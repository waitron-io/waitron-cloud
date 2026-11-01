import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {BillingStore,createLeaseIssuer,type BillingLevel,type PlanMode} from '@waitron-cloud/registration';
import {TranslationWorker,createLoopbackOpenAiClient} from '@waitron-cloud/translation';
import {createAccountApp} from '../src/app.ts';
import {connectedVenue,database,giveConsent,readyForTranslation} from '../../translation/test/fixtures.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from '../../translation/test/fake-openai.ts';
const origin='https://cloud.example.test';
const text=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR',staffName:'Cafe',existing:{},missing:['ca','es']}],houseStyle:[]});
const results=[{ref:'product:1',names:{ca:'Cafe [ca]',es:'Cafe [es]'},placeholder:false,corrections:[]}];
async function fixture(planMode:PlanMode='test-venue-levels'){
 const db=await database(),issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const v=await connectedVenue(db,issuer,origin),store=new BillingStore(db.pool),scope={organisationId:v.organisationId,legalBusinessId:v.legalBusinessId};
 const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
 await store.execute(scope,event(),{type:'ensure_business'});await readyForTranslation(db,v);await giveConsent(db,v);
 const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},translation:true,leaseIssuer:issuer,planMode});
 const post=(action:string,envelope:unknown,headers:Record<string,string>={})=>app.request(`${origin}/api/installations/${action}`,
  {method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(envelope)},
  {incoming:{socket:{remoteAddress:'203.0.113.1'}}} as HttpBindings);
 const set=async(level:BillingLevel)=>{
  const old=await store.venue(scope,v.venueId);
  await store.transition(scope,event(),{type:'set_venue',venueId:v.venueId,expectedRevision:old.revision,value:{level,connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
 };
 const count=async()=>Number((await db.pool.query('SELECT count(*) AS n FROM translation_jobs')).rows[0].n);
 const act=(action:string,jobId:unknown,extra={})=>post(action,v.proof(action,{version:1,jobId,...extra},randomUUID(),v.lease));
 return {db,v,issuer,post,set,count,act,close:()=>db.close()};
}
async function error(response:Response){return [response.status,await response.json()];}

// Omitting account-app mode propagation admits these jobs despite the registered level.
for(const enrolled of [false,true])test(`venue HTTP translation refuses ${enrolled?'registered':'unenrolled'} admission before creating a job`,async()=>{
 const f=await fixture();try{
  if(enrolled)await f.set('registered');
  const response=await f.post('translation-submit',f.v.submit(text));
  assert.deepEqual(await error(response),[403,{error:'permission_denied'}]);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(await f.count(),0);
 }finally{await f.close();}
});
for(const level of ['connected','hosted'] as const)test(`venue HTTP translation ${level} admission preserves consent readiness and paging`,async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));try{
  await f.set(level);await f.db.pool.query('DELETE FROM translation_consents');
  assert.deepEqual(await error(await f.post('translation-submit',f.v.submit(text))),[403,{error:'translation_consent_required'}]);
  await giveConsent(f.db,f.v);await f.db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE service='content_translation'");
  assert.deepEqual(await error(await f.post('translation-submit',f.v.submit(text))),[403,{error:'permission_denied'}]);
  await readyForTranslation(f.db,f.v);const envelope=f.v.submit(text),first=await f.post('translation-submit',envelope);
  assert.equal(first.status,200);const job=await first.json() as {jobId:string};
  assert.equal(await new TranslationWorker(f.db.pool,createLoopbackOpenAiClient({apiKey:'local-fake-only',baseUrl:fake.baseUrl,timeoutMs:5000}),{planMode:'test-venue-levels',batchConcurrency:1}).runOnce(new AbortController().signal),true);
  assert.deepEqual(await (await f.act('translation-collect',job.jobId)).json(),{version:1,jobId:job.jobId,state:'done',results,failed:[],nextCursor:null});
  assert.equal(await f.count(),1);assert.equal(fake.requests.length,2);
 }finally{await fake.close();await f.close();}
});
test('venue HTTP translation durable replay and result ownership survive downgrade',async()=>{
 const f=await fixture(),fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));try{
  await f.set('connected');const operation=randomUUID(),envelope=f.v.submit(text,operation),first=await f.post('translation-submit',envelope);
  assert.equal(first.status,200);const job=await first.json() as {version:number;jobId:string;state:string;total:number};
  await new TranslationWorker(f.db.pool,createLoopbackOpenAiClient({apiKey:'local-fake-only',baseUrl:fake.baseUrl,timeoutMs:5000}),{planMode:'test-venue-levels',batchConcurrency:1}).runOnce(new AbortController().signal);
  await f.set('registered');await f.db.pool.query('DELETE FROM translation_consents');
  await f.db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE service='content_translation'");
  assert.deepEqual(await (await f.post('translation-submit',envelope)).json(),{...job,state:'done'});
  assert.deepEqual(await error(await f.post('translation-submit',f.v.submit(text.replace('Cafe','Coffee'),operation))),[409,{error:'conflict'}]);
  assert.deepEqual(await error(await f.post('translation-submit',f.v.submit(text))),[403,{error:'permission_denied'}]);
  assert.equal((await (await f.act('translation-status',job.jobId)).json() as {state:string}).state,'done');
  const foreign=await connectedVenue(f.db,f.issuer,origin);
  for(const action of ['translation-status','translation-collect','translation-release'])
   assert.deepEqual(await error(await f.post(action,foreign.proof(action,{version:1,jobId:job.jobId,...(action==='translation-collect'?{cursor:-1}:{})},randomUUID(),foreign.lease))),[404,{error:'translation_job_not_found'}]);
  assert.deepEqual(await error(await f.act('translation-collect',job.jobId,{cursor:-1})),[400,{error:'invalid_request'}]);
  assert.deepEqual((await (await f.act('translation-collect',job.jobId)).json() as {results:unknown}).results,results);
  assert.deepEqual(await (await f.act('translation-release',job.jobId)).json(),{version:1,jobId:job.jobId,state:'collected'});
  assert.deepEqual(await error(await f.act('translation-collect',job.jobId)),[410,{error:'translation_expired'}]);
  assert.equal(await f.count(),1);assert.equal(fake.requests.length,2);
 }finally{await fake.close();await f.close();}
});
test('venue HTTP translation keeps signature lease and browser origin checks before level admission',async()=>{
 const f=await fixture();try{
  await f.set('registered');const good=f.v.submit(text),foreign=await connectedVenue(f.db,f.issuer,origin);
  assert.deepEqual(await error(await f.post('translation-submit',{...good,signature:'A'.repeat(86)})),[401,{error:'invalid_proof'}]);
  const crossed=f.v.proof('translation-submit',{},randomUUID(),foreign.lease,JSON.stringify({version:1,...(await import('@waitron-cloud/translation')).jobFingerprint(text)}));
  assert.deepEqual(await error(await f.post('translation-submit',{...crossed,body:text})),[401,{error:'invalid_proof'}]);
  assert.deepEqual(await error(await f.post('translation-submit',good,{origin})),[403,{error:'forbidden'}]);
  await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.v.installationId]);
  assert.deepEqual(await error(await f.post('translation-submit',good)),[403,{error:'revoked'}]);assert.equal(await f.count(),0);
 }finally{await f.close();}
});
test('venue HTTP translation production refusal precedes all new model work',async()=>{
 const f=await fixture();try{
  await f.db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[f.v.venueId]);
  const now=Date.now(),lease=f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.v.installationId,venueId:f.v.venueId,environment:'production',publicKey:f.v.installationKey,issuedAt:now,expiresAt:now+3600000});
  const proof=f.v.proof('translation-submit',{},randomUUID(),lease,JSON.stringify({version:1,...(await import('@waitron-cloud/translation')).jobFingerprint(text)}));
  assert.deepEqual(await error(await f.post('translation-submit',{...proof,body:text})),[403,{error:'permission_denied'}]);assert.equal(await f.count(),0);
 }finally{await f.close();}
});

