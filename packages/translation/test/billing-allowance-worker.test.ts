import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool,type PoolClient} from 'pg';
import {AllowanceConfigStore,BillingStore,createLeaseIssuer,releaseUnstartedAllowance,transaction} from '@waitron-cloud/registration';
import {readTrialUsage} from '../../registration/src/billing-trial-usage.ts';
import {TranslationMachine,TranslationWorker,createLoopbackOpenAiClient,sweepTranslationJobs} from '../src/index.ts';
import {connectedVenue,database,giveConsent,readyForTranslation} from './fixtures.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from './fake-openai.ts';

const origin='https://cloud.example.test',allowances={mode:'test',calendar:'UTC'} as const;
const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
async function fixture(count=2){
 const db=await database();try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const v=await connectedVenue(db,issuer,origin),store=new BillingStore(db.pool),scope={organisationId:v.organisationId,legalBusinessId:v.legalBusinessId};
  await store.execute(scope,event(),{type:'ensure_business'});
  await store.transition(scope,event(),{type:'start_trial',venueId:v.venueId,level:'connected',on:new Date().toISOString().slice(0,10)});
  await readyForTranslation(db,v);await giveConsent(db,v);
  await new AllowanceConfigStore(db.pool).publish({revision:1,effectiveFrom:'2020-01-01',limits:{
   registered:{transactional_email:'0',address_lookup:'0',sms:'0',content_translation:'0',rota_solver:'0'},
   connected:{transactional_email:'0',address_lookup:'0',sms:'0',content_translation:String(Math.max(6,count)),rota_solver:'0'},
   hosted:{transactional_email:'0',address_lookup:'0',sms:'0',content_translation:String(Math.max(6,count)),rota_solver:'0'},
  },unpaidTrial:{content_translation:String(count),rota_solver:'0'}});
  const machine=new TranslationMachine(db.pool,issuer,origin,undefined,undefined,'test-venue-levels',allowances);
  const body=JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es','en']},houseStyle:[],
   items:Array.from({length:count},(_,n)=>({ref:'product:'+n,kind:'product',family:'product:'+n,category:'TAPAS',staffName:'GILDAS',existing:{},missing:['es','en']}))});
  const signed=v.submit(body),reply=await machine.execute('translation-submit',{payload:signed.payload,signature:signed.signature},body);
  const jobId=reply.jobId;
  const reservation=async()=>(await db.pool.query('SELECT *,month::text FROM billing_allowance_reservations')).rows[0];
  const job=async()=>(await db.pool.query('SELECT * FROM translation_jobs WHERE id=$1',[jobId])).rows[0];
  const run=(baseUrl:string,batchConcurrency=1)=>new TranslationWorker(db.secondPool,createLoopbackOpenAiClient({apiKey:'synthetic',baseUrl,timeoutMs:5000}),
   {planMode:'test-venue-levels',allowances,wait:async()=>{},batchConcurrency});
  const trial=(await store.history(scope,v.venueId)).trials[0]!;
  async function emptyCoverage(){
   const cellId=randomUUID();
   await db.pool.query(`INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint)
    VALUES($1,'ES','aws','test','worker.example.test',24,$2,'gateway.example.test:51820')`,[cellId,randomUUID()]);
   await db.pool.query(`INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port)
    VALUES($1,$2,$3,'10.77.24.2',$4,443)`,[v.venueId,v.installationId,cellId,randomUUID()]);
   const from=Date.parse(trial.startedOn+'T00:00:00Z'),until=Date.parse(trial.endsOn+'T00:00:00Z');
   const rows=Array.from({length:(until-from)/600000},(_,n)=>{const at=new Date(from+n*600000).toISOString();return {at,digest:createHash('sha256').update(at).digest('hex')};});
   await db.pool.query(`INSERT INTO remote_traffic_coverage(cell_id,gateway_id,generation,manifest_digest,manifest_sequence,issued_at,expires_at,kind)
    SELECT $1,$2,1,r.digest,1,r.at::timestamptz,r.at::timestamptz+interval '10 minutes','empty'
    FROM jsonb_to_recordset($3::jsonb) AS r(digest text,at text)`,[cellId,randomUUID(),JSON.stringify(rows)]);
  }
  return {db,v,scope,store,jobId,reservation,job,run,emptyCoverage,
   usage:()=>transaction(db.pool,c=>readTrialUsage(c,scope,v.venueId,trial))};
 }catch(error){await db.close();throw error;}
}

