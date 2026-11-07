import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createSession,type SessionCredentials} from '@waitron-cloud/identity';
import {AllowanceConfigStore,reserveAllowance,BillingStore,transaction} from '@waitron-cloud/registration';
import {database} from '../../translation/test/fixtures.ts';
import {createAccountApp} from '../src/app.ts';
import type {MethodSetup} from '../src/billing-method-binding.ts';
import type {StartedMethod,MethodVerification} from '../src/billing-method-providers.ts';

const origin='https://cloud.example.test',start='/api/account/billing/method/start',verify='/api/account/billing/method/verify';
let db:Awaited<ReturnType<typeof database>>,addresses=0;
before(async()=>{db=await database();});after(async()=>db?.close());
async function owner(){
 const accountId=randomUUID(),organisationId=randomUUID(),legalBusinessId=randomUUID(),venueId=randomUUID();
 const session=await transaction(db.pool,async client=>{
  await client.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
  await client.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[accountId,`methods-${accountId}@example.invalid`]);
  await client.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);
  await client.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[legalBusinessId,organisationId]);
  await client.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true)',[accountId,organisationId]);
  await client.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[venueId,organisationId,legalBusinessId]);
  return createSession(client,accountId);
 });
 return {accountId,organisationId,legalBusinessId,venueId,session};
}
function provider(){
 const calls:MethodSetup[]=[];
 let pause:undefined|(()=>Promise<void>),result:MethodVerification|undefined;
 return {calls,setPause:(fn:()=>Promise<void>)=>{pause=fn;},setResult:(value:MethodVerification)=>{result=value;},client:{
  async start(setup:MethodSetup,authorize?:()=>Promise<void>):Promise<StartedMethod>{
   await authorize?.();calls.push(setup);await pause?.();
   return {customerId:'customer_'+setup.id,providerReference:'checkout_'+setup.id,presentation:setup.kind==='card'?{checkoutId:'checkout_'+setup.id}:{url:'https://checkout.stripe.com/c/pay/test'}};
  },
  async verify(setup:MethodSetup,authorize?:()=>Promise<void>):Promise<MethodVerification>{
   await authorize?.();calls.push(setup);await pause?.();return result??{state:'verified',methodId:'token_'+setup.id,mandateId:setup.kind==='card'?null:'mandate_'+setup.id};
  },
 }};
}
function app(f:Awaited<ReturnType<typeof owner>>,p=provider(),enabled=true){
 return createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},
  planMode:'test-venue-levels',billingAccount:{accountIds:[f.accountId]},...(enabled?{billingMethods:{stripeAccount:'stripe-test:acct_synthetic',sumupAccount:'sumup-sandbox:MSYNTHETIC',client:p.client}}:{})});
}
function request(target:ReturnType<typeof app>,session:SessionCredentials,path:string,body:unknown,headers:Record<string,string>={}){
 return target.request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken,...headers},body:JSON.stringify(body)},
  {incoming:{socket:{remoteAddress:`192.0.${Math.floor(++addresses/250)}.${addresses%250+1}`}}} as HttpBindings);
}
function gate(){let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(r=>entered=r),done=new Promise<void>(r=>release=r);return {waiting,release,pause:async()=>{entered();await done;}};}
async function current(f:Awaited<ReturnType<typeof owner>>){return new BillingStore(db.pool).business({organisationId:f.organisationId,legalBusinessId:f.legalBusinessId});}

test('sandbox method routes are off unless explicitly configured',async()=>{
 const f=await owner(),p=provider();
 const response=await request(app(f,p,false),f.session,start,{venueId:f.venueId,kind:'card'});
 assert.equal(response.status,503);assert.equal(p.calls.length,0);
});

