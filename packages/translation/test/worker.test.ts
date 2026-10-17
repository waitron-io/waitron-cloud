import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {collectJob,createJob,createOpenAiClient,jobFingerprint,lockVenue,parseJob,readJob,writtenItems} from '../src/index.ts';
import {connectedVenue,database} from './fixtures.ts';
import {echoFirstPass,emptyReview,isReview,responsesBody,startFakeOpenAi,type FakeReply} from './fake-openai.ts';
import {TranslationWorker} from '../src/index.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 // Every test leases "the oldest open job", so jobs left open by an earlier test are closed first.
 await db.pool.query("UPDATE translation_jobs SET state='expired',lease_id=NULL,lease_until=NULL WHERE state IN ('queued','running')");
 await db.pool.query('UPDATE translation_policy SET monthly_cap_micro_usd=5000000');
});
type Venue=Awaited<ReturnType<typeof connectedVenue>>;
const item=(ref:string,category:string,staffName:string,over:Record<string,unknown>={})=>({ref,kind:'product',family:ref,category,staffName,existing:{},missing:['ca','es'],...over});
const many=(prefix:string,category:string,n:number,staff=(i:number)=>`${prefix}-${i}`)=>Array.from({length:n},(_,i)=>item(`${prefix}:${i}`,category,staff(i)));
const body=(items:object[])=>JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},items,houseStyle:[]});
async function queue(items:object[]):Promise<{v:Venue;job:{id:string}}>{
 const v=await connectedVenue(db,issuer,origin),text=body(items);
 const job=await transaction(db.pool,async c=>{await lockVenue(c,v.venueId);
  return createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(text),body:text,total:writtenItems(parseJob(text)).length});});
 return {v,job};
}
const worker=(baseUrl:string,options:{batchConcurrency?:number;maxLeases?:number}={},timeoutMs=100)=>
 new TranslationWorker(db.pool,createOpenAiClient({apiKey:'k',baseUrl,timeoutMs}),{wait:async()=>{},...options});
const row=async(id:string)=>(await db.pool.query('SELECT *,lease_until<=clock_timestamp() AS lease_free FROM translation_jobs WHERE id=$1',[id])).rows[0];
const saved=async(id:string)=>(await db.pool.query('SELECT batch_results FROM translation_job_bodies WHERE job_id=$1',[id])).rows[0]?.batch_results as Record<string,unknown>|undefined;
async function collected(v:Venue,id:string){
 const results:Awaited<ReturnType<typeof collectJob>>['results']=[],failed:string[]=[];
 let cursor=0;
 for(;;){const page=await transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,id),cursor));
  results.push(...page.results);failed.push(...page.failed);if(page.nextCursor===null)return {results,failed};cursor=page.nextCursor;}
}
const refs=(items:{ref:string}[])=>items.map(i=>i.ref).sort();
const live=()=>new AbortController().signal;
async function until(check:()=>Promise<boolean>|boolean,ms=5000){const end=Date.now()+ms;while(!await check()){if(Date.now()>end)throw new Error('condition timed out');await delay(10);}}

