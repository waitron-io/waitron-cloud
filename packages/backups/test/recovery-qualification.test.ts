import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {transaction} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {machineTarget,otherTarget,recoveryFixture,origin} from './fixtures/recovery-v2.ts';
import {fixtureTarget,fixtureImage,verificationOutput,verifyPointFixture} from './fixtures/verification.ts';
import {setVerificationPolicy} from '../src/verification-admission.ts';
import {RemoteAccessStore} from '../../remote-access/src/placement.ts';
import {ReplacementStore,replacementPayload} from '../src/replacement.ts';
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
async function approved(){
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start'));
 await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input);
 return {...f,t};
}
async function replacement(){
 const f=await approved();await f.recovery.target(f.t.id,'restored',f.t.envelope('restored',f.point.digest));
 const key=generateKeyPairSync('ed25519'),claims={id:f.t.id,localVenueId:f.binding.localVenueId,nodeId:f.point.sourceNodeId,publicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),peerPublicKey:randomBytes(32).toString('base64')};
 return {...f,store:new ReplacementStore(db.pool,f.vault,origin),confirmation:{oldInstallationId:f.installed.installationId,oldServerUnavailable:true,confirmReplacement:true},
 envelope(action:'prepare'|'status'){const bytes=replacementPayload(origin,action,claims,Date.now());return {id:f.t.id,payload:bytes.toString('base64url'),signature:f.t.sign(bytes),keySignature:sign(null,bytes,key.privateKey).toString('base64url')};}};
}
async function noReplacement(f:Awaited<ReturnType<typeof replacement>>){
 const row=(await db.pool.query('SELECT revoked_at,superseded_by FROM installations WHERE id=$1',[f.installed.installationId])).rows[0];
 assert.deepEqual(row,{revoked_at:null,superseded_by:null});
 assert.equal((await db.pool.query('SELECT count(*) FROM installations WHERE venue_id=$1',[f.installed.venueId])).rows[0].count,'1');
 assert.equal((await db.pool.query('SELECT active_key_version FROM backup_locations WHERE venue_id=$1',[f.installed.venueId])).rows[0].active_key_version,1);
 assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='replacement.approved' AND source_id=$1",[f.t.id])).rows[0].count,'0');
}
// Removing the current qualification/evidence check would disclose keys or register a replacement in these cases.
for(const fault of ['release','policy','new-success','unavailable','invalid','deleting','metadata','legacy-operation'] as const)test(`all snapshot access rechecks ${fault} after approval`,async context=>{
 const f=await approved();let unseals=0;const unseal=f.vault.open.bind(f.vault);context.mock.method(f.vault,'open',(...args:Parameters<typeof unseal>)=>{unseals++;return unseal(...args);});
 if(fault==='release')await db.pool.query('UPDATE backup_verification_policy SET release_ready=false');
 if(fault==='policy')await transaction(db.pool,c=>setVerificationPolicy(c,otherTarget(),fixtureImage,true));
 if(fault==='new-success')await verifyPointFixture(db.pool,f.catalogue,f.point.id);
 if(fault==='unavailable')await verifyPointFixture(db.pool,f.catalogue,f.point.id,async()=>{throw Error('storage unavailable');});
 if(fault==='invalid')await verifyPointFixture(db.pool,f.catalogue,f.point.id,async(_s,_k,r)=>verificationOutput(r,'invalid','archive_invalid'));
 if(fault==='deleting')await db.pool.query('UPDATE backup_points SET deleting=true WHERE id=$1',[f.point.id]);
 if(fault==='metadata')await db.pool.query('UPDATE backup_points SET size=size+1 WHERE id=$1',[f.point.id]);
 if(fault==='legacy-operation')await db.pool.query('UPDATE backup_recoveries SET verification_target=NULL,verification_attempt_id=NULL WHERE id=$1',[f.t.id]);
 unseals=0;
 for(const action of ['info','read','restored'] as const){
  await assert.rejects(f.recovery.target(f.t.id,action as 'read',f.t.envelope(action,action==='info'?'':f.point.digest,Date.now(),origin,fault==='legacy-operation'?1:2)),/unverified|unavailable/);
  assert.equal((await db.pool.query('SELECT status,restored_at FROM backup_recoveries WHERE id=$1',[f.t.id])).rows[0].status,'pending');
  assert.equal((await db.pool.query('SELECT restored_at FROM backup_recoveries WHERE id=$1',[f.t.id])).rows[0].restored_at,null);
 }
 assert.equal(unseals,0);assert.equal((await db.pool.query('SELECT revoked_at FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].revoked_at,null);
});
for(const request of ['absent','v1'] as const)test(`approval requires a persisted v2 request when ${request} and legacy success is retained`,async()=>{
 const f=await recoveryFixture(db,false),t=machineTarget();
 if(request==='v1')await f.requests.machine('start',t.envelope('start','',Date.now(),origin,1));
 const input={...f.input,id:t.id,mode:'failure' as const,targetPublicKey:t.publicKey};
 await assert.rejects(f.recovery.start(f.session.token,f.session.csrfToken,input),/unverified/);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_recoveries WHERE id=$1',[t.id])).rows[0].count,'0');
});
test('default selection ignores an unqualified legacy flag and a release-disabled pass',async()=>{
 const f=await recoveryFixture(db,false);
 assert.equal((await f.recovery.catalogue(f.session.token,f.installed.venueId)).defaultPointId,null);
 await transaction(db.pool,c=>setVerificationPolicy(c,fixtureTarget,fixtureImage,true));await verifyPointFixture(db.pool,f.catalogue,f.point.id);
 assert.equal((await f.recovery.catalogue(f.session.token,f.installed.venueId)).defaultPointId,f.point.id);
 await db.pool.query('UPDATE backup_points SET current_evidence_id=NULL,last_attempt_id=NULL WHERE id=$1',[f.point.id]);
 assert.equal((await f.recovery.catalogue(f.session.token,f.installed.venueId)).defaultPointId,null);
});
for(const stage of ['prepare','prepared-status','complete','completed-status','completed-prepare','completed-owner','completed-inspect'] as const)test(`replacement cannot outlive qualification at ${stage}`,async context=>{
 const f=await replacement();
 if(stage!=='prepare')await f.store.machine('prepare',f.envelope('prepare'));
 const completed=stage.startsWith('completed-');if(completed)await f.store.complete(f.t.id,f.session.token,f.session.csrfToken,f.confirmation);
 let rotations=0;const create=f.vault.create.bind(f.vault);context.mock.method(f.vault,'create',(...args:Parameters<typeof create>)=>{rotations++;return create(...args);});
 await db.pool.query('UPDATE backup_verification_policy SET release_ready=false');
 const call=stage==='complete'||stage==='completed-owner'?f.store.complete(f.t.id,f.session.token,f.session.csrfToken,f.confirmation)
 :stage==='completed-inspect'?f.store.inspect(f.t.id,f.session.token,f.session.csrfToken)
 :f.store.machine(stage==='prepare'||stage==='completed-prepare'?'prepare':'status',f.envelope(stage==='prepare'||stage==='completed-prepare'?'prepare':'status'));
 await assert.rejects(call,/unavailable|unverified/);assert.equal(rotations,0);
 if(!completed)await noReplacement(f);
});
test('replacement cannot silently adopt a newer success for the same target',async()=>{
 const f=await replacement();await f.store.machine('prepare',f.envelope('prepare'));await verifyPointFixture(db.pool,f.catalogue,f.point.id);
 await assert.rejects(f.store.complete(f.t.id,f.session.token,f.session.csrfToken,f.confirmation),/unavailable|unverified/);await noReplacement(f);
});
test('restored report changes no registration, keys, routing, or activation state',async()=>{
 const f=await approved();
 const snapshot=async()=>({installations:(await db.pool.query('SELECT * FROM installations WHERE venue_id=$1 ORDER BY id',[f.installed.venueId])).rows,keys:(await db.pool.query('SELECT * FROM backup_key_versions WHERE venue_id=$1 ORDER BY version',[f.installed.venueId])).rows,routes:(await db.pool.query('SELECT * FROM remote_placements WHERE venue_id=$1',[f.installed.venueId])).rows,services:(await db.pool.query('SELECT * FROM installation_services WHERE installation_id=$1 ORDER BY service',[f.installed.installationId])).rows});
 const before=await snapshot();await f.recovery.target(f.t.id,'restored',f.t.envelope('restored',f.point.digest));
 assert.deepEqual(await snapshot(),before);assert.equal((await f.recovery.status(f.session.token,f.t.id)).status,'restored');
});
async function blockedBy(id:number,observer:Pick<typeof db.secondPool,'query'>=db.secondPool){
 const until=Date.now()+4000;
 while(Date.now()<until){const row=(await observer.query('SELECT query FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[db.schema,id])).rows[0];if(row)return String(row.query);await new Promise(r=>setTimeout(r,10));}
 assert.fail('operation must wait for the acknowledged PostgreSQL lock');
}
test('approval rechecks qualification after waiting for the selected point foreign key',async()=>{
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start'));
 const blocker=await db.secondPool.connect(),id=(await blocker.query('SELECT pg_backend_pid() AS id')).rows[0].id;let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM backup_points WHERE id=$1 FOR UPDATE',[f.point.id]);
  pending=f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input);const refused=assert.rejects(pending,/unverified/);void refused.catch(()=>{});
  assert.match(await blockedBy(id),/INSERT INTO backup_recoveries/);
  await blocker.query('UPDATE backup_points SET size=size+1 WHERE id=$1',[f.point.id]);await blocker.query('COMMIT');await refused;
  assert.equal((await db.pool.query('SELECT count(*) FROM backup_recoveries WHERE id=$1',[t.id])).rows[0].count,'0');
  assert.equal((await db.pool.query('SELECT operation_id FROM backup_recovery_requests WHERE id=$1',[t.id])).rows[0].operation_id,null);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});
for(const action of ['approve','read','replace','completed-replay'] as const)test(`${action} locks policy before the venue and observes a committed policy change`,async()=>{
 const f=action==='replace'||action==='completed-replay'?await replacement():await approved(),t=f.t;
 if('confirmation' in f){await f.store.machine('prepare',f.envelope('prepare'));if(action==='completed-replay')await f.store.complete(t.id,f.session.token,f.session.csrfToken,f.confirmation);}
 if(action==='approve')await f.recovery.close(f.session.token,f.session.csrfToken,t.id);
 const next=machineTarget();if(action==='approve')await f.requests.machine('start',next.envelope('start'));
 const blocker=await db.secondPool.connect(),id=(await blocker.query('SELECT pg_backend_pid() AS id')).rows[0].id;let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('UPDATE backup_verification_policy SET release_ready=false');
  pending=action==='approve'?f.requests.approve(next.id,next.code,f.session.token,f.session.csrfToken,f.input):'confirmation' in f?(action==='completed-replay'?f.store.machine('status',f.envelope('status')):f.store.complete(t.id,f.session.token,f.session.csrfToken,f.confirmation)):f.recovery.target(t.id,'read',t.envelope('read',f.point.digest));
  const refused=assert.rejects(pending,/unverified|unavailable/);void refused.catch(()=>{});
  assert.match(await blockedBy(id),/backup_verification_policy.*FOR SHARE/);
  await blocker.query("SET LOCAL lock_timeout='2s'");await blocker.query('SELECT venue_id FROM backup_locations WHERE venue_id=$1 FOR UPDATE',[f.installed.venueId]);
  await blocker.query('COMMIT');await refused;if('confirmation' in f&&action!=='completed-replay')await noReplacement(f);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});
for(const mutation of ['metadata','deleting'] as const)test(`delivery rechecks ${mutation} after an acknowledged key wait`,async()=>{
 const f=await approved(),blocker=await db.secondPool.connect(),id=(await blocker.query('SELECT pg_backend_pid() AS id')).rows[0].id;let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('LOCK backup_key_versions IN ACCESS EXCLUSIVE MODE');
  pending=f.recovery.target(f.t.id,'read',f.t.envelope('read',f.point.digest));const refused=assert.rejects(pending,/unverified|unavailable/);void refused.catch(()=>{});
  assert.match(await blockedBy(id),/SELECT sealed FROM backup_key_versions/);
  await blocker.query(`UPDATE backup_points SET ${mutation==='metadata'?'size=size+1':'deleting=true'} WHERE id=$1`,[f.point.id]);
  await blocker.query('COMMIT');await refused;
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});
test('completed replay locks the current installation before the backup venue',async()=>{
 const f=await replacement();await f.store.machine('prepare',f.envelope('prepare'));const result=await f.store.complete(f.t.id,f.session.token,f.session.csrfToken,f.confirmation);
 const blocker=await db.secondPool.connect(),id=(await blocker.query('SELECT pg_backend_pid() AS id')).rows[0].id;let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query("SET LOCAL lock_timeout='2s'");await blocker.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[result.registration.installationId]);
  pending=f.store.machine('status',f.envelope('status'));void pending.catch(()=>{});
  assert.match(await blockedBy(id),/SELECT id FROM installations/);
  await blocker.query('SELECT venue_id FROM backup_locations WHERE venue_id=$1 FOR UPDATE',[f.installed.venueId]);
  await blocker.query('COMMIT');assert.deepEqual(await pending,result);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});
for(const expiry of ['operation','proof'] as const)test(`info rechecks ${expiry} expiry after a qualification lookup waits`,async()=>{
 const f=await approved(),blocker=await db.secondPool.connect(),id=(await blocker.query('SELECT pg_backend_pid() AS id')).rows[0].id,proof=f.t.envelope('info'),now=Date.now;let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('LOCK backup_verification_attempts IN ACCESS EXCLUSIVE MODE');
  pending=f.recovery.target(f.t.id,'info',proof);const refused=assert.rejects(pending,expiry==='operation'?/unavailable/:/invalid_proof/);void refused.catch(()=>{});
  assert.match(await blockedBy(id),/FROM backup_point_qualification/);
  if(expiry==='operation')await blocker.query("UPDATE backup_recoveries SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[f.t.id]);
  else Date.now=()=>now()+61000;
  await blocker.query('COMMIT');await refused;
 }finally{Date.now=now;await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});
test('direct snapshot start cannot outlive its persisted request while inserting the operation',async()=>{
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start'));
 await db.pool.query("UPDATE backup_recovery_requests SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[t.id]);
 const blocker=await db.secondPool.connect(),id=(await blocker.query('SELECT pg_backend_pid() AS id')).rows[0].id;let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM backup_points WHERE id=$1 FOR UPDATE',[f.point.id]);
  pending=f.recovery.start(f.session.token,f.session.csrfToken,{...f.input,id:t.id,targetPublicKey:t.publicKey,mode:'failure'});const refused=assert.rejects(pending,/unavailable/);void refused.catch(()=>{});
  assert.match(await blockedBy(id),/INSERT INTO backup_recoveries/);await new Promise(r=>setTimeout(r,1100));
  await blocker.query('COMMIT');await refused;
  assert.equal((await db.pool.query('SELECT count(*) FROM backup_recoveries WHERE id=$1',[t.id])).rows[0].count,'0');
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('replacement rolls registration, rotation and routing back when qualification changes during key insertion',async()=>{
 const f=await replacement(),remote=new RemoteAccessStore(db.pool),cell=crypto.randomUUID();
 await remote.createCell({id:cell,country:'ES',provider:'aws',environment:'test',suffix:'qualification.test',subnet:46,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.test:51820'});
 await remote.provision(f.installed.installationId,cell,randomBytes(32).toString('base64'));
 await f.store.machine('prepare',f.envelope('prepare'));
 const original=(await db.pool.query('SELECT * FROM remote_placements WHERE venue_id=$1',[f.installed.venueId])).rows;
 const blocker=await db.secondPool.connect(),id=(await blocker.query('SELECT pg_backend_pid() AS id')).rows[0].id;let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('LOCK backup_key_versions IN ACCESS EXCLUSIVE MODE');
  pending=f.store.complete(f.t.id,f.session.token,f.session.csrfToken,f.confirmation);const refused=assert.rejects(pending,/unavailable/);void refused.catch(()=>{});
  assert.match(await blockedBy(id),/INSERT INTO backup_key_versions/);
  await blocker.query('UPDATE backup_points SET size=size+1 WHERE id=$1',[f.point.id]);await blocker.query('COMMIT');await refused;
  await noReplacement(f);assert.deepEqual((await db.pool.query('SELECT * FROM remote_placements WHERE venue_id=$1',[f.installed.venueId])).rows,original);
  assert.equal((await db.pool.query('SELECT result FROM installation_replacements WHERE id=$1',[f.t.id])).rows[0].result,null);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

// A backend can advance after the activity snapshot but before the live blocker check.
test('wait observation refreshes activity after acknowledging the blocker',async context=>{
 const f=await approved(),holder=await db.secondPool.connect(),waiter=await db.pool.connect(),observer=await db.secondPool.connect();
 const holderPid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 const waiterPid=(await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 const observerPid=(await observer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 let observation:Promise<string>|undefined,lookup:Promise<unknown>|undefined;
 async function acknowledged(pid:number,stage:string){
  const until=Date.now()+4000;
  while(Date.now()<until){
   if((await db.pool.query('SELECT $2::integer=ANY(pg_catalog.pg_blocking_pids($1)) AS blocked',[pid,holderPid])).rows[0].blocked)return;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail(`${stage} must reach its acknowledged lock`);
 }
 try{
  await holder.query('BEGIN');await holder.query('LOCK backup_verification_attempts IN ACCESS EXCLUSIVE MODE');
  await holder.query('SELECT pg_advisory_lock($1)',[holderPid]);
  await waiter.query('SELECT expires_at>clock_timestamp() AS valid FROM backup_recoveries WHERE id=$1',[f.t.id]);
  await holder.query(`CREATE FUNCTION ${db.schema}.pg_blocking_pids(integer) RETURNS integer[] LANGUAGE plpgsql AS $$
   BEGIN
    IF $1=${waiterPid} THEN PERFORM pg_advisory_xact_lock(${holderPid}); END IF;
    RETURN pg_catalog.pg_blocking_pids($1);
   END $$`);
  // Publish the gate without releasing the separate session advisory lock.
  await holder.query('COMMIT');await holder.query('BEGIN');await holder.query('LOCK backup_verification_attempts IN ACCESS EXCLUSIVE MODE');
  await observer.query(`SET search_path=${db.schema},pg_catalog`);
  observation=blockedBy(holderPid,observer);void observation.catch(()=>{});
  await acknowledged(observerPid,'activity snapshot captured before live blocker check');
  lookup=waiter.query('SELECT * FROM backup_point_qualification WHERE point_id=$1',[f.point.id]);void lookup.catch(()=>{});
  await acknowledged(waiterPid,'qualification lookup');
  const fields='pid,query,query_start,state,wait_event_type,wait_event';
  context.diagnostic(JSON.stringify({stage:'qualification blocked before observer resumes',blockerPid:holderPid,waiter:(await db.pool.query(`SELECT ${fields} FROM pg_stat_activity WHERE pid=$1`,[waiterPid])).rows[0],observer:(await db.pool.query(`SELECT ${fields} FROM pg_stat_activity WHERE pid=$1`,[observerPid])).rows[0]}));
  await holder.query('SELECT pg_advisory_unlock($1)',[holderPid]);
  const observed=await observation;
  context.diagnostic(JSON.stringify({stage:'acknowledged wait query returned',blockerPid:holderPid,waiterPid,observed}));
  assert.match(observed,/FROM backup_point_qualification/);
 }finally{
  await holder.query('SELECT pg_advisory_unlock($1)',[holderPid]);await holder.query('ROLLBACK');
  await Promise.allSettled([lookup,observation].filter(Boolean));
  await observer.query(`SET search_path=${db.schema}`);
  await holder.query(`DROP FUNCTION IF EXISTS ${db.schema}.pg_blocking_pids(integer)`);
  holder.release();waiter.release();observer.release();
 }
});
