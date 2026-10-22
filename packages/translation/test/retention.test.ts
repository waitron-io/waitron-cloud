import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {Pool} from 'pg';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {collectJob,createJob,createLoopbackOpenAiClient,jobFingerprint,lockVenue,monthSpend,parseJob,readJob,releaseJob,sweepTranslationJobs,TranslationError,TranslationWorker,writtenItems} from '../src/index.ts';
import {connectedVenue,database,giveConsent} from './fixtures.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from './fake-openai.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
type Venue=Awaited<ReturnType<typeof connectedVenue>>;
async function aged(v:Venue,state:string,age:string){
 const id=randomUUID(),finished=['done','partly_done','failed','collected'].includes(state);
 const reason=state==='partly_done'?'provider_failed':state==='failed'?'provider_unavailable':null;
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,reason,total,done,provider,model,prompt_version,lease_id,lease_until,created_at,finished_at)
  VALUES($1,$2,$3,$4,$5,10,$6,$7,1,0,'openai','gpt-6-luna','translate-all-v1',CASE WHEN $6='running' THEN gen_random_uuid() END,CASE WHEN $6='running' THEN clock_timestamp()+interval '1 minute' END,
   clock_timestamp()-$8::interval,CASE WHEN $9 THEN clock_timestamp()-$8::interval END)`,[id,v.installationId,v.venueId,randomUUID(),'a'.repeat(64),state,reason,age,finished]);
 if(state!=='collected')await db.pool.query("INSERT INTO translation_job_bodies(job_id,body) VALUES($1,'{}')",[id]);
 return id;
}
const look=async(id:string)=>(await db.pool.query('SELECT j.state,j.lease_id,(SELECT count(*)::integer FROM translation_job_bodies b WHERE b.job_id=j.id) AS bodies FROM translation_jobs j WHERE j.id=$1',[id])).rows[0];
async function drain(){for(let pass=0;pass<100;pass++)if((await sweepTranslationJobs(db.pool)).expired===0)return;assert.fail('sweep did not finish the bounded fixture');}
test('a finished job keeps its body for 24 hours, then loses it, expires, and can no longer be collected',async()=>{
 const v=await connectedVenue(db,issuer,origin),kept=await aged(v,'done','23 hours 59 minutes'),gone=await aged(v,'done','24 hours');
 const partly=await aged(v,'partly_done','25 hours'),failed=await aged(v,'failed','25 hours');
 await drain();
 assert.deepEqual(await look(kept),{state:'done',lease_id:null,bodies:1});
 for(const id of [gone,partly,failed])assert.deepEqual(await look(id),{state:'expired',lease_id:null,bodies:0});
 await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,gone))),(e:unknown)=>e instanceof TranslationError&&e.code==='expired');
});
test('a job that never finished expires 24 hours after it was submitted, with its lease cleared',async()=>{
 const a=await connectedVenue(db,issuer,origin),b=await connectedVenue(db,issuer,origin),c=await connectedVenue(db,issuer,origin);
 const queued=await aged(a,'queued','24 hours'),running=await aged(b,'running','25 hours'),young=await aged(c,'queued','23 hours');
 await drain();
 for(const id of [queued,running]){assert.deepEqual(await look(id),{state:'expired',lease_id:null,bodies:0});
  assert.equal((await db.pool.query('SELECT lease_until FROM translation_jobs WHERE id=$1',[id])).rows[0].lease_until,null);}
 assert.deepEqual(await look(young),{state:'queued',lease_id:null,bodies:1});
});
test('a collected job is left alone, and the limit bounds one pass',async()=>{
 const v=await connectedVenue(db,issuer,origin),collected=await aged(v,'collected','30 hours');
 await drain();assert.equal((await look(collected)).state,'collected');
 for(let n=0;n<3;n++)await aged(v,'done','25 hours');
 assert.deepEqual(await sweepTranslationJobs(db.pool,2),{expired:2});
 assert.deepEqual(await sweepTranslationJobs(db.pool,2),{expired:1});
 await assert.rejects(sweepTranslationJobs(db.pool,0),/translation_sweep_limit/);
});
test('a worker that loses its job to the sweep stops without writing',async()=>{
 await db.pool.query("UPDATE translation_jobs SET created_at=clock_timestamp()-interval '25 hours' WHERE state IN ('queued','running')");
 await drain();
 const v=await connectedVenue(db,issuer,origin);await giveConsent(db,v);
 const text=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},
  items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR',staffName:'CAFE',existing:{},missing:['ca','es']}],houseStyle:[]});
 const job=await transaction(db.pool,async c=>{await lockVenue(c,v.venueId);
  return createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(text),body:text,total:writtenItems(parseJob(text)).length});});
 const fake=await startFakeOpenAi(async r=>{
  await db.pool.query("UPDATE translation_jobs SET created_at=created_at-interval '25 hours' WHERE id=$1",[job.id]);
  await sweepTranslationJobs(db.pool);
  return echoFirstPass(r);
 });
 try{
  assert.equal(await new TranslationWorker(db.pool,createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl}),{wait:async()=>{}}).runOnce(new AbortController().signal),true);
  assert.deepEqual(await look(job.id),{state:'expired',lease_id:null,bodies:0});
  assert.equal(fake.requests.length,1);
  assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM usage_events WHERE source_reference=$1',[job.id])).rows[0].n,0);
 }finally{await fake.close();}
});

test('finished retention uses finish time, retains exact recent text and accounting, and is idempotent',async()=>{
 await drain();
 const v=await connectedVenue(db,issuer,origin),recent=await aged(v,'done','25 hours'),stale=await aged(v,'done','1 hour');
 await db.pool.query("UPDATE translation_jobs SET finished_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[recent]);
 await db.pool.query("UPDATE translation_jobs SET finished_at=clock_timestamp()-interval '24 hours',input_tokens=123,output_tokens=45,cost_micro_usd=67 WHERE id=$1",[stale]);
 const text='{"items":[],"text":"Cafè 😀 \\u0000 \\ud800"}',results='{"0":{"results":[{"ref":"p1","names":{"ca":"Cafè \\u0000 \\ud800"},"corrections":[]}],"failed":[]}}';
 for(const id of [recent,stale])await db.pool.query('UPDATE translation_job_bodies SET body=$2,batch_results=$3 WHERE job_id=$1',[id,text,results]);
 const before=(await db.pool.query('SELECT * FROM translation_jobs WHERE id=$1',[stale])).rows[0];
 assert.deepEqual(await sweepTranslationJobs(db.pool),{expired:1});
 const after=(await db.pool.query('SELECT * FROM translation_jobs WHERE id=$1',[stale])).rows[0];
 assert.deepEqual(after,{...before,state:'expired',lease_id:null,lease_until:null});
 assert.deepEqual((await db.pool.query('SELECT body,batch_results::text FROM translation_job_bodies WHERE job_id=$1',[recent])).rows,[{body:text,batch_results:results}]);
 assert.deepEqual(await sweepTranslationJobs(db.pool),{expired:0});
 assert.deepEqual(await look(recent),{state:'done',lease_id:null,bodies:1});
});
test('each invalid limit is refused without changing any row',async()=>{
 const v=await connectedVenue(db,issuer,origin),id=await aged(v,'done','25 hours');
 for(const limit of [0,-1,1.5,1001,NaN,Infinity,'1',null]){
  await assert.rejects(sweepTranslationJobs(db.pool,limit as number),/translation_sweep_limit/);
  assert.deepEqual(await look(id),{state:'done',lease_id:null,bodies:1});
 }
 await drain();
});
test('a locked collect row is skipped while other eligible jobs expire, and rollback preserves both body and state',async t=>{
 const bounded=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${db.schema} -c lock_timeout=1000`});t.after(()=>bounded.end());
 await drain();const v=await connectedVenue(db,issuer,origin),locked=await aged(v,'done','25 hours'),free=await aged(v,'failed','25 hours');
 const client=await db.pool.connect();
 try{
  await client.query('BEGIN');await readJob(client,v.installationId,locked);
  assert.deepEqual(await sweepTranslationJobs(bounded),{expired:1});
  assert.deepEqual(await look(locked),{state:'done',lease_id:null,bodies:1});
  assert.deepEqual(await look(free),{state:'expired',lease_id:null,bodies:0});
 }finally{await client.query('ROLLBACK');client.release();}
 await db.pool.query(`CREATE FUNCTION reject_translation_expiry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic expiry failure'; END $$`);
 await db.pool.query('CREATE TRIGGER reject_translation_expiry BEFORE UPDATE ON translation_jobs FOR EACH ROW EXECUTE FUNCTION reject_translation_expiry()');
 try{
  await assert.rejects(sweepTranslationJobs(bounded),/synthetic expiry failure/);
  assert.deepEqual(await look(locked),{state:'done',lease_id:null,bodies:1});
 }finally{await db.pool.query('DROP TRIGGER reject_translation_expiry ON translation_jobs');await db.pool.query('DROP FUNCTION reject_translation_expiry()');}
 assert.deepEqual(await sweepTranslationJobs(bounded),{expired:1});
});
test('two simultaneous sweeps expire each retained body once and retain every accounting row',async()=>{
 await drain();const v=await connectedVenue(db,issuer,origin),ids=[];
 for(let i=0;i<5;i++)ids.push(await aged(v,'done','25 hours'));
 const before=(await db.pool.query('SELECT count(*)::int AS n FROM translation_jobs')).rows[0].n;
 const passes=await Promise.all([sweepTranslationJobs(db.pool,3),sweepTranslationJobs(db.secondPool,3)]);
 assert.equal(passes.reduce((sum,p)=>sum+p.expired,0),5);
 for(const id of ids)assert.deepEqual(await look(id),{state:'expired',lease_id:null,bodies:0});
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM translation_jobs')).rows[0].n,before);
});