for(const [name,failure] of [['a timeout',{delayMs:500,json:{}}],['malformed JSON',{json:responsesBody('no json here')}],['a missing product',{json:responsesBody('{"products":[]}')}],['a 429 with Retry-After',{status:429,headers:{'retry-after':'1'}}]] as [string,FakeReply][])
test(`one batch failing with ${name} ends partly done with provider_failed`,async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():r.body.input.includes('FAIL-')?failure:echoFirstPass(r));
 try{
  const {v,job}=await queue([...many('ok','A',60),...many('bad','B',60,i=>`FAIL-${i}`)]);
  assert.equal(await worker(fake.baseUrl).runOnce(live()),true);
  const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.reason,ended.done,ended.failed],['partly_done','provider_failed',60,60]);
  const result=await collected(v,job.id);
  assert.equal(result.results.length,60);assert.deepEqual(result.failed.sort(),refs(many('bad','B',60)));
 }finally{await fake.close();}
});
test('every batch failing ends failed with provider_unavailable, and collect is refused',async()=>{
 const fake=await startFakeOpenAi(()=>({status:500}));
 try{
  const {v,job}=await queue([...many('a','A',60),...many('b','B',60)]);
  await worker(fake.baseUrl).runOnce(live());
  const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.reason,ended.done,ended.failed],['failed','provider_unavailable',0,120]);
  await assert.rejects(collected(v,job.id),/not_ready/);
  // A 500 carries no token counts, so nothing was billed and no usage is recorded.
  assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM usage_events WHERE source_reference=$1',[job.id])).rows[0].n,0);
 }finally{await fake.close();}
});
test('a review that always times out leaves the job done with the first-pass names',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?{delayMs:500,json:{}}:echoFirstPass(r));
 try{
  const {v,job}=await queue(many('p','A',3));
  await worker(fake.baseUrl).runOnce(live());
  assert.equal((await row(job.id)).state,'done');
  assert.deepEqual((await collected(v,job.id)).results.map(r=>r.names),[0,1,2].map(i=>({ca:`p-${i} [ca]`,es:`p-${i} [es]`})));
 }finally{await fake.close();}
});
test('four batches run side by side and a fifth waits for one to finish',async()=>{
 let open=0,peak=0;const waiting:(()=>void)[]=[];
 const fake=await startFakeOpenAi(async r=>{
  if(isReview(r))return emptyReview();
  open++;peak=Math.max(peak,open);
  if(open===4)for(const release of waiting.splice(0))release();
  else if(peak<4)await new Promise<void>(resolve=>waiting.push(resolve));
  open--;return echoFirstPass(r);
 });
 try{
  const {job}=await queue(['A','B','C','D','E'].flatMap(c=>many(c.toLowerCase(),c,60)));
  await worker(fake.baseUrl,{},5000).runOnce(live());
  assert.equal((await row(job.id)).state,'done');assert.equal(peak,4);
  const firstPasses=fake.requests.flatMap((r,i)=>isReview(r)?[]:[i]),firstReview=fake.requests.findIndex(isReview);
  assert.equal(firstPasses.length,5);assert.ok(firstPasses[4]!>firstReview,'the fifth batch started before any batch finished');
 }finally{await fake.close();}
});
test('reaching the cap mid-job stops later batches without calling the provider',async()=>{
 const usage={input_tokens:10000,output_tokens:2000};
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview(usage):echoFirstPass(r,usage));
 try{
  const {v,job}=await queue([...many('a','A',60),...many('b','B',60),...many('c','C',60)]);
  // 10,000 input and 2,000 output tokens cost 1,000 + 1,000 micro-dollars at the seeded prices, so the first call reaches this cap.
  await db.pool.query('UPDATE translation_policy SET monthly_cap_micro_usd=2000');
  await worker(fake.baseUrl,{batchConcurrency:1}).runOnce(live());
  const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.reason,ended.done,ended.failed,ended.cost_micro_usd],['partly_done','limit_reached',60,120,'2000']);
  assert.equal(fake.requests.length,1);
  assert.deepEqual((await collected(v,job.id)).results.slice(0,2).map(r=>r.names),[{ca:'a-0 [ca]',es:'a-0 [es]'},{ca:'a-1 [ca]',es:'a-1 [es]'}]);
 }finally{await fake.close();}
});
test('a finished job records four usage events naming the job and no name',async()=>{
 const usage={input_tokens:1000,output_tokens:200};
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview(usage):echoFirstPass(r,usage));
 try{
  const {job}=await queue(many('SENTINEL-STAFF','A',3));
  await worker(fake.baseUrl).runOnce(live());
  // Two calls of 1,000 in and 200 out: 200 micro-dollars each.
  assert.deepEqual((await db.pool.query(`SELECT event_type,quantity::text,source_kind,source_reference FROM usage_events WHERE source_reference=$1 ORDER BY event_type`,[job.id])).rows,[
   {event_type:'translation.cost_micro_usd',quantity:'400',source_kind:'translation_job',source_reference:job.id},
   {event_type:'translation.input_tokens',quantity:'2000',source_kind:'translation_job',source_reference:job.id},
   {event_type:'translation.items_completed',quantity:'3',source_kind:'translation_job',source_reference:job.id},
   {event_type:'translation.output_tokens',quantity:'400',source_kind:'translation_job',source_reference:job.id}]);
  const stored=JSON.stringify([(await db.pool.query('SELECT * FROM usage_events WHERE source_reference=$1',[job.id])).rows,await row(job.id)]);
  assert.equal(stored.includes('SENTINEL'),false);
 }finally{await fake.close();}
});
test('an abort during a batch saves nothing for it, hands the lease back, and a restart sends only the unfinished batch',async()=>{
 const controller=new AbortController();
 const fake=await startFakeOpenAi(r=>{
  if(isReview(r))return emptyReview();
  if(r.body.input.includes('"b-0"')&&!controller.signal.aborted){controller.abort();return {delayMs:2000,json:{}};}
  return echoFirstPass(r);
 });
 try{
  const {job}=await queue([...many('a','A',60),...many('b','B',60)]);
  const w=worker(fake.baseUrl,{batchConcurrency:1},5000);
  assert.equal(await w.runOnce(controller.signal),true);
  const stopped=await row(job.id);
  assert.deepEqual([stopped.state,stopped.lease_free,stopped.lease_count,stopped.done,stopped.failed],['running',true,0,60,0]);
  assert.deepEqual(Object.keys((await saved(job.id))!),['0']);
  const sentBefore=fake.requests.length;
  assert.equal(await w.runOnce(live()),true);
  assert.equal(fake.requests.slice(sentBefore).some(r=>r.body.input.includes('"a-0"')),false);
  assert.equal((await row(job.id)).state,'done');
 }finally{await fake.close();}
});
test('an abort during the review saves no first-pass-only result',async()=>{
 const controller=new AbortController();
 const fake=await startFakeOpenAi(r=>{if(!isReview(r))return echoFirstPass(r);controller.abort();return {delayMs:2000,json:{}};});
 try{
  const {job}=await queue(many('a','A',3));
  await worker(fake.baseUrl,{},5000).runOnce(controller.signal);
  const stopped=await row(job.id);
  assert.deepEqual([stopped.state,stopped.done,stopped.failed],['running',0,0]);
  assert.deepEqual(await saved(job.id),{});
 }finally{await fake.close();}
});
test("another worker's live lease is respected",async()=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 const fake=await startFakeOpenAi(async r=>{if(isReview(r))return emptyReview();await held;return echoFirstPass(r);});
 try{
  const {job}=await queue(many('a','A',3));
  const first=worker(fake.baseUrl,{},5000).runOnce(live());
  await until(()=>fake.requests.length===1);
  assert.equal(await worker(fake.baseUrl).runOnce(live()),false);
  release();assert.equal(await first,true);assert.equal((await row(job.id)).state,'done');
 }finally{await fake.close();}
});
test('a job leased more than three times ends with its unfinished batches failed and no provider call; a third lease still runs',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 const diedOn=async(leases:number)=>{
  const queued=await queue([...many('a','A',60),...many('b','B',60)]);
  const results=many('a','A',60).map(i=>({ref:i.ref,names:{ca:'x',es:'y'},placeholder:false,corrections:[]}));
  await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[queued.job.id,{0:{results,failed:[]}}]);
  await db.pool.query(`UPDATE translation_jobs SET state='running',lease_id=gen_random_uuid(),lease_until=clock_timestamp()-interval '1 second',
   lease_count=$2,done=60,started_at=clock_timestamp() WHERE id=$1`,[queued.job.id,leases]);
  return queued;
 };
 try{
  const {v,job}=await diedOn(3);
  assert.equal(await worker(fake.baseUrl).runOnce(live()),true);
  assert.equal(fake.requests.length,0);
  const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.reason,ended.done,ended.failed,ended.lease_count],['partly_done','provider_failed',60,60,4]);
  assert.deepEqual((await collected(v,job.id)).failed.sort(),refs(many('b','B',60)));
  const third=await diedOn(2);
  assert.equal(await worker(fake.baseUrl).runOnce(live()),true);
  assert.equal((await row(third.job.id)).state,'done');assert.ok(fake.requests.length>0);
 }finally{await fake.close();}
});
test('a context head is sent but never returned or failed',async()=>{
 const head=item('product:9','A','CANYA',{existing:{ca:'Canya',es:'Caña'},missing:[]});
 const variants=[item('variant:1','A','PINTA',{kind:'variant',family:'product:9'}),item('variant:2','A','GERRA',{kind:'variant',family:'product:9'})];
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 const failing=await startFakeOpenAi(()=>({status:500}));
 try{
  const ok=await queue([head,...variants]);
  assert.equal((await row(ok.job.id)).total,2);
  await worker(fake.baseUrl).runOnce(live());
  assert.deepEqual([(await row(ok.job.id)).state,(await row(ok.job.id)).done],['done',2]);
  assert.ok(fake.requests[0]!.body.input.includes('CANYA'));
  const okResult=await collected(ok.v,ok.job.id);
  assert.deepEqual([okResult.results.map(r=>r.ref),okResult.failed],[['variant:1','variant:2'],[]]);
  const bad=await queue([head,...variants]);
  await worker(failing.baseUrl).runOnce(live());
  assert.deepEqual([(await row(bad.job.id)).state,(await row(bad.job.id)).failed],['failed',2]);
  assert.deepEqual(((await saved(bad.job.id)) as Record<string,{failed:string[]}>)['0']!.failed,['variant:1','variant:2']);
 }finally{await fake.close();await failing.close();}
});