// Without beforeProvider spending, real outbound traffic sees a held reservation.
test('translation worker spends once before real calls and saves the actual first invocation instant',async()=>{
 const f=await fixture(),seen:{state:string;attempted:Date|null;now:number}[]=[];
 const fake=await startFakeOpenAi(async r=>{
  const saved=await f.reservation();seen.push({state:saved.state,attempted:saved.attempted_at,now:Date.now()});
  return isReview(r)?emptyReview({input_tokens:0,output_tokens:0}):echoFirstPass(r,{input_tokens:20,output_tokens:10});
 });
 try{
  const before=Date.now();await assert.doesNotReject(async()=>assert.equal(await f.run(fake.baseUrl).runOnce(new AbortController().signal),true));
  const saved=await f.reservation(),job=await f.job();
  assert.deepEqual(seen.map(s=>s.state),['spent','spent']);assert.equal(seen[0]!.attempted,null);
  assert.ok(saved.attempted_at instanceof Date);assert.ok(saved.attempted_at.getTime()>=before&&saved.attempted_at.getTime()<=seen[0]!.now);
  assert.equal(seen[1]!.attempted?.getTime(),saved.attempted_at.getTime());
  assert.deepEqual([saved.units,saved.state,job.state,job.done,job.cost_micro_usd],['2','spent','done',2,'7']);
  assert.equal(fake.requests.length,2);assert.equal(await f.run(fake.baseUrl).runOnce(new AbortController().signal),false);
  assert.deepEqual(await f.reservation(),saved);
 }finally{await fake.close();await f.db.close();}
});

test('pending durable calls cannot release allowance even without a saved lease',async()=>{
 const f=await fixture();try{
  const saved=await f.reservation();
  await f.db.pool.query('UPDATE translation_jobs SET allowance_open_calls=1 WHERE id=$1',[f.jobId]);
  await assert.rejects(transaction(f.db.pool,c=>releaseUnstartedAllowance(c,saved.id)),{code:'allowance_conflict'});
  await f.db.pool.query("UPDATE translation_jobs SET created_at=clock_timestamp()-interval '25 hours' WHERE id=$1",[f.jobId]);
  await assert.doesNotReject(sweepTranslationJobs(f.db.pool));
  assert.deepEqual([(await f.reservation()).state,(await f.job()).allowance_open_calls],['held',1]);
 }finally{await f.db.close();}
});

test('a stale lease cannot spend an allowance after the final permission read',async()=>{
 const f=await fixture(),replacement=randomUUID(),patched:{client:PoolClient;query:PoolClient['query']}[]=[];let intercepted=false;
 const intercept=(client:PoolClient)=>{
  const query=client.query.bind(client);patched.push({client,query});
  client.query=((...args:any[])=>{
   if(!intercepted&&typeof args[0]==='string'&&args[0].startsWith('SELECT id,allowance_open_calls FROM translation_jobs')){
    intercepted=true;return f.db.pool.query("UPDATE translation_jobs SET lease_id=$2,lease_until=clock_timestamp()+interval '1 hour' WHERE id=$1",[f.jobId,replacement]).then(()=>(query as any)(...args));
   }
   return (query as any)(...args);
  }) as PoolClient['query'];
 };
 f.db.secondPool.on('connect',intercept);
 const fake=await startFakeOpenAi(r=>echoFirstPass(r));
 try{
  await f.run(fake.baseUrl).runOnce(new AbortController().signal);assert.equal(intercepted,true);
  const job=await f.job();assert.deepEqual([fake.requests.length,(await f.reservation()).state,job.lease_id,job.allowance_open_calls],[0,'held',replacement,0]);
 }finally{f.db.secondPool.removeListener('connect',intercept);for(const {client,query} of patched)client.query=query;await fake.close();await f.db.close();}
});

