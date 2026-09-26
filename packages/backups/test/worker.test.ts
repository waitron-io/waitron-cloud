import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {SignupStore,RegistrationStore} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {BackupCatalogue} from '../src/catalogue.ts';
import {BackupKeyVault} from '../src/keys.ts';
import {receipt} from '../src/storage.ts';
import {BackupWorker} from '../src/worker.ts';
let db:Awaited<ReturnType<typeof database>>,catalogue:BackupCatalogue,worker:BackupWorker;
let venue:{installationId:string;venueId:string};
const vault=new BackupKeyVault(randomBytes(32)),objects=new Map<string,Buffer>();
let failDelete=false,restores=0,restore:()=>Promise<void>;
const storage=()=>({async read(key:string){const bytes=objects.get(key);if(!bytes)throw Error('missing');return bytes;},async put(key:string,bytes:Uint8Array){objects.set(key,Buffer.from(bytes));return receipt(bytes);},async remove(key:string){if(failDelete)throw Error('unavailable');objects.delete(key);}});
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await db.pool.query('TRUNCATE signup_requests,email_outbox,organisations,cloud_accounts CASCADE');objects.clear();failDelete=false;restores=0;restore=async()=>{restores++;};
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('worker@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password:'A sufficiently long password',organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),r=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await r.start(binding);await r.approveCloud(binding,owner.accountId);await r.approveLocal(binding,randomUUID());venue=await r.complete(binding);
 catalogue=new BackupCatalogue(db.pool,vault,storage);await catalogue.provision(venue.installationId,{endpoint:'https://storage.test',bucket:'worker-fixture',region:'local'});
 worker=new BackupWorker(db.pool,catalogue,async()=>restore());
});
async function snapshot(days=0){const capture=await catalogue.reserveCapture(venue.installationId,randomUUID()),bytes=Buffer.from('encrypted fixture '+capture.id);objects.set(capture.incomingKey,bytes);return catalogue.publish(venue.installationId,capture.id,{...receipt(bytes),capturedAt:new Date(Date.now()-days*86400000).toISOString(),retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}});}
async function only(kind:string){await worker.schedule();await db.pool.query("UPDATE backup_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>$1",[kind]);}
test('scheduling is idempotent and concurrent workers claim verification once',async()=>{
 const point=await snapshot();await Promise.all([worker.schedule(),worker.schedule()]);await only('verify');
 const other=new BackupWorker(db.secondPool,new BackupCatalogue(db.secondPool,vault,storage),async()=>restore());
 const results=await Promise.all([worker.runOnce(),other.runOnce()]);assert.equal(results.filter(Boolean).length,1);assert.equal(restores,1);
 assert.equal((await db.pool.query('SELECT verification FROM backup_points WHERE id=$1',[point.id])).rows[0].verification,'verified');
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_jobs')).rows[0].count,'3');assert.equal(await other.runOnce(),false);
});
test('lease takeover fences a late failed verification after a new worker succeeds',async()=>{
 const point=await snapshot();await only('verify');let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});restore=async()=>{entered();await gate;throw Error('old result');};
 const old=worker.runOnce();await started;
 try{
  await db.pool.query("UPDATE backup_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE kind='verify'");
  assert.equal((await worker.status()).due,1);
  const fresh=new BackupWorker(db.secondPool,new BackupCatalogue(db.secondPool,vault,storage),async()=>{});assert.equal(await fresh.runOnce(),true);
 }finally{release();await old;}
 assert.equal((await db.pool.query('SELECT verification FROM backup_points WHERE id=$1',[point.id])).rows[0].verification,'verified');
 assert.deepEqual((await db.pool.query('SELECT outcome FROM backup_verifications')).rows.map(r=>r.outcome),['verified']);
});
test('failed verification backs off, survives worker restart and succeeds on retry',async()=>{
 const point=await snapshot();await only('verify');restore=async()=>{throw Error('temporary failure with private details');};
 assert.equal(await worker.runOnce(),true);assert.equal(await worker.runOnce(),false);
 let job=(await db.pool.query("SELECT * FROM backup_jobs WHERE kind='verify'")).rows[0];assert.equal(job.attempts,1);assert.equal(Number(job.failures),1);assert(!JSON.stringify(job).includes('private details'));
 await db.pool.query("UPDATE backup_jobs SET available_at=clock_timestamp() WHERE kind='verify'");restore=async()=>{restores++;};
 worker=new BackupWorker(db.secondPool,new BackupCatalogue(db.secondPool,vault,storage),async()=>restore());assert.equal(await worker.runOnce(),true);
 assert.equal((await db.pool.query('SELECT verification FROM backup_points WHERE id=$1',[point.id])).rows[0].verification,'verified');
 job=(await db.pool.query("SELECT * FROM backup_jobs WHERE kind='verify'")).rows[0];assert.equal(job.attempts,0);assert.equal(Number(job.failures),1);
});
test('shutdown cancels a snapshot download without recording a failure or consuming a retry',async()=>{
 const point=await snapshot();await only('verify');
 let entered!:()=>void,stageSignal:AbortSignal|undefined;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const cancellingCatalogue=new BackupCatalogue(db.pool,vault,()=>({
  async stage(_key:string,_streamKey?:string,options?:{signal?:AbortSignal}){
   stageSignal=options?.signal;entered();
   if(!stageSignal)throw Error('missing shutdown signal');
   await new Promise<never>((_resolve,reject)=>stageSignal!.addEventListener('abort',()=>reject(Error('backup.cancelled')),{once:true}));
   throw Error('unreachable');
  },
  async putStaged(){throw Error('unused');},
  async remove(){throw Error('unused');},
 }));
 const cancellingWorker=new BackupWorker(db.pool,cancellingCatalogue,async()=>assert.fail('restore must not start')),
  controller=new AbortController(),running=cancellingWorker.runOnce(controller.signal);
 await started;controller.abort();await running;
 assert.equal(stageSignal?.aborted,true);
 const job=(await db.pool.query("SELECT status,attempts,runs,failures,last_error,claim_id,lease_until FROM backup_jobs WHERE kind='verify' AND target_id=$1",[point.id])).rows[0];
 assert.deepEqual(job,{status:'pending',attempts:0,runs:'1',failures:'0',last_error:null,claim_id:null,lease_until:null});
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_verifications WHERE point_id=$1',[point.id])).rows[0].count,'0');
 assert.equal((await db.pool.query('SELECT verification FROM backup_points WHERE id=$1',[point.id])).rows[0].verification,'pending');
});
test('shutdown does not erase a real verification failure',async()=>{
 const point=await snapshot();await only('verify');const controller=new AbortController();
 const failingWorker=new BackupWorker(db.pool,catalogue,async()=>{controller.abort();throw Error('corrupt archive');});
 assert.equal(await failingWorker.runOnce(controller.signal),true);
 const job=(await db.pool.query("SELECT status,attempts,failures,last_error FROM backup_jobs WHERE kind='verify' AND target_id=$1",[point.id])).rows[0];
 assert.equal(job.status,'pending');assert.equal(job.attempts,1);assert.equal(job.failures,'1');assert.equal(job.last_error,'verification_failed');
 assert.deepEqual((await db.pool.query('SELECT outcome FROM backup_verifications WHERE point_id=$1',[point.id])).rows.map(row=>row.outcome),['failed']);
 assert.equal((await db.pool.query('SELECT verification FROM backup_points WHERE id=$1',[point.id])).rows[0].verification,'failed');
});
test('abandoned captures expire, cannot be reused and clean orphan objects after restart',async()=>{
 const capture=await catalogue.reserveCapture(venue.installationId,randomUUID());objects.set(capture.incomingKey,Buffer.from('abandoned'));objects.set('snapshots/'+capture.id,Buffer.from('uncommitted'));
 await db.pool.query("UPDATE backup_captures SET created_at=clock_timestamp()-interval '25 hours' WHERE id=$1",[capture.id]);
 await assert.rejects(catalogue.reserveCapture(venue.installationId,capture.id),/expired/);await only('incoming');failDelete=true;assert.equal(await worker.runOnce(),true);assert(objects.has(capture.incomingKey));
 failDelete=false;await db.pool.query("UPDATE backup_jobs SET available_at=clock_timestamp() WHERE kind='incoming'");assert.equal(await worker.runOnce(),true);assert.equal(objects.size,0);
 const row=(await db.pool.query('SELECT expired_at,cleaned_at FROM backup_captures WHERE id=$1',[capture.id])).rows[0];assert(row.expired_at);assert(row.cleaned_at);await assert.rejects(catalogue.reserveCapture(venue.installationId,capture.id),/expired/);
});
test('upload grace refuses late publication but preserves committed snapshots and exact retries',async()=>{
 const published=await snapshot(),pending=await catalogue.reserveCapture(venue.installationId,randomUUID()),bytes=Buffer.from('late upload');objects.set(pending.incomingKey,bytes);
 const metadata={...receipt(bytes),capturedAt:new Date().toISOString(),retention:'daily' as const,sourceNodeId:randomUUID(),modules:{core:1}};
 await db.pool.query("UPDATE backup_captures SET created_at=clock_timestamp()-interval '24 hours 15 minutes'");
 await assert.rejects(catalogue.publish(venue.installationId,pending.id,metadata),/capture_expired/);assert.equal(await catalogue.cleanupCapture(venue.venueId),null);assert(objects.has(pending.incomingKey));
 await db.pool.query("UPDATE backup_captures SET created_at=clock_timestamp()-interval '25 hours'");
 const cleaned=[await catalogue.cleanupCapture(venue.venueId),await catalogue.cleanupCapture(venue.venueId)];assert(cleaned.includes(pending.id));assert(cleaned.includes(published.id));assert(objects.has(published.objectKey));assert(!objects.has(pending.incomingKey));
 const {digest,size,capturedAt,retention,sourceNodeId,modules}=published;
 assert.equal((await catalogue.publish(venue.installationId,published.id,{digest,size,capturedAt,retention,sourceNodeId,modules})).id,published.id);
 await assert.rejects(catalogue.publish(venue.installationId,pending.id,metadata),/capture_expired/);
});
test('retry exhaustion is visible and explicit retry resumes the same durable job',async()=>{
 await snapshot();await only('verify');restore=async()=>{throw Error('private adapter detail');};
 for(let n=0;n<8;n++){await db.pool.query("UPDATE backup_jobs SET available_at=clock_timestamp() WHERE kind='verify'");assert.equal(await worker.runOnce(),true);}
 assert.equal(await worker.runOnce(),false);let status=await worker.status();assert.equal(status.counts.failed,1);assert.equal(status.failures,8);assert.equal(status.runs,8);
 assert.equal(await worker.retryFailed(),1);restore=async()=>{};assert.equal(await worker.runOnce(),true);status=await worker.status();assert.equal(status.counts.failed,0);assert.equal(status.runs,9);
});
test('each schedule is bounded and later sweeps pick up the remaining snapshots',async()=>{
 for(let n=0;n<103;n++)await snapshot();assert.equal(await worker.schedule(),102);assert.equal(await worker.schedule(),3);assert.equal(await worker.schedule(),0);
 await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[venue.venueId]);assert.equal(await worker.runOnce(),false);
});
test('retention resumes after delete failure and preserves the verified fallback',async()=>{
 const old=await snapshot(70),fallback=await snapshot(60);await catalogue.verify(fallback.id,'fixture',async()=>{});await only('retention');
 failDelete=true;assert.equal(await worker.runOnce(),true);assert.equal((await db.pool.query('SELECT deleting FROM backup_points WHERE id=$1',[old.id])).rows[0].deleting,true);
 failDelete=false;await db.pool.query("UPDATE backup_jobs SET available_at=clock_timestamp() WHERE kind='retention'");assert.equal(await worker.runOnce(),true);assert(!objects.has(old.objectKey));assert(objects.has(fallback.objectKey));
});

