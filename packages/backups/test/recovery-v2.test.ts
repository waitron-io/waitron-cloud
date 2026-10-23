import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createPublicKey,verify,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {ManagedStreams} from '../src/managed-streams.ts';
import {verifyPointFixture} from './fixtures/verification.ts';
import {requestPayloadV2,recoveryPayloadV2} from '../src/recovery-v2.ts';
import {database} from '../../account-http/test/fixtures.ts';
import {verifyRecoveryRequest,requestPayload} from '../src/recovery-request.ts';
import {fixtureTarget} from './fixtures/verification.ts';
import {machineTarget,otherTarget,recoveryFixture,origin} from './fixtures/recovery-v2.ts';
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
test('v2 accepts the complete pinned 15-owner target in Waitron signed request bytes',()=>{
 const t=machineTarget();assert.equal(t.target.modules.length,15);
 const proof=t.envelope('start');const claims=verifyRecoveryRequest(origin,'start',proof);
 assert.equal(claims.id,t.id);assert.equal(claims.publicKey,t.publicKey);
 assert.deepEqual(JSON.parse(Buffer.from(proof.payload,'base64url').toString()),['waitron-cloud-recovery-request-v2',origin,t.id,'start',t.publicKey,t.code,fixtureTarget.digest,JSON.parse(Buffer.from(proof.payload,'base64url').toString()).at(-1)]);
});
test('v2 persists exact target and key, accepts 32 owners, and never downgrades or substitutes a target',async()=>{
 const f=await recoveryFixture(db),t=machineTarget(otherTarget());
 const pending=await f.requests.machine('start',t.envelope('start'));assert.equal(pending.version,2);assert.equal(pending.state,'awaiting_owner');
 const row=(await db.pool.query('SELECT * FROM backup_recovery_requests WHERE id=$1',[t.id])).rows[0];
 assert.equal(row.protocol_version,2);assert.deepEqual(row.verification_target,t.target);assert.equal(row.public_key,t.publicKey);assert.notEqual(row.code_hash,t.code);
 assert.deepEqual(await f.requests.machine('start',t.envelope('start')),pending);
 assert.deepEqual(await f.requests.machine('status',t.envelope('status')),pending);
 await assert.rejects(f.requests.machine('status',t.envelope('status','',Date.now(),origin,1)),/conflict|invalid_proof/);
 const original=t.target;t.target=fixtureTarget;await assert.rejects(f.requests.machine('start',t.envelope('start')),/conflict/);t.target=original;
 const different=machineTarget(t.target);different.id=t.id;await assert.rejects(f.requests.machine('start',different.envelope('start')),/conflict/);
 assert.deepEqual((await db.pool.query('SELECT verification_target FROM backup_recovery_requests WHERE id=$1',[t.id])).rows[0].verification_target,original);
 const legacy=machineTarget();await f.requests.machine('start',legacy.envelope('start','',Date.now(),origin,1));
 await assert.rejects(f.requests.machine('start',legacy.envelope('start')),/conflict/);
});
for(const fault of ['origin','action','signature','clock','target','missing-target','mixed-version'] as const)test(`v2 request refuses ${fault} before storing a request`,async()=>{
 const f=await recoveryFixture(db),t=machineTarget(),proof=t.envelope('start','',fault==='clock'?Date.now()-120000:Date.now(),fault==='origin'?'https://other.test':origin);
 if(fault==='signature')proof.signature='A'.repeat(86);
 if(fault==='target')proof.target=otherTarget();
 if(fault==='missing-target')delete (proof as unknown as Record<string,unknown>).target;
 if(fault==='mixed-version')(proof as unknown as Record<string,unknown>).version=1;
 await assert.rejects(f.requests.machine(fault==='action'?'status':'start',proof),/invalid_proof/);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_recovery_requests WHERE id=$1',[t.id])).rows[0].count,'0');
});
test('v2 snapshot returns the persisted descriptor on info/read/restored and refuses v1 proofs',async()=>{
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start'));
 const approved=await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input);assert.equal(approved.state,'approved');
 const saved=(await db.pool.query('SELECT * FROM backup_recoveries WHERE id=$1',[t.id])).rows[0];assert.deepEqual(saved.verification_target,t.target);assert(saved.verification_attempt_id);
 const a=(await db.pool.query('SELECT * FROM backup_verification_attempts WHERE id=$1',[saved.verification_attempt_id])).rows[0];
 const expected={protocol:'backup-data-restore/v1',target:t.target,policyDigest:t.target.policyDigest,requestDigest:a.request_digest,archiveSha256:f.point.digest,archiveBytes:f.point.size,pointId:f.point.id};
 for(const action of ['info','read','restored'] as const){
  const result=await f.recovery.target(t.id,action as 'read',t.envelope(action,action==='info'?'':f.point.digest));
  assert.equal(result.version,2);assert.deepEqual(result.verification,expected);assert(Buffer.byteLength(JSON.stringify(result))<=65536);
  await assert.rejects(f.recovery.target(t.id,action as 'read',t.envelope(action,action==='info'?'':f.point.digest,Date.now(),origin,1)),/invalid_proof/);
 }
 assert.equal((await f.recovery.status(f.session.token,t.id)).status,'restored');
 assert.equal((await db.pool.query('SELECT revoked_at FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].revoked_at,null);
});
test('a v1 request cannot approve a currently qualified snapshot, and release-off v2 cannot approve',async()=>{
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start','',Date.now(),origin,1));
 await assert.rejects(f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input),/unverified/);
 const v2=machineTarget();await f.requests.machine('start',v2.envelope('start'));await db.pool.query('UPDATE backup_verification_policy SET release_ready=false');
 await assert.rejects(f.requests.approve(v2.id,v2.code,f.session.token,f.session.csrfToken,f.input),/unverified/);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_recoveries WHERE id=ANY($1::uuid[])',[[t.id,v2.id]])).rows[0].count,'0');
});
test('request signature time is rechecked after an acknowledged request-row lock wait',async()=>{
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start'));
 const blocker=await db.secondPool.connect(),blockerId=(await blocker.query('SELECT pg_backend_pid() AS id')).rows[0].id,proof=t.envelope('status');let pending:Promise<unknown>|undefined;
 const now=Date.now;let advance=0;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM backup_recovery_requests WHERE id=$1 FOR UPDATE',[t.id]);
  pending=f.requests.machine('status',proof);const refused=assert.rejects(pending,/invalid_proof/);void refused.catch(()=>{});
  const until=now()+3000;let waiting=false;while(now()<until){if((await db.secondPool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[db.schema,blockerId])).rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}assert(waiting,'request must wait on the acknowledged blocker');
  advance=61000;Date.now=()=>now()+advance;await blocker.query('COMMIT');await refused;
 }finally{Date.now=now;await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('literal Ed25519 vectors match both Waitron v2 namespaces and preserve v1 bytes',()=>{
 const id='11111111-1111-4111-8111-111111111111',key='MCowBQYDK2VwAyEAiojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w',digest='27b6669fe7367c9619bd71fb7ac6ce0edcd97d5a7f3c6e83d953468ed62932c5';
 const request='["waitron-cloud-recovery-request-v2","https://cloud.test","11111111-1111-4111-8111-111111111111","start","MCowBQYDK2VwAyEAiojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","12345678","27b6669fe7367c9619bd71fb7ac6ce0edcd97d5a7f3c6e83d953468ed62932c5",1700000000000]';
 const recovery='["waitron-cloud-recovery-v2","https://cloud.test","11111111-1111-4111-8111-111111111111","read","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","27b6669fe7367c9619bd71fb7ac6ce0edcd97d5a7f3c6e83d953468ed62932c5",1700000000000]';
 assert.equal(requestPayloadV2(origin,id,'start',key,'12345678',digest,1700000000000).toString(),request);
 assert.equal(recoveryPayloadV2(origin,id,'read','a'.repeat(64),digest,1700000000000).toString(),recovery);
 assert.equal(requestPayload(origin,id,'start',key,'12345678',1700000000000).toString(),'["waitron-cloud-recovery-request-v1","https://cloud.test","11111111-1111-4111-8111-111111111111","start","MCowBQYDK2VwAyEAiojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","12345678",1700000000000]');
 const publicKey=createPublicKey({key:Buffer.from(key,'base64url'),format:'der',type:'spki'});
 assert(verify(null,Buffer.from(request),publicKey,Buffer.from('ED83OK8nmfr_cdkQDdAgpKypF7cRUhVmSK-h01U7bnsxkpnAbNxgR19DSIMMBS2SUOhNUau1OvXAFMQOhFe4Dg','base64url')));
 assert(verify(null,Buffer.from(recovery),publicKey,Buffer.from('c6axk-1kSspEaLvLfbtWKSQ6PIoALHOdY4goXheo-x-jkbHamg6GgIzRxVwy0PHuEhfiePs6dU9dIz2Cc99DBA','base64url')));
});
for(const fault of ['origin','signature','clock','digest','target','missing-target','mixed-version','action'] as const)test(`v2 target actions refuse ${fault} without keys or a restored report`,async()=>{
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start'));await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input);
 for(const action of ['info','read','restored'] as const){
  const proof=t.envelope(action,action==='info'?'':fault==='digest'?'b'.repeat(64):f.point.digest,fault==='clock'?Date.now()-120000:Date.now(),fault==='origin'?'https://other.test':origin);
  if(fault==='signature')proof.signature='A'.repeat(86);
  if(fault==='target')proof.target=otherTarget();
  if(fault==='missing-target')delete (proof as unknown as Record<string,unknown>).target;
  if(fault==='mixed-version')(proof as unknown as Record<string,unknown>).version=1;
  if(fault==='digest'&&action==='info')continue;
  await assert.rejects(f.recovery.target(t.id,(fault==='action'?(action==='info'?'read':'info'):action) as 'read',proof),/invalid_proof/);
  assert.equal((await db.pool.query('SELECT status FROM backup_recoveries WHERE id=$1',[t.id])).rows[0].status,'pending');
 }
});

test('approval refuses a valid requested target different from the qualified archive target',async()=>{
 const f=await recoveryFixture(db),t=machineTarget(otherTarget());await f.requests.machine('start',t.envelope('start'));
 await assert.rejects(f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input),/unverified/);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_recoveries WHERE id=$1',[t.id])).rows[0].count,'0');
 assert.equal((await db.pool.query('SELECT operation_id FROM backup_recovery_requests WHERE id=$1',[t.id])).rows[0].operation_id,null);
});
test('target delivery refuses when a stored operation target differs from its selected immutable attempt',async()=>{
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start'));await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input);
 t.target=otherTarget();await db.pool.query('UPDATE backup_recoveries SET verification_target=$2 WHERE id=$1',[t.id,t.target]);
 await assert.rejects(f.recovery.target(t.id,'read',t.envelope('read',f.point.digest)),/unverified/);
 assert.equal((await db.pool.query('SELECT status FROM backup_recoveries WHERE id=$1',[t.id])).rows[0].status,'pending');
});

test('owner replay cannot substitute a newer verification attempt for the approved operation',async()=>{
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start'));await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input);
 const saved=(await db.pool.query('SELECT verification_attempt_id FROM backup_recoveries WHERE id=$1',[t.id])).rows[0];
 await verifyPointFixture(db.pool,f.catalogue,f.point.id);
 await assert.rejects(f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input),/conflict/);
 assert.deepEqual((await db.pool.query('SELECT verification_attempt_id FROM backup_recoveries WHERE id=$1',[t.id])).rows[0],saved);
});
test('v2 snapshot negotiation cannot silently select the continuous protocol',async()=>{
 const f=await recoveryFixture(db),t=machineTarget(),signer=generateKeyPairSync('ed25519'),nodeId=randomUUID(),stored=new Map<string,Buffer>(),localVenueId=f.binding.localVenueId;
 const streams=new ManagedStreams(db.pool,f.vault,{async provision(){return {writerReference:'writer',readerReference:'reader',writerCredentials:{accessKeyId:'write',secretAccessKey:'secret'}};},async read(_r,_l,key){const bytes=stored.get(key);if(!bytes)throw Error('missing');return bytes;}});
 const revision=(await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].configuration_revision;
 const configured=await streams.configure(f.installed.installationId,revision,{localVenueId,sourceNodeId:nodeId,pointerSignerPublicKey:signer.publicKey.export({type:'spki',format:'der'}).toString('base64')});
 const writtenAt=new Date().toISOString(),generation=`gen-2-${nodeId}-${writtenAt.replace(/[-:.]/g,'').replace(/\d{3}Z$/,'Z')}`,body={venueId:localVenueId,term:2,nodeId,generation,writtenAt};
 const signed=Buffer.from(JSON.stringify({pointer:{generation,nodeId,term:2,venueId:localVenueId,writtenAt},purpose:'waitron.stream.pointer.v1'}));
 stored.set(`${configured.bucket.prefix}venues/${localVenueId}/current.json`,Buffer.from(JSON.stringify({body,signature:sign(null,signed,signer.privateKey).toString('base64')})));
 await streams.observe(f.installed.installationId,configured.configurationRevision);
 assert((await f.recovery.catalogue(f.session.token,f.installed.venueId)).continuousRecovery);
 await f.requests.machine('start',t.envelope('start'));
 await assert.rejects(f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,{source:'continuous',venueId:f.installed.venueId,oldServerUnavailable:true,acceptDataLoss:true}),/unverified/);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_recoveries WHERE id=$1',[t.id])).rows[0].count,'0');
});

test('v2 proof expiry during an acknowledged archive-key wait prevents key disclosure',async()=>{
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start'));await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input);
 const blocker=await db.secondPool.connect(),blockerId=(await blocker.query('SELECT pg_backend_pid() AS id')).rows[0].id,proof=t.envelope('read',f.point.digest),now=Date.now;let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('LOCK backup_key_versions IN ACCESS EXCLUSIVE MODE');
  pending=f.recovery.target(t.id,'read',proof);const refused=assert.rejects(pending,/invalid_proof/);void refused.catch(()=>{});
  const until=now()+3000;let waiting=false;while(now()<until){if((await db.secondPool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[db.schema,blockerId])).rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}assert(waiting,'delivery must reach the acknowledged key blocker');
  Date.now=()=>now()+61000;await blocker.query('COMMIT');await refused;
 }finally{Date.now=now;await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});
