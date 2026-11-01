import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {BillingStore,createLeaseIssuer,type BillingLevel} from '@waitron-cloud/registration';
import {TranslationMachine,TranslationWorker,createLoopbackOpenAiClient,createJob,jobFingerprint} from '../src/index.ts';
import {transaction} from '@waitron-cloud/registration';
import {connectedVenue,database,giveConsent,readyForTranslation} from './fixtures.ts';
import {echoFirstPass,emptyReview,isReview,responsesBody,startFakeOpenAi} from './fake-openai.ts';
const origin='https://cloud.example.test';
const text=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR',staffName:'Cafe',existing:{},missing:['ca','es']}],houseStyle:[]});
const results=[{ref:'product:1',names:{ca:'Cafe [ca]',es:'Cafe [es]'},placeholder:false,corrections:[]}];
const mode='test-venue-levels' as const;
const code=(name:string)=>(error:any)=>error.code===name||error.message===name;
const issuer=()=>createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
async function fixture(){
 const db=await database(),signer=issuer(),store=new BillingStore(db.pool);
 const v=await connectedVenue(db,signer,origin),scope={organisationId:v.organisationId,legalBusinessId:v.legalBusinessId};
 await store.execute(scope,{key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}},{type:'ensure_business'});
 await readyForTranslation(db,v);await giveConsent(db,v);
 // Runtime construction lets database behavior checks run independently of static signature checks.
 const api=await import(new URL('../src/index.ts',import.meta.url).href);
 const machine:TranslationMachine=new api.TranslationMachine(db.pool,signer,origin,undefined,undefined,mode);
 const set=async(level:BillingLevel)=>{
  const old=await store.venue(scope,v.venueId);
  await store.transition(scope,{key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}},
   {type:'set_venue',venueId:v.venueId,expectedRevision:old.revision,value:{level,connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
 };
 const submit=(operationId=randomUUID(),body=text)=>{const e=v.submit(body,operationId);return machine.execute('translation-submit',{payload:e.payload,signature:e.signature},body);};
 const act=(action:'translation-status'|'translation-collect'|'translation-release',jobId:unknown,extra={})=>machine.execute(action,v.proof(action,{version:1,jobId,...extra},randomUUID(),v.lease));
 const row=async(jobId:unknown)=>(await db.pool.query('SELECT * FROM translation_jobs WHERE id=$1',[jobId])).rows[0];
 const queue=()=>transaction(db.pool,c=>createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(text),body:text,total:1}));
 const worker=(baseUrl:string,over={})=>new TranslationWorker(db.pool,createLoopbackOpenAiClient({apiKey:'local-fake-only',baseUrl,timeoutMs:5000}),{planMode:mode,batchConcurrency:1,wait:async()=>{},...over} as any);
 return {db,v,machine,signer,set,submit,act,row,queue,worker,close:()=>db.close()};
}

for(const enrolled of [false,true])test(`venue translation denies a ${enrolled?'registered':'unenrolled'} venue despite ready setup and consent`,async()=>{
 const f=await fixture();try{
  if(enrolled)await f.set('registered');
  await assert.rejects(f.submit(),code('permission_denied'));
  assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'0');
 }finally{await f.close();}
});
for(const level of ['connected','hosted'] as const)test(`venue translation ${level} admission retains independent readiness and consent gates`,async()=>{
 const f=await fixture();try{
  await f.set(level);await f.db.pool.query('DELETE FROM translation_consents');
  await assert.rejects(f.submit(),code('consent_required'));
  await giveConsent(f.db,f.v);await f.db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE service='content_translation'");
  await assert.rejects(f.submit(),code('permission_denied'));
  await readyForTranslation(f.db,f.v);assert.equal((await f.submit()).state,'queued');
  assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'1');
 }finally{await f.close();}
});
test('venue translation durable results survive downgrade missing consent and unready setup',async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));try{
  await f.set('connected');const op=randomUUID(),first=await f.submit(op);
  assert.equal(await f.worker(fake.baseUrl).runOnce(new AbortController().signal),true);
  await f.set('registered');await f.db.pool.query('DELETE FROM translation_consents');
  await f.db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE service='content_translation'");
  assert.deepEqual(await f.submit(op),{...first,state:'done'});
  assert.equal((await f.act('translation-status',first.jobId)).state,'done');
  const collected=await f.act('translation-collect',first.jobId);assert.deepEqual(collected.results,results);assert.equal(collected.nextCursor,null);
  await assert.rejects(f.submit(op,text.replace('Cafe','Coffee')),code('conflict'));
  assert.equal((await f.act('translation-release',first.jobId)).state,'collected');
  await assert.rejects(f.act('translation-collect',first.jobId),code('expired'));
  assert.equal(fake.requests.length,2);
 }finally{await fake.close();await f.close();}
});