async function paged(){
 const v=await connectedVenue(db,issuer,origin),languages=['en','es','ca','fr','de','it','pt','nl','sv','da','fi','pl','cs','sk','hu','ro','el','tr','ja','zh'];
 const items=Array.from({length:300},(_,i)=>({ref:`p${i}`,kind:'product',family:`p${i}`,category:null,staffName:'Coffee',existing:{},missing:languages}));
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'en',enabled:languages},items,houseStyle:[]});
 assert(Buffer.byteLength(body)<1048576);assert.equal(writtenItems(parseJob(body)).length,300);
 const row=await transaction(db.pool,async c=>{await lockVenue(c,v.venueId);return createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(body),body,total:300});});
 const results=items.map(item=>({ref:item.ref,names:Object.fromEntries(languages.map(l=>[l,'\u0000'.repeat(500)])),placeholder:false,corrections:[]}));
 await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[row.id,JSON.stringify({0:{results,failed:[]}})]);
 await db.pool.query("UPDATE translation_jobs SET state='done',done=300,finished_at=clock_timestamp()-interval '23 hours 59 minutes' WHERE id=$1",[row.id]);
 return {v,row,results};
}
test('repeated real pages preserve every byte and the original deadline, then sweep between pages refuses continuation',async()=>{
 const {v,row,results}=await paged(),collect=(cursor=0)=>transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,row.id),cursor));
 const before=(await db.pool.query('SELECT finished_at,collected_at FROM translation_jobs WHERE id=$1',[row.id])).rows[0];
 const first=await collect();assert(first.nextCursor!==null);assert(Buffer.byteLength(JSON.stringify(first))<=16777216);
 assert.deepEqual(await collect(),first);assert.deepEqual(first.results,results.slice(0,first.nextCursor));
 assert.deepEqual(await sweepTranslationJobs(db.pool),{expired:0});
 assert.deepEqual((await db.pool.query('SELECT finished_at,collected_at FROM translation_jobs WHERE id=$1',[row.id])).rows[0],before);
 assert.deepEqual(await look(row.id),{state:'done',lease_id:null,bodies:1});
 await db.pool.query("UPDATE translation_jobs SET finished_at=clock_timestamp()-interval '24 hours' WHERE id=$1",[row.id]);
 assert.deepEqual(await sweepTranslationJobs(db.pool),{expired:1});
 await assert.rejects(collect(first.nextCursor),(e:unknown)=>e instanceof TranslationError&&e.code==='expired');
 await assert.rejects(transaction(db.pool,async c=>releaseJob(c,await readJob(c,v.installationId,row.id))),(e:unknown)=>e instanceof TranslationError&&e.code==='expired');
});
test('release waits for a real collecting page transaction, then a partial walk cannot continue',async()=>{
 const {v,row,results}=await paged(),a=await db.pool.connect(),b=await db.pool.connect();let release:Promise<unknown>|undefined;
 try{
  await a.query('BEGIN');const page=await collectJob(a,await readJob(a,v.installationId,row.id));assert(page.nextCursor!==null);
  assert.deepEqual(page.results,results.slice(0,page.nextCursor));
  const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  release=transactionWithClient();
  async function transactionWithClient(){await b.query('BEGIN');try{const result=await releaseJob(b,await readJob(b,v.installationId,row.id));await b.query('COMMIT');return result;}catch(error){await b.query('ROLLBACK');throw error;}}
  const end=Date.now()+5000;let blocked=false;
  while(Date.now()<end){blocked=!!(await db.pool.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",[pid])).rowCount;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(blocked,true,'release must wait for collect row lock');
  assert.deepEqual(await sweepTranslationJobs(db.pool),{expired:0});
  await a.query('COMMIT');assert.deepEqual(await release,{version:1,jobId:row.id,state:'collected'});
  await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,row.id),page.nextCursor)),(e:unknown)=>e instanceof TranslationError&&e.code==='expired');
  assert.deepEqual(await look(row.id),{state:'collected',lease_id:null,bodies:0});
 }finally{await a.query('ROLLBACK');if(release)await release;await b.query('ROLLBACK');a.release();b.release();}
});

