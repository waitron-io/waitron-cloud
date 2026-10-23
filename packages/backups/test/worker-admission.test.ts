import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,beforeEach,test} from 'node:test';
import {Readable} from 'node:stream';
import {transaction} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import {BackupCatalogue,type ObjectFactory} from '../src/catalogue.ts';
import {BackupKeyVault} from '../src/keys.ts';
import {receipt} from '../src/storage.ts';
import type {DataRestoreVerifier,VerifiedChildOutput} from '../src/container-verifier.ts';
import {backupVerificationRequestDigest,type BackupVerificationRequest,type BackupVerificationResult} from '../src/verification-protocol.ts';
import {setVerificationPolicy,type VerificationClaim} from '../src/verification-admission.ts';
import {BackupWorker} from '../src/worker.ts';

let db:Awaited<ReturnType<typeof database>>;
const master=randomBytes(32),vault=new BackupKeyVault(master),body=Buffer.from('encrypted claim pipeline fixture');
const target=JSON.parse(await readFile(new URL('../../../deploy/backup-verifier/target.json',import.meta.url),'utf8'));
const image='local.waitron-verifier@sha256:'+'2'.repeat(64);
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{await resetSchema(db.pool);});

function output(r:BackupVerificationRequest,status:BackupVerificationResult['status']='passed',reason:BackupVerificationResult['reason']='none'):VerifiedChildOutput{
 return {result:{protocol:r.protocol,requestDigest:backupVerificationRequestDigest(r),attemptToken:r.attempt.childToken,
 measuredArchive:{sha256:r.archive.sha256,bytes:r.archive.bytes},targetDigest:r.target.digest,policyDigest:r.target.policyDigest,
 modules:status==='passed'?r.target.modules.map(m=>({name:m.name,semanticsVersion:m.semanticsVersion,status:'passed',checks:[{code:'data',status:'passed'}]})):[],
 status,reason,activation:'not_attempted'},receipt:{childId:'3'.repeat(64),imageId:'sha256:'+'2'.repeat(64),requestDigest:backupVerificationRequestDigest(r),controllerScope:r.attempt.controllerScope,childToken:r.attempt.childToken,terminated:true,cleanupConfirmed:true}};
}
async function fixture(){
 const organisation=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID(),id=randomUUID(),job=randomUUID(),claimId=randomUUID();
 await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisation]);
 await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisation]);
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,organisation,business,randomUUID()]);
 await db.pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installation,venue,randomUUID()]);
 await db.pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://storage.test',$3,'local')",[venue,installation,venue]);
 const sealed=vault.create(venue,1);
 await db.pool.query('INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,$2)',[venue,sealed]);
 await db.pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,1)',[id,venue,installation]);
 await db.pool.query(`INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules)
 VALUES($1,$2,$3,1,'snapshot',$4,$5,$6,'2026-10-20T08:00:00.000Z','daily',$7,'{"core":3}')`,[id,venue,installation,'snapshots/'+id,receipt(body).digest,body.length,randomUUID()]);
 await transaction(db.pool,c=>setVerificationPolicy(c,target,image,true));
 await db.pool.query("INSERT INTO backup_jobs(id,kind,venue_id,target_id,status,claim_id,lease_until,attempts,runs) VALUES($1,'verify',$2,$3,'pending',NULL,NULL,0,0)",[job,venue,id]);
 const claim:VerificationClaim={id:job,venueId:venue,pointId:id,claimId,number:1,controllerScope:'pipeline-fixture'};
 let disposals=0;
 const objects:ObjectFactory=()=>({async stage(key){assert.equal(key,'snapshots/'+id);return {receipt:receipt(body),open(){return Readable.from([body]);},async dispose(){disposals++;}};},async putStaged(){throw Error('unused');},async remove(){throw Error('unused');}});
 const catalogue=(store=objects,keyVault=vault)=>new BackupCatalogue(db.pool,keyVault,store);
 async function state(){return {
  point:(await db.pool.query('SELECT verification,current_evidence_id,last_attempt_id FROM backup_points WHERE id=$1',[id])).rows[0],
  history:(await db.pool.query('SELECT outcome FROM backup_verifications ORDER BY checked_at,id')).rows,
  attempts:(await db.pool.query('SELECT * FROM backup_verification_attempts ORDER BY created_at,id')).rows,
  job:(await db.pool.query('SELECT * FROM backup_jobs WHERE id=$1',[job])).rows[0]};}
 return {catalogue,claim,state,objects,get disposals(){return disposals;}};
}


