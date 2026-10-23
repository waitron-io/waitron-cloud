import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {source,digest} from './schema-upgrade-fixture.mjs';

const tables=['backup_locations','backup_key_versions','backup_captures','backup_points','backup_verifications','backup_jobs','backup_recovery_requests','backup_recoveries','backup_verification_policy','backup_verification_attempts'];
export async function backupState(pool){
 const value={};
 for(const table of tables)if((await pool.query('SELECT to_regclass($1) AS name',[table])).rows[0].name!==null)value[table]=(await pool.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
 return value;
}
export async function seedLegacyBackups(root,pool,state){
 const {BackupKeyVault}=await source(root,'packages/backups/src/keys.ts');
 const vault=new BackupKeyVault(randomBytes(32)),installed=state.installations[0],owner=state.owners[0],pointId=randomUUID(),holdId=randomUUID(),requestId=randomUUID();
 const sealed=vault.create(installed.venueId,1);
 await pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://storage.test',$3,'local')",[installed.venueId,installed.installationId,'upgrade-'+randomUUID()]);
 await pool.query('INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,$2)',[installed.venueId,sealed]);
 await pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,1)',[pointId,installed.venueId,installed.installationId]);
 await pool.query(`INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification)
 VALUES($1,$2,$3,1,'snapshot',$4,$5,42,clock_timestamp(),'daily',$6,'{"core":1}','verified')`,[pointId,installed.venueId,installed.installationId,'snapshots/'+pointId,'1'.repeat(64),randomUUID()]);
 await pool.query("INSERT INTO backup_verifications(id,point_id,digest,verifier,outcome) VALUES($1,$2,$3,'synthetic-legacy-upgrade','verified')",[randomUUID(),pointId,'1'.repeat(64)]);
 const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 await pool.query('INSERT INTO backup_recovery_requests(id,public_key,code_hash) VALUES($1,$2,$3)',[requestId,publicKey,'5'.repeat(64)]);
 await pool.query("INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode) VALUES($1,$2,$3,$4,$5,'failure')",[holdId,installed.venueId,pointId,owner.accountId,publicKey]);
 return {pointId,holdId,requestId,venueId:installed.venueId,vault,keys:vault.open(installed.venueId,1,sealed),before:await backupState(pool)};
}
export async function upgradedBackups(root,pool,state,proof){
 const after=await backupState(pool),extra=['current_evidence_id','last_attempt_id','protocol_version','verification_target','verification_attempt_id'];
 for(const [table,rows] of Object.entries(proof.before)){
  const current=structuredClone(after[table]);for(const row of current)for(const key of extra)if(!Object.hasOwn(rows.find(r=>r.value.id===row.value.id)?.value??{},key))delete row.value[key];
  assert.equal(digest(current),digest(rows),table+' preserved');
 }
 const p=(await pool.query('SELECT current_verification,verification_id FROM backup_point_qualification WHERE point_id=$1',[proof.pointId])).rows[0];
 assert.deepEqual(p,{current_verification:'pending',verification_id:null});
 assert.deepEqual((await pool.query('SELECT current_evidence_id,last_attempt_id FROM backup_points WHERE id=$1',[proof.pointId])).rows[0],{current_evidence_id:null,last_attempt_id:null});
 assert.deepEqual((await pool.query('SELECT protocol_version,verification_target FROM backup_recovery_requests WHERE id=$1',[proof.requestId])).rows[0],{protocol_version:null,verification_target:null});
 assert.deepEqual((await pool.query('SELECT verification_attempt_id,verification_target FROM backup_recoveries WHERE id=$1',[proof.holdId])).rows[0],{verification_attempt_id:null,verification_target:null});
 const row=(await pool.query('SELECT sealed FROM backup_key_versions WHERE venue_id=$1',[proof.venueId])).rows[0];assert.deepEqual(proof.vault.open(proof.venueId,1,row.sealed),proof.keys);
 const {BackupKeyVault}=await source(root,'packages/backups/src/keys.ts');
 assert.throws(()=>new BackupKeyVault(randomBytes(32)).open(proof.venueId,1,row.sealed),/key_unavailable/);
 assert.throws(()=>proof.vault.open(randomUUID(),1,row.sealed),/key_unavailable/);
 return {legacyUnqualified:true,historyPreserved:true,keysPreserved:true,holdsPreserved:true};
}
// Synthetic evidence proves database migration and binding preservation, never archive or image qualification.
export async function freshBackupEvidence(root,pool,state,proof){
 const {BackupCatalogue}=await source(root,'packages/backups/src/catalogue.ts'),{receipt}=await source(root,'packages/backups/src/storage.ts');
 const {admitPointFixture,fixtureTarget}=await source(root,'packages/backups/test/fixtures/verification.ts');
 const {RecoveryRequests}=await source(root,'packages/backups/src/recovery-request.ts');
 const data=new Map(),store={async read(k){return data.get(k);},async put(k,b){data.set(k,Buffer.from(b));return receipt(b);},async remove(k){data.delete(k);}};
 const catalogue=new BackupCatalogue(pool,proof.vault,()=>store),installed=state.installations[1],owner=state.owners[1];
 await catalogue.provision(installed.installationId,{endpoint:'https://storage.test',region:'local',bucket:'fresh-upgrade-'+randomUUID()});
 const capture=await catalogue.reserveCapture(installed.installationId,randomUUID()),bytes=Buffer.from('synthetic-upgrade-archive');data.set(capture.incomingKey,bytes);
 const point=await catalogue.publish(installed.installationId,capture.id,{...receipt(bytes),capturedAt:new Date().toISOString(),retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}});
 const attempt=await admitPointFixture(pool,point.id);assert.equal((await pool.query('SELECT current_verification FROM backup_point_qualification WHERE point_id=$1',[point.id])).rows[0].current_verification,'verified');
 const key=generateKeyPairSync('ed25519'),id=randomUUID(),code='12345678',origin='http://127.0.0.1:3000',publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const bytesToSign=Buffer.from(JSON.stringify(['waitron-cloud-recovery-request-v2',origin,id,'start',publicKey,code,fixtureTarget.digest,Date.now()]));
 const requests=new RecoveryRequests(pool,proof.vault,origin,{activeKeyId:'upgrade-recovery',keys:{'upgrade-recovery':randomBytes(32).toString('hex')}});
 await requests.machine('start',{version:2,target:fixtureTarget,payload:bytesToSign.toString('base64url'),signature:sign(null,bytesToSign,key.privateKey).toString('base64url')});
 await requests.approve(id,code,owner.credentials.token,owner.credentials.csrfToken,{pointId:point.id,oldServerUnavailable:true,acceptDataLoss:true});
 const operation=(await pool.query('SELECT verification_attempt_id,verification_target FROM backup_recoveries WHERE id=$1',[id])).rows[0];
 assert.equal(operation.verification_attempt_id,attempt.id);assert.deepEqual(operation.verification_target,fixtureTarget);
 proof.freshPointId=point.id;proof.freshRecoveryId=id;proof.attemptId=attempt.id;proof.target=fixtureTarget;
 return {freshEvidence:true,v2Binding:true};
}
export async function restoredBackups(root,pool,proof,expected){
 assert.equal(digest(await backupState(pool)),digest(expected),'entire restored backup graph');
 const key=(await pool.query('SELECT sealed FROM backup_key_versions WHERE venue_id=$1',[proof.venueId])).rows[0];assert.deepEqual(proof.vault.open(proof.venueId,1,key.sealed),proof.keys);
 const states=(await pool.query('SELECT point_id,current_verification,verification_id FROM backup_point_qualification WHERE point_id=ANY($1::uuid[]) ORDER BY point_id',[[proof.pointId,proof.freshPointId]])).rows;
 assert.deepEqual(states.find(p=>p.point_id===proof.pointId),{point_id:proof.pointId,current_verification:'pending',verification_id:null});
 assert.deepEqual(states.find(p=>p.point_id===proof.freshPointId),{point_id:proof.freshPointId,current_verification:'verified',verification_id:proof.attemptId});
 const op=(await pool.query('SELECT verification_attempt_id,verification_target FROM backup_recoveries WHERE id=$1',[proof.freshRecoveryId])).rows[0];assert.equal(op.verification_attempt_id,proof.attemptId);assert.deepEqual(op.verification_target,proof.target);
 assert.equal((await pool.query('SELECT point_id FROM backup_recoveries WHERE id=$1',[proof.holdId])).rows[0].point_id,proof.pointId);
 return {restoredEvidence:true,restoredHistory:true,restoredKeys:true,restoredHolds:true,restoredV2Binding:true,restoredLegacyUnqualified:true};
}
export async function seedBackupMonitoring(root,pool,email){
 const {MonitorWorker}=await source(root,'packages/registration/src/monitoring.ts');
 const {EmailOutbox}=await source(root,'packages/registration/src/email-outbox.ts');
 await pool.query("UPDATE installation_services SET state='ready' WHERE service='remote_access'");
 await pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '1 day'");
 const monitor=new MonitorWorker(pool,new EmailOutbox(email),{quietSeconds:3600,reminderSeconds:3600});
 await monitor.schedule();while(await monitor.runOnce()){}
 assert.notEqual((await pool.query('SELECT count(*) FROM venue_alert_episodes')).rows[0].count,'0');
}
