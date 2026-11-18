import {setRecoveryScope} from '../../registration/test/fixtures/recovery-scope.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {HttpBindings} from '@hono/node-server';
import {createSession,type SessionCredentials} from '@waitron-cloud/identity';
import {BillingPriceStore,BillingStore,transaction,type PlanMode} from '@waitron-cloud/registration';
import {database} from '../../translation/test/fixtures.ts';
import {createAccountApp} from '../src/app.ts';
import {startAccountServer} from '../src/server.ts';

const origin='https://cloud.example.test',readPath='/api/account/billing/read',startPath='/api/account/billing/start-trial';
let db:Awaited<ReturnType<typeof database>>,addresses=0;
before(async()=>{db=await database();});after(async()=>db?.close());
function app(accountIds?:readonly string[],planMode:PlanMode='test-venue-levels',testDb=db){
 return createAccountApp({pool:testDb.pool,outbox:testDb.outbox,config:{portalOrigin:origin,production:true,rateKey:testDb.rateKey,trustedProxyIps:[]},
  planMode,...(accountIds===undefined?{}:{billingAccount:{accountIds}})});
}
async function owner(testDb=db){
 const accountId=randomUUID(),organisationId=randomUUID(),legalBusinessId=randomUUID(),venueId=randomUUID();
 const session=await transaction(testDb.pool,async client=>{
  await client.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
  await client.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[accountId,`billing-${accountId}@example.test`]);
  await client.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);
  await client.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[legalBusinessId,organisationId]);
  await client.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true)',[accountId,organisationId]);
  await client.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",[venueId,organisationId,legalBusinessId]);
  return createSession(client,accountId);
 });
 return {accountId,organisationId,legalBusinessId,venueId,session};
}
async function request(target:ReturnType<typeof app>,session:SessionCredentials,path=readPath,body:unknown={},headers:Record<string,string>={},method='POST'){
 const bindings={incoming:{socket:{remoteAddress:`192.0.${Math.floor(++addresses/250)}.${addresses%250+1}`}}} as HttpBindings;
 return target.request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken,...headers},body:JSON.stringify(body)},bindings);
}
async function billingRows(organisationId:string){
 const result:Record<string,unknown>={};
 for(const table of ['billing_businesses','billing_events','billing_venues','billing_trials','billing_service_authority','billing_paid_periods','billing_payment_methods'])
  result[table]=(await db.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE organisation_id=$1 ORDER BY to_jsonb(t)::text`,[organisationId])).rows;
 return result;
}

test('billing chooser read lists a test venue without an installation or billing writes',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await billingRows(f.organisationId);
 const seen=(await db.pool.query('SELECT last_seen_at FROM cloud_sessions WHERE account_id=$1',[f.accountId])).rows;
 const response=await request(target,f.session);assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{venues:[{venueId:f.venueId,level:'registered',trial:null,canStartTrial:true,taxProfile:{legalName:null,address:null,taxNumber:null}}]});
 assert.deepEqual(await billingRows(f.organisationId),before);
 assert.deepEqual((await db.pool.query('SELECT last_seen_at FROM cloud_sessions WHERE account_id=$1',[f.accountId])).rows,seen);
});

test('billing chooser starts the existing Connected trial without an anchor payment or installation',async()=>{
 const f=await owner(),target=app([f.accountId]);
 const today=(await db.pool.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
 const end=new Date(today+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+30);
 const expected={venues:[{venueId:f.venueId,level:'connected',trial:{level:'connected',startedOn:today,endsOn:end.toISOString().slice(0,10),extended:false,state:'active'},canStartTrial:false,taxProfile:{legalName:null,address:null,taxNumber:null}}]};
 const response=await request(target,f.session,startPath,{venueId:f.venueId});assert.equal(response.status,200);
 assert.deepEqual(await response.json(),expected);
 assert.deepEqual(await (await request(target,f.session)).json(),expected);
 const business=(await db.pool.query('SELECT anchor_date,anchor_day,current_method_id FROM billing_businesses WHERE organisation_id=$1',[f.organisationId])).rows[0];
 assert.deepEqual(business,{anchor_date:null,anchor_day:null,current_method_id:null});
 assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM billing_paid_periods WHERE organisation_id=$1',[f.organisationId])).rows[0].count,0);
 assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM installations WHERE venue_id=$1',[f.venueId])).rows[0].count,0);
 const before=await billingRows(f.organisationId),again=await request(target,f.session,startPath,{venueId:f.venueId});
 assert.equal(again.status,409);assert.deepEqual(await again.json(),{error:'conflict',...expected});
 assert.deepEqual(await billingRows(f.organisationId),before);
});

test('billing chooser remains off without the synthetic account allowlist',async()=>{
 const f=await owner(),response=await request(app(),f.session);
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'temporarily_unavailable'});
});

test('billing chooser requires the existing test venue mode when configured',async()=>{
 const f=await owner();assert.throws(()=>app([f.accountId],'existing'),/billing_account.test_mode_required/);
});

test('billing chooser requires owner browser proof and the synthetic account allowlist',async()=>{
 const f=await owner(),target=app([f.accountId]);
 for(const path of [readPath,startPath]){
  const body=path===readPath?{}:{venueId:f.venueId};
  for(const headers of ([{origin:'https://elsewhere.test'},{'x-csrf-token':'wrong'}] as Record<string,string>[])){
   const response=await request(target,f.session,path,body,headers);assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'forbidden'});
  }
  const response=await request(app([randomUUID()]),f.session,path,body);assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'permission_denied'});
 }
 assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM billing_trials WHERE organisation_id=$1',[f.organisationId])).rows[0].count,0);
});

test('billing chooser refuses foreign and production trial requests without effects',async()=>{
 const f=await owner(),other=await owner(),target=app([f.accountId]),before=await billingRows(f.organisationId);
 const foreign=await request(target,f.session,startPath,{venueId:other.venueId});assert.equal(foreign.status,403);assert.deepEqual(await foreign.json(),{error:'permission_denied'});
 await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[f.venueId]);
 const read=await request(target,f.session);assert.equal(read.status,200);
 assert.deepEqual(await read.json(),{venues:[{venueId:f.venueId,level:'registered',trial:null,canStartTrial:false}]});
 const production=await request(target,f.session,startPath,{venueId:f.venueId});assert.equal(production.status,403);assert.deepEqual(await production.json(),{error:'permission_denied'});
 assert.deepEqual(await billingRows(f.organisationId),before);
});

test('billing chooser refuses unverified credentials and removed owner membership',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await billingRows(f.organisationId);
 await db.pool.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[f.accountId]);
 for(const path of [readPath,startPath])assert.equal((await request(target,f.session,path,path===readPath?{}:{venueId:f.venueId})).status,403);
 await db.pool.query('UPDATE cloud_credentials SET email_verified_at=clock_timestamp() WHERE account_id=$1',[f.accountId]);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.accountId]);
 const response=await request(target,f.session,startPath,{venueId:f.venueId});assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'permission_denied'});
 assert.deepEqual(await billingRows(f.organisationId),before);
});

async function waitForBillingLock(part:string){
 for(let n=0;n<500;n++){
  if((await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[db.schema,'%'+part+'%'])).rowCount)return;
  await delay(10);
 }
 assert.fail('billing request did not reach the expected database lock');
}

test('billing trial rolls back if its session expires while waiting for the business lock',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await billingRows(f.organisationId),blocker=await db.secondPool.connect();
 const expiry=(await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '4 seconds' WHERE account_id=$1 RETURNING absolute_expires_at",[f.accountId])).rows[0].absolute_expires_at;
 let pending:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM legal_businesses WHERE id=$1 FOR UPDATE',[f.legalBusinessId]);
  pending=request(target,f.session,startPath,{venueId:f.venueId});await waitForBillingLock('FROM legal_businesses');
  for(;;){if((await db.secondPool.query('SELECT clock_timestamp()>=$1::timestamptz AS expired',[expiry])).rows[0].expired)break;await delay(20);}
  await blocker.query('COMMIT');
  const response=await pending;assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'session_expired'});
  assert.deepEqual(await billingRows(f.organisationId),before);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('billing trial rechecks owner membership after its row lock wait',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await billingRows(f.organisationId),blocker=await db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT account_id FROM organisation_memberships WHERE account_id=$1 FOR UPDATE',[f.accountId]);
  pending=request(target,f.session,startPath,{venueId:f.venueId});await waitForBillingLock('FROM organisation_memberships');
  await blocker.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.accountId]);await blocker.query('COMMIT');
  const response=await pending;assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'permission_denied'});
  assert.deepEqual(await billingRows(f.organisationId),before);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('billing trial refuses a venue moved to another business during its parent lock wait',async()=>{
 const f=await owner(),target=app([f.accountId]),otherBusiness=randomUUID(),before=await billingRows(f.organisationId),blocker=await db.secondPool.connect();let pending:Promise<Response>|undefined;
 await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[otherBusiness,f.organisationId]);
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM legal_businesses WHERE id=$1 FOR UPDATE',[f.legalBusinessId]);
  pending=request(target,f.session,startPath,{venueId:f.venueId});await waitForBillingLock('FROM legal_businesses');
  await blocker.query('UPDATE venues SET legal_business_id=$1 WHERE id=$2',[otherBusiness,f.venueId]);await blocker.query('COMMIT');
  const response=await pending;assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'permission_denied'});
  assert.deepEqual(await billingRows(f.organisationId),before);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('billing chooser serializes concurrent trial starts and creates one trial',async()=>{
 const f=await owner(),target=app([f.accountId]);
 const responses=await Promise.all([request(target,f.session,startPath,{venueId:f.venueId}),request(target,f.session,startPath,{venueId:f.venueId})]);
 assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
 assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM billing_trials WHERE venue_id=$1',[f.venueId])).rows[0].count,1);
 assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM billing_events WHERE organisation_id=$1',[f.organisationId])).rows[0].count,2);
});

test('billing trial rolls back across the database UTC day boundary and returns a fresh view',async t=>{
 const f=await owner(),target=app([f.accountId]),before=await billingRows(f.organisationId);
 const connect=db.pool.connect.bind(db.pool);let dateReads=0;
 // Only the clock boundary is controlled; all writes, locks, commit and rollback use PostgreSQL.
 const clock=t.mock.method(db.pool,'connect',async()=>{
  const client=await connect(),query=client.query.bind(client);
  return new Proxy(client,{get(object,key){
   if(key==='query')return async(...args:Parameters<typeof client.query>)=>{
    const result=await (query as Function)(...args);
    if(args[0]==="SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day"&&++dateReads>=2){
     const day=new Date(result.rows[0].day+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+1);result.rows[0].day=day.toISOString().slice(0,10);
    }
    return result;
   };
   const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;
  }});
 });
 const response=await request(target,f.session,startPath,{venueId:f.venueId});clock.mock.restore();assert.equal(response.status,409);
 assert.deepEqual(await response.json(),{error:'conflict',venues:[{venueId:f.venueId,level:'registered',trial:null,canStartTrial:true,taxProfile:{legalName:null,address:null,taxNumber:null}}]});
 assert.deepEqual(await billingRows(f.organisationId),before);
});

test('billing chooser bounds bodies methods and request rates',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await billingRows(f.organisationId);
 assert.equal((await request(target,f.session,readPath,{}, {},'DELETE')).status,405);
 for(const body of [{unexpected:'field'},{venueId:'bad'},{venueId:f.venueId,level:'hosted'}])
  assert.equal((await request(target,f.session,startPath,body)).status,400);
 assert.equal((await request(target,f.session,startPath,{venueId:'x'.repeat(20000)})).status,413);
 let limited:Response|undefined;
 for(let i=0;i<31;i++){const response=await request(target,f.session);if(response.status===429){limited=response;break;}assert.equal(response.status,200);}
 assert.equal(limited?.status,429);assert.match(limited!.headers.get('retry-after')!,/^\d+$/);
 assert.deepEqual(await billingRows(f.organisationId),before);
});

test('billing chooser reads multiple businesses and expired trials without creating billing rows',async()=>{
 const f=await owner(),other=await owner(),target=app([f.accountId]);
 await db.pool.query('DELETE FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2',[other.accountId,other.organisationId]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[f.accountId,other.organisationId]);
 const scope={organisationId:f.organisationId,legalBusinessId:f.legalBusinessId},store=new BillingStore(db.pool);
 const event=()=>({key:randomUUID(),occurredAt:'2020-01-01T00:00:00.000Z',source:{kind:'internal' as const}});
 await store.execute(scope,event(),{type:'ensure_business'});
 await store.transition(scope,event(),{type:'start_trial',venueId:f.venueId,level:'connected',on:'2020-01-01'});
 const before=await billingRows(f.organisationId),response=await request(target,f.session);assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{venues:[{venueId:f.venueId,level:'registered',trial:null,canStartTrial:false,taxProfile:{legalName:null,address:null,taxNumber:null}},{venueId:other.venueId,level:'registered',trial:null,canStartTrial:true,taxProfile:{legalName:null,address:null,taxNumber:null}}].sort((a,b)=>a.venueId.localeCompare(b.venueId))});
 assert.deepEqual(await billingRows(f.organisationId),before);
});

test('billing trial refuses credentials withdrawn during their row lock wait',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await billingRows(f.organisationId),blocker=await db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT account_id FROM cloud_credentials WHERE account_id=$1 FOR UPDATE',[f.accountId]);
  pending=request(target,f.session,startPath,{venueId:f.venueId});await waitForBillingLock('FROM cloud_credentials');
  await blocker.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[f.accountId]);await blocker.query('COMMIT');
  const response=await pending;assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'permission_denied'});
  assert.deepEqual(await billingRows(f.organisationId),before);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('billing trial refuses a session ended during its row lock wait',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await billingRows(f.organisationId),blocker=await db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT account_id FROM cloud_sessions WHERE account_id=$1 FOR UPDATE',[f.accountId]);
  pending=request(target,f.session,startPath,{venueId:f.venueId});await waitForBillingLock('ended_at IS NULL FOR UPDATE');
  await blocker.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1',[f.accountId]);await blocker.query('COMMIT');
  const response=await pending;assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'unauthenticated'});
  assert.deepEqual(await billingRows(f.organisationId),before);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('account server forwards trial configuration without outbound requests or changed security policy',async t=>{
 const f=await owner();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('outbound request forbidden');});
 const running=await startAccountServer({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},planMode:'test-venue-levels',billingAccount:{accountIds:[f.accountId]},host:'127.0.0.1',port:0});
 try{
  const address=running.server.address();assert.ok(address&&typeof address!=='string');
  const {request:httpRequest}=await import('node:http');
  const response=await new Promise<{status:number;body:string;policy:string|string[]|undefined}>((resolve,reject)=>{
   const call=httpRequest({hostname:'127.0.0.1',port:address.port,path:readPath,method:'POST',headers:{host:'cloud.example.test',origin,'content-type':'application/json',cookie:'__Host-cloud_session='+f.session.token,'x-csrf-token':f.session.csrfToken}},res=>{
    let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,body,policy:res.headers['content-security-policy']}));
   });call.on('error',reject);call.end('{}');
  });
  assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body),{venues:[{venueId:f.venueId,level:'registered',trial:null,canStartTrial:true,taxProfile:{legalName:null,address:null,taxNumber:null}}]});
  assert.equal(response.policy,(await request(app(),f.session)).headers.get('content-security-policy')??undefined);assert.equal(calls,0);
 }finally{await running.close();}
});

test('session and activity discover the trial chooser only for configured synthetic accounts',async()=>{
 const f=await owner();
 for(const allowed of [undefined,[randomUUID()],[f.accountId]]){
  const target=app(allowed);
  for(const activity of [false,true]){
   const response=await target.request(origin+'/api/account/session'+(activity?'/activity':''),{
    method:activity?'POST':'GET',headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+f.session.token,'x-csrf-token':f.session.csrfToken},
    ...(activity?{body:'{}'}:{})
   },{incoming:{socket:{remoteAddress:`192.0.2.${++addresses%250+1}`}}} as HttpBindings);
   assert.equal(response.status,200);const value=await response.json();
   assert.equal(value.accountId,f.accountId);
   assert.equal(value.billingTrialAvailable,allowed?.includes(f.accountId)?true:undefined);
   assert.equal(Object.hasOwn(value,'billingTrialAvailable'),allowed?.includes(f.accountId)??false);
  }
 }
});

const taxPath='/api/account/billing/tax/save',taxProfile={legalName:'Synthetic business',address:'Synthetic street 1',taxNumber:'TEST-123'};
async function taxRow(id:string){
 return (await db.pool.query('SELECT name,billing_address,tax_number,country_code FROM legal_businesses WHERE id=$1',[id])).rows[0];
}

test('tax details can be saved reloaded and corrected without payment methods or billing changes',async()=>{
 const f=await owner(),target=app([f.accountId]),billing=await billingRows(f.organisationId),sibling=randomUUID();
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",[sibling,f.organisationId,f.legalBusinessId]);
 await db.pool.query("UPDATE legal_businesses SET country_code='ES' WHERE id=$1",[f.legalBusinessId]);
 const empty=await (await request(target,f.session)).json();
 assert.deepEqual(empty.venues[0].taxProfile,{legalName:null,address:null,taxNumber:null});
 assert.equal(empty.venues[0].paymentMethods,undefined);
 const response=await request(target,f.session,taxPath,{venueId:f.venueId,legalName:'  Synthetic business  ',address:' Synthetic street 1 ',taxNumber:' TEST-123 '});
 assert.equal(response.status,200);const saved=await response.json();assert.deepEqual(saved.venues.find((venue:any)=>venue.venueId===f.venueId).taxProfile,taxProfile);assert.deepEqual(saved.venues.find((venue:any)=>venue.venueId===sibling).taxProfile,taxProfile);
 assert.deepEqual((await (await request(target,f.session)).json()).venues[0].taxProfile,taxProfile);
 const corrected={legalName:'Corrected synthetic business',address:'Synthetic street 2',taxNumber:'TEST-456'};
 assert.equal((await request(target,f.session,taxPath,{venueId:f.venueId,...corrected})).status,200);
 assert.deepEqual(await taxRow(f.legalBusinessId),{name:corrected.legalName,billing_address:corrected.address,tax_number:corrected.taxNumber,country_code:'ES'});
 assert.deepEqual(await billingRows(f.organisationId),billing);
});

test('tax saves reject unknown fields controls empty and oversized strings without partial writes',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await taxRow(f.legalBusinessId);
 const invalid=[
  {legalName:''},{legalName:'x'.repeat(201)},{address:'   '},{address:'x'.repeat(601)},
  {taxNumber:''},{taxNumber:'x'.repeat(33)},{legalName:'Bad\nname'},{address:'Bad\u0085address'},
  {taxNumber:'\tTEST-123'},{address:'Two\u2028lines'},{legalName:'Two\u2029lines'},{legalName:null},{countryCode:'FR'},{venueId:'not-an-id'}
 ];
 for(const change of invalid){
  const response=await request(target,f.session,taxPath,{venueId:f.venueId,...taxProfile,...change});
  assert.equal(response.status,400,JSON.stringify(change));assert.deepEqual(await response.json(),{error:'invalid_input'});
  assert.deepEqual(await taxRow(f.legalBusinessId),before);
 }
 const maximum={legalName:'n'.repeat(200),address:'a'.repeat(600),taxNumber:'t'.repeat(32)};
 const accepted=await request(target,f.session,taxPath,{venueId:f.venueId,...maximum});
 assert.equal(accepted.status,200);assert.deepEqual((await accepted.json()).venues[0].taxProfile,maximum);
});

test('tax saving requires allowlisted verified ownership and browser proof for the selected test business',async()=>{
 const f=await owner(),foreign=await owner(),target=app([f.accountId]),body={venueId:f.venueId,...taxProfile},before=await taxRow(f.legalBusinessId);
 assert.equal((await request(app(),f.session,taxPath,body)).status,503);
 assert.equal((await request(app([randomUUID()]),f.session,taxPath,body)).status,403);
 for(const headers of [{origin:'https://elsewhere.test'},{'x-csrf-token':'wrong'}] as Record<string,string>[]){
  assert.equal((await request(target,f.session,taxPath,body,headers)).status,403);
 }
 assert.equal((await request(target,f.session,taxPath,{...body,venueId:foreign.venueId})).status,403);
 await db.pool.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[f.accountId]);
 assert.equal((await request(target,f.session,taxPath,body)).status,403);
 await db.pool.query('UPDATE cloud_credentials SET email_verified_at=clock_timestamp() WHERE account_id=$1',[f.accountId]);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.accountId]);
 assert.equal((await request(target,f.session,taxPath,body)).status,403);
 assert.deepEqual(await taxRow(f.legalBusinessId),before);
 assert.deepEqual(await taxRow(foreign.legalBusinessId),before);
});

test('a production venue sharing the business hides its tax profile and refuses a synthetic save',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await taxRow(f.legalBusinessId),production=randomUUID();
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'production')",[production,f.organisationId,f.legalBusinessId]);
 const read=await request(target,f.session);assert.equal(read.status,200);
 for(const venue of (await read.json()).venues)assert.equal(Object.hasOwn(venue,'taxProfile'),false);
 const refused=await request(target,f.session,taxPath,{venueId:f.venueId,...taxProfile});assert.equal(refused.status,403);
 assert.deepEqual(await taxRow(f.legalBusinessId),before);
});

test('tax save rolls back if its session expires while waiting for the business lock',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await taxRow(f.legalBusinessId),blocker=await db.secondPool.connect();
 const expiry=(await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '4 seconds' WHERE account_id=$1 RETURNING absolute_expires_at",[f.accountId])).rows[0].absolute_expires_at;
 let pending:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM legal_businesses WHERE id=$1 FOR UPDATE',[f.legalBusinessId]);
  pending=request(target,f.session,taxPath,{venueId:f.venueId,...taxProfile});await waitForBillingLock('FROM legal_businesses');
  for(;;){if((await db.secondPool.query('SELECT clock_timestamp()>=$1::timestamptz AS expired',[expiry])).rows[0].expired)break;await delay(20);}
  await blocker.query('COMMIT');const response=await pending;
  assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'session_expired'});
  assert.deepEqual(await taxRow(f.legalBusinessId),before);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('tax save rechecks venue binding after the business lock wait',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await taxRow(f.legalBusinessId),other=randomUUID(),blocker=await db.secondPool.connect();let pending:Promise<Response>|undefined;
 await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[other,f.organisationId]);
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM legal_businesses WHERE id=$1 FOR UPDATE',[f.legalBusinessId]);
  pending=request(target,f.session,taxPath,{venueId:f.venueId,...taxProfile});await waitForBillingLock('FROM legal_businesses');
  await blocker.query('UPDATE venues SET legal_business_id=$1 WHERE id=$2',[other,f.venueId]);await blocker.query('COMMIT');
  assert.equal((await pending).status,403);assert.deepEqual(await taxRow(f.legalBusinessId),before);assert.deepEqual(await taxRow(other),before);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('tax save refuses a production venue created while it waits for its organisation lock',async()=>{
 const f=await owner(),target=app([f.accountId]),before=await taxRow(f.legalBusinessId),blocker=await db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE',[f.organisationId]);
  pending=request(target,f.session,taxPath,{venueId:f.venueId,...taxProfile});await waitForBillingLock('FROM organisations');
  await blocker.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'production')",[randomUUID(),f.organisationId,f.legalBusinessId]);await blocker.query('COMMIT');
  assert.equal((await pending).status,403);assert.deepEqual(await taxRow(f.legalBusinessId),before);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('tax save business lock holds new venue creation until its transaction finishes',async t=>{
 const f=await owner(),target=app([f.accountId]),writer=await db.secondPool.connect(),connect=db.pool.connect.bind(db.pool);
 let reached!:()=>void,release!:()=>void;const writing=new Promise<void>(resolve=>reached=resolve),continuing=new Promise<void>(resolve=>release=resolve);
 const hooked=t.mock.method(db.pool,'connect',async()=>{
  const client=await connect(),query=client.query.bind(client);
  return new Proxy(client,{get(object,key){
   if(key==='query')return async(...args:Parameters<typeof client.query>)=>{
    const result=await (query as Function)(...args);
    if(typeof args[0]==='string'&&args[0].startsWith('UPDATE legal_businesses SET name=')){reached();await continuing;}
    return result;
   };
   const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;
  }});
 });
 let pending:Promise<Response>|undefined,creating:Promise<unknown>|undefined;
 try{
  pending=request(target,f.session,taxPath,{venueId:f.venueId,...taxProfile});await writing;
  await writer.query("SELECT set_config('application_name',$1,false)",[db.schema]);
  creating=writer.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'production')",[randomUUID(),f.organisationId,f.legalBusinessId]);
  await waitForBillingLock('INSERT INTO venues');release();assert.equal((await pending).status,200);await creating;
  const read=await request(target,f.session);assert.equal(read.status,200);
  for(const venue of (await read.json()).venues)assert.equal(Object.hasOwn(venue,'taxProfile'),false);
 }finally{release();await pending?.catch(()=>{});await creating?.catch(()=>{});writer.release();hooked.mock.restore();}
});

test('recovered scope: billing chooser and tax save keep the recovered business only',async()=>{
 const f=await owner(),target=app([f.accountId]);await setRecoveryScope(db.pool,f.accountId);
 assert.deepEqual(await (await request(target,f.session)).json(),{venues:[]});
 assert.equal((await request(target,f.session,'/api/account/billing/tax/save',{venueId:f.venueId,legalName:'Sol SL',address:'Synthetic 1',taxNumber:'B12345678'})).status,403);
 await setRecoveryScope(db.pool,f.accountId,f.organisationId);assert.equal(((await (await request(target,f.session)).json()) as {venues:unknown[]}).venues.length,1);
});

test('billing shows the effective Connected price only on in-scope test venues',async t=>{
 const pricedDb=await database();t.after(()=>pricedDb.close());
 const f=await owner(pricedDb),target=app([f.accountId],undefined,pricedDb),productionId=randomUUID();
 await pricedDb.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'production')",[productionId,f.organisationId,f.legalBusinessId]);
 const store=new BillingPriceStore(pricedDb.pool);
 await store.publish({revision:1,effectiveFrom:'2000-01-01',currency:'EUR',prices:{connectedMonthlyCents:1000,hostedMonthlyCents:2000},vatRateBasisPoints:2100});
 await store.publish({revision:2,effectiveFrom:'2099-01-01',currency:'EUR',prices:{connectedMonthlyCents:3000,hostedMonthlyCents:4000},vatRateBasisPoints:2100});
 const expected={currency:'EUR',netCents:1000,grossCents:1210};

 const read=await request(target,f.session);assert.equal(read.status,200);
 const {venues}=await read.json();
 assert.deepEqual(venues.find((venue:{venueId:string})=>venue.venueId===f.venueId)?.connectedPrice,expected);
 const production=venues.find((venue:{venueId:string})=>venue.venueId===productionId);
 assert.equal(Object.hasOwn(production,'connectedPrice'),false);

 await setRecoveryScope(pricedDb.pool,f.accountId);
 assert.deepEqual(await (await request(target,f.session)).json(),{venues:[]});
 await setRecoveryScope(pricedDb.pool,f.accountId,f.organisationId);
 const start=await request(target,f.session,startPath,{venueId:f.venueId});assert.equal(start.status,200);
 assert.deepEqual((await start.json()).venues.find((venue:{venueId:string})=>venue.venueId===f.venueId)?.connectedPrice,expected);
});

test('a saved card can start the free trial without an effective price',async()=>{
 const f=await owner(),target=app([f.accountId]);
 const store=new BillingStore(db.pool),scope={organisationId:f.organisationId,legalBusinessId:f.legalBusinessId};
 const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
 await store.execute(scope,event(),{type:'ensure_business'});
 const method={id:randomUUID(),kind:'card',provider:'sumup',providerAccountId:'synthetic',customerId:'synthetic',methodId:'synthetic',mandateId:null} as const;
 await store.execute(scope,event(),{type:'set_method',method});
 const response=await request(target,f.session,startPath,{venueId:f.venueId});
 assert.equal(response.status,200);
 const {venues:[venue]}=await response.json();
 assert.equal(venue.trial.state,'active');
 assert.equal(Object.hasOwn(venue,'connectedPrice'),false);
});