test('a lease that expires at the reservation boundary cannot spend allowance',async()=>{
 const f=await fixture(),patched:{client:PoolClient;query:PoolClient['query']}[]=[];let intercepted=false;
 const intercept=(client:PoolClient)=>{
  const query=client.query.bind(client);patched.push({client,query});
  client.query=((...args:any[])=>{
   if(!intercepted&&typeof args[0]==='string'&&args[0].startsWith('SELECT id,units,state,attempted_at,binding FROM billing_allowance_reservations')){
    intercepted=true;return (query as any)(...args).then(async(result:unknown)=>{
     // Keep real row locks and expire the lease without waiting for a wall-clock delay.
     await query("UPDATE translation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.jobId]);return result;
    });
   }
   return (query as any)(...args);
  }) as PoolClient['query'];
 };
 f.db.secondPool.on('connect',intercept);const fake=await startFakeOpenAi(r=>echoFirstPass(r));
 try{
  await assert.doesNotReject(f.run(fake.baseUrl).runOnce(new AbortController().signal));assert.equal(intercepted,true);
  assert.deepEqual([fake.requests.length,(await f.reservation()).state,(await f.job()).allowance_open_calls],[0,'held',0]);
 }finally{f.db.secondPool.removeListener('connect',intercept);for(const {client,query} of patched)client.query=query;await fake.close();await f.db.close();}
});

for(const kind of ['units','fingerprint','released','missing'] as const)test('translation spending refuses a '+kind+' reservation mismatch',async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(r=>echoFirstPass(r));try{
  if(kind==='units')await f.db.pool.query('UPDATE translation_jobs SET total=3 WHERE id=$1',[f.jobId]);
  if(kind==='fingerprint')await f.db.pool.query('UPDATE translation_jobs SET job_sha256=$2 WHERE id=$1',[f.jobId,'b'.repeat(64)]);
  if(kind==='released')await f.db.pool.query("UPDATE billing_allowance_reservations SET state='released'");
  if(kind==='missing')await f.db.pool.query('UPDATE translation_jobs SET operation_id=$2 WHERE id=$1',[f.jobId,randomUUID()]);
  await assert.doesNotReject(f.run(fake.baseUrl).runOnce(new AbortController().signal));
  assert.deepEqual([fake.requests.length,(await f.reservation()).state,(await f.job()).allowance_open_calls],[0,kind==='released'?'released':'held',0]);
 }finally{await fake.close();await f.db.close();}
});

test('durable pending call counts start empty and cannot become negative',async()=>{
 const f=await fixture();try{
  assert.equal((await f.job()).allowance_open_calls,0);
  await assert.rejects(f.db.pool.query('UPDATE translation_jobs SET allowance_open_calls=-1 WHERE id=$1',[f.jobId]),{code:'23514'});
  assert.equal((await f.job()).allowance_open_calls,0);
 }finally{await f.db.close();}
});

test('a replacement lease cannot confirm or close the old workers invocation',async()=>{
 const f=await fixture(),replacement=randomUUID();
 const fake=await startFakeOpenAi(async r=>{
  await f.db.pool.query("UPDATE translation_jobs SET lease_id=$2,lease_until=clock_timestamp()+interval '1 hour' WHERE id=$1",[f.jobId,replacement]);
  return echoFirstPass(r,{input_tokens:20,output_tokens:10});
 });
 try{
  await assert.doesNotReject(f.run(fake.baseUrl).runOnce(new AbortController().signal));
  const job=await f.job(),saved=await f.reservation();
  assert.deepEqual([fake.requests.length,job.lease_id,job.state,job.allowance_open_calls,job.cost_micro_usd,saved.state,saved.attempted_at],[1,replacement,'running',1,'0','spent',null]);
 }finally{await fake.close();await f.db.close();}
});