test('shutdown while waiting for a database connection hands back the new lease without a provider call',async()=>{
 const {Pool}=await import('pg'),pool=new Pool({...db.pool.options,max:1});
 const {job}=await queue(many('a','A',1)),controller=new AbortController();
 const held=await pool.connect(),fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 try{
  const pending=new TranslationWorker(pool,createOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl}),{wait:async()=>{}}).runOnce(controller.signal);
  await until(()=>pool.waitingCount===1);controller.abort();held.release();
  assert.equal(await pending,true);assert.equal(fake.requests.length,0);
  const stopped=await row(job.id);assert.deepEqual([stopped.state,stopped.lease_free,stopped.lease_count,stopped.done],['running',true,0,0]);
 }finally{if(pool.totalCount===0)held.release();await pool.end();await fake.close();}
});
for(const options of [{batchConcurrency:0},{batchConcurrency:1.5},{batchConcurrency:NaN},{leaseMs:0},{leaseMs:Infinity},{maxLeases:0}])
 test(`invalid worker options are refused: ${JSON.stringify(options)}`,()=>{
  assert.throws(()=>new TranslationWorker(db.pool,{provider:'openai',model:'gpt-6-luna',respond:async()=>{throw Error('unused');}},options),/translation_worker_options_invalid/);
 });