// A sibling's paid authority cannot replace the authenticated installation's venue.
test('venue HTTP translation ignores paid sibling selectors and isolates same organisation jobs',async()=>{
 const f=await fixture();try{
  await f.set('registered');
  const {generateKeyPairSync,sign}=await import('node:crypto'),{RegistrationStore,InstallationStore,encodeMachine}=await import('@waitron-cloud/registration');
  const key=generateKeyPairSync('ed25519'),installationKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
  const binding={operationId:randomUUID(),installationKey,localVenueId:randomUUID(),environment:'test',organisationId:f.v.organisationId,legalBusinessId:f.v.legalBusinessId};
  const registrations=new RegistrationStore(f.db.pool);await registrations.start(binding);await registrations.approveCloud(binding,f.v.accountId);await registrations.approveLocal(binding,randomUUID());
  const sibling=await registrations.complete(binding),store=new BillingStore(f.db.pool),scope={organisationId:f.v.organisationId,legalBusinessId:f.v.legalBusinessId};
  const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
  await store.transition(scope,event(),{type:'set_venue',venueId:sibling.venueId,expectedRevision:0,value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
  await readyForTranslation(f.db,sibling);await giveConsent(f.db,{...f.v,venueId:sibling.venueId});
  const proof=(action:string,body:string,lease='')=>{const payload=encodeMachine({origin,action:action as any,installationId:sibling.installationId,operationId:randomUUID(),issuedAt:Date.now(),lease,body});return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};};
  const lease=(await new InstallationStore(f.db.pool,f.issuer,origin).execute('renew',proof('renew','{}'))).lease!;
  const {jobFingerprint}=await import('@waitron-cloud/translation');
  const admitted=await f.post('translation-submit',{...proof('translation-submit',JSON.stringify({version:1,...jobFingerprint(text)}),JSON.stringify(lease)),body:text});
  assert.equal(admitted.status,200);const job=await admitted.json() as {jobId:string};
  assert.deepEqual(await error(await f.post('translation-submit',f.v.submit(text))),[403,{error:'permission_denied'}]);
  for(const selector of [{venueId:sibling.venueId},{installationId:sibling.installationId},{organisationId:f.v.organisationId,legalBusinessId:f.v.legalBusinessId,venueId:sibling.venueId}]){
   const body=JSON.stringify({...JSON.parse(text),...selector});
   assert.deepEqual(await error(await f.post('translation-submit',f.v.submit(body))),[400,{error:'invalid_request'}]);
   const forged=f.v.proof('translation-submit',{},randomUUID(),f.v.lease,JSON.stringify({version:1,...jobFingerprint(text),...selector}));
   assert.deepEqual(await error(await f.post('translation-submit',{...forged,body:text})),[401,{error:'invalid_proof'}]);
  }
  for(const action of ['translation-status','translation-collect','translation-release'])
   assert.deepEqual(await error(await f.act(action,job.jobId,action==='translation-collect'?{cursor:-1}:{})),[404,{error:'translation_job_not_found'}]);
  assert.equal(await f.count(),1);assert.equal((await f.db.pool.query('SELECT state FROM translation_jobs WHERE id=$1',[job.jobId])).rows[0].state,'queued');
  assert.deepEqual((await f.db.pool.query('SELECT DISTINCT venue_id FROM translation_jobs')).rows,[{venue_id:sibling.venueId}]);
 }finally{await f.close();}
});