function worker(f:Awaited<ReturnType<typeof fixture>>,verify:DataRestoreVerifier,other=false){return new BackupWorker(other?db.secondPool:db.pool,f.catalogue(),verify,'pipeline-fixture');}
for(const [status,reason,want] of [
 ['passed','none','verified'],['invalid','module_integrity','failed'],['needs_authority','module_data_check_requires_authority','pending'],
 ['unsupported','module_missing','pending'],['unavailable','decryption_unavailable','pending']
] as const)test('worker admits bound '+status+' exactly once',async()=>{
 const f=await fixture();let calls=0;
 assert.equal(await worker(f,async(_source,_key,r)=>{calls++;assert.equal(r.attempt.controllerScope,'pipeline-fixture');return output(r,status,reason);}).runOnce(),true);
 const s=await f.state();assert.equal(calls,1);assert.equal(s.point.verification,want);assert.equal(s.attempts.length,1);assert.equal(s.attempts[0].status,status);
 assert.equal(s.job.claim_id,null);assert.equal(s.job.attempts,status==='passed'?0:1);assert.equal(s.job.failures,status==='passed'?'0':'1');
 assert.deepEqual(s.history,want==='pending'?[]:[{outcome:want}]);assert.equal(f.disposals,1);
});
test('worker cannot certify a callback that returns nothing',async()=>{
 const f=await fixture();
 // The runtime must also refuse untyped callers from JavaScript.
 await worker(f,(async()=>{}) as unknown as DataRestoreVerifier).runOnce();
 const s=await f.state();assert.equal(s.point.verification,'pending');assert.deepEqual(s.history,[]);assert.equal(s.job.last_error,'verification_unavailable');
});
test('worker leaves verification unclaimed until a target policy exists',async()=>{
 const f=await fixture();await db.pool.query('UPDATE backup_verification_policy SET revision=0,target=NULL,verifier_image=NULL,release_ready=false');
 const before=await f.state();assert.equal(await worker(f,async()=>assert.fail('policy absent')).runOnce(),false);assert.deepEqual(await f.state(),before);
 await transaction(db.pool,c=>setVerificationPolicy(c,target,image,false));assert.equal(await worker(f,async(_s,_k,r)=>output(r)).runOnce(),true);
 assert.equal((await f.state()).point.verification,'verified');
});
for(const kind of ['passed','thrown','cancelled'] as const)test('worker ignores expired '+kind+' without changing job counters',async()=>{
 const f=await fixture(),stop=new AbortController();let claimed:unknown;
 await worker(f,async(_s,_k,r)=>{
  await db.secondPool.query("UPDATE backup_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.claim.id]);claimed=(await f.state()).job;
  if(kind==='cancelled'){stop.abort();throw Error('backup.verifier_cancelled');}
  if(kind==='thrown')throw Error('private late diagnostic');return output(r);
 }).runOnce(stop.signal);
 const s=await f.state();assert.deepEqual(s.job,claimed);assert.equal(s.point.verification,'pending');assert.deepEqual(s.history,[]);assert.equal(s.attempts[0].state,'running');
});
test('worker policy change during child work leaves replacement claim untouched',async()=>{
 const f=await fixture();let after:unknown;
 await worker(f,async(_s,_k,r)=>{await transaction(db.secondPool,c=>setVerificationPolicy(c,target,image,false));after=(await f.state()).job;return output(r);}).runOnce();
 const s=await f.state();assert.deepEqual(s.job,after);assert.deepEqual(s.history,[]);assert.equal(s.point.verification,'pending');assert.equal(s.attempts[0].state,'running');
});
test('worker cancellation returns budget through one bound unavailable attempt',async()=>{
 const f=await fixture(),stop=new AbortController();
 await worker(f,async()=>{stop.abort();throw Error('backup.verifier_cancelled');}).runOnce(stop.signal);
 const s=await f.state();assert.equal(s.job.attempts,0);assert.equal(s.job.runs,'1');assert.equal(s.job.failures,'0');assert.equal(s.job.claim_id,null);
 assert.equal(s.attempts.length,1);assert.equal(s.attempts[0].status,'unavailable');assert.equal(s.attempts[0].reason,'cancelled');assert.deepEqual(s.history,[]);
});

for(const outcome of ['error','cancelled'] as const)test('expired cleanup '+outcome+' cannot change its old job',async()=>{
 const f=await fixture(),stop=new AbortController();let expired:unknown;
 await db.pool.query("UPDATE backup_jobs SET kind='incoming',target_id=venue_id WHERE id=$1",[f.claim.id]);
 await db.pool.query("UPDATE backup_captures SET created_at=clock_timestamp()-interval '25 hours'");
 const store:ObjectFactory=()=>({async read(){throw Error('unused');},async put(){throw Error('unused');},async remove(){
  await db.secondPool.query("UPDATE backup_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.claim.id]);expired=(await f.state()).job;
  if(outcome==='cancelled'){stop.abort();throw Error('backup.cancelled');}throw Error('private late delete error');
 }});
 await new BackupWorker(db.pool,f.catalogue(store),async()=>assert.fail('cleanup must not verify'),'pipeline-fixture').runOnce(stop.signal);
 assert.deepEqual((await f.state()).job,expired);
});

for(const phase of ['selection','completion'])test('retention '+phase+' waits for policy before taking a venue lock',async()=>{
 const f=await fixture(),otherId=randomUUID();
 await db.pool.query("UPDATE backup_points SET captured_at=clock_timestamp()-interval '90 days' WHERE id=$1",[f.claim.pointId]);
 await db.pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) SELECT $1,venue_id,installation_id,key_version FROM backup_captures WHERE id=$2',[otherId,f.claim.pointId]);
 await db.pool.query("INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules) SELECT $1::uuid,venue_id,installation_id,key_version,kind,'snapshots/'||($1::uuid)::text,digest,size,clock_timestamp(),retention,source_node_id,modules FROM backup_points WHERE id=$2",[otherId,f.claim.pointId]);
 const {Pool}=await import('pg'),pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+db.schema,max:1,statement_timeout:5000});
 const holder=await db.pool.connect(),probe=await pool.connect(),pid=(await probe.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;probe.release();
 await holder.query('BEGIN');if(phase==='selection')await holder.query('SELECT * FROM backup_verification_policy FOR UPDATE');const holderPid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 let removed=0;const store:ObjectFactory=()=>({async read(){throw Error('unused');},async put(){throw Error('unused');},async remove(){removed++;if(phase==='completion')await holder.query('SELECT * FROM backup_verification_policy FOR UPDATE');}});
 const running=new BackupCatalogue(pool,vault,store).cleanupOne(f.claim.venueId);let settled=false;void running.then(()=>{settled=true;},()=>{settled=true;});
 try{
  const deadline=Date.now()+2000;let blocked=false;
  while(Date.now()<deadline&&!settled){if((await db.secondPool.query('SELECT $2=ANY(pg_blocking_pids($1)) AS blocked',[pid,holderPid])).rows[0].blocked){blocked=true;break;}await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(blocked,true,'retention did not wait for the policy lock');assert.equal(removed,phase==='selection'?0:1);
  const observer=await db.secondPool.connect();try{await observer.query('BEGIN');await observer.query('SELECT * FROM backup_locations WHERE venue_id=$1 FOR UPDATE NOWAIT',[f.claim.venueId]);await observer.query('ROLLBACK');}finally{observer.release();}
 }finally{await holder.query('ROLLBACK');holder.release();await running;await pool.end();}
 assert.equal(removed,1);
});

test('worker does not claim or count verification while a policy change owns the lock',async()=>{
 const f=await fixture(),{Pool}=await import('pg'),pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+db.schema,max:1,statement_timeout:5000});
 const probe=await pool.connect(),pid=(await probe.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;probe.release();
 const holder=await db.pool.connect();await holder.query('BEGIN');await holder.query('SELECT * FROM backup_verification_policy FOR UPDATE');const holderPid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 const running=new BackupWorker(pool,new BackupCatalogue(pool,vault,f.objects),async(_s,_k,r)=>output(r),'pipeline-fixture').runOnce();void running.catch(()=>{});
 try{
  let blocked=false;const deadline=Date.now()+2000;
  while(Date.now()<deadline){if((await db.secondPool.query('SELECT $2=ANY(pg_blocking_pids($1)) AS blocked',[pid,holderPid])).rows[0].blocked){blocked=true;break;}await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(blocked,true);const s=await f.state();assert.equal(s.job.status,'pending');assert.equal(s.job.attempts,0);assert.equal(s.job.runs,'0');assert.equal(s.attempts.length,0);
 }finally{await holder.query('ROLLBACK');holder.release();await running;await pool.end();}
 assert.equal((await f.state()).point.verification,'verified');
});

test('worker refuses an absent or unbounded controller scope before claiming work',async()=>{
 const f=await fixture(),before=await f.state();
 for(const scope of [undefined,'','x'.repeat(129)])assert.throws(()=>new BackupWorker(db.pool,f.catalogue(),async()=>assert.fail('invalid scope'),scope as string),/^Error: backup.verifier_configuration$/);
 assert.deepEqual(await f.state(),before);
});