test('failed callback renewal rolls back its invocation marker while preserving the paid cost',async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(r=>echoFirstPass(r,{input_tokens:20,output_tokens:10}));
 try{
  await f.db.pool.query("CREATE FUNCTION refuse_allowance_close() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.allowance_open_calls<OLD.allowance_open_calls THEN RAISE EXCEPTION 'synthetic-close-refusal'; END IF; RETURN NEW; END$$; CREATE TRIGGER refuse_allowance_close BEFORE UPDATE OF allowance_open_calls ON translation_jobs FOR EACH ROW EXECUTE FUNCTION refuse_allowance_close()");
  await assert.rejects(f.run(fake.baseUrl).runOnce(new AbortController().signal),/synthetic-close-refusal/);
  const job=await f.job(),saved=await f.reservation();
  assert.deepEqual([fake.requests.length,job.allowance_open_calls,job.cost_micro_usd,saved.state,saved.attempted_at],[1,1,'7','spent',null]);
 }finally{await fake.close();await f.db.close();}
});

for(const field of ['started_at','lease_count','lease_id','state'] as const)test('expiry retains admitted work with saved '+field,async()=>{
 const f=await fixture();try{
  const update={started_at:'started_at=clock_timestamp()',lease_count:'lease_count=1',lease_id:'lease_id=gen_random_uuid()',state:"state='running'"}[field];
  await f.db.pool.query("UPDATE translation_jobs SET created_at=clock_timestamp()-interval '25 hours',"+update+' WHERE id=$1',[f.jobId]);
  await assert.doesNotReject(sweepTranslationJobs(f.db.pool));assert.equal((await f.reservation()).state,'held');
 }finally{await f.db.close();}
});

test('parallel translation batches retain separate pending calls over one allowance debit',async()=>{
 const f=await fixture(91),pending:number[]=[];let arrivals=0,release!:()=>void,releaseReads!:()=>void;
 const both=new Promise<void>(resolve=>{release=resolve;});
 const bothRead=new Promise<void>(resolve=>{releaseReads=resolve;});
 const fake=await startFakeOpenAi(async r=>{
  if(!isReview(r)){if(++arrivals===2)release();await both;pending.push((await f.job()).allowance_open_calls);if(pending.length===2)releaseReads();await bothRead;return echoFirstPass(r,{input_tokens:20,output_tokens:10});}
  return emptyReview({input_tokens:0,output_tokens:0});
 });
 try{
  await f.run(fake.baseUrl,2).runOnce(new AbortController().signal);
  assert.deepEqual(pending,[2,2]);const job=await f.job(),saved=await f.reservation();
  assert.deepEqual([job.state,job.done,job.allowance_open_calls,job.cost_micro_usd,saved.units,saved.state],['done',91,0,'14','91','spent']);
  assert.equal(fake.requests.length,4);assert.equal((await f.db.pool.query('SELECT count(*) FROM billing_allowance_reservations')).rows[0].count,'1');
 }finally{release();releaseReads();await fake.close();await f.db.close();}
});

test('cancellation between durable spending and invocation leaves zero confirmed trial runs',async()=>{
 const f=await fixture(),controller=new AbortController(),patched:{client:PoolClient;query:PoolClient['query']}[]=[];let intercepted=false;
 await f.emptyCoverage();
 const intercept=(client:PoolClient)=>{
  const query=client.query.bind(client);patched.push({client,query});
  client.query=((...args:any[])=>{
   if(!intercepted&&typeof args[0]==='string'&&args[0].startsWith('UPDATE translation_jobs SET allowance_open_calls=allowance_open_calls+1')){
    intercepted=true;return (query as any)(...args).then((result:unknown)=>{controller.abort();return result;});
   }
   return (query as any)(...args);
  }) as PoolClient['query'];
 };
 f.db.secondPool.on('connect',intercept);const fake=await startFakeOpenAi(r=>echoFirstPass(r));
 try{
  await f.run(fake.baseUrl).runOnce(controller.signal);assert.equal(intercepted,true);
  const saved=await f.reservation(),usage=await f.usage();
  assert.deepEqual([fake.requests.length,saved.units,saved.state,saved.attempted_at,(await f.job()).allowance_open_calls],[0,'2','spent',null,1]);
  assert.deepEqual([usage.complete,usage.usage.translationRuns],[false,0]);
 }finally{f.db.secondPool.removeListener('connect',intercept);for(const {client,query} of patched)client.query=query;await fake.close();await f.db.close();}
});

