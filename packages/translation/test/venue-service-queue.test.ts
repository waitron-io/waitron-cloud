import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {BillingStore,createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {TranslationWorker,createLoopbackOpenAiClient,createJob,jobFingerprint} from '../src/index.ts';
import {connectedVenue,database,giveConsent} from './fixtures.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from './fake-openai.ts';

const origin='https://cloud.example.test';
const text=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR',staffName:'Cafe',existing:{},missing:['ca','es']}],houseStyle:[]});
const mode='test-venue-levels' as const;

async function fixture(){
 const db=await database(),signer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const production=await connectedVenue(db,signer,origin);
 await giveConsent(db,production);
 const queue=(v:{venueId:string;installationId:string})=>transaction(db.pool,c=>createJob(c,{
  installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(text),body:text,total:1}));
 const row=async(id:string)=>(await db.pool.query('SELECT * FROM translation_jobs WHERE id=$1',[id])).rows[0];
 const body=async(id:string)=>(await db.pool.query('SELECT * FROM translation_job_bodies WHERE job_id=$1',[id])).rows[0];
 const eligible=async()=>{
  const v=await connectedVenue(db,signer,origin);await giveConsent(db,v);
  const store=new BillingStore(db.pool),scope={organisationId:v.organisationId,legalBusinessId:v.legalBusinessId};
  const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
  await store.execute(scope,event(),{type:'ensure_business'});
  await store.transition(scope,event(),{type:'set_venue',venueId:v.venueId,expectedRevision:0,
   value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
  return v;
 };
 const worker=(baseUrl:string)=>new TranslationWorker(db.pool,createLoopbackOpenAiClient({apiKey:'local-fake-only',baseUrl,timeoutMs:5000}),
  {planMode:mode,batchConcurrency:1,wait:async()=>{}});
 return {db,production,queue,row,body,eligible,worker,close:()=>db.close()};
}

for(const state of ['queued','running'] as const){
 test(`venue translation skips an earlier production ${state} job and completes eligible test work`,async()=>{
  const f=await fixture(),fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
  try{
   const old=await f.queue(f.production);
   await f.db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[f.production.venueId]);
   await f.db.pool.query(`UPDATE translation_jobs SET created_at=clock_timestamp()-interval '1 hour',state=$2,
    lease_id=$3,lease_until=CASE WHEN $2='running' THEN clock_timestamp()-interval '1 minute' ELSE NULL END,
    lease_count=CASE WHEN $2='running' THEN 1 ELSE 0 END WHERE id=$1`,[old.id,state,state==='running'?randomUUID():null]);
   const before=await f.row(old.id),beforeBody=await f.body(old.id);
   const next=await f.queue(await f.eligible()),worker=f.worker(fake.baseUrl);
   assert.equal(await worker.runOnce(new AbortController().signal),true);
   const completed=await f.row(next.id);
   assert.deepEqual([completed.state,completed.done,completed.failed],['done',1,0]);
   assert.equal(fake.requests.length,2);
   assert.deepEqual(await f.row(old.id),before);
   assert.deepEqual(await f.body(old.id),beforeBody);
   assert.equal(await worker.runOnce(new AbortController().signal),false);
   assert.equal(fake.requests.length,2);
   assert.deepEqual(await f.row(old.id),before);
   assert.equal((await f.db.pool.query('SELECT count(*) FROM billing_service_authority WHERE venue_id=$1',[f.production.venueId])).rows[0].count,'0');
  }finally{await fake.close();await f.close();}
 });
 test(`venue translation leaves a production-only ${state} queue untouched`,async()=>{
  const f=await fixture(),fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
  try{
   const old=await f.queue(f.production);
   await f.db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[f.production.venueId]);
   if(state==='running')await f.db.pool.query("UPDATE translation_jobs SET state='running',lease_id=$2,lease_until=clock_timestamp()-interval '1 minute',lease_count=1 WHERE id=$1",[old.id,randomUUID()]);
   const before=await f.row(old.id),beforeBody=await f.body(old.id);
   assert.equal(await f.worker(fake.baseUrl).runOnce(new AbortController().signal),false);
   assert.equal(fake.requests.length,0);
   assert.deepEqual(await f.row(old.id),before);
   assert.deepEqual(await f.body(old.id),beforeBody);
   assert.equal((await f.db.pool.query('SELECT count(*) FROM usage_events')).rows[0].count,'0');
  }finally{await fake.close();await f.close();}
 });
}
