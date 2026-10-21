import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,beforeEach,test} from 'node:test';
import {Pool,type PoolClient} from 'pg';
import {transaction} from '@waitron-cloud/registration';
import {migrate} from '../../registration/src/migrate.ts';
import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import {backupVerificationRequestDigest,type BackupVerificationRequest,type BackupVerificationResult} from '../src/verification-protocol.ts';
import type {VerifiedChildOutput} from '../src/container-verifier.ts';
import * as admission from '../src/verification-admission.ts';

const schema='admission_'+randomUUID().replaceAll('-','');
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema});
const second=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema});
const target=JSON.parse(await readFile(new URL('../../../deploy/backup-verifier/target.json',import.meta.url),'utf8'));
const image='local.waitron-verifier@sha256:'+'2'.repeat(64);
before(async()=>{await admin.query('CREATE SCHEMA '+schema);await migrate(pool);});
after(async()=>{await Promise.all([pool.end(),second.end()]);await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
beforeEach(async()=>{await resetSchema(pool);});
async function seed(leaseMs=120000,configure=true){
 const c=await pool.connect();
 try{
 const organisation=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID(),id=randomUUID(),job=randomUUID(),claim=randomUUID();
 await c.query('INSERT INTO organisations(id) VALUES($1)',[organisation]);
 await c.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisation]);
 await c.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,organisation,business,randomUUID()]);
 await c.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installation,venue,randomUUID()]);
 await c.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://storage.test',$3,'local')",[venue,installation,venue]);
 await c.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'sealed-fixture')",[venue]);
 await c.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,1)',[id,venue,installation]);
 await c.query(`INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules)
 VALUES($1,$2,$3,1,'snapshot',$4,$5,42,'2026-10-20T08:00:00.000Z','daily',$6,'{"core":3}')`,[id,venue,installation,'snapshots/'+id,'1'.repeat(64),randomUUID()]);
 if(configure)await transaction(pool,c=>admission.setVerificationPolicy(c,target,image,true));
 await c.query("INSERT INTO backup_jobs(id,kind,venue_id,target_id,status,claim_id,lease_until,attempts,runs) VALUES($1,'verify',$2,$3,'running',$4,clock_timestamp()+$5*interval '1 millisecond',1,1)",[job,venue,id,claim,leaseMs]);
 const attempt=await transaction(pool,c=>admission.prepareVerification(c,{id:job,venueId:venue,pointId:id,claimId:claim,number:1,controllerScope:'admission-fixture'}));
 assert(attempt,'a live snapshot must prepare an immutable attempt');
 return {id,venue,installation,job,claim,attempt};
 }finally{c.release();}
}
type Fixture=Awaited<ReturnType<typeof seed>>;
function output(r:BackupVerificationRequest,status:BackupVerificationResult['status']='passed',reason:BackupVerificationResult['reason']='none'):VerifiedChildOutput{
 return {result:{protocol:r.protocol,requestDigest:backupVerificationRequestDigest(r),attemptToken:r.attempt.childToken,
 measuredArchive:{sha256:r.archive.sha256,bytes:r.archive.bytes},targetDigest:r.target.digest,policyDigest:r.target.policyDigest,
 modules:status==='passed'?r.target.modules.map(m=>({name:m.name,semanticsVersion:m.semanticsVersion,status:'passed',checks:[{code:'data',status:'passed'}]})):[],
 status,reason,activation:'not_attempted'},receipt:{childId:'3'.repeat(64),imageId:'sha256:'+'2'.repeat(64),requestDigest:backupVerificationRequestDigest(r),controllerScope:r.attempt.controllerScope,childToken:r.attempt.childToken,terminated:true,cleanupConfirmed:true}};
}
async function state(f:Fixture,reader:Pool|PoolClient=pool){return {
 point:(await reader.query('SELECT verification,current_evidence_id,last_attempt_id FROM backup_points WHERE id=$1',[f.id])).rows[0],
 qualification:(await reader.query('SELECT current_verification,last_reason FROM backup_point_qualification WHERE point_id=$1',[f.id])).rows[0],
 evidence:(await reader.query('SELECT * FROM backup_verification_attempts ORDER BY created_at,id')).rows,
 history:(await reader.query('SELECT outcome FROM backup_verifications ORDER BY checked_at,id')).rows,
 job:(await reader.query('SELECT * FROM backup_jobs WHERE id=$1',[f.job])).rows[0]};}