test('the default pass is bounded to 100 jobs and an explicit 1000-job pass drains the remainder',async()=>{
 await drain();const v=await connectedVenue(db,issuer,origin);
 const ids=(await db.pool.query<{id:string}>(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,done,provider,model,prompt_version,finished_at)
  SELECT gen_random_uuid(),$1,$2,gen_random_uuid(),repeat('a',64),10,'done',1,1,'openai','gpt-6-luna','translate-all-v1',clock_timestamp()-interval '25 hours' FROM generate_series(1,101) RETURNING id`,[v.installationId,v.venueId])).rows.map(row=>row.id);
 await db.pool.query("INSERT INTO translation_job_bodies(job_id,body) SELECT unnest($1::uuid[]),'private text'",[ids]);
 assert.deepEqual(await sweepTranslationJobs(db.pool),{expired:100});
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM translation_job_bodies WHERE job_id=ANY($1::uuid[])',[ids])).rows[0].n,1);
 assert.deepEqual(await sweepTranslationJobs(db.pool,1000),{expired:1});
});
test('expiry retains the real completed-job usage ledger and cap spend without keeping submitted or generated text',async()=>{
 const v=await connectedVenue(db,issuer,origin);await giveConsent(db,v);
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},items:[{ref:'p1',kind:'product',family:'p1',category:null,staffName:'CAFE',existing:{},missing:['ca','es']}],houseStyle:[]});
 const job=await transaction(db.pool,async c=>{await lockVenue(c,v.venueId);return createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(body),body,total:1});});
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 try{
  assert.equal(await new TranslationWorker(db.pool,createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl})).runOnce(new AbortController().signal),true);
  const ledger=(await db.pool.query('SELECT * FROM usage_events WHERE source_reference=$1 ORDER BY event_type',[job.id])).rows;assert.equal(ledger.length,4);
  const before=await transaction(db.pool,c=>monthSpend(c,v.venueId));assert(before>0n);
  await db.pool.query("UPDATE translation_jobs SET finished_at=clock_timestamp()-interval '25 hours' WHERE id=$1",[job.id]);
  await drain();assert.deepEqual(await look(job.id),{state:'expired',lease_id:null,bodies:0});
  assert.deepEqual((await db.pool.query('SELECT * FROM usage_events WHERE source_reference=$1 ORDER BY event_type',[job.id])).rows,ledger);
  assert.equal(await transaction(db.pool,c=>monthSpend(c,v.venueId)),before);
 }finally{await fake.close();}
});
