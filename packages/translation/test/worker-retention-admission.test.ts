import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {createJob,createLoopbackOpenAiClient,jobFingerprint,lockVenue,sweepTranslationJobs,TranslationWorker} from '../src/index.ts';
import {connectedVenue,database,giveConsent} from './fixtures.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from './fake-openai.ts';

let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.pool.query("UPDATE translation_jobs SET state='expired',lease_id=NULL,lease_until=NULL WHERE state IN ('queued','running')");
});
async function queue(name:string){
 const venue=await connectedVenue(db,issuer,origin);await giveConsent(db,venue);
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},
  items:[{ref:'p1',kind:'product',family:'p1',category:null,staffName:name,existing:{},missing:['ca','es']}],houseStyle:[]});
 return transaction(db.pool,async client=>{
  await lockVenue(client,venue.venueId);
  return createJob(client,{installationId:venue.installationId,venueId:venue.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(body),body,total:1});
 });
}
const jobRow=async(id:string)=>(await db.pool.query('SELECT * FROM translation_jobs WHERE id=$1',[id])).rows[0];
const bodyRow=async(id:string)=>(await db.pool.query('SELECT body,batch_results::text FROM translation_job_bodies WHERE job_id=$1',[id])).rows[0];

for(const state of ['queued','running'] as const)for(const age of ['24 hours','25 hours'])
test(`a ${state} job submitted ${age} ago is not leased or sent while awaiting cleanup`,async()=>{
 const old=await queue('OLD-MENU');
 await db.pool.query(`UPDATE translation_jobs SET state=$2,created_at=clock_timestamp()-$3::interval,
  lease_id=CASE WHEN $2='running' THEN gen_random_uuid() ELSE NULL END,
  lease_until=CASE WHEN $2='running' THEN clock_timestamp()-interval '1 second' ELSE NULL END,
  started_at=CASE WHEN $2='running' THEN clock_timestamp()-interval '1 hour' ELSE NULL END,
  lease_count=CASE WHEN $2='running' THEN 2 ELSE 0 END,input_tokens=12,output_tokens=3,cost_micro_usd=7
  WHERE id=$1`,[old.id,state,age]);
 const beforeJob=await jobRow(old.id),beforeBody=await bodyRow(old.id);
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 try{
  const worker=new TranslationWorker(db.pool,createLoopbackOpenAiClient({apiKey:'local-test',baseUrl:fake.baseUrl,timeoutMs:5000}));
  const leased=await worker.runOnce(new AbortController().signal);
  assert.equal(fake.requests.length,0,'old menu must not reach the provider');
  assert.equal(leased,false,'old work must not receive a new lease');
  assert.deepEqual(await jobRow(old.id),beforeJob,'skipping preserves the lease, attempts and accounting');
  assert.deepEqual(await bodyRow(old.id),beforeBody,'the existing sweep owns deletion');

  const resubmit=()=>transaction(db.pool,async client=>{
   await lockVenue(client,old.venue_id);
   return createJob(client,{installationId:old.installation_id,venueId:old.venue_id,operationId:randomUUID(),
    fingerprint:jobFingerprint(beforeBody.body),body:beforeBody.body,total:1});
  });
  await assert.rejects(resubmit(),/job_running/,'the same venue still waits for cleanup');
  const young=await queue('YOUNG-MENU');
  await db.pool.query("UPDATE translation_jobs SET created_at=clock_timestamp()-interval '23 hours 59 minutes 50 seconds' WHERE id=$1",[young.id]);
  assert.equal(await worker.runOnce(new AbortController().signal),true);
  assert.equal((await jobRow(young.id)).state,'done','old work must not starve a younger job');
  assert.equal(fake.requests.length,2);
  assert.ok(fake.requests.every(r=>!r.body.input.includes('OLD-MENU')));
  assert.deepEqual(await jobRow(old.id),beforeJob);
  assert.deepEqual(await bodyRow(old.id),beforeBody);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM usage_events WHERE source_reference=$1',[old.id])).rows[0].n,0);

  assert.deepEqual(await sweepTranslationJobs(db.pool),{expired:1});
  assert.deepEqual(await jobRow(old.id),{...beforeJob,state:'expired',lease_id:null,lease_until:null});
  assert.equal(await bodyRow(old.id),undefined);
  assert.equal((await jobRow(young.id)).state,'done');
  assert.equal((await resubmit()).state,'queued','cleanup permits a fresh job for the same venue');
 }finally{await fake.close();}
});