const admit=(f:Fixture,o:VerifiedChildOutput=output(f.attempt.request))=>transaction(pool,c=>admission.admitVerification(c,f.attempt,o));
async function retry(f:Fixture){
 const claim=randomUUID();await pool.query("UPDATE backup_jobs SET status='running',claim_id=$2,lease_until=clock_timestamp()+interval '120 seconds',attempts=1 WHERE id=$1",[f.job,claim]);
 const attempt=await transaction(pool,c=>admission.prepareVerification(c,{id:f.job,venueId:f.venue,pointId:f.id,claimId:claim,number:1,controllerScope:'admission-fixture'}));assert(attempt);return {...f,claim,attempt};
}
for(const [status,reason,want] of [
 ['passed','none','verified'],['invalid','module_integrity','failed'],['needs_authority','module_data_check_requires_authority','unavailable'],
 ['unsupported','module_missing','unavailable'],['unavailable','decryption_unavailable','unavailable']
] as const)test('admits completed '+status+' with atomic point evidence and job state',async()=>{
 const f=await seed();assert.equal(await admit(f,output(f.attempt.request,status,reason)),want);const s=await state(f);
 assert.equal(s.qualification.current_verification,want==='unavailable'?'pending':want);
 assert.equal(s.point.verification,want==='unavailable'?'pending':want);assert.equal(s.evidence.length,1);assert.equal(s.evidence[0].state,'finished');
 assert.equal(s.evidence[0].status,status);assert(s.evidence[0].admitted_at);assert.equal(s.point.last_attempt_id,s.evidence[0].id);
 assert.deepEqual(s.history,want==='unavailable'?[]:[{outcome:want}]);assert.equal(s.job.claim_id,null);assert.equal(s.job.lease_until,null);
 assert.equal(s.job.status,'pending');assert.equal(Number(s.job.failures),want==='verified'?0:1);assert.equal(Boolean(s.job.last_success_at),want==='verified');
});
test('unavailable recheck clears current success and preserves historical fallback',async()=>{
 let f=await seed();await admit(f);f=await retry(f);assert.equal(await transaction(pool,c=>admission.recordVerificationUnavailable(c,f.attempt,'secret_unavailable')),'unavailable');
 const s=await state(f);assert.equal(s.qualification.current_verification,'pending');assert.equal(s.point.current_evidence_id,null);assert.equal(s.point.verification,'pending');
 assert.deepEqual(s.history,[{outcome:'verified'}]);assert.equal(s.evidence.length,2);assert.equal(s.qualification.last_reason,'secret_unavailable');
});
test('inconclusive recheck preserves completed invalid evidence',async()=>{
 let f=await seed();await admit(f,output(f.attempt.request,'invalid','archive_invalid'));f=await retry(f);
 await transaction(pool,c=>admission.recordVerificationUnavailable(c,f.attempt,'cleanup_uncertain'));const s=await state(f);
 assert.equal(s.qualification.current_verification,'failed');assert.equal(s.point.verification,'failed');assert.equal(s.point.current_evidence_id,s.evidence[0].id);
 assert.deepEqual(s.history,[{outcome:'failed'}]);assert.equal(s.qualification.last_reason,'cleanup_uncertain');
});
for(const failure of ['void','image','child','request','scope','token','terminated','cleanup','coverage','resultBinding','measured'] as const)
 test('untrusted '+failure+' cannot admit an archive verdict',async()=>{
 const f=await seed();let o:any=output(f.attempt.request);
 if(failure==='void')o=undefined;
 else if(failure==='image')o.receipt.imageId='sha256:'+'4'.repeat(64);
 else if(failure==='child')o.receipt.childId='foreign-child';
 else if(failure==='request')o.receipt.requestDigest='4'.repeat(64);
 else if(failure==='scope')o.receipt.controllerScope='other';
 else if(failure==='token')o.receipt.childToken='other';
 else if(failure==='terminated')o.receipt.terminated=false;
 else if(failure==='cleanup')o.receipt.cleanupConfirmed=false;
 else if(failure==='coverage')o.result.modules.pop();
 else if(failure==='resultBinding')o.result.requestDigest='4'.repeat(64);
 else o.result.measuredArchive.bytes++;
 assert.equal(await transaction(pool,c=>admission.admitVerification(c,f.attempt,o)),'unavailable');const s=await state(f);
 assert.equal(s.qualification.current_verification,'pending');assert.deepEqual(s.history,[]);assert.equal(s.evidence[0].status,'unavailable');
 assert.equal(s.evidence[0].result,null);assert.equal(Number(s.job.failures),1);
});
for(const change of ['lease','claim','number','jobVenue','jobTarget','jobKind','status','deadline','policy','object','digest','size','node','modules','retention','key','capture','deleting','deleted','production','requestDigest','snapshot','kind'] as const)
 test('stale '+change+' writes absolutely no state',async()=>{
 const f=await seed();
 if(change==='lease')await pool.query("UPDATE backup_jobs SET lease_until=clock_timestamp()-interval '1 second'");
 else if(change==='claim')await pool.query('UPDATE backup_jobs SET claim_id=$1',[randomUUID()]);
 else if(change==='number')await pool.query('UPDATE backup_jobs SET attempts=2');
 else if(change==='jobVenue'){const other=await seed(120000,false);await pool.query('UPDATE backup_jobs SET venue_id=$2 WHERE id=$1',[f.job,other.venue]);}
 else if(change==='jobTarget')await pool.query('UPDATE backup_jobs SET target_id=$1',[randomUUID()]);
 else if(change==='jobKind')await pool.query("UPDATE backup_jobs SET kind='retention'");
 else if(change==='status')await pool.query("UPDATE backup_jobs SET status='pending',claim_id=NULL,lease_until=NULL");
 else if(change==='deadline')f.attempt=structuredClone(f.attempt),f.attempt.request.attempt.deadline='2020-01-01T00:00:00.000Z';
 else if(change==='policy')await pool.query('UPDATE backup_verification_policy SET revision=revision+1');
 else if(change==='capture'){await pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,2,'other')",[f.venue]);await pool.query('UPDATE backup_captures SET key_version=2');}
 else if(change==='production')await pool.query("UPDATE venues SET environment='production'");
 else if(change==='requestDigest')f.attempt=structuredClone(f.attempt),f.attempt.request.sourceNodeId=randomUUID();
 else if(change==='snapshot')f.attempt=structuredClone(f.attempt),f.attempt.point.objectKey='different';
 else if(change==='kind')await pool.query("UPDATE backup_points SET kind='continuous'");
 else {if(change==='key')await pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,2,'other')",[f.venue]);const changes={object:"object_key='other'",digest:"digest='"+'4'.repeat(64)+"'",size:'size=43',node:"source_node_id='"+randomUUID()+"'",modules:`modules='{"core":4}'`,retention:"retention='monthly'",key:'key_version=2',deleting:'deleting=true',deleted:'deleted_at=clock_timestamp()'};await pool.query('UPDATE backup_points SET '+changes[change]);}
 const before=await state(f);assert.equal(await admit(f),'stale');assert.deepEqual(await state(f),before);
 assert.equal(await transaction(pool,c=>admission.recordVerificationUnavailable(c,f.attempt,'unexpected')),'stale');assert.deepEqual(await state(f),before);
});
test('duplicate concurrent results admit one history entry and one job transition',async()=>{
 const f=await seed(),o=output(f.attempt.request);const results=await Promise.all([admit(f,o),transaction(second,c=>admission.admitVerification(c,f.attempt,o))]);
 assert.deepEqual(results.sort(),['stale','verified']);const s=await state(f);assert.equal(s.evidence.length,1);assert.deepEqual(s.history,[{outcome:'verified'}]);assert.equal(s.job.attempts,0);assert.equal(Number(s.job.failures),0);
});
test('policy change invalidates existing qualification immediately and schedules recheck',async()=>{
 const f=await seed();await admit(f);const before=await state(f);
 assert.equal(await transaction(pool,c=>admission.setVerificationPolicy(c,target,image,true)),2);const s=await state(f);
 assert.equal(s.qualification.current_verification,'pending');assert.deepEqual(s.history,before.history);assert.deepEqual(s.evidence,before.evidence);
 assert(s.job.available_at<=new Date());assert.equal(s.job.status,'pending');
});

