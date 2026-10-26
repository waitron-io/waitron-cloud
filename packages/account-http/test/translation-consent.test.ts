import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {HttpBindings} from '@hono/node-server';
import {createSession,endSession,type SessionCredentials} from '@waitron-cloud/identity';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {connectedVenue,database,readyForTranslation} from '../../translation/test/fixtures.ts';
const origin='https://cloud.example.test',path='/api/account/translation-consent';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,addresses=0;
before(async()=>{db=await database();app=createAccountApp({translation:true,leaseIssuer:issuer,pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});});
after(async()=>db?.close());
const bindings=()=>({incoming:{socket:{remoteAddress:`192.0.${Math.floor(++addresses/250)}.${addresses%250+1}`}}}) as HttpBindings;
async function owner(){
 const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);
 return {v,session:await transaction(db.pool,c=>createSession(c,v.accountId))};
}
async function consent(session:SessionCredentials,body?:unknown,headers:Record<string,string>={},method=body===undefined?'GET':'POST'){
 return app.request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken,...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)})},bindings());
}
const agree=(venueId:string)=>({venueId,choice:'agree',consentVersion:'providers-2026-10-14'});
const rows=async(venueId:string)=>(await db.pool.query('SELECT account_id,consent_version,providers,consented_at,withdrawn_at FROM translation_consents WHERE venue_id=$1 ORDER BY consented_at',[venueId])).rows;
async function status(response:Response,expected:number,error?:string){
 assert.equal(response.status,expected);
 if(error)assert.deepEqual(await response.json(),{error});
}
async function waitForLock(query:string){
 for(let n=0;n<150;n++){
  if((await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[db.schema,query])).rowCount)return;
  await delay(10);
 }
 assert.fail('request did not reach the expected database lock');
}
// Catches missing dispatch, wrong account binding, lost history and accidental session renewal.
test('an owner lists, agrees and withdraws without renewing the session',async()=>{
 const {v,session}=await owner(),other=await owner();
 const before=(await db.pool.query('SELECT last_seen_at FROM cloud_sessions WHERE account_id=$1',[v.accountId])).rows;
 assert.deepEqual(await (await consent(session)).json(),{consents:[{venueId:v.venueId,consented:false,consentedAt:null}]});
 const agreed=await consent(session,agree(v.venueId));await status(agreed,200);
 const view=await agreed.json() as {consents:{venueId:string;consented:boolean;consentedAt:string}[]};
 const saved=await rows(v.venueId);assert.equal(saved.length,1);
 assert.deepEqual(view,{consents:[{venueId:v.venueId,consented:true,consentedAt:saved[0]!.consented_at.toISOString()}]});
 assert.deepEqual([saved[0]!.account_id,saved[0]!.consent_version,saved[0]!.providers],[v.accountId,'providers-2026-10-14',['openai','anthropic','google']]);
 await status(await consent(session,agree(v.venueId)),200);assert.equal((await rows(v.venueId)).length,1);
 assert.deepEqual(await (await consent(session,{venueId:v.venueId,choice:'withdraw'})).json(),{consents:[{venueId:v.venueId,consented:false,consentedAt:null}]});
 assert.ok((await rows(v.venueId))[0]!.withdrawn_at);
 assert.deepEqual(await (await consent(other.session)).json(),{consents:[{venueId:other.v.venueId,consented:false,consentedAt:null}]});
 assert.deepEqual((await db.pool.query('SELECT last_seen_at FROM cloud_sessions WHERE account_id=$1',[v.accountId])).rows,before);
});
test('reads require a live session but do not require browser write proof',async()=>{
 const {v,session}=await owner();
 await status(await consent(session,undefined,{cookie:''}),401,'unauthenticated');
 await status(await consent(session,undefined,{cookie:'__Host-cloud_session=wrong'}),401,'unauthenticated');
 const response=await consent(session,undefined,{origin:'','x-csrf-token':''});await status(response,200);
 assert.deepEqual(await response.json(),{consents:[{venueId:v.venueId,consented:false,consentedAt:null}]});
});
test('both agreement and withdrawal require the portal origin and session CSRF token',async()=>{
 const {v,session}=await owner();
 for(const body of [agree(v.venueId),{venueId:v.venueId,choice:'withdraw'}]){
  for(const headers of ([{origin:'https://elsewhere.test'},{origin:''},{'x-csrf-token':'wrong'},{'x-csrf-token':''},{'x-csrf-token':(await owner()).session.csrfToken}] as Record<string,string>[]))
   await status(await consent(session,body,headers),403,'forbidden');
 }
 assert.equal((await rows(v.venueId)).length,0);
});
test('unsupported methods and query strings cannot mutate consent',async()=>{
 const {v,session}=await owner();
 for(const method of ['PUT','PATCH','DELETE'])await status(await consent(session,agree(v.venueId),{},method),405,'method_not_allowed');
 await status(await app.request(origin+path+'?venueId='+v.venueId,{headers:{cookie:'__Host-cloud_session='+session.token}},bindings()),400,'invalid_input');
 assert.equal((await rows(v.venueId)).length,0);
});
test('a non-owner cannot list, agree or withdraw and another owner cannot cross organisations',async()=>{
 const {v,session}=await owner(),member=randomUUID(),other=await owner();
 await status(await consent(session,agree(v.venueId)),200);
 await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[member]);
 await db.pool.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[member,`member-${member}@example.test`]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,false,false)',[member,v.organisationId]);
 const memberSession=await transaction(db.pool,c=>createSession(c,member));
 assert.deepEqual(await (await consent(memberSession)).json(),{consents:[]});
 for(const actor of [memberSession,other.session])for(const body of [agree(v.venueId),{venueId:v.venueId,choice:'withdraw'}])await status(await consent(actor,body),403,'permission_denied');
 const saved=await rows(v.venueId);assert.equal(saved.length,1);assert.equal(saved[0]!.withdrawn_at,null);
});
test('all owned venues are returned, including those without installations',async()=>{
 const {v,session}=await owner(),extra=randomUUID();
 await db.pool.query('INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,$5)',[extra,v.organisationId,v.legalBusinessId,randomUUID(),'test']);
 const expected=[v.venueId,extra].sort().map(venueId=>({venueId,consented:false,consentedAt:null}));
 assert.deepEqual(await (await consent(session)).json(),{consents:expected});
 await status(await consent(session,agree(extra)),200);assert.equal((await rows(extra)).length,1);
});
test('an unverified owner sees no consents and cannot change them',async()=>{
 const {v,session}=await owner();
 await db.pool.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[v.accountId]);
 assert.deepEqual(await (await consent(session)).json(),{consents:[]});
 for(const body of [agree(v.venueId),{venueId:v.venueId,choice:'withdraw'}])await status(await consent(session,body),403,'permission_denied');
 assert.equal((await rows(v.venueId)).length,0);
});
test('disabled and ended accounts cannot read or change consent',async()=>{
 for(const change of ['disabled','ended']){
  const {v,session}=await owner();
  if(change==='disabled')await db.pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[v.accountId]);
  else await transaction(db.pool,c=>endSession(c,session.token));
  await status(await consent(session),401,'unauthenticated');await status(await consent(session,agree(v.venueId)),401,'unauthenticated');
  assert.equal((await rows(v.venueId)).length,0);
 }
});
test('an unknown field, invalid choice, missing or stray version and invalid venue are refused',async()=>{
 const {v,session}=await owner();
 const bodies=[{...agree(v.venueId),accountId:'x'},{...agree(v.venueId),organisationId:v.organisationId},{...agree(v.venueId),providers:['openai']},
  {...agree(v.venueId),choice:'maybe'},{venueId:v.venueId,choice:'agree'},{venueId:v.venueId,choice:'withdraw',consentVersion:'providers-2026-10-14'},
  {...agree(v.venueId),consentVersion:'providers-2026-01-01'},agree('not-a-venue'),{...agree(v.venueId),venueId:42},{...agree(v.venueId),consentVersion:null},[],null];
 for(const body of bodies)await status(await consent(session,body),400,'invalid_input');
 await status(await consent(session,agree(randomUUID())),403,'permission_denied');
 assert.equal((await rows(v.venueId)).length,0);
});
test('the account body retains the small reader and JSON encoding limits',async()=>{
 const {v,session}=await owner();
 await status(await consent(session,agree(v.venueId),{'content-type':'text/plain'}),415,'invalid_input');
 await status(await consent(session,agree(v.venueId),{'content-encoding':'gzip'}),415,'invalid_input');
 await status(await consent(session,agree(v.venueId),{'content-length':'16385'}),413,'invalid_input');
 await status(await consent(session,{...agree(v.venueId),extra:'x'.repeat(16384)}),413,'invalid_input');
 assert.equal((await rows(v.venueId)).length,0);
});
test('reads and writes share thirty requests per account, independent of the caller address',async()=>{
 const {v,session}=await owner();
 for(let n=0;n<30;n++)await status(await consent(session,n%2?{venueId:v.venueId,choice:'withdraw'}:undefined),200);
 const limited=await consent(session,agree(v.venueId));await status(limited,429,'rate_limited');
 assert.ok(Number(limited.headers.get('retry-after'))>0);assert.equal((await rows(v.venueId)).length,0);
 await status(await consent((await owner()).session),200);
 await status(await app.request(origin+'/api/account/alerts',{headers:{cookie:'__Host-cloud_session='+session.token}},bindings()),200);
});
test('invalid browser proof consumes no account allowance',async()=>{
 const {v,session}=await owner();
 for(let n=0;n<30;n++)await status(await consent(session,agree(v.venueId),{'x-csrf-token':'wrong'}),403,'forbidden');
 await status(await consent(session,agree(v.venueId)),200);assert.equal((await rows(v.venueId)).length,1);
});
test('consent management remains available while the machine feature is off',async()=>{
 const {v,session}=await owner();
 const disabled=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
 const response=await disabled.request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken},body:JSON.stringify(agree(v.venueId))},bindings());
 await status(response,200);assert.equal((await rows(v.venueId)).length,1);
});
test('a session ended while its body is read cannot authorise the later write',async()=>{
 const {v,session}=await owner();let reading!:()=>void,finish!:(value:Uint8Array)=>void;
 const read=new Promise<void>(resolve=>{reading=resolve;});
 const body=new ReadableStream<Uint8Array>({pull(controller){reading();return new Promise<void>(resolve=>{finish=value=>{controller.enqueue(value);controller.close();resolve();};});}},{highWaterMark:0});
 const pending=Promise.resolve(app.request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken},body,duplex:'half'} as RequestInit,bindings()));
 await Promise.race([read,pending.then(response=>assert.fail(`response ${response.status} before reading body`))]);
 await transaction(db.pool,c=>endSession(c,session.token));
 const block=await db.secondPool.connect();let response:Response|undefined,waited=false;
 await block.query('BEGIN');
 try{
  await block.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-consent:'||$1,0))",[v.venueId]);
  void pending.then(value=>{response=value;});finish(new TextEncoder().encode(JSON.stringify(agree(v.venueId))));
  for(let n=0;n<150&&!response;n++){
   if((await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[db.schema,"SELECT pg_advisory_xact_lock(hashtextextended('translation-consent:%"])).rowCount){waited=true;break;}
   await delay(10);
  }
 }finally{await block.query('COMMIT');block.release();}
 const refused=await pending;assert.equal(waited,false,'an ended session must be refused before waiting on consent');
 await status(refused,401,'unauthenticated');assert.equal((await rows(v.venueId)).length,0);
});
for(const choice of ['agree','withdraw'] as const)test(`session expiry during a blocked ${choice} rolls back the entire change`,async()=>{
 const {v,session}=await owner();
 if(choice==='withdraw')await status(await consent(session,agree(v.venueId)),200);
 const before=await rows(v.venueId),block=await db.secondPool.connect();let pending:Promise<Response>|undefined;
 await block.query('BEGIN');
 try{
  await block.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-consent:'||$1,0))",[v.venueId]);
  const hash=createHash('sha256').update(session.token).digest('hex');
  const expiry=(await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '1 second' WHERE token_hash=$1 RETURNING absolute_expires_at",[hash])).rows[0]!.absolute_expires_at as Date;
  pending=consent(session,choice==='agree'?agree(v.venueId):{venueId:v.venueId,choice});
  await waitForLock("SELECT pg_advisory_xact_lock(hashtextextended('translation-consent:%");
  while(!(await db.secondPool.query('SELECT clock_timestamp()>=$1 AS expired',[expiry])).rows[0]!.expired)await delay(20);
 }finally{await block.query('COMMIT');block.release();}
 assert.ok(pending);await status(await pending,401,'session_expired');assert.deepEqual(await rows(v.venueId),before);
});
test('a machine submit is refused until an owner agrees, then withdrawal blocks the next job',async()=>{
 const {v,session}=await owner();
 const text=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR',staffName:'CAFE',existing:{},missing:['ca','es']}],houseStyle:[]});
 const submit=()=>app.request(origin+'/api/installations/translation-submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v.submit(text))},bindings());
 await status(await submit(),403,'translation_consent_required');
 await status(await consent(session,agree(v.venueId)),200);await status(await submit(),200);
 await status(await consent(session,{venueId:v.venueId,choice:'withdraw'}),200);
 await status(await submit(),403,'translation_consent_required');
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_jobs WHERE venue_id=$1',[v.venueId])).rows[0]!.n,1);
});