test('a cancelled sibling cannot close another batchs failed accounting',async()=>{
 const f=await fixture(91);await f.emptyCoverage();let arrivals=0,release!:()=>void,releaseHeld!:()=>void;
 const both=new Promise<void>(resolve=>{release=resolve;}),held=new Promise<void>(resolve=>{releaseHeld=resolve;});
 const fake=await startFakeOpenAi(async r=>{
  if(++arrivals===2)release();await both;
  const products=JSON.parse(r.body.input.split('Products:\n')[1]!) as unknown[];
  if(products.length===1)await held;
  return echoFirstPass(r,{input_tokens:20,output_tokens:10});
 });
 try{
  await f.db.pool.query("CREATE FUNCTION refuse_sibling_cost() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic-sibling-cost'; END$$; CREATE TRIGGER refuse_sibling_cost BEFORE UPDATE OF cost_micro_usd ON translation_jobs FOR EACH ROW EXECUTE FUNCTION refuse_sibling_cost()");
  await assert.rejects(f.run(fake.baseUrl,2).runOnce(new AbortController().signal),/synthetic-sibling-cost/);
  assert.deepEqual([fake.requests.length,(await f.job()).allowance_open_calls,(await f.job()).cost_micro_usd],[2,1,'0']);
  assert.equal((await f.usage()).complete,false);
 }finally{release();releaseHeld();await fake.close();await f.db.close();}
});

test('translation worker refuses an uncertain spent admission after lease takeover without another call',async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 try{
  const saved=await f.reservation();
  await f.db.pool.query("UPDATE billing_allowance_reservations SET state='spent' WHERE id=$1",[saved.id]);
  await f.db.pool.query("UPDATE translation_jobs SET state='running',lease_id=$2,lease_until=clock_timestamp()-interval '1 second',lease_count=1,started_at=clock_timestamp() WHERE id=$1",[f.jobId,randomUUID()]);
  await f.run(fake.baseUrl).runOnce(new AbortController().signal);
  assert.equal(fake.requests.length,0);assert.deepEqual([(await f.reservation()).state,(await f.reservation()).attempted_at],['spent',null]);
 }finally{await fake.close();await f.db.close();}
});

test('translation allowance storage failure escapes before any provider call',async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(r=>echoFirstPass(r));
 try{
  await f.db.pool.query("CREATE FUNCTION refuse_allowance_spend() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic-spend-refusal'; END$$; CREATE TRIGGER refuse_allowance_spend BEFORE UPDATE ON billing_allowance_reservations FOR EACH ROW EXECUTE FUNCTION refuse_allowance_spend()");
  await assert.rejects(f.run(fake.baseUrl).runOnce(new AbortController().signal),/synthetic-spend-refusal/);
  assert.deepEqual([fake.requests.length,(await f.reservation()).state,(await f.job()).cost_micro_usd],[0,'held','0']);
 }finally{await fake.close();await f.db.close();}
});

test('a pending-call write failure rolls back spending before any provider call',async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(r=>echoFirstPass(r));
 try{
  await f.db.pool.query("CREATE FUNCTION refuse_allowance_open() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.allowance_open_calls>OLD.allowance_open_calls THEN RAISE EXCEPTION 'synthetic-open-refusal'; END IF; RETURN NEW; END$$; CREATE TRIGGER refuse_allowance_open BEFORE UPDATE OF allowance_open_calls ON translation_jobs FOR EACH ROW EXECUTE FUNCTION refuse_allowance_open()");
  await assert.rejects(f.run(fake.baseUrl).runOnce(new AbortController().signal),/synthetic-open-refusal/);
  assert.deepEqual([fake.requests.length,(await f.reservation()).state,(await f.job()).allowance_open_calls],[0,'held',0]);
 }finally{await fake.close();await f.db.close();}
});