test('the CLI reports and retries durable failures without storage or verifier credentials',async()=>{
 await snapshot();await only('verify');await db.pool.query("UPDATE backup_jobs SET status='failed',attempts=8 WHERE kind='verify'");
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options','-c search_path='+db.schema);
 const run=async(mode:string)=>JSON.parse((await promisify(execFile)(process.execPath,['packages/backups/src/worker-cli.ts',mode],{cwd:new URL('../../../',import.meta.url),env:{PATH:process.env.PATH,DATABASE_URL:url.href}})).stdout);
 assert.equal((await run('--status')).counts.failed,1);
 assert.equal((await run('--retry-failed')).retried,1);
 assert.equal((await run('--status')).counts.failed,0);
});
test('an expired verification records failure and backoff when its claim has not been replaced',async()=>{
 const point=await snapshot();await only('verify');restore=async()=>{await db.secondPool.query("UPDATE backup_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE kind='verify'");};
 assert.equal(await worker.runOnce(),true);
 const job=(await db.pool.query("SELECT *,available_at>clock_timestamp() AS delayed FROM backup_jobs WHERE kind='verify'")).rows[0];
 assert.equal(job.status,'pending');assert.equal(Number(job.failures),1);assert.equal(job.last_error,'operation_failed');assert.equal(job.delayed,true);
 assert.equal(await worker.runOnce(),false);
 assert.equal((await db.pool.query('SELECT verification FROM backup_points WHERE id=$1',[point.id])).rows[0].verification,'pending');
});
