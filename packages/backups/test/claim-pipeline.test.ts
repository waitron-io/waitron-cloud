import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
import {stageReadable} from '../src/object-transfer.ts';

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
 await db.pool.query("INSERT INTO backup_jobs(id,kind,venue_id,target_id,status,claim_id,lease_until,attempts,runs) VALUES($1,'verify',$2,$3,'running',$4,clock_timestamp()+interval '120 seconds',1,1)",[job,venue,id,claimId]);
 const claim:VerificationClaim={id:job,venueId:venue,pointId:id,claimId,number:1,controllerScope:'pipeline-fixture'};
 let disposals=0,opens=0;
 const objects:ObjectFactory=()=>({async stage(key){assert.equal(key,'snapshots/'+id);return {receipt:receipt(body),open(){opens++;return Readable.from([body]);},async dispose(){disposals++;}};},async putStaged(){throw Error('unused');},async remove(){throw Error('unused');}});
 const catalogue=(store=objects,keyVault=vault)=>new BackupCatalogue(db.pool,keyVault,store);
 async function state(){return {
  point:(await db.pool.query('SELECT verification,current_evidence_id,last_attempt_id FROM backup_points WHERE id=$1',[id])).rows[0],
  history:(await db.pool.query('SELECT outcome FROM backup_verifications ORDER BY checked_at,id')).rows,
  attempts:(await db.pool.query('SELECT * FROM backup_verification_attempts ORDER BY created_at,id')).rows,
  job:(await db.pool.query('SELECT * FROM backup_jobs WHERE id=$1',[job])).rows[0]};}
 const run=(verify:DataRestoreVerifier=async(_source,_key,request)=>output(request),store=objects,signal=new AbortController().signal,keyVault=vault)=>{
  const c=catalogue(store,keyVault);
  assert.equal(typeof c.verifyClaim,'function','the catalogue has no strict claimed verification path');
  return c.verifyClaim(claim,verify,signal);
 };
 return {claim,run,state,objects,keys:vault.open(venue,1,sealed),get disposals(){return disposals;},get opens(){return opens;}};
}