test('a stolen lease cannot save or account for the old worker reply',async()=>{
 const {job}=await queue(many('a','A',2)),replacement=randomUUID();
 const fake=await startFakeOpenAi(async r=>{
  await db.pool.query("UPDATE translation_jobs SET lease_id=$2,lease_until=clock_timestamp()+interval '10 minutes' WHERE id=$1",[job.id,replacement]);return echoFirstPass(r);
 });
 try{
  await worker(fake.baseUrl).runOnce(live());
  const stopped=await row(job.id);assert.deepEqual([stopped.state,stopped.lease_id,stopped.done,stopped.input_tokens],['running',replacement,0,'0']);
  assert.deepEqual(await saved(job.id),{});assert.equal(fake.requests.length,1);
 }finally{await fake.close();}
});
test('finishing and usage roll back together, and recovery emits each measure once without sending saved batches again',async()=>{
 const {job,v}=await queue(many('a','A',3));
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 await db.pool.query(`CREATE FUNCTION refuse_translation_usage() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.source_reference='${job.id}' THEN RAISE EXCEPTION 'usage_unavailable'; END IF; RETURN NEW; END$$;
 CREATE TRIGGER refuse_translation_usage BEFORE INSERT ON usage_events FOR EACH ROW EXECUTE FUNCTION refuse_translation_usage()`);
 try{
  await assert.rejects(worker(fake.baseUrl).runOnce(live()),/usage_unavailable/);
  const pending=await row(job.id);assert.deepEqual([pending.state,pending.done,pending.finished_at],['running',3,null]);
  assert.equal((await db.pool.query('SELECT * FROM usage_events WHERE source_reference=$1',[job.id])).rowCount,0);
  assert.deepEqual(Object.keys((await saved(job.id))!),['0']);assert.equal(fake.requests.length,2);
  await db.pool.query('DROP TRIGGER refuse_translation_usage ON usage_events; DROP FUNCTION refuse_translation_usage()');
  await db.pool.query("UPDATE translation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]);
  await worker(fake.baseUrl).runOnce(live());assert.equal(fake.requests.length,2);
  const events=(await db.pool.query('SELECT venue_id,organisation_id,occurred_at FROM usage_events WHERE source_reference=$1',[job.id])).rows;
  assert.equal(events.length,4);for(const event of events){assert.equal(event.venue_id,v.venueId);assert.equal(event.organisation_id,v.organisationId);assert.equal(event.occurred_at.toISOString(),(await row(job.id)).finished_at.toISOString());}
  assert.equal(await worker(fake.baseUrl).runOnce(live()),false);
  assert.equal((await db.pool.query('SELECT * FROM usage_events WHERE source_reference=$1',[job.id])).rowCount,4);
 }finally{await db.pool.query('DROP TRIGGER IF EXISTS refuse_translation_usage ON usage_events; DROP FUNCTION IF EXISTS refuse_translation_usage()');await fake.close();}
});
test('integer prices round each billed attempt up and unusable billed replies remain in usage',async()=>{
 const {job}=await queue(many('a','A',1));
 const fake=await startFakeOpenAi(()=>({json:responsesBody('bad JSON',{input_tokens:1,output_tokens:0})}));
 try{
  await worker(fake.baseUrl).runOnce(live());const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.reason,ended.input_tokens,ended.output_tokens,ended.cost_micro_usd],['failed','provider_unavailable','4','0','4']);
  assert.deepEqual((await db.pool.query('SELECT event_type,quantity::text FROM usage_events WHERE source_reference=$1 ORDER BY event_type',[job.id])).rows,[
   {event_type:'translation.cost_micro_usd',quantity:'4'},{event_type:'translation.input_tokens',quantity:'4'}]);
 }finally{await fake.close();}
});
test('a cap reached before work makes every pending ref failed without a provider call',async()=>{
 const {job}=await queue(many('a','A',1));
 await db.pool.query('UPDATE translation_jobs SET cost_micro_usd=5000000 WHERE id=$1',[job.id]);
 const fake=await startFakeOpenAi(()=>{throw Error('must not call');});
 try{await worker(fake.baseUrl).runOnce(live());const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.reason,ended.failed],['failed','limit_reached',1]);assert.equal(fake.requests.length,0);
 }finally{await fake.close();}
});
test('review totals are saved with the batch, while provider calls hold no job transaction lock',async()=>{
 const {job}=await queue(many('a','A',2));
 const fake=await startFakeOpenAi(async r=>{
  await transaction(db.secondPool,async c=>{await c.query('SELECT id FROM translation_jobs WHERE id=$1 FOR UPDATE NOWAIT',[job.id]);});
  return isReview(r)?{json:responsesBody(JSON.stringify({changes:[{id:'p01',language:'ca',name:'Cervesa'},{id:'p01',language:'fr',name:'Refused'}]}))}:echoFirstPass(r);
 });
 try{await worker(fake.baseUrl).runOnce(live());const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.review_applied,ended.review_dropped],['done',1,1]);assert.equal(fake.requests.length,2);
 }finally{await fake.close();}
});
test('the oldest unlocked job is leased while another queued job is locked',async()=>{
 const a=await queue(many('a','A',1)),b=await queue(many('b','B',1)),held=await db.secondPool.connect();
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 const {Pool}=await import('pg'),selectionPool=new Pool({...db.pool.options,options:db.pool.options.options+' -c lock_timeout=500ms'});
 try{
  await held.query('BEGIN');await held.query('SELECT id FROM translation_jobs WHERE id=$1 FOR UPDATE',[a.job.id]);
  await new TranslationWorker(selectionPool,createOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl,timeoutMs:100}),{wait:async()=>{}}).runOnce(live());
  assert.equal((await row(b.job.id)).state,'done');assert.equal((await row(a.job.id)).state,'queued');
  await held.query('ROLLBACK');await worker(fake.baseUrl).runOnce(live());assert.equal((await row(a.job.id)).state,'done');
 }finally{await held.query('ROLLBACK');held.release();await selectionPool.end();await fake.close();}
});
test('a full paged walk retains submit order and exact text despite regrouped families and reversed completion',async()=>{
 const languages=['ca','es','en','fr','de','it','pt','nl','sv','da','no','fi','pl','cs','sk','hu','ro','el','tr','ar'];
 const items=Array.from({length:600},(_,i)=>item('p'+i,'A','Staff '+i,{family:'family'+(i%10),missing:languages}));
 const v=await connectedVenue(db,issuer,origin),text=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:languages},items,houseStyle:[]});
 assert.ok(Buffer.byteLength(text)<=1048576);
 const job=await transaction(db.pool,async c=>{await lockVenue(c,v.venueId);return createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(text),body:text,total:600});});
 const name='漢'.repeat(498)+'\u0000\ud800',fix={field:'internal',wrong:'\udfff\u0000',right:'\ud800\u0001'};
 const completion:string[]=[];
 const fake=await startFakeOpenAi(async r=>{
  if(isReview(r))return emptyReview();
  const products=JSON.parse(r.body.input.split('Products:\n')[1]!) as {id:string;internal:string}[];
  const leading=products[0]!.internal;
  if(leading==='Staff 0')await until(async()=>Object.hasOwn((await saved(job.id))??{},'1'));
  completion.push(leading);
  return {json:responsesBody(JSON.stringify({products:products.map(p=>({id:p.id,...Object.fromEntries(languages.map(l=>[l,name])),placeholder:false,corrections:[fix]}))}))};
 });
 try{
  const client=createOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl,timeoutMs:10000});
  const leading=(input:string)=>JSON.parse(input.split('Products:\n')[1]!)[0].internal as string;
  const reordered={...client,async respond(call:Parameters<typeof client.respond>[0],signal?:AbortSignal){
   if(call.effort==='low'){
    const name=leading(call.input);
    if(name==='Staff 0')await until(()=>fake.requests.some(r=>!isReview(r)&&leading(r.body.input)==='Staff 1'));
    else if(name!=='Staff 1')await until(()=>fake.requests.some(r=>!isReview(r)&&leading(r.body.input)==='Staff 0'));
   }
   return client.respond(call,signal);
  }};
  await new TranslationWorker(db.pool,reordered,{wait:async()=>{}}).runOnce(live());assert.equal((await row(job.id)).state,'done');
  assert.notEqual(completion[0],'Staff 0');assert.ok(completion.includes('Staff 0'));
  assert.ok(completion.indexOf('Staff 1')<completion.indexOf('Staff 0'));
  assert.deepEqual(fake.requests.filter(r=>!isReview(r)).slice(0,2).map(r=>leading(r.body.input)),['Staff 1','Staff 0']);
  const all:string[]=[];let cursor=0,pages=0;
  for(;;){const page=await transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,job.id),cursor));
   pages++;assert.ok(Buffer.byteLength(JSON.stringify(page))<=16777216);assert.deepEqual(page.failed,[]);
   for(const result of page.results){all.push(result.ref);assert.deepEqual(result.names,Object.fromEntries(languages.map(l=>[l,name])));assert.deepEqual(result.corrections,[fix]);}
   if(page.nextCursor===null)break;assert.ok(page.nextCursor>cursor);cursor=page.nextCursor;
  }
  assert.ok(pages>1);assert.deepEqual(all,items.map(i=>i.ref));assert.equal(new Set(all).size,600);
 }finally{await fake.close();}
});

