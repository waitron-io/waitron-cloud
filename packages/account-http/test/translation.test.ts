import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {jobFingerprint} from '@waitron-cloud/translation';
import {createAccountApp} from '../src/app.ts';
import {connectedVenue,database,readyForTranslation} from '../../translation/test/fixtures.ts';
const origin='https://cloud.example.test';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,addresses=0;
const config=()=>({portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[] as string[]});
before(async()=>{db=await database();app=createAccountApp({translation:true,leaseIssuer:issuer,pool:db.pool,outbox:db.outbox,config:config()});});
after(async()=>db?.close());
type Venue=Awaited<ReturnType<typeof connectedVenue>>&{ip:string};
async function venue():Promise<Venue>{const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);return {...v,ip:`203.0.113.${++addresses}`};}
function post(v:{ip:string},action:string,body:unknown,headers:Record<string,string>={},target=app){
 return target.request(`${origin}/api/installations/${action}`,{method:'POST',headers:{'content-type':'application/json',...headers},
  body:typeof body==='string'?body:JSON.stringify(body)},{incoming:{socket:{remoteAddress:v.ip}}} as HttpBindings);
}
const item=(ref:string,over:Record<string,unknown>={})=>({ref,kind:'product',family:ref,category:'BAR',staffName:'CAFE',existing:{},missing:['ca','es','en'],...over});
const jobText=(items:object[]=[item('product:1')])=>JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},items,houseStyle:[]});
const reference=(v:Venue,action:string,jobId:string)=>v.proof(action,{version:1,jobId},randomUUID(),v.lease);
const error=async(response:Response)=>[response.status,((await response.json()) as {error:string}).error];
const jobCount=async(v:Venue)=>(await db.pool.query('SELECT count(*)::integer AS n FROM translation_jobs WHERE venue_id=$1',[v.venueId])).rows[0].n as number;
test('submit, status, collect and release follow the contract shapes',async()=>{
 const v=await venue(),submitted=await post(v,'translation-submit',v.submit(jobText()));
 assert.equal(submitted.status,200);assert.equal(submitted.headers.get('cache-control'),'no-store');
 const {jobId,...reply}=(await submitted.json()) as {jobId:string};
 assert.deepEqual(reply,{version:1,state:'queued',total:1});
 assert.deepEqual(await (await post(v,'translation-status',reference(v,'translation-status',jobId))).json(),{version:1,jobId,state:'queued',total:1,done:0,failed:0});
 const result={ref:'product:1',names:{ca:'Cafè',es:'Café',en:'Coffee'},placeholder:false,corrections:[]};
 await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[jobId,JSON.stringify({0:{results:[result],failed:[]}})]);
 await db.pool.query("UPDATE translation_jobs SET state='done',done=1,finished_at=clock_timestamp() WHERE id=$1",[jobId]);
 assert.deepEqual(await (await post(v,'translation-collect',reference(v,'translation-collect',jobId))).json(),{version:1,jobId,state:'done',results:[result],failed:[],nextCursor:null});
 assert.deepEqual(await (await post(v,'translation-release',reference(v,'translation-release',jobId))).json(),{version:1,jobId,state:'collected'});
 assert.deepEqual(await error(await post(v,'translation-collect',reference(v,'translation-collect',jobId))),[410,'translation_expired']);
});
test('a resent submit returns the same job, and its operation with another body conflicts',async()=>{
 const v=await venue(),op=randomUUID(),envelope=v.submit(jobText(),op);
 const first=await (await post(v,'translation-submit',envelope)).json();
 assert.deepEqual(await (await post(v,'translation-submit',envelope)).json(),first);
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText([item('product:2')]),op))),[409,'conflict']);
 assert.equal(await jobCount(v),1);
});
test('a changed byte of the body or a wrong length is an invalid proof and creates nothing',async()=>{
 const v=await venue(),text=jobText(),good=v.submit(text);
 assert.deepEqual(await error(await post(v,'translation-submit',{...good,body:text.replace('CAFE','CAFF')})),[401,'invalid_proof']);
 const {jobSha256,jobBytes}=jobFingerprint(text);
 const wrong=v.proof('translation-submit',undefined,randomUUID(),v.lease,JSON.stringify({version:1,jobSha256,jobBytes:jobBytes+1}));
 assert.deepEqual(await error(await post(v,'translation-submit',{...wrong,body:text})),[401,'invalid_proof']);
 assert.equal(await jobCount(v),0);
});
test('a proof signed 61 seconds ago is refused',async()=>{
 const v=await venue();
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText(),randomUUID(),Date.now()-61000))),[401,'invalid_proof']);
});
test('an expired lease is refused',async()=>{
 const v=await venue(),now=Date.now(),text=jobText();
 const lease=issuer.issue({origin,leaseId:randomUUID(),installationId:v.installationId,venueId:v.venueId,environment:'test',publicKey:v.installationKey,issuedAt:now-3600000,expiresAt:now-1});
 const envelope=v.proof('translation-submit',undefined,randomUUID(),lease,JSON.stringify({version:1,...jobFingerprint(text)}));
 assert.deepEqual(await error(await post(v,'translation-submit',{...envelope,body:text})),[401,'invalid_proof']);
});
test('a browser origin, a service that is not ready and a revoked installation are each refused with 403',async()=>{
 const v=await venue();
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText()),{origin})),[403,'forbidden']);
 await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1 AND service='content_translation'",[v.installationId]);
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText()))),[403,'permission_denied']);
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[v.installationId]);
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText()))),[403,'revoked']);
});
test("another installation's job is not found on status, collect and release",async()=>{
 const a=await venue(),b=await venue();
 const {jobId}=(await (await post(a,'translation-submit',a.submit(jobText()))).json()) as {jobId:string};
 for(const action of ['translation-status','translation-collect','translation-release'])
  assert.deepEqual(await error(await post(b,action,reference(b,action,jobId))),[404,'translation_job_not_found']);
});
test('a second submit while one is queued is refused',async()=>{
 const v=await venue();assert.equal((await post(v,'translation-submit',v.submit(jobText()))).status,200);
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText([item('product:2')])))),[409,'translation_job_running']);
});
test('the cap refusal carries exactly how many items fit, with the usual security headers',async()=>{
 const v=await venue();
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,provider,model,prompt_version,cost_micro_usd,finished_at)
  VALUES($1,$2,$3,$4,$5,1,'collected',1,'openai','gpt-6-luna','translate-all-v1',4999000,clock_timestamp())`,[randomUUID(),v.installationId,v.venueId,randomUUID(),'b'.repeat(64)]);
 const response=await post(v,'translation-submit',v.submit(jobText(Array.from({length:7},(_,i)=>item(`product:${i}`)))));
 assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'translation_limit_reached',fits:6});
 for(const [name,value] of [['cache-control','no-store'],['x-content-type-options','nosniff'],['referrer-policy','no-referrer']] as const)assert.equal(response.headers.get(name),value,name);
});
test('a job field that breaks a rule is an invalid request',async()=>{
 const v=await venue();
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText([item('product:1',{kind:'dish'})])))),[400,'invalid_request']);
});
test('with translation off all four routes answer 503, and turning it on needs a lease issuer',async()=>{
 const off=createAccountApp({pool:db.pool,outbox:db.outbox,leaseIssuer:issuer,config:config()}),v=await venue();
 for(const action of ['translation-submit','translation-status','translation-collect','translation-release'])
  assert.deepEqual(await error(await post(v,action,{},{},off)),[503,'temporarily_unavailable']);
 assert.throws(()=>createAccountApp({translation:true,pool:db.pool,outbox:db.outbox,config:config()}),/translation\.installation_issuer_required/);
});
test('the outer request: other keys are an invalid envelope, a non-object is the reader’s 400 and another type its 415',async()=>{
 const v=await venue(),good=v.submit(jobText());
 for(const body of [{payload:good.payload,signature:good.signature},{...good,extra:'x'},{...good,body:5}])
  assert.deepEqual(await error(await post(v,'translation-submit',body)),[401,'invalid_proof'],JSON.stringify(Object.keys(body)));
 assert.deepEqual(await error(await post(v,'translation-status',{...reference(v,'translation-status',randomUUID()),body:'x'})),[401,'invalid_proof']);
 assert.deepEqual(await error(await post(v,'translation-submit',JSON.stringify([good]))),[400,'invalid_input']);
 assert.deepEqual(await error(await post(v,'translation-submit',JSON.stringify(good),{'content-type':'text/plain'})),[415,'invalid_input']);
});
test('a context head counts for nothing in total, and one that heads nothing is refused',async()=>{
 const v=await venue(),head=item('product:640',{missing:[],existing:{ca:'Canya',es:'Caña',en:'Half pint'}});
 const variant=item('variant:812',{kind:'variant',family:'product:640',existing:{en:'Pint'},missing:['ca','es']});
 assert.equal(((await (await post(v,'translation-submit',v.submit(jobText([head,variant])))).json()) as {total:number}).total,1);
 const w=await venue();
 assert.deepEqual(await error(await post(w,'translation-submit',w.submit(jobText([item('product:9',{missing:[],existing:{ca:'a',es:'b',en:'c'}}),item('product:10')])))),[400,'invalid_request']);
});

test('machine routes refuse GET, forged or crossed authority, and unknown paths',async()=>{
 const v=await venue(),w=await venue(),text=jobText(),good=v.submit(text);
 for(const action of ['translation-submit','translation-status','translation-collect','translation-release']){
  const response=await app.request(`${origin}/api/installations/${action}`,{method:'GET'},{incoming:{socket:{remoteAddress:v.ip}}} as HttpBindings);
  assert.deepEqual(await error(response),[405,'method_not_allowed']);
 }
 for(const envelope of [{...good,signature:'A'.repeat(86)},
  {...v.proof('translation-status',{},randomUUID(),v.lease),body:text},
  {...v.proof('translation-submit',{},randomUUID(),w.lease,JSON.stringify({version:1,...jobFingerprint(text)})),body:text},
  {...v.proof('translation-submit'),body:text}])
  assert.deepEqual(await error(await post(v,'translation-submit',envelope)),[401,'invalid_proof']);
 assert.equal(await jobCount(v),0);
 assert.deepEqual(await error(await post(v,'translation-unknown',{})),[404,'not_found']);
});
test('retry precedes entitlement and spending refusals at the HTTP boundary',async()=>{
 const v=await venue(),envelope=v.submit(jobText()),first=await post(v,'translation-submit',envelope);
 assert.equal(first.status,200);const accepted=await first.json();
 await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1 AND service='content_translation'",[v.installationId]);
 assert.deepEqual(await (await post(v,'translation-submit',envelope)).json(),accepted);
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText()))),[403,'permission_denied']);
 assert.equal(await jobCount(v),1);
});
test('queued and failed jobs cannot collect, failed jobs can release, and expiry refuses release',async()=>{
 const v=await venue(),submitted=await post(v,'translation-submit',v.submit(jobText()));assert.equal(submitted.status,200);
 const {jobId}=await submitted.json() as {jobId:string};
 for(const action of ['translation-collect','translation-release'])assert.deepEqual(await error(await post(v,action,reference(v,action,jobId))),[409,'translation_not_ready']);
 await db.pool.query("UPDATE translation_jobs SET state='failed',reason='provider_unavailable',finished_at=clock_timestamp() WHERE id=$1",[jobId]);
 assert.deepEqual(await error(await post(v,'translation-collect',reference(v,'translation-collect',jobId))),[409,'translation_not_ready']);
 const released={version:1,jobId,state:'collected'};
 for(let i=0;i<2;i++)assert.deepEqual(await (await post(v,'translation-release',reference(v,'translation-release',jobId))).json(),released);
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies WHERE job_id=$1',[jobId])).rows[0].n,0);
 await db.pool.query("UPDATE translation_jobs SET state='expired' WHERE id=$1",[jobId]);
 assert.deepEqual(await error(await post(v,'translation-release',reference(v,'translation-release',jobId))),[410,'translation_expired']);
});
test('all routes enforce existing address and installation request allowances',async()=>{
 const v=await venue(),proof=reference(v,'translation-status',randomUUID());
 // A valid signature spends the installation allowance even when its job does not exist.
 for(let i=0;i<30;i++)assert.deepEqual(await error(await post(v,'translation-status',proof)),[404,'translation_job_not_found']);
 const blocked=await post(v,'translation-status',proof);assert.deepEqual(await error(blocked),[429,'rate_limited']);assert(Number(blocked.headers.get('retry-after'))>0);
 const w=await venue();for(let i=0;i<60;i++)assert.deepEqual(await error(await post(w,'translation-status',{})),[401,'invalid_proof']);
 assert.deepEqual(await error(await post(w,'translation-status',{})),[429,'rate_limited']);
});
test('the existing reader bounds declared and streamed bytes, encoding and malformed JSON',async()=>{
 const v=await venue();
 const cases:Record<string,string>[]=[{'content-length':'16385'},{}, {'content-encoding':'gzip'}];
 for(const headers of cases){
  const response=await post(v,'translation-submit','x'.repeat(16385),headers);
  assert.deepEqual(await error(response),[headers['content-encoding']?415:413,'invalid_input']);
  assert.equal(response.headers.get('cache-control'),'no-store');
 }
 assert.deepEqual(await error(await post(v,'translation-submit','{')),[400,'invalid_input']);
 assert.equal(await jobCount(v),0);
});

test('forged proofs cannot spend a real installation request allowance',async()=>{
 const v=await venue(),signed=reference(v,'translation-status',randomUUID()),forged={...signed,signature:'A'.repeat(86)};
 for(let i=0;i<30;i++)assert.deepEqual(await error(await post(v,'translation-status',forged)),[401,'invalid_proof']);
 assert.deepEqual(await error(await post(v,'translation-status',signed)),[404,'translation_job_not_found']);
});

test('non-string unsigned bodies are refused before spending the installation allowance',async()=>{
 const v=await venue(),signed=v.submit(jobText());
 for(let i=0;i<30;i++)assert.deepEqual(await error(await post(v,'translation-submit',{...signed,body:5})),[401,'invalid_proof']);
 assert.equal((await post(v,'translation-submit',signed)).status,200);assert.equal(await jobCount(v),1);
});