for(const [status,reason,want] of [
 ['passed','none','verified'],['invalid','module_integrity','failed'],['needs_authority','module_data_check_requires_authority','unavailable'],
 ['unsupported','module_missing','unavailable'],['unavailable','decryption_unavailable','unavailable']
] as const)test('claimed catalogue stages and atomically admits '+status,async()=>{
 const f=await fixture();
 assert.equal(await f.run(async(source,key,request)=>{
  assert.deepEqual(Object.keys(key).sort(),['reference','secret','version']);assert.equal(key.version,1);assert.equal(key.reference,`cloud-backup:${f.claim.venueId}:1`);
  assert.equal(key.secret===f.keys.recoveryKey,true,'only the matching archive key may enter the child');
  assert.equal(request.archive.environment,'preproduction');assert.equal(request.sourceInstallationId,(await db.pool.query('SELECT installation_id FROM backup_points')).rows[0].installation_id);
  const chunks=[];for await(const chunk of source.open())chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),body);
  // Preparation is committed before external work, and no admission lock spans it.
  assert.equal((await f.state()).attempts[0].state,'running');
  const c=await db.secondPool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='500ms'");await c.query('SELECT * FROM backup_verification_policy FOR UPDATE');await c.query('SELECT * FROM backup_locations FOR UPDATE');await c.query('ROLLBACK');}finally{c.release();}
  return output(request,status,reason);
 }),want);
 const s=await f.state();assert.equal(f.disposals,1);assert.equal(s.point.verification,want==='unavailable'?'pending':want);
 assert.equal(s.attempts[0].status,status);assert.equal(s.attempts[0].cleanup_confirmed,true);assert.equal(s.job.claim_id,null);
 assert.deepEqual(s.history,want==='unavailable'?[]:[{outcome:want}]);assert.equal(Number(s.job.failures),want==='verified'?0:1);
 assert(!JSON.stringify(s).includes(f.keys.recoveryKey));assert(!JSON.stringify(s).includes(f.keys.streamKey));assert(!JSON.stringify(s).includes(master.toString('hex')));
});
test('void callback cannot verify a staged backup',async()=>{
 const f=await fixture();assert.equal(await f.run(async()=>undefined as never),'unavailable');const s=await f.state();
 assert.equal(s.point.verification,'pending');assert.deepEqual(s.history,[]);assert.equal(f.disposals,1);assert.equal(s.attempts[0].reason,'cleanup_uncertain');
});
for(const [message,reason] of [['corrupt archive with private details','unexpected'],['backup.verifier_failed','unexpected'],['backup.verifier_timeout','deadline'],['backup.verifier_resource','resource_limit'],['backup.verifier_cleanup','cleanup_uncertain']] as const)
 test('thrown '+message+' is uncertainty without an archive verdict',async()=>{
 const f=await fixture();assert.equal(await f.run(async()=>{throw Error(message);}),'unavailable');const s=await f.state();
 assert.equal(s.attempts[0].reason,reason);assert.equal(s.point.verification,'pending');assert.deepEqual(s.history,[]);assert.equal(f.disposals,1);
 assert(!JSON.stringify(s).includes('private details'));
});
test('a wrong master key is unavailable and never corruption',async()=>{
 const f=await fixture();assert.equal(await f.run(async()=>assert.fail('verifier must not run'),f.objects,undefined,new BackupKeyVault(randomBytes(32))),'unavailable');
 const s=await f.state();assert.equal(s.attempts[0].reason,'secret_unavailable');assert.equal(s.point.verification,'pending');assert.deepEqual(s.history,[]);
});
for(const startup of [false,true])test('storage '+(startup?'startup':'download')+' failure creates no archive verdict',async()=>{
 const f=await fixture(),store:ObjectFactory=()=>{if(startup)throw Error('private provider address');return {async read(){throw Error('private provider address');},async put(){throw Error('unused');},async remove(){}};};
 assert.equal(await f.run(async()=>assert.fail('verifier must not run'),store),'unavailable');const s=await f.state();assert.equal(s.attempts[0].reason,'unexpected');assert.deepEqual(s.history,[]);assert(!JSON.stringify(s).includes('private provider address'));
});
for(const status of ['passed','invalid'] as const)test('stage cleanup uncertainty overrides '+status,async()=>{
 const f=await fixture();let disposals=0;
 const store:ObjectFactory=()=>({async stage(){return {receipt:receipt(body),open:()=>Readable.from([body]),async dispose(){disposals++;throw Error('private scratch');}};},async putStaged(){throw Error('unused');},async remove(){}});
 assert.equal(await f.run(async(_s,_k,r)=>output(r,status,status==='passed'?'none':'archive_invalid'),store),'unavailable');
 const s=await f.state();assert.equal(disposals,1);assert.equal(s.attempts[0].reason,'cleanup_uncertain');assert.equal(s.point.verification,'pending');assert.deepEqual(s.history,[]);
});
test('cancellation during staging disposes the stage and returns retry budget',async()=>{
 const f=await fixture(),stop=new AbortController();let disposals=0;
 const store:ObjectFactory=()=>({async stage(_key,_streamKey,options){assert.equal(options?.signal,stop.signal);stop.abort();return {receipt:receipt(body),open(){assert.fail('aborted stage must not open');},async dispose(){disposals++;}};},async putStaged(){throw Error('unused');},async remove(){}});
 assert.equal(await f.run(async()=>assert.fail('verifier must not run'),store,stop.signal),'unavailable');
 const s=await f.state();assert.equal(disposals,1);assert.equal(s.attempts[0].reason,'cancelled');assert.equal(s.job.attempts,0);assert.equal(Number(s.job.failures),0);assert.deepEqual(s.history,[]);
});
for(const outcome of ['passed','invalid','throw','cancelled'] as const)test('expired claim ignores late '+outcome+' without any job or evidence mutation',async()=>{
 const f=await fixture(),stop=new AbortController();let before:Awaited<ReturnType<typeof f.state>>|undefined;
 assert.equal(await f.run(async(_s,_k,r)=>{
  await db.secondPool.query("UPDATE backup_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.claim.id]);before=await f.state();
  if(outcome==='cancelled'){stop.abort();throw Error('backup.verifier_cancelled');}
  if(outcome==='throw')throw Error('late failure');
  return output(r,outcome,outcome==='passed'?'none':'archive_invalid');
 },f.objects,stop.signal),'stale');
 assert.deepEqual(await f.state(),before);assert.equal(f.disposals,1);
});

for(const status of ['passed','invalid'] as const)test('cancellation during successful stage disposal overrides '+status,async()=>{
 const f=await fixture(),stop=new AbortController();
 const store:ObjectFactory=()=>({async stage(){return {receipt:receipt(body),open:()=>Readable.from([body]),async dispose(){stop.abort();}};},async putStaged(){throw Error('unused');},async remove(){}});
 assert.equal(await f.run(async(_s,_k,r)=>output(r,status,status==='passed'?'none':'archive_invalid'),store,stop.signal),'unavailable');
 const s=await f.state();assert.equal(s.attempts[0].reason,'cancelled');assert.deepEqual(s.history,[]);assert.equal(s.job.attempts,0);
});
for(const mismatch of ['digest','size'] as const){
 const changed=mismatch==='digest'?Buffer.from('x'.repeat(body.length)):Buffer.concat([body,Buffer.from('extra')]);
 const store:ObjectFactory=()=>({async read(){return changed;},async put(){throw Error('unused');},async remove(){}});
 test('independently measured staged '+mismatch+' mismatch is admitted only as a completed invalid verdict',async()=>{
  const f=await fixture();assert.equal(await f.run(async(source,_key,r)=>{
   const chunks=[];for await(const chunk of source.open())chunks.push(chunk);
   assert.deepEqual(Buffer.concat(chunks),changed);
   const o=output(r,'invalid',mismatch==='digest'?'archive_digest_mismatch':'archive_size_mismatch');o.result.measuredArchive={sha256:receipt(changed).digest,bytes:changed.length};return o;
  },store),'failed');
  const s=await f.state();assert.equal(s.point.verification,'failed');assert.deepEqual(s.history,[{outcome:'failed'}]);
 });
 test('a claimed passed result cannot hide the staged '+mismatch+' mismatch',async()=>{
  const f=await fixture();assert.equal(await f.run(async(_s,_k,r)=>output(r),store),'unavailable');const s=await f.state();assert.equal(s.point.verification,'pending');assert.deepEqual(s.history,[]);
 });
}
test('disagreement between stage and child measurements creates no archive verdict',async()=>{
 const f=await fixture();assert.equal(await f.run(async(_s,_k,r)=>{const o=output(r,'invalid','module_integrity');o.result.measuredArchive={sha256:'4'.repeat(64),bytes:body.length};return o;}),'unavailable');
 assert.deepEqual((await f.state()).history,[]);
});
test('a child byte-count disagreement is unavailable even when its digest matches the stage',async()=>{
 const f=await fixture();assert.equal(await f.run(async(_s,_k,r)=>{const o=output(r,'invalid','module_integrity');o.result.measuredArchive!.bytes++;return o;}),'unavailable');
 assert.deepEqual((await f.state()).history,[]);
});
test('a completed invalid verdict without the staged input measurement cannot create failure evidence',async()=>{
 const f=await fixture();assert.equal(await f.run(async(_s,_k,r)=>{const o=output(r,'invalid','archive_invalid');o.result.measuredArchive=null;return o;}),'unavailable');
 assert.deepEqual((await f.state()).history,[]);
});
for(const change of ['expired','claim','deleting','production'] as const)test('initial '+change+' claim never opens storage or keys',async()=>{
 const f=await fixture();
 if(change==='expired')await db.pool.query("UPDATE backup_jobs SET lease_until=clock_timestamp()-interval '1 second'");
 if(change==='claim')await db.pool.query('UPDATE backup_jobs SET claim_id=$1',[randomUUID()]);
 if(change==='deleting')await db.pool.query('UPDATE backup_points SET deleting=true');
 if(change==='production')await db.pool.query("UPDATE venues SET environment='production'");
 const before=await f.state();assert.equal(await f.run(async()=>assert.fail('verifier must not run'),()=>assert.fail('storage must not open')),'stale');
 assert.deepEqual(await f.state(),before);
});
for(const change of ['policy','delete','retry'] as const)test(change+' during external verification rejects old output and all later error bookkeeping',async()=>{
 const f=await fixture();let before:Awaited<ReturnType<typeof f.state>>|undefined;
 assert.equal(await f.run(async(_s,_k,r)=>{
  if(change==='policy')await transaction(db.secondPool,c=>setVerificationPolicy(c,target,image,true));
  if(change==='delete')await db.secondPool.query('UPDATE backup_points SET deleting=true,deleted_at=clock_timestamp()');
  if(change==='retry')await db.secondPool.query('UPDATE backup_jobs SET claim_id=$1,attempts=2',[randomUUID()]);
  before=await f.state();return output(r);
 }),'stale');assert.deepEqual(await f.state(),before);assert.equal(f.disposals,1);
});
for(const first of ['passed','invalid'] as const)test('unavailable recheck keeps historical '+first+' evidence with truthful current state',async()=>{
 const f=await fixture();await f.run(async(_s,_k,r)=>output(r,first,first==='passed'?'none':'archive_invalid'));
 const initial=await f.state();f.claim.claimId=randomUUID();f.claim.number=1;
 await db.pool.query("UPDATE backup_jobs SET status='running',claim_id=$2,attempts=1,runs=runs+1,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$1",[f.claim.id,f.claim.claimId]);
 assert.equal(await f.run(async()=>{throw Error('backup.verifier_resource');}),'unavailable');const s=await f.state();
 assert.deepEqual(s.history,initial.history);assert.equal(s.point.verification,first==='passed'?'pending':'failed');
 assert.equal(s.point.current_evidence_id,first==='passed'?null:initial.point.current_evidence_id);assert.equal(s.attempts.length,2);
 assert.notEqual(s.attempts[1].child_token,s.attempts[0].child_token);assert.equal(s.attempts[1].reason,'resource_limit');assert.equal(f.disposals,2);
});
test('a cancelled claim retry gets a fresh token even when its attempt number is reused',async()=>{
 const f=await fixture(),stop=new AbortController();await f.run(async()=>{stop.abort();throw Error('backup.verifier_cancelled');},f.objects,stop.signal);
 const initial=await f.state();assert.equal(initial.job.attempts,0);f.claim.claimId=randomUUID();
 await db.pool.query("UPDATE backup_jobs SET status='running',claim_id=$2,attempts=1,runs=runs+1,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$1",[f.claim.id,f.claim.claimId]);
 assert.equal(await f.run(),'verified');const s=await f.state();assert.equal(s.attempts.length,2);
 assert.notEqual(s.attempts[1].child_token,s.attempts[0].child_token);assert.equal(s.attempts[1].attempt_number,s.attempts[0].attempt_number);assert.deepEqual(s.history,[{outcome:'verified'}]);
});
test('empty encrypted input admits child size failure without a fictitious nonempty measurement',async()=>{
 const f=await fixture(),store:ObjectFactory=()=>({async read(){return Buffer.alloc(0);},async put(){throw Error('unused');},async remove(){}});
 assert.equal(await f.run(async(_s,_k,r)=>{const o=output(r,'invalid','archive_size_mismatch');o.result.measuredArchive=null;return o;},store),'failed');
 assert.deepEqual((await f.state()).history,[{outcome:'failed'}]);
});
for(const mismatch of ['digest','size'] as const)test('staged '+mismatch+' mismatch cannot claim that a module check completed',async()=>{
 const f=await fixture(),changed=mismatch==='digest'?Buffer.from('x'.repeat(body.length)):Buffer.concat([body,Buffer.from('extra')]);
 const store:ObjectFactory=()=>({async read(){return changed;},async put(){throw Error('unused');},async remove(){}});
 assert.equal(await f.run(async(_s,_k,r)=>{const o=output(r,'invalid','module_integrity');o.result.measuredArchive={sha256:receipt(changed).digest,bytes:changed.length};return o;},store),'unavailable');
 assert.deepEqual((await f.state()).history,[]);
});
test('shutdown does not relabel an unexpected verifier exception as cancellation',async()=>{
 const f=await fixture(),stop=new AbortController();assert.equal(await f.run(async()=>{stop.abort();throw Error('unexpected private detail');},f.objects,stop.signal),'unavailable');
 const s=await f.state();assert.equal(s.attempts[0].reason,'unexpected');assert.equal(s.job.attempts,1);assert.equal(Number(s.job.failures),1);assert.deepEqual(s.history,[]);
});
test('an absent target policy never opens storage and never changes the claim',async()=>{
 const f=await fixture();await db.pool.query('UPDATE backup_verification_policy SET revision=0,target=NULL,verifier_image=NULL,release_ready=false');const before=await f.state();
 assert.equal(await f.run(async()=>assert.fail('verifier must not run'),()=>assert.fail('storage must not open')),'stale');assert.deepEqual(await f.state(),before);
});
for(const reason of ['archive_size_mismatch','archive_digest_mismatch'] as const)test('matching staged bytes cannot acquire a false '+reason+' verdict',async()=>{
 const f=await fixture();assert.equal(await f.run(async(_s,_k,r)=>output(r,'invalid',reason)),'unavailable');assert.deepEqual((await f.state()).history,[]);
});
test('an already cancelled claim never attempts to unseal a wrong master key',async()=>{
 const f=await fixture();assert.equal(await f.run(async()=>assert.fail('verifier must not run'),f.objects,AbortSignal.abort(),new BackupKeyVault(randomBytes(32))),'unavailable');
 const s=await f.state();assert.equal(s.attempts[0].reason,'cancelled');assert.equal(s.job.attempts,0);
});
test('cancellation just after unsealing stops before storage construction',async()=>{
 const f=await fixture(),stop=new AbortController();
 const cancellingVault=new class extends BackupKeyVault {override open(venue:string,version:number,sealed:string){const keys=super.open(venue,version,sealed);stop.abort();return keys;}}(master);
 assert.equal(await f.run(async()=>assert.fail('verifier must not run'),()=>assert.fail('storage must not open'),stop.signal,cancellingVault),'unavailable');
 const s=await f.state();assert.equal(s.attempts[0].reason,'cancelled');assert.equal(s.job.attempts,0);
});
test('a verifier cannot replace the independently staged receipt to hide different bytes',async()=>{
 const f=await fixture(),changed=Buffer.from('different staged input'),store:ObjectFactory=()=>({async read(){return changed;},async put(){throw Error('unused');},async remove(){}});
 assert.equal(await f.run(async(s,_k,r)=>{s.receipt.digest=r.archive.sha256;s.receipt.size=r.archive.bytes;return output(r);},store),'unavailable');assert.deepEqual((await f.state()).history,[]);
});
test('a length mismatch takes precedence over a digest mismatch in the child verdict',async()=>{
 const f=await fixture(),changed=Buffer.concat([body,Buffer.from('extra')]),store:ObjectFactory=()=>({async read(){return changed;},async put(){throw Error('unused');},async remove(){}});
 assert.equal(await f.run(async(_s,_k,r)=>{const o=output(r,'invalid','archive_digest_mismatch');o.result.measuredArchive={sha256:receipt(changed).digest,bytes:changed.length};return o;},store),'unavailable');assert.deepEqual((await f.state()).history,[]);
});
test('the real filesystem stage is removed before a passed result becomes visible',async()=>{
 const f=await fixture(),directory=await mkdtemp(join(tmpdir(),'claim-pipeline-stage-')),holder=await db.secondPool.connect();
 let running:Promise<string>|undefined,ack!:()=>void;
 const begun=new Promise<void>(resolve=>{ack=resolve;});
 try{
  const store:ObjectFactory=()=>({async stage(_key,_streamKey,options){return stageReadable(Readable.from([body]),body.length,{...options,temporaryRoot:directory});},async putStaged(){throw Error('unused');},async remove(){}});
  running=f.run(async(source,_key,r)=>{
   assert.equal((await readdir(directory)).length,1);const chunks=[];for await(const chunk of source.open())chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),body);
   await holder.query('BEGIN');await holder.query('SELECT * FROM backup_verification_policy FOR UPDATE');ack();
   return output(r);
  },store);
  await Promise.race([begun,running.then(()=>assert.fail('admission must wait for the acknowledged lock'))]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let blocked=false;const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   const waiting=await db.pool.query("SELECT pid FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid)) AND query='SELECT * FROM backup_verification_policy WHERE id=1 FOR SHARE'",[pid]);
   if(waiting.rowCount){blocked=true;break;}await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(blocked,true,'admission must acknowledge its exact PostgreSQL blocker');assert.deepEqual(await readdir(directory),[]);
  const before=await f.state();assert.equal(before.point.verification,'pending');assert.deepEqual(before.history,[]);assert.equal(before.attempts[0].state,'running');
  await holder.query('COMMIT');assert.equal(await running,'verified');
  assert.deepEqual(await readdir(directory),[]);assert.equal((await f.state()).point.verification,'verified');
 }finally{await holder.query('ROLLBACK');await running?.catch(()=>{});holder.release();await rm(directory,{recursive:true,force:true});}
});
test('a real staging stream failure closes and removes its partial file without an archive verdict',async()=>{
 const f=await fixture(),directory=await mkdtemp(join(tmpdir(),'claim-pipeline-stage-'));
 try{
  const stream=Readable.from((async function*(){yield body.subarray(0,3);throw Error('private staging failure');})());
  const store:ObjectFactory=()=>({async stage(_key,_streamKey,options){return stageReadable(stream,body.length,{...options,temporaryRoot:directory});},async putStaged(){throw Error('unused');},async remove(){}});
  assert.equal(await f.run(async()=>assert.fail('verifier must not run'),store),'unavailable');
  assert.equal(stream.destroyed,true);assert.deepEqual(await readdir(directory),[]);const s=await f.state();assert.deepEqual(s.history,[]);assert.equal(s.point.verification,'pending');assert.equal(s.attempts[0].reason,'unexpected');
 }finally{await rm(directory,{recursive:true,force:true});}
});