test('shutdown while loading a repeatedly abandoned job saves no failed batches and returns its lease',async()=>{
 const {job}=await queue(many('a','A',1));await db.pool.query('UPDATE translation_jobs SET lease_count=3 WHERE id=$1',[job.id]);
 const held=await db.secondPool.connect(),controller=new AbortController();
 const fake=await startFakeOpenAi(()=>{throw Error('must not call');});
 try{
  await held.query('BEGIN');await held.query('LOCK translation_job_bodies IN ACCESS EXCLUSIVE MODE');
  const running=worker(fake.baseUrl).runOnce(controller.signal);
  await until(async()=>Number((await row(job.id)).lease_count)===4);controller.abort();await held.query('ROLLBACK');
  assert.equal(await running,true);const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.failed,ended.lease_count,ended.lease_free],['running',0,3,true]);assert.deepEqual(await saved(job.id),{});assert.equal(fake.requests.length,0);
 }finally{await held.query('ROLLBACK');held.release();await fake.close();}
});

test('the four-call concurrency ceiling is enforced',()=>{
 assert.throws(()=>new TranslationWorker(db.pool,{provider:'openai',model:'gpt-6-luna',respond:async()=>{throw Error('unused');}},{batchConcurrency:5}),/translation_worker_options_invalid/);
});
test('an already stopped worker does not lease a queued job',async()=>{
 const {job}=await queue(many('a','A',1)),controller=new AbortController();controller.abort();
 const fake=await startFakeOpenAi(()=>{throw Error('unused');});
 try{assert.equal(await worker(fake.baseUrl).runOnce(controller.signal),false);assert.equal((await row(job.id)).lease_count,0);assert.equal((await row(job.id)).state,'queued');assert.equal(fake.requests.length,0);}finally{await fake.close();}
});
test('the oldest submitted job runs first regardless of physical insertion order',async()=>{
 const a=await queue(many('a','A',1)),b=await queue(many('b','B',1));
 await db.pool.query("UPDATE translation_jobs SET created_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[b.job.id]);
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 try{await worker(fake.baseUrl).runOnce(live());assert.equal((await row(b.job.id)).state,'done');assert.equal((await row(a.job.id)).state,'queued');}finally{await fake.close();}
});
test('each attempted call renews the lease before the next pass',async()=>{
 const {job}=await queue(many('a','A',1));let initial=0;
 const fake=await startFakeOpenAi(async r=>{
  const lease=(await row(job.id)).lease_until.getTime();
  if(!isReview(r)){initial=lease;await delay(15);return echoFirstPass(r);}
  assert.ok(lease>initial,'lease was not renewed after the first call');return emptyReview();
 });
 try{await worker(fake.baseUrl).runOnce(live());assert.equal((await row(job.id)).state,'done');assert.equal(fake.requests.length,2);}finally{await fake.close();}
});

for(const stage of ['renew','save','finish'] as const)test(`a lease stolen immediately before ${stage} fences that write`,async()=>{
 const {job}=await queue(stage==='save'?[...many('a','A',60),...many('b','B',60)]:many('a','A',2)),replacement=randomUUID();
 const condition=stage==='renew'?"NEW.input_tokens=100 AND OLD.input_tokens=0 AND NEW.lease_id=OLD.lease_id":stage==='save'?"NEW.lease_until IS DISTINCT FROM OLD.lease_until AND NEW.input_tokens=200 AND NEW.lease_id=OLD.lease_id":"NEW.done>OLD.done";
 await db.pool.query(`CREATE FUNCTION steal_translation_lease() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.id='${job.id}' AND ${condition} THEN UPDATE translation_jobs SET lease_id='${replacement}'${stage==='renew'?",lease_until=clock_timestamp()+interval '1 hour'":''} WHERE id=NEW.id; END IF; RETURN NEW; END$$;
 CREATE TRIGGER steal_translation_lease AFTER UPDATE ON translation_jobs FOR EACH ROW EXECUTE FUNCTION steal_translation_lease()`);
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 try{
  await worker(fake.baseUrl,{batchConcurrency:1}).runOnce(live());const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.lease_id,ended.done],['running',replacement,stage==='finish'?2:0]);
  assert.deepEqual(Object.keys((await saved(job.id))!),stage==='finish'?['0']:[]);
  assert.equal((await db.pool.query('SELECT * FROM usage_events WHERE source_reference=$1',[job.id])).rowCount,0);assert.equal(fake.requests.length,stage==='renew'?1:2);
  if(stage==='renew')assert.ok(ended.lease_until.getTime()>Date.now()+30*60000,'old worker shortened the replacement lease');
 }finally{await db.pool.query('DROP TRIGGER steal_translation_lease ON translation_jobs; DROP FUNCTION steal_translation_lease()');await fake.close();}
});
test('shutdown never returns a replacement worker lease or decrements its count',async()=>{
 const {job}=await queue(many('a','A',1)),replacement=randomUUID(),controller=new AbortController();
 const fake=await startFakeOpenAi(async()=>{
  await db.pool.query("UPDATE translation_jobs SET lease_id=$2,lease_until=clock_timestamp()+interval '1 hour' WHERE id=$1",[job.id,replacement]);controller.abort();return {delayMs:2000,json:{}};
 });
 try{
  assert.equal(await worker(fake.baseUrl,{},5000).runOnce(controller.signal),true);const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.lease_id,ended.lease_free,ended.lease_count],['running',replacement,false,1]);assert.deepEqual(await saved(job.id),{});
 }finally{await fake.close();}
});

test('shutdown between exhausted-lease batch saves leaves later batches pending',async()=>{
 const {job}=await queue([...many('a','A',60),...many('b','B',60)]);
 await db.pool.query('UPDATE translation_jobs SET lease_count=3 WHERE id=$1',[job.id]);
 const held=await db.secondPool.connect(),controller=new AbortController();
 const fake=await startFakeOpenAi(()=>{throw Error('must not call');});
 try{
  await held.query('BEGIN');await held.query('SELECT job_id FROM translation_job_bodies WHERE job_id=$1 FOR UPDATE',[job.id]);
  const running=worker(fake.baseUrl).runOnce(controller.signal);
  await until(async()=>(await db.secondPool.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'UPDATE translation_job_bodies%'",[db.schema])).rows[0].n>0);
  controller.abort();await held.query('ROLLBACK');assert.equal(await running,true);
  const ended=await row(job.id);assert.deepEqual([ended.state,ended.failed,ended.lease_count,ended.lease_free],['running',60,3,true]);
  assert.deepEqual(Object.keys((await saved(job.id))!),['0']);assert.equal(fake.requests.length,0);
 }finally{await held.query('ROLLBACK');held.release();await fake.close();}
});