test('venue translation queued connected work retains consent_required after consent withdrawal',async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));try{
  await f.set('connected');const queued=await f.queue();
  await f.db.pool.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE venue_id=$1',[f.v.venueId]);
  assert.equal(await f.worker(fake.baseUrl).runOnce(new AbortController().signal),true);
  const row=await f.row(queued.id);
  assert.deepEqual([row.state,row.reason,row.done,row.failed,row.lease_id,row.lease_until],['failed','consent_required',0,1,null,null]);
  assert.equal(fake.requests.length,0);
  assert.equal((await f.db.pool.query('SELECT count(*) AS n FROM usage_events WHERE source_reference=$1',[queued.id])).rows[0].n,'0');
 }finally{await fake.close();await f.close();}
});
test('venue translation ownership precedes cursor validation after downgrade',async()=>{
 const f=await fixture();try{
  await f.set('connected');const first=await f.submit();await f.set('registered');
  const other=await connectedVenue(f.db,f.signer,origin);
  await assert.rejects(f.machine.execute('translation-collect',other.proof('translation-collect',{version:1,jobId:first.jobId,cursor:-1},randomUUID(),other.lease)),code('job_not_found'));
  await assert.rejects(f.act('translation-collect',first.jobId,{cursor:-1}),code('invalid_request'));
 }finally{await f.close();}
});
for(const response of ['success','malformed','billed failure'] as const)for(const restore of [false,true])test(`venue translation ${response} after ${restore?'round trip':'downgrade'} starts no review or retry`,async()=>{
 const f=await fixture();let entered!:()=>void,release!:()=>void;
 const enteredReply=new Promise<void>(resolve=>{entered=resolve;}),pause=new Promise<void>(resolve=>{release=resolve;});
 const fake=await startFakeOpenAi(async r=>{
  if(isReview(r))return emptyReview();entered();await pause;
  return response==='success'?echoFirstPass(r,{input_tokens:11,output_tokens:5}):response==='malformed'?{json:responsesBody('invalid',{input_tokens:11,output_tokens:5})}:
   {json:{...responsesBody('unfinished',{input_tokens:11,output_tokens:5}),status:'incomplete'}};
 });
 let pending:Promise<boolean>|undefined;
 try{
  await f.set('connected');const first=await f.submit();pending=f.worker(fake.baseUrl).runOnce(new AbortController().signal);
  await enteredReply;await f.set('registered');if(restore)await f.set('connected');release();await pending;
  const row=await f.row(first.jobId);
  assert.deepEqual([row.state,row.reason,row.done,row.failed,row.input_tokens,row.output_tokens],response==='success'?['done',null,1,0,'11','5']:['failed','provider_unavailable',0,1,'11','5']);
  assert.equal(fake.requests.length,1);assert.ok(BigInt(row.cost_micro_usd)>0n);
  if(response==='success')assert.deepEqual((await f.act('translation-collect',first.jobId)).results,results);
 }finally{release();await pending;await fake.close();await f.close();}
});
test('venue translation queued denial finishes without starving the next eligible venue',async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));try{
  await f.set('registered');const denied=await f.queue();
  const other=await connectedVenue(f.db,f.signer,origin);await giveConsent(f.db,other);
  const next=await transaction(f.db.pool,c=>createJob(c,{installationId:other.installationId,venueId:other.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(text),body:text,total:1}));
  const store=new BillingStore(f.db.pool),scope={organisationId:other.organisationId,legalBusinessId:other.legalBusinessId};
  const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
  await store.execute(scope,event(),{type:'ensure_business'});await store.transition(scope,event(),{type:'set_venue',venueId:other.venueId,expectedRevision:0,value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
  const worker=f.worker(fake.baseUrl);assert.equal(await worker.runOnce(new AbortController().signal),true);
  assert.deepEqual([(await f.row(denied.id)).state,(await f.row(denied.id)).reason],['failed','provider_unavailable']);assert.equal(fake.requests.length,0);
  assert.equal(await worker.runOnce(new AbortController().signal),true);assert.equal((await f.row(next.id)).state,'done');assert.equal(fake.requests.length,2);
 }finally{await fake.close();await f.close();}
});
test('venue translation retry wait rechecks authority before the next provider call',async()=>{
 const f=await fixture();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),pause=new Promise<void>(resolve=>{release=resolve;});
 const fake=await startFakeOpenAi(()=>({status:503}));let pending:Promise<boolean>|undefined;
 try{
  await f.set('connected');const first=await f.submit();pending=f.worker(fake.baseUrl,{wait:async()=>{enter();await pause;}}).runOnce(new AbortController().signal);
  await entered;await f.set('registered');release();await pending;
  const row=await f.row(first.jobId);assert.deepEqual([row.state,row.reason,row.done,row.failed,row.cost_micro_usd],['failed','provider_unavailable',0,1,'0']);assert.equal(fake.requests.length,1);
 }finally{release();await pending;await fake.close();await f.close();}
});
