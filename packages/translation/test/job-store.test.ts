import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {after,before,test} from 'node:test';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {collectJob,createJob,findSubmitted,jobFingerprint,lockVenue,monthSpend,readJob,releaseJob,spendingPolicy,statusView,submitView,TranslationError,type SubmitFingerprint} from '../src/index.ts';
import {connectedVenue,database} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const vectors=JSON.parse(readFileSync(new URL('./submit-vectors.json',import.meta.url),'utf8'));
before(async()=>{db=await database();});after(async()=>db?.close());
const submit=(v:{installationId:string;venueId:string},operationId:string,body:string,fingerprint:SubmitFingerprint,total:number)=>
 transaction(db.pool,async c=>{await lockVenue(c,v.venueId);return await findSubmitted(c,v.installationId,operationId,fingerprint)
  ??await createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId,fingerprint,body,total});});
const jobs=async(v:{venueId:string})=>(await db.pool.query('SELECT count(*)::integer AS n FROM translation_jobs WHERE venue_id=$1',[v.venueId])).rows[0].n as number;
test('a retried submit returns the first job; the same operation with another fingerprint conflicts',async()=>{
 const v=await connectedVenue(db,issuer,origin),op=randomUUID(),body='{"x":1}',fp=jobFingerprint(body);
 const first=await submit(v,op,body,fp,3);
 assert.equal((await submit(v,op,body,fp,3)).id,first.id);
 await assert.rejects(submit(v,op,'{"x":2}',jobFingerprint('{"x":2}'),3),(e:unknown)=>e instanceof TranslationError&&e.code==='conflict');
 assert.equal(await jobs(v),1);
});
test('the shared replayed-operation vector conflicts after the valid one',async()=>{
 const byName=Object.fromEntries(vectors.cases.map((c:{name:string;envelope:{body:string}})=>[c.name,c.envelope.body]));
 const v=await connectedVenue(db,issuer,origin);
 await submit(v,vectors.operationId,byName.valid,jobFingerprint(byName.valid),1);
 await assert.rejects(submit(v,vectors.operationId,byName.replayed_operation,jobFingerprint(byName.replayed_operation),1),(e:unknown)=>e instanceof TranslationError&&e.code==='conflict');
});
test('a second job while one is open is refused, and allowed once the first finishes',async()=>{
 const v=await connectedVenue(db,issuer,origin);await submit(v,randomUUID(),'{}',jobFingerprint('{}'),1);
 await assert.rejects(submit(v,randomUUID(),'{}',jobFingerprint('{}'),1),(e:unknown)=>e instanceof TranslationError&&e.code==='job_running');
 await db.pool.query("UPDATE translation_jobs SET state='done',finished_at=clock_timestamp() WHERE venue_id=$1",[v.venueId]);
 await submit(v,randomUUID(),'{}',jobFingerprint('{}'),1);
 assert.equal(await jobs(v),2);
});
test('the estimate is refused up front with how many items would fit, and last month does not count',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,provider,model,prompt_version,cost_micro_usd,created_at,finished_at)
  VALUES($1,$2,$3,$4,$5,1,'collected',1,'openai','gpt-6-luna','translate-all-v1',4999000,date_trunc('month',clock_timestamp(),'UTC'),clock_timestamp())`,[randomUUID(),v.installationId,v.venueId,randomUUID(),'b'.repeat(64)]);
 // 1,000 micro-dollars left at 146 each: 6 items fit.
 await assert.rejects(submit(v,randomUUID(),'{}',jobFingerprint('{}'),7),(e:unknown)=>e instanceof TranslationError&&e.code==='limit_reached'&&e.fits===6);
 await submit(v,randomUUID(),'{}',jobFingerprint('{}'),6);
 const w=await connectedVenue(db,issuer,origin);
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,provider,model,prompt_version,cost_micro_usd,created_at,finished_at)
  VALUES($1,$2,$3,$4,$5,1,'collected',1,'openai','gpt-6-luna','translate-all-v1',5000000,date_trunc('month',clock_timestamp(),'UTC')-interval '1 second',clock_timestamp())`,[randomUUID(),w.installationId,w.venueId,randomUUID(),'c'.repeat(64)]);
 await submit(w,randomUUID(),'{}',jobFingerprint('{}'),1000);
});
test('status shows the reason only for a partly done or failed job, and a retried submit returns the first job in its current state',async()=>{
 const v=await connectedVenue(db,issuer,origin),op=randomUUID(),fp=jobFingerprint('{}'),job=await submit(v,op,'{}',fp,2);
 assert.deepEqual(submitView(job),{version:1,jobId:job.id,state:'queued',total:2});
 assert.equal('reason' in statusView(job),false);
 await db.pool.query("UPDATE translation_jobs SET state='running' WHERE id=$1",[job.id]);
 assert.deepEqual(submitView(await submit(v,op,'{}',fp,2)),{version:1,jobId:job.id,state:'running',total:2});
 for(const [state,reason] of [['partly_done','limit_reached'],['partly_done','provider_failed'],['failed','provider_unavailable'],['failed','consent_required']] as const){
  await db.pool.query('UPDATE translation_jobs SET state=$2,reason=$3,finished_at=clock_timestamp() WHERE id=$1',[job.id,state,reason]);
  assert.equal(statusView(await transaction(db.pool,c=>readJob(c,v.installationId,job.id))).reason,reason);
 }
 assert.deepEqual(submitView(await submit(v,op,'{}',fp,2)),{version:1,jobId:job.id,state:'failed',total:2});
 assert.equal(await jobs(v),1);
});
test('another installation cannot read a job, and collect and release follow the contract states',async()=>{
 const a=await connectedVenue(db,issuer,origin),b=await connectedVenue(db,issuer,origin);
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'en',enabled:['en','ca']},houseStyle:[],items:[
  {ref:'context',kind:'product',family:'context',category:null,staffName:'Coffee',existing:{},missing:[]},
  ...['product:1','product:2'].map(ref=>({ref,kind:'variant',family:'context',category:null,staffName:'Coffee',existing:{},missing:['ca']}))]});
 const job=await submit(a,randomUUID(),body,jobFingerprint(body),2);
 const code=(name:string)=>(e:unknown)=>e instanceof TranslationError&&e.code===name;
 await assert.rejects(transaction(db.pool,c=>readJob(c,b.installationId,job.id)),code('job_not_found'));
 await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,a.installationId,job.id))),code('not_ready'));
 await assert.rejects(transaction(db.pool,async c=>releaseJob(c,await readJob(c,a.installationId,job.id))),code('not_ready'));
 await db.pool.query(`UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1`,[job.id,{0:{results:[{ref:'product:1',names:{ca:'Cafè'},placeholder:false,corrections:[]}],failed:['product:2']}}]);
 await db.pool.query("UPDATE translation_jobs SET state='partly_done',reason='provider_failed',done=1,failed=1,finished_at=clock_timestamp() WHERE id=$1",[job.id]);
 const collected=await transaction(db.pool,async c=>collectJob(c,await readJob(c,a.installationId,job.id)));
 assert.deepEqual(collected,{version:1,jobId:job.id,state:'partly_done',results:[{ref:'product:1',names:{ca:'Cafè'},placeholder:false,corrections:[]}],failed:['product:2'],nextCursor:null});
 const released=await transaction(db.pool,async c=>releaseJob(c,await readJob(c,a.installationId,job.id)));
 assert.deepEqual(released,{version:1,jobId:job.id,state:'collected'});
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies WHERE job_id=$1',[job.id])).rows[0].n,0);
 assert.deepEqual(await transaction(db.pool,async c=>releaseJob(c,await readJob(c,a.installationId,job.id))),released);
 await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,a.installationId,job.id))),code('expired'));
});