async function blocked(waiter:number,blocker:number){
 const until=Date.now()+5000;
 do{const row=(await admin.query('SELECT $2::integer=ANY(pg_blocking_pids($1)) AS blocked',[waiter,blocker])).rows[0];if(row.blocked)return;await new Promise(resolve=>setImmediate(resolve));}while(Date.now()<until);
 assert.fail('the exact admission connection never acknowledged its expected blocker');
}
async function lockedRace(f:Fixture,lock:string,change:(c:PoolClient)=>Promise<unknown>){
 const holder=await pool.connect(),waiter=await second.connect();let running:Promise<unknown>|undefined;
 try{
 await holder.query('BEGIN');await holder.query(lock,[f.id]);
 const holderPid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 await waiter.query('BEGIN');const waiterPid=(await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 running=admission.admitVerification(waiter,f.attempt,output(f.attempt.request));
 await blocked(waiterPid,holderPid);await change(holder);const expected=await state(f,holder);
 await holder.query('COMMIT');assert.equal(await running,'stale');await waiter.query('COMMIT');
 assert.deepEqual(await state(f),expected);
 }finally{await holder.query('ROLLBACK');await running?.catch(()=>{});await waiter.query('ROLLBACK');holder.release();waiter.release();}
}
test('policy changed under an acknowledged exclusive lock rejects waiting output',async()=>{
 const f=await seed();await lockedRace(f,'SELECT id FROM backup_verification_policy WHERE $1::uuid IS NOT NULL FOR UPDATE',c=>admission.setVerificationPolicy(c,target,image,true));
});
for(const change of ['deletion','metadata','retry'] as const)test(change+' committed under the venue lock rejects waiting output',async()=>{
 const f=await seed();await lockedRace(f,'SELECT venue_id FROM backup_locations WHERE venue_id=(SELECT venue_id FROM backup_points WHERE id=$1) FOR UPDATE',async c=>{
 if(change==='deletion')await c.query('UPDATE backup_points SET deleting=true,deleted_at=clock_timestamp() WHERE id=$1',[f.id]);
 if(change==='metadata')await c.query("UPDATE backup_points SET object_key='changed-during-wait' WHERE id=$1",[f.id]);
 if(change==='retry')await c.query('UPDATE backup_jobs SET claim_id=$2,attempts=2 WHERE id=$1',[f.job,randomUUID()]);
 });
});
test('lease expiry during the final capture lock wait rejects waiting output',async()=>{
 const f=await seed(1200);await lockedRace(f,'SELECT id FROM backup_captures WHERE id=$1 FOR UPDATE',async c=>{
 for(;;){const row=(await c.query('SELECT clock_timestamp()>lease_until AS expired FROM backup_jobs WHERE id=$1',[f.job])).rows[0];if(row.expired)break;await new Promise(resolve=>setImmediate(resolve));}
 });
});
test('lease expiry during the evidence write rolls back every admission write',async()=>{
 const f=await seed(1200),holder=await pool.connect(),waiter=await second.connect();let running:Promise<unknown>|undefined;
 try{
 await holder.query('BEGIN');await holder.query('LOCK TABLE backup_verifications IN EXCLUSIVE MODE');
 const hp=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 await waiter.query('BEGIN');const wp=(await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 const before=await state(f);running=admission.admitVerification(waiter,f.attempt,output(f.attempt.request));await blocked(wp,hp);
 for(;;){if((await holder.query('SELECT clock_timestamp()>$1::timestamptz AS expired',[f.attempt.request.attempt.deadline])).rows[0].expired)break;await new Promise(resolve=>setImmediate(resolve));}
 await holder.query('COMMIT');assert.equal(await running,'stale');await waiter.query('COMMIT');assert.deepEqual(await state(f),before);
 }finally{await holder.query('ROLLBACK');await running?.catch(()=>{});await waiter.query('ROLLBACK');holder.release();waiter.release();}
});
for(const status of ['passed','invalid','unavailable'] as const)test('old '+status+' result cannot overwrite a completed retry even when its attempt number is reused',async()=>{
 let f=await seed();const old=f;f=await retry(f);assert.notEqual(old.attempt.request.attempt.childToken,f.attempt.request.attempt.childToken);await admit(f);
 const before=await state(f);assert.equal(await admit(old,output(old.attempt.request,status,status==='passed'?'none':status==='invalid'?'archive_invalid':'unexpected')),'stale');assert.deepEqual(await state(f),before);
});

for(const expiry of ['lease','deadline'] as const)for(const status of ['passed','invalid','unavailable'] as const)
 test(expiry+' independently expires during '+status+' writes without changing any state',async()=>{
 const f=await seed(expiry==='deadline'?1200:120000),holder=await pool.connect(),waiter=await second.connect();let running:Promise<unknown>|undefined;
 if(expiry==='lease')await pool.query("UPDATE backup_jobs SET lease_until=date_trunc('milliseconds',clock_timestamp()+interval '1200 milliseconds') WHERE id=$1",[f.job]);
 else await pool.query("UPDATE backup_jobs SET lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$1",[f.job]);
 const until=expiry==='deadline'?f.attempt.request.attempt.deadline:(await pool.query('SELECT lease_until FROM backup_jobs WHERE id=$1',[f.job])).rows[0].lease_until;
 try{
 await holder.query('BEGIN');await holder.query('LOCK TABLE backup_verification_attempts IN SHARE MODE');
 const hp=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 await waiter.query('BEGIN');const wp=(await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 const before=await state(f);
 running=status==='unavailable'?admission.recordVerificationUnavailable(waiter,f.attempt,'unexpected'):admission.admitVerification(waiter,f.attempt,output(f.attempt.request,status,status==='passed'?'none':'archive_invalid'));
 await blocked(wp,hp);
 for(;;){if((await holder.query('SELECT clock_timestamp()>$1::timestamptz AS expired',[until])).rows[0].expired)break;await new Promise(resolve=>setImmediate(resolve));}
 await holder.query('COMMIT');assert.equal(await running,'stale');await waiter.query('COMMIT');assert.deepEqual(await state(f),before);
 }finally{await holder.query('ROLLBACK');await running?.catch(()=>{});await waiter.query('ROLLBACK');holder.release();waiter.release();}
});
test('new attempt keeps a detached frozen publication snapshot and refuses repeated preparation',async()=>{
 const f=await seed();assert(Object.isFrozen(f.attempt));assert(Object.isFrozen(f.attempt.point));assert(Object.isFrozen(f.attempt.point.modules));assert(Object.isFrozen(f.attempt.request));
 assert.throws(()=>{f.attempt.point.modules.core=9;},TypeError);
 const repeated=await transaction(pool,c=>admission.prepareVerification(c,{id:f.job,venueId:f.venue,pointId:f.id,claimId:f.claim,number:1,controllerScope:'admission-fixture'}));
 assert.equal(repeated,undefined);assert.equal((await state(f)).evidence.length,1);
});
test('disabled release policy cannot qualify a passed data check',async()=>{
 let f=await seed();await transaction(pool,c=>admission.setVerificationPolicy(c,target,image,false));f=await retry(f);await admit(f);
 assert.equal((await state(f)).qualification.current_verification,'pending');
});
test('wrong key is unavailable and does not replace a prior archive verdict',async()=>{
 let f=await seed();await admit(f);f=await retry(f);await admit(f,output(f.attempt.request,'unavailable','decryption_unavailable'));
 const s=await state(f);assert.deepEqual(s.history,[{outcome:'verified'}]);assert.equal(s.qualification.current_verification,'pending');assert.equal(s.qualification.last_reason,'decryption_unavailable');
});
for(const [reason,field] of [['archive_digest_mismatch','sha256'],['archive_size_mismatch','bytes']] as const)
 test('completed measured '+field+' mismatch is invalid',async()=>{
 const f=await seed(),o=output(f.attempt.request,'invalid',reason);
 if(field==='sha256')o.result.measuredArchive!.sha256='9'.repeat(64);else o.result.measuredArchive!.bytes++;
 assert.equal(await admit(f,o),'failed');assert.deepEqual((await state(f)).history,[{outcome:'failed'}]);
});
test('cancellation returns retry budget but the next claim always has a fresh child token',async()=>{
 let f=await seed();await transaction(pool,c=>admission.recordVerificationUnavailable(c,f.attempt,'cancelled'));const s=await state(f);
 assert.equal(s.job.attempts,0);assert.equal(Number(s.job.runs),1);assert.equal(Number(s.job.failures),0);assert.equal(s.job.last_success_at,null);
 const old=f;f=await retry(f);assert.notEqual(f.attempt.request.attempt.childToken,old.attempt.request.attempt.childToken);assert.notEqual(f.claim,old.claim);await admit(f);
 assert.equal(await admit(old),'stale');
});
test('exhausted unavailable retries keep their bounded failure status until policy explicitly requeues them',async()=>{
 let f=await seed();await pool.query('UPDATE backup_jobs SET attempts=8');
 // A fresh binding must use the actual attempt number, not mutate a stored request.
 const claim=randomUUID();await pool.query('UPDATE backup_jobs SET claim_id=$1',[claim]);
 const a=await transaction(pool,c=>admission.prepareVerification(c,{id:f.job,venueId:f.venue,pointId:f.id,claimId:claim,number:8,controllerScope:'admission-fixture'}));assert(a);f={...f,claim,attempt:a};
 assert.equal(await transaction(pool,c=>admission.recordVerificationUnavailable(c,f.attempt,'resource_limit')),'unavailable');const s=await state(f);
 assert.equal(s.job.status,'failed');assert.equal(s.job.attempts,8);assert.equal(Number(s.job.failures),1);assert.equal(s.job.last_error,'verification_unavailable');
});

for(const binding of ['keyReference','sourceInstallation','sourceNode','captureTime','archiveDigest','archiveSize','manifest','environment','moduleMap','keyVersion'] as const)
 test('independently stored mismatched '+binding+' binding cannot admit evidence',async()=>{
 const f=await seed(),a={...structuredClone(f.attempt)},r=a.request;
 if(binding==='keyReference')r.backupKey.reference='other-key';
 if(binding==='sourceInstallation')r.sourceInstallationId=randomUUID();
 if(binding==='sourceNode')r.sourceNodeId=randomUUID();
 if(binding==='captureTime')r.capturedAt='2026-10-19T08:00:00.000Z';
 if(binding==='archiveDigest')r.archive.sha256='9'.repeat(64);
 if(binding==='archiveSize')r.archive.bytes++;
 if(binding==='manifest')r.archive.manifestVersion=2;
 if(binding==='environment')r.archive.environment='production';
 if(binding==='moduleMap')r.archive.modules={core:4};
 if(binding==='keyVersion')r.backupKey.version=2;
 const row=(await pool.query('SELECT to_jsonb(a) AS row FROM backup_verification_attempts a WHERE id=$1',[a.id])).rows[0].row;
 a.id=randomUUID();r.attempt.claimId=randomUUID();r.attempt.childToken=randomUUID();
 Object.assign(row,{id:a.id,request:r,request_digest:backupVerificationRequestDigest(r),claim_id:r.attempt.claimId,child_token:r.attempt.childToken});
 await pool.query('INSERT INTO backup_verification_attempts SELECT * FROM jsonb_populate_record(NULL::backup_verification_attempts,$1::jsonb)',[row]);
 await pool.query('UPDATE backup_jobs SET claim_id=$1',[r.attempt.claimId]);
 const before=await state(f);await assert.doesNotReject(async()=>{assert.equal(await transaction(pool,c=>admission.admitVerification(c,a,output(r))),'stale');});assert.deepEqual(await state(f),before);
});

for(const change of ['image','target','missing'] as const)test('current policy '+change+' mismatch fences every outcome',async()=>{
 const f=await seed();
 if(change==='image')await pool.query('UPDATE backup_verification_policy SET verifier_image=$1',['local.waitron-verifier@sha256:'+'9'.repeat(64)]);
 if(change==='target'){
  const alternate=JSON.parse(await readFile(new URL('fixtures/verification-vector.json',import.meta.url),'utf8')).target;
  await pool.query('UPDATE backup_verification_policy SET target=$1',[alternate]);
 }
 if(change==='missing')await pool.query('DELETE FROM backup_verification_policy');
 const before=await state(f);assert.equal(await admit(f),'stale');assert.deepEqual(await state(f),before);
});
for(const change of ['digest','pointMetadata'] as const)test('stored evidence '+change+' mismatch fences every outcome',async()=>{
 const f=await seed(),a={...structuredClone(f.attempt)},r=a.request;
 const row=(await pool.query('SELECT to_jsonb(a) AS row FROM backup_verification_attempts a WHERE id=$1',[a.id])).rows[0].row;
 a.id=randomUUID();r.attempt.claimId=randomUUID();r.attempt.childToken=randomUUID();
 Object.assign(row,{id:a.id,request:r,request_digest:backupVerificationRequestDigest(r),claim_id:r.attempt.claimId,child_token:r.attempt.childToken});
 if(change==='digest')row.request_digest='9'.repeat(64);else row.point_metadata.objectKey='another-object';
 await pool.query('INSERT INTO backup_verification_attempts SELECT * FROM jsonb_populate_record(NULL::backup_verification_attempts,$1::jsonb)',[row]);
 await pool.query('UPDATE backup_jobs SET claim_id=$1',[r.attempt.claimId]);
 const before=await state(f);await assert.doesNotReject(async()=>{assert.equal(await transaction(pool,c=>admission.admitVerification(c,a,output(r))),'stale');});assert.deepEqual(await state(f),before);
});

test('a substituted point identity is stale before any database writes',async()=>{
 const f=await seed(),a=structuredClone(f.attempt);a.point.id=randomUUID();const before=await state(f);
 await assert.doesNotReject(async()=>{assert.equal(await transaction(pool,c=>admission.admitVerification(c,a,output(a.request))),'stale');});
 assert.deepEqual(await state(f),before);
});