test('a test account adds and switches both methods while preserving billing dates and the old method until verified',async()=>{
 const f=await owner(),p=provider(),target=app(f,p);
 await new BillingStore(db.pool).execute({organisationId:f.organisationId,legalBusinessId:f.legalBusinessId},
  {key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}},{type:'ensure_business'});
 for(const kind of ['card','direct_debit','card'] as const){
  const old=(await current(f)).paymentMethod;
  const response=await request(target,f.session,start,{venueId:f.venueId,kind});assert.equal(response.status,200);
  const data=await response.json(),setup=p.calls.at(-1)!;
  assert.deepEqual(data,kind==='card'?{checkoutId:'checkout_'+setup.id}:{url:'https://checkout.stripe.com/c/pay/test'});
  assert.equal(setup.ownerId,f.accountId);assert.equal(setup.legalBusinessId,f.legalBusinessId);
  assert.equal(setup.providerAccountId,kind==='card'?'sumup-sandbox:MSYNTHETIC':'stripe-test:acct_synthetic');
  assert.deepEqual((await current(f)).paymentMethod,old);
  p.setResult({state:'pending'});assert.deepEqual(await (await request(target,f.session,verify,{venueId:f.venueId})).json(),{state:'pending'});
  assert.deepEqual((await current(f)).paymentMethod,old);
  p.setResult({state:'failed'});assert.deepEqual(await (await request(target,f.session,verify,{venueId:f.venueId})).json(),{state:'failed'});
  assert.deepEqual((await current(f)).paymentMethod,old);
  p.setResult({state:'verified',methodId:'token_'+setup.id,mandateId:kind==='card'?null:'mandate_'+setup.id});
  const verified=await request(target,f.session,verify,{venueId:f.venueId});assert.equal(verified.status,200);assert.deepEqual(await verified.json(),{state:'verified'});
  const business=await current(f);assert.equal(business.paymentMethod?.id,setup.methodId);assert.equal(business.paymentMethod?.kind,kind);
  assert.equal(business.anchorDate,null);assert.equal(business.anchorDay,null);
  const count=p.calls.length;assert.deepEqual(await (await request(target,f.session,verify,{venueId:f.venueId})).json(),{state:'verified'});assert.equal(p.calls.length,count);
 }
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM billing_paid_periods WHERE organisation_id=$1',[f.organisationId])).rows[0].n,0);
});

test('method routes reject caller-supplied provider references and malformed kinds before dispatch',async()=>{
 const f=await owner(),p=provider(),target=app(f,p);
 for(const [path,body]of [[start,{venueId:f.venueId,kind:'card',checkoutId:'forged'}],[start,{venueId:f.venueId,kind:'live'}],[verify,{venueId:f.venueId,providerReference:'forged'}],[verify,{venueId:'not-a-uuid'}]]){
  assert.equal((await request(target,f.session,path as string,body)).status,400);
 }
 assert.equal(p.calls.length,0);
});

test('method routes require browser proof verified ownership and a test venue before dispatch',async()=>{
 const f=await owner(),other=await owner(),p=provider(),target=app(f,p);
 for(const headers of [{origin:'https://elsewhere.test'},{'x-csrf-token':'wrong'}] as Record<string,string>[])
  assert.equal((await request(target,f.session,start,{venueId:f.venueId,kind:'card'},headers)).status,403);
 assert.equal((await request(target,other.session,start,{venueId:other.venueId,kind:'card'})).status,403);
 assert.equal((await request(target,f.session,start,{venueId:other.venueId,kind:'card'})).status,403);
 await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[f.venueId]);
 assert.equal((await request(target,f.session,start,{venueId:f.venueId,kind:'card'})).status,403);
 await db.pool.query("UPDATE venues SET environment='test' WHERE id=$1",[f.venueId]);
 await db.pool.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[f.accountId]);
 assert.equal((await request(target,f.session,start,{venueId:f.venueId,kind:'card'})).status,403);
 await db.pool.query('UPDATE cloud_credentials SET email_verified_at=clock_timestamp() WHERE account_id=$1',[f.accountId]);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.accountId]);
 assert.equal((await request(target,f.session,start,{venueId:f.venueId,kind:'card'})).status,403);
 assert.equal(p.calls.length,0);
});

test('owner revocation during provider start permits no presentation or bound provider response',async()=>{
 const f=await owner(),p=provider(),g=gate();p.setPause(g.pause);const target=app(f,p);
 const pending=request(target,f.session,start,{venueId:f.venueId,kind:'card'});
 try{await g.waiting;await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.accountId]);}
 finally{g.release();}
 const response=await pending;assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'permission_denied'});
 assert.deepEqual((await db.pool.query('SELECT customer_id,provider_reference FROM billing_method_setups WHERE organisation_id=$1',[f.organisationId])).rows,[{customer_id:null,provider_reference:null}]);
});