test('concurrent retries return one job and competing operations receive job_running',async()=>{
 const v=await connectedVenue(db,issuer,origin),op=randomUUID(),fp=jobFingerprint('{}');
 const rows=await Promise.all(Array.from({length:8},()=>submit(v,op,'{}',fp,1)));
 assert.equal(new Set(rows.map(row=>row.id)).size,1);assert.equal(await jobs(v),1);
 const w=await connectedVenue(db,issuer,origin);
 const attempts=await Promise.allSettled(Array.from({length:8},()=>submit(w,randomUUID(),'{}',fp,1)));
 assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
 for(const a of attempts)if(a.status==='rejected')assert(a.reason instanceof TranslationError&&a.reason.code==='job_running',String(a.reason));
 assert.equal(await jobs(w),1);
});
test('a retried operation compares byte count as well as hash even after the cap is spent',async()=>{
 const v=await connectedVenue(db,issuer,origin),op=randomUUID(),fp=jobFingerprint('{}');
 const row=await submit(v,op,'{}',fp,1);
 await db.pool.query("UPDATE translation_jobs SET state='done',cost_micro_usd=5000000,finished_at=clock_timestamp() WHERE id=$1",[row.id]);
 assert.equal((await submit(v,op,'{}',fp,1)).id,row.id);
 await assert.rejects(submit(v,op,'{}',{...fp,jobBytes:3},1),(e:unknown)=>e instanceof TranslationError&&e.code==='conflict');
 await assert.rejects(submit(v,randomUUID(),'{}',fp,1),(e:unknown)=>e instanceof TranslationError&&e.code==='limit_reached'&&e.fits===0);
});
test('failed jobs release without collecting and expiry refuses collection and release',async()=>{
 for(const state of ['failed','expired'] as const){
  const v=await connectedVenue(db,issuer,origin),job=await submit(v,randomUUID(),'{}',jobFingerprint('{}'),1);
  await db.pool.query("UPDATE translation_jobs SET state=$2,reason='limit_reached',finished_at=clock_timestamp(),lease_id=$3,lease_until=clock_timestamp() WHERE id=$1",[job.id,state,randomUUID()]);
  const run=(action:typeof releaseJob|typeof collectJob)=>transaction(db.pool,async c=>action(c,await readJob(c,v.installationId,job.id)));
  await assert.rejects(run(collectJob),(e:unknown)=>e instanceof TranslationError&&e.code===(state==='failed'?'not_ready':'expired'));
  if(state==='expired')await assert.rejects(run(releaseJob),(e:unknown)=>e instanceof TranslationError&&e.code==='expired');
  else{
   assert.deepEqual(await run(releaseJob),{version:1,jobId:job.id,state:'collected'});
   const r=await transaction(db.pool,c=>readJob(c,v.installationId,job.id));
   assert.equal(r.lease_id,null);assert.equal(r.lease_until,null);assert(r.collected_at instanceof Date);
   assert.equal((await db.pool.query('SELECT * FROM translation_job_bodies WHERE job_id=$1',[job.id])).rowCount,0);
  }
 }
});
test('owned cursor validation precedes state refusal while a foreign lookup stays hidden',async()=>{
 const v=await connectedVenue(db,issuer,origin),other=await connectedVenue(db,issuer,origin),job=await submit(v,randomUUID(),'{}',jobFingerprint('{}'),2);
 for(const cursor of [-1,0.5,Number.MAX_SAFE_INTEGER+1,'0',null,true,2,3]){
  await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,job.id),cursor)),(e:unknown)=>e instanceof TranslationError&&e.code==='invalid_request');
  await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,other.installationId,job.id),cursor)),(e:unknown)=>e instanceof TranslationError&&e.code==='job_not_found');
 }
});
test('multiple collects retain the body and release waits for the collecting transaction',async()=>{
 const v=await connectedVenue(db,issuer,origin),body=JSON.stringify({items:[{ref:'p1',missing:['ca']}]});
 const job=await submit(v,randomUUID(),body,jobFingerprint(body),1);
 await db.pool.query("UPDATE translation_jobs SET state='done',done=1,finished_at=clock_timestamp() WHERE id=$1",[job.id]);
 await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[job.id,{0:{results:[{ref:'p1',names:{ca:'Cafè'},placeholder:false,corrections:[]}],failed:[]}}]);
 const a=await db.pool.connect(),b=await db.pool.connect();
 try{
  await a.query('BEGIN');await b.query('BEGIN');
  const first=await collectJob(a,await readJob(a,v.installationId,job.id));
  assert.deepEqual(await collectJob(a,await readJob(a,v.installationId,job.id)),first);
  assert.equal((await a.query('SELECT count(*)::integer AS n FROM translation_job_bodies WHERE job_id=$1',[job.id])).rows[0].n,1);
  // A nonwaiting lock attempt proves that release cannot acquire this job until collect commits.
  await assert.rejects(b.query('SELECT id FROM translation_jobs WHERE id=$1 FOR UPDATE NOWAIT',[job.id]),(e:unknown)=>{assert.equal((e as {code:string}).code,'55P03');return true;});
  await b.query('ROLLBACK');await a.query('COMMIT');
  assert.equal((await transaction(db.pool,async c=>releaseJob(c,await readJob(c,v.installationId,job.id)))).state,'collected');
  await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,job.id))),(e:unknown)=>e instanceof TranslationError&&e.code==='expired');
 }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();}
});
test('spend uses exact integer arithmetic and UTC boundaries independent of session timezone',async()=>{
 const v=await connectedVenue(db,issuer,origin),row=await submit(v,randomUUID(),'{}',jobFingerprint('{}'),1);
 await db.pool.query("UPDATE translation_jobs SET state='done',finished_at=clock_timestamp(),cost_micro_usd='9007199254740993',created_at=date_trunc('month',clock_timestamp(),'UTC') WHERE id=$1",[row.id]);
 for(const zone of ['Pacific/Kiritimati','America/Los_Angeles'])await transaction(db.pool,async c=>{
  await c.query("SELECT set_config('TimeZone',$1,true)",[zone]);
  assert.equal(await monthSpend(c,v.venueId),9007199254740993n);
  await c.query("UPDATE translation_jobs SET created_at=date_trunc('month',clock_timestamp(),'UTC')-interval '1 microsecond' WHERE id=$1",[row.id]);
  assert.equal(await monthSpend(c,v.venueId),0n);
  await c.query("UPDATE translation_jobs SET created_at=date_trunc('month',clock_timestamp(),'UTC') WHERE id=$1",[row.id]);
 });
 await assert.rejects(submit(v,randomUUID(),'{}',jobFingerprint('{}'),1),(e:unknown)=>e instanceof TranslationError&&e.code==='limit_reached'&&e.fits===0);
});
test('a transaction failure rolls back both submitted metadata and body',async()=>{
 const v=await connectedVenue(db,issuer,origin),op=randomUUID();let id='';
 await assert.rejects(transaction(db.pool,async c=>{
  await lockVenue(c,v.venueId);id=(await createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:op,body:'{}',fingerprint:jobFingerprint('{}'),total:1})).id;
  throw new Error('simulated caller failure');
 }),/simulated caller failure/);
 assert.equal(await jobs(v),0);assert.equal((await db.pool.query('SELECT * FROM translation_job_bodies WHERE job_id=$1',[id])).rowCount,0);
 assert.equal((await submit(v,op,'{}',jobFingerprint('{}'),1)).state,'queued');
});
test('a retained PostgreSQL job walks several bounded pages without deleting or reordering outcomes',async()=>{
 const v=await connectedVenue(db,issuer,origin),languages=['en','es','ca','fr','de','it','pt','nl','sv','da','fi','pl','cs','sk','hu','ro','el','tr','ja','zh'];
 const items=Array.from({length:600},(_,i)=>({ref:`product:${i}`,kind:'product',family:`product:${i}`,category:null,staffName:'Coffee',existing:{},missing:languages}));
 items[0]!.kind='variant';items[0]!.family='context';
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'en',enabled:languages},houseStyle:[],items:[{...items[0],ref:'context',kind:'product',family:'context',missing:[]},...items]});
 assert(Buffer.byteLength(body)<=1048576);
 const job=await submit(v,randomUUID(),body,jobFingerprint(body),600);
 const results=items.filter((_,i)=>i%4!==1).map(item=>({ref:item.ref,names:Object.fromEntries(languages.map(l=>[l,'\u0001'.repeat(500)])),placeholder:false,corrections:[]}));
 const failed=items.filter((_,i)=>i%4===1).map(item=>item.ref);
 await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[job.id,{5:{results:[...results].reverse(),failed:[...failed].reverse()}}]);
 await db.pool.query("UPDATE translation_jobs SET state='partly_done',reason='provider_failed',done=450,failed=150,finished_at=clock_timestamp() WHERE id=$1",[job.id]);
 const walk=(cursor?:unknown)=>transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,job.id),cursor));
 const first=await walk();assert(first.nextCursor!==null);assert.deepEqual(first,await walk(0));
 assert.equal(first.results[0]!.ref,'product:0');assert.equal(first.failed[0],'product:1');
 const second=await walk(first.nextCursor);assert.equal(second.nextCursor,null);
 for(const value of [first,second])assert(Buffer.byteLength(JSON.stringify(value))<=16777216);
 assert.deepEqual([...first.results,...second.results],results);assert.deepEqual([...first.failed,...second.failed],failed);
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies WHERE job_id=$1',[job.id])).rows[0].n,1);
 assert.deepEqual((await walk(599)).failed,['product:599'].filter(ref=>failed.includes(ref)));
 await transaction(db.pool,async c=>releaseJob(c,await readJob(c,v.installationId,job.id)));
 await assert.rejects(walk(first.nextCursor),(e:unknown)=>e instanceof TranslationError&&e.code==='expired');
});
test('an estimate exactly equal to the money left is accepted and one more item is refused',async()=>{
 const v=await connectedVenue(db,issuer,origin),first=await submit(v,randomUUID(),'{}',jobFingerprint('{}'),1);
 await db.pool.query("UPDATE translation_jobs SET state='collected',cost_micro_usd=4998978,created_at=date_trunc('month',clock_timestamp(),'UTC') WHERE id=$1",[first.id]);
 assert.equal((await submit(v,randomUUID(),'{}',jobFingerprint('{}'),7)).total,7);
 await db.pool.query("UPDATE translation_jobs SET state='done',finished_at=clock_timestamp() WHERE venue_id=$1 AND state='queued'",[v.venueId]);
 await assert.rejects(submit(v,randomUUID(),'{}',jobFingerprint('{}'),8),(e:unknown)=>e instanceof TranslationError&&e.code==='limit_reached'&&e.fits===7);
});
test('a stored total that disagrees with the retained items is an invariant failure',async()=>{
 const v=await connectedVenue(db,issuer,origin),body=JSON.stringify({items:[{ref:'p1',missing:['ca']}]});
 const job=await submit(v,randomUUID(),body,jobFingerprint(body),2);
 await db.pool.query("UPDATE translation_jobs SET state='done',done=1,finished_at=clock_timestamp() WHERE id=$1",[job.id]);
 await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[job.id,{0:{results:[{ref:'p1',names:{ca:'Cafè'},placeholder:false,corrections:[]}],failed:[]}}]);
 await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,job.id),1)),/translation_outcomes_invalid/);
});
test('a terminal job with a missing retained body is expired',async()=>{
 const v=await connectedVenue(db,issuer,origin),job=await submit(v,randomUUID(),'{}',jobFingerprint('{}'),1);
 await db.pool.query("UPDATE translation_jobs SET state='done',finished_at=clock_timestamp() WHERE id=$1",[job.id]);
 await db.pool.query('DELETE FROM translation_job_bodies WHERE job_id=$1',[job.id]);
 await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,job.id))),(e:unknown)=>e instanceof TranslationError&&e.code==='expired');
});
test('a missing spending policy refuses service instead of supplying an allowance',async()=>{
 const original=(await db.pool.query('SELECT * FROM translation_policy')).rows[0];
 try{
  await db.pool.query('DELETE FROM translation_policy');
  await assert.rejects(transaction(db.pool,c=>spendingPolicy(c)),/translation_policy_missing/);
 }finally{await db.pool.query('INSERT INTO translation_policy VALUES(true,$1,$2)',[original.monthly_cap_micro_usd,original.estimate_micro_usd_per_item]);}
});
