import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {HttpBindings} from '@hono/node-server';
import {createSession,type SessionCredentials} from '@waitron-cloud/identity';
import {BillingStore,transaction,type PlanMode} from '@waitron-cloud/registration';
import {database} from '../../translation/test/fixtures.ts';
import {createAccountApp} from '../src/app.ts';
import {startAccountServer} from '../src/server.ts';

const origin='https://cloud.example.test',readPath='/api/account/billing/read',startPath='/api/account/billing/start-trial';
let db:Awaited<ReturnType<typeof database>>,addresses=0;
before(async()=>{db=await database();});after(async()=>db?.close());
function app(accountIds?:readonly string[],planMode:PlanMode='test-venue-levels'){
 return createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},
  planMode,...(accountIds===undefined?{}:{billingAccount:{accountIds}})});
}
async function owner(){
 const accountId=randomUUID(),organisationId=randomUUID(),legalBusinessId=randomUUID(),venueId=randomUUID();
 const session=await transaction(db.pool,async client=>{
  await client.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
  await client.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[accountId,`billing-${accountId}@example.test`]);
  await client.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);
  await client.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[legalBusinessId,organisationId]);
  await client.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true)',[accountId,organisationId]);
  await client.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[venueId,organisationId,legalBusinessId]);
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
 assert.deepEqual(await response.json(),{venues:[{venueId:f.venueId,level:'registered',trial:null,canStartTrial:true}]});
 assert.deepEqual(await billingRows(f.organisationId),before);
 assert.deepEqual((await db.pool.query('SELECT last_seen_at FROM cloud_sessions WHERE account_id=$1',[f.accountId])).rows,seen);
});

test('billing chooser starts the existing Connected trial without an anchor payment or installation',async()=>{
 const f=await owner(),target=app([f.accountId]);
 const today=(await db.pool.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
 const end=new Date(today+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+30);
 const expected={venues:[{venueId:f.venueId,level:'connected',trial:{level:'connected',startedOn:today,endsOn:end.toISOString().slice(0,10),extended:false,state:'active'},canStartTrial:false}]};
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
 assert.deepEqual(await response.json(),{error:'conflict',venues:[{venueId:f.venueId,level:'registered',trial:null,canStartTrial:true}]});
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
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[f.accountId,other.organisationId]);
 const scope={organisationId:f.organisationId,legalBusinessId:f.legalBusinessId},store=new BillingStore(db.pool);
 const event=()=>({key:randomUUID(),occurredAt:'2020-01-01T00:00:00.000Z',source:{kind:'internal' as const}});
 await store.execute(scope,event(),{type:'ensure_business'});
 await store.transition(scope,event(),{type:'start_trial',venueId:f.venueId,level:'connected',on:'2020-01-01'});
 const before=await billingRows(f.organisationId),response=await request(target,f.session);assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{venues:[{venueId:f.venueId,level:'registered',trial:null,canStartTrial:false},{venueId:other.venueId,level:'registered',trial:null,canStartTrial:true}].sort((a,b)=>a.venueId.localeCompare(b.venueId))});
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
  assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body),{venues:[{venueId:f.venueId,level:'registered',trial:null,canStartTrial:true}]});
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