test('billed provider failures retain one allowance debit and every actual cost',async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(()=>({json:{status:'incomplete',usage:{input_tokens:20,output_tokens:10},output:[]}}));
 try{
  await f.emptyCoverage();await f.run(fake.baseUrl).runOnce(new AbortController().signal);
  const saved=await f.reservation(),job=await f.job(),usage=await f.usage();
  assert.deepEqual([fake.requests.length,saved.units,saved.state,job.cost_micro_usd,job.allowance_open_calls,job.state],[4,'2','spent','28',0,'failed']);
  assert.deepEqual([usage.complete,usage.usage.translationRuns],[true,1]);
 }finally{await fake.close();await f.db.close();}
});

test('translation allowance releases only never-leased expired work and retains the saved reservation',async()=>{
 const f=await fixture();try{
  const saved=await f.reservation();await f.db.pool.query("UPDATE translation_jobs SET created_at=clock_timestamp()-interval '25 hours' WHERE id=$1",[f.jobId]);
  assert.deepEqual(await sweepTranslationJobs(f.db.pool),{expired:1});
  assert.deepEqual([ (await f.reservation()).id,(await f.reservation()).units,(await f.reservation()).state,(await f.job()).state],[saved.id,'2','released','expired']);
  assert.deepEqual(await sweepTranslationJobs(f.db.pool),{expired:0});
 }finally{await f.db.close();}
});

for(const [planMode,value] of [['existing',allowances],['test-free-paid',allowances],['test-venue-levels',null],['test-venue-levels',{mode:'production',calendar:'UTC'}]] as const)
test('translation worker refuses invalid allowance options before opening a connection '+JSON.stringify([planMode,value]),async()=>{
 const pool=new Pool();try{
  assert.throws(()=>new TranslationWorker(pool,{provider:'openai',model:'gpt-6-luna',respond:async()=>{throw Error('must not call');}},
   {planMode,allowances:value} as ConstructorParameters<typeof TranslationWorker>[2]),{code:'invalid_allowance_input'});
  assert.equal(pool.totalCount,0);
 }finally{await pool.end();}
});

// A later confirmed call must not erase uncertainty from a failed accounting callback.
for(const stage of ['first','review'] as const)test('a '+stage+' cost callback failure cannot replay paid work after lease takeover',async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(r=>isReview(r)?emptyReview({input_tokens:0,output_tokens:0}):echoFirstPass(r,{input_tokens:20,output_tokens:10}));
 try{
  await f.emptyCoverage();
  await f.db.pool.query(`CREATE FUNCTION refuse_allowance_cost() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
   IF ${stage==='first'?'NEW.input_tokens>OLD.input_tokens':'OLD.input_tokens>0'} THEN RAISE EXCEPTION 'synthetic-cost-refusal'; END IF; RETURN NEW; END$$;
   CREATE TRIGGER refuse_allowance_cost BEFORE UPDATE OF cost_micro_usd ON translation_jobs FOR EACH ROW EXECUTE FUNCTION refuse_allowance_cost()`);
  await assert.rejects(f.run(fake.baseUrl).runOnce(new AbortController().signal),/synthetic-cost-refusal/);
  const expectedCalls=stage==='first'?1:2;assert.equal(fake.requests.length,expectedCalls);
  const usage=await f.usage();assert.deepEqual([usage.complete,usage.usage.translationRuns],[false,1],'uncommitted call accounting remains incomplete despite another confirmed invocation');
  await f.db.pool.query('DROP TRIGGER refuse_allowance_cost ON translation_jobs; DROP FUNCTION refuse_allowance_cost()');
  await f.db.pool.query("UPDATE translation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.jobId]);
  await f.run(fake.baseUrl).runOnce(new AbortController().signal);
  assert.equal(fake.requests.length,expectedCalls,'an accounting failure never licenses another provider call');
  assert.deepEqual([(await f.reservation()).units,(await f.reservation()).state,(await f.job()).cost_micro_usd],['2','spent',stage==='first'?'0':'7']);
 }finally{await fake.close();await f.db.close();}
});