test('session expiry during provider verification prevents method selection',async()=>{
 const f=await owner(),p=provider(),target=app(f,p);
 assert.equal((await request(target,f.session,start,{venueId:f.venueId,kind:'card'})).status,200);
 const g=gate();p.setPause(g.pause);const pending=request(target,f.session,verify,{venueId:f.venueId});
 try{await g.waiting;await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1",[f.accountId]);}
 finally{g.release();}
 const response=await pending;assert.equal(response.status,401);assert.equal((await current(f)).paymentMethod,null);
});

test('a late verification cannot select a setup replaced by a later start',async()=>{
 const f=await owner(),p=provider(),target=app(f,p);
 await request(target,f.session,start,{venueId:f.venueId,kind:'card'});
 const g=gate();p.setPause(g.pause);const pending=request(target,f.session,verify,{venueId:f.venueId});
 try{await g.waiting;p.setPause(async()=>{});assert.equal((await request(target,f.session,start,{venueId:f.venueId,kind:'direct_debit'})).status,200);}
 finally{g.release();}
 assert.equal((await pending).status,409);assert.equal((await current(f)).paymentMethod,null);
});

test('method writes share the existing account billing request limit',async()=>{
 const f=await owner(),p=provider(),target=app(f,p);
 for(let i=0;i<30;i++)assert.equal((await request(target,f.session,'/api/account/billing/read',{})).status,200);
 const response=await request(target,f.session,start,{venueId:f.venueId,kind:'card'});assert.equal(response.status,429);assert.equal(p.calls.length,0);
});

test('billing read exposes method state without any provider customer token or checkout reference',async()=>{
 const f=await owner(),p=provider(),target=app(f,p);
 const read=async()=>{
  const response=await request(target,f.session,'/api/account/billing/read',{});assert.equal(response.status,200);
  return (await response.json()).venues[0].paymentMethods;
 };
 assert.deepEqual(await read(),{selected:null,setup:null});
 await request(target,f.session,start,{venueId:f.venueId,kind:'card'});
 assert.deepEqual(await read(),{selected:null,setup:{kind:'card',state:'pending'}});
 await request(target,f.session,verify,{venueId:f.venueId});
 assert.deepEqual(await read(),{selected:'card',setup:{kind:'card',state:'verified'}});
 await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[f.venueId]);
 assert.equal(await read(),undefined);
});

test('verification refuses a saved setup for a provider account no longer configured',async()=>{
 const f=await owner(),p=provider();
 await request(app(f,p),f.session,start,{venueId:f.venueId,kind:'card'});
 const count=p.calls.length,target=createAccountApp({pool:db.pool,outbox:db.outbox,
  config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},planMode:'test-venue-levels',billingAccount:{accountIds:[f.accountId]},
  billingMethods:{stripeAccount:'stripe-test:acct_synthetic',sumupAccount:'sumup-sandbox:MOTHER',client:p.client}});
 assert.equal((await request(target,f.session,verify,{venueId:f.venueId})).status,403);
 assert.equal(p.calls.length,count);assert.equal((await current(f)).paymentMethod,null);
});

test('a verified replacement owner can start a new setup without using the previous owner binding',async()=>{
 const f=await owner(),other=await owner(),p=provider();
 await request(app(f,p),f.session,start,{venueId:f.venueId,kind:'card'});
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1 AND organisation_id=$2',[f.accountId,f.organisationId]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[other.accountId,f.organisationId]);
 const replacement={...f,accountId:other.accountId,session:other.session},target=app(replacement,p);
 assert.equal((await request(target,other.session,verify,{venueId:f.venueId})).status,403);
 const response=await request(target,other.session,start,{venueId:f.venueId,kind:'card'});assert.equal(response.status,200);
 assert.equal(p.calls.at(-1)!.ownerId,other.accountId);
});

test('route verification unlocks the existing full trial allowance without refilling held units',async()=>{
 const f=await owner(),p=provider(),target=app(f,p),installationId=randomUUID();
 await new AllowanceConfigStore(db.pool).publish({revision:1,effectiveFrom:'2020-01-01',limits:{
  registered:{transactional_email:'2',address_lookup:'2',sms:'0',content_translation:'0',rota_solver:'0'},
  connected:{transactional_email:'4',address_lookup:'4',sms:'0',content_translation:'6',rota_solver:'4'},
  hosted:{transactional_email:'6',address_lookup:'6',sms:'0',content_translation:'8',rota_solver:'6'},
 },unpaidTrial:{content_translation:'2',rota_solver:'1'}});
 assert.equal((await request(target,f.session,'/api/account/billing/start-trial',{venueId:f.venueId})).status,200);
 await db.pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installationId,f.venueId,installationId]);
 const reserve=(units:bigint)=>transaction(db.pool,client=>reserveAllowance(client,{accountId:f.accountId,venueId:f.venueId,installationId,
  service:'content_translation',operationId:randomUUID(),binding:'synthetic-method-route',units}));
 assert.equal((await reserve(2n)).state,'held');
 await assert.rejects(reserve(1n),{code:'allowance_exhausted'});
 assert.equal((await request(target,f.session,start,{venueId:f.venueId,kind:'card'})).status,200);
 await assert.rejects(reserve(1n),{code:'allowance_exhausted'});
 assert.equal((await request(target,f.session,verify,{venueId:f.venueId})).status,200);
 assert.equal((await reserve(4n)).units,'4');
 assert.equal((await db.pool.query("SELECT sum(units)::text AS units FROM billing_allowance_reservations WHERE account_id=$1 AND state='held'",[f.accountId])).rows[0].units,'6');
});
