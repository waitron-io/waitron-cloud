import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {PoolClient} from 'pg';
import * as registration from '../src/index.ts';
import {event,set,trial,venueServiceFixture,type Fixture} from './fixtures/venue-service.ts';

const policy={suggestionMicros:10,validationMicros:20,
 paidVenueMonth:{suggestions:500,validations:100},freeAccountMonth:{suggestions:100,validations:20},
 cloudDay:{freeSuggestions:5,freeValidations:2,limitMicros:100},
 cloudMonth:{freeSuggestions:50,freeValidations:20,limitMicros:1000},
 freeDay:{freeSuggestions:1,freeValidations:0,limitMicros:30},
 freeMonth:{freeSuggestions:10,freeValidations:5,limitMicros:300}};
type Scope={accountId:string;venueId:string;installationId:string};
type Suggestion={kind:'suggest';workflowId:string;operationId:string};
type Admit=(client:PoolClient,scope:Scope,request:Suggestion,limits:typeof policy)=>Promise<unknown>;

async function ownerScope(f:Fixture,organisationId:string,venueId:string){
 const accountId=randomUUID();
 await f.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
 await f.pool.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[accountId,`${accountId}@example.test`]);
 await f.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[accountId,organisationId]);
 const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[venueId])).rows[0].id;
 return {accountId,venueId,installationId};
}
const request=():Suggestion=>({kind:'suggest',workflowId:randomUUID(),operationId:randomUUID()});

function at(client:PoolClient,now:Date,day:string){
 return new Proxy(client,{get(target,key){
  if(key==='query')return (sql:string,...args:unknown[])=>sql.startsWith('SELECT now,(now AT TIME ZONE')
   ?Promise.resolve({rows:[{now,day}]}):Reflect.apply(target.query,target,[sql,...args]);
  return Reflect.get(target,key);
 }});
}

test('the last free daily call is admitted once across accounts and a paying venue can still search',async()=>{
 const admit=(registration as Record<string,unknown>).admitAddressLookup as Admit;
 assert.equal(typeof admit,'function','address lookups need shared admission before sending');
 const f=await venueServiceFixture();
 try{
  const first=await ownerScope(f,f.scope.organisationId,f.venues[0]!);
  const second=await ownerScope(f,f.foreign.organisationId,f.foreignVenue);
  const paidVenue=f.venues[1]!;
  const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[paidVenue])).rows[0].id;
  const paid={...first,venueId:paidVenue,installationId};
  await set(f,'connected',paidVenue);
  const suggest=(box:Scope,pool=f.pool)=>registration.transaction(pool,client=>admit(client,box,request(),policy));
  await suggest(first);
  await f.pool.query(`CREATE FUNCTION address_test_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN PERFORM pg_advisory_xact_lock(hashtext(current_schema()),hashtext('address-test-barrier')); RETURN NEW; END $$`);
  await f.pool.query('CREATE TRIGGER address_test_barrier BEFORE INSERT ON address_lookup_calls FOR EACH ROW EXECUTE FUNCTION address_test_barrier()');
  const blocker=await f.pool.connect();
  let pending:Promise<PromiseSettledResult<unknown>[]>|undefined;
  try{
   await blocker.query('BEGIN');
   await blocker.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('address-test-barrier'))");
   const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   pending=Promise.allSettled([suggest(first),suggest(second,f.peer)]);
   let waiting=0;
   const until=performance.now()+5000;
   while(waiting<2&&performance.now()<until){
    const result=await f.admin.query(`WITH RECURSIVE chain(pid) AS (SELECT $1::int UNION
      SELECT a.pid FROM pg_stat_activity a JOIN chain c ON c.pid=ANY(pg_blocking_pids(a.pid)))
     SELECT count(*)::int AS n FROM chain WHERE pid<>$1`,[pid]);
    waiting=result.rows[0].n;if(waiting<2)await delay(10);
   }
   assert.equal(waiting,2,'both admissions must reach the database barrier');
  }finally{await blocker.query('ROLLBACK');blocker.release();}
  const race=await pending;
  assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
  for(const outcome of race)if(outcome.status==='rejected')assert.equal(outcome.reason.code,'limit');
  await assert.rejects(suggest(second),{code:'limit'});
  await suggest(paid);
  const counts=await f.pool.query('SELECT class,count(*)::int AS calls FROM address_lookup_calls GROUP BY class ORDER BY class');
  assert.deepEqual(counts.rows,[{class:'free',calls:2},{class:'paid',calls:1}]);
 }finally{await f.close();}
});

test('only an active trial with a business card gets the paid lookup allowance',async()=>{
 const f=await venueServiceFixture();
 try{
  const box=await ownerScope(f,f.scope.organisationId,f.venues[0]!);
  const day=(await f.pool.query("SELECT (clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date::text AS day")).rows[0].day;
  await trial(f,'connected',day);
  const suggest=async()=>{
   const call=request();
   await registration.transaction(f.pool,client=>registration.admitAddressLookup(client,box,call,policy));
   return (await f.pool.query('SELECT class FROM address_lookup_calls WHERE operation_id=$1',[call.operationId])).rows[0].class;
  };
  assert.equal(await suggest(),'free');
  await f.store.execute(f.scope,event(),{type:'set_method',method:{id:randomUUID(),kind:'direct_debit',provider:'stripe',providerAccountId:'synthetic',customerId:'synthetic',methodId:'synthetic-mandate',mandateId:'synthetic-mandate'}});
  assert.equal(await suggest(),'free');
  await f.store.execute(f.scope,event(),{type:'set_method',method:{id:randomUUID(),kind:'card',provider:'sumup',providerAccountId:'synthetic',customerId:'synthetic',methodId:'synthetic-card',mandateId:null}});
  assert.equal(await suggest(),'paid');
 }finally{await f.close();}
});

test('a trial that starts on the UTC date is paid even while Pacific usage is on the previous day',async()=>{
 const f=await venueServiceFixture();
 try{
  const box=await ownerScope(f,f.scope.organisationId,f.venues[0]!);
  const now=new Date('2026-01-02T02:00:00Z'),call=request();
  await trial(f,'connected','2026-01-02');
  await f.store.execute(f.scope,event(),{type:'set_method',method:{id:randomUUID(),kind:'card',provider:'sumup',providerAccountId:'synthetic',customerId:'synthetic',methodId:'utc-trial',mandateId:null}});
  await registration.transaction(f.pool,client=>registration.admitAddressLookup(at(client,now,'2026-01-01'),box,call,policy));
  assert.equal((await f.pool.query('SELECT class FROM address_lookup_calls WHERE operation_id=$1',[call.operationId])).rows[0].class,'paid');
 }finally{await f.close();}
});

test('a free owner stops at its configured monthly search allowance across venues',async()=>{
 const f=await venueServiceFixture();
 try{
  const first=await ownerScope(f,f.scope.organisationId,f.venues[0]!);
  const next=f.venues[1]!;
  const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[next])).rows[0].id;
  const scopes=[first,{...first,venueId:next,installationId}];
  const restricted={...policy,freeAccountMonth:{suggestions:1,validations:1}};
  const suggest=(box:Scope)=>registration.transaction(f.pool,client=>registration.admitAddressLookup(client,box,request(),restricted));
  await suggest(scopes[0]!);
  await assert.rejects(suggest(scopes[1]!),{code:'limit'});
  assert.equal((await f.pool.query('SELECT count(*)::int AS calls FROM address_lookup_calls')).rows[0].calls,1);
 }finally{await f.close();}
});

test('the daily and monthly spend caps leave room for a validation at the configured limit',async t=>{
 const f=await venueServiceFixture();
 try{
  const free=await ownerScope(f,f.scope.organisationId,f.venues[0]!);
  const paidVenue=f.venues[1]!;
  const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[paidVenue])).rows[0].id;
  const paid={...free,venueId:paidVenue,installationId};
  await set(f,'connected',paidVenue);
  for(const bucket of ['cloudDay','cloudMonth','freeMonth'] as const)await t.test(bucket,async()=>{
   await f.pool.query('TRUNCATE address_lookup_calls');
   const limits={...policy,[bucket]:{freeSuggestions:0,freeValidations:0,limitMicros:30}};
   const first=bucket==='freeMonth'?free:paid,call=request();
   await registration.transaction(f.pool,client=>registration.admitAddressLookup(client,first,call,limits));
   await assert.rejects(registration.transaction(f.pool,client=>registration.admitAddressLookup(client,free,request(),limits)),{code:'limit'});
   await registration.transaction(f.pool,client=>registration.admitAddressLookup(client,first,
    {...call,kind:'validate',operationId:randomUUID()},limits));
   assert.deepEqual((await f.pool.query('SELECT kind FROM address_lookup_calls ORDER BY kind')).rows,
    [{kind:'suggest'},{kind:'validate'}]);
  });
 }finally{await f.close();}
});

test('the Cloud budgets count the exact Pacific boundary and disregard the preceding period',async()=>{
 const f=await venueServiceFixture();try{
  const box=await ownerScope(f,f.scope.organisationId,f.venues[0]!);
  const now=new Date('2026-02-01T07:00:00Z');
  for(const [bucket,begin] of [['cloudDay','2026-01-31T08:00:00Z'],['cloudMonth','2026-01-01T08:00:00Z']] as const){
   const limit={...policy,[bucket]:{freeSuggestions:1,freeValidations:1,limitMicros:0}};
   for(const delta of [-1,0]){
    await f.pool.query('TRUNCATE address_lookup_calls');
    await f.pool.query(`INSERT INTO address_lookup_calls(installation_id,operation_id,workflow_id,venue_id,account_id,class,kind,admitted_at)
     VALUES($1,$2,$3,$4,$5,'free','suggest',$6)`,[box.installationId,randomUUID(),randomUUID(),box.venueId,box.accountId,new Date(Date.parse(begin)+delta)]);
    const next=registration.transaction(f.pool,client=>registration.admitAddressLookup(at(client,now,'2026-01-31'),box,request(),limit));
    if(delta===0)await assert.rejects(next,{code:'limit'},bucket);else await next;
   }
  }
 }finally{await f.close();}
});

test('paid validation caps are enforced per venue even when two venues share an owner',async()=>{
 const f=await venueServiceFixture();try{
  const first=await ownerScope(f,f.scope.organisationId,f.venues[0]!),venueId=f.venues[1]!;
  const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[venueId])).rows[0].id;
  const second={...first,venueId,installationId};
  await set(f,'connected',f.venues[0]!);await set(f,'connected',venueId);
  const limit={...policy,paidVenueMonth:{suggestions:500,validations:1}};
  const admit=(box:Scope,call:Suggestion|{kind:'validate';workflowId:string;operationId:string})=>
   registration.transaction(f.pool,client=>registration.admitAddressLookup(client,box,call,limit));
  const a=request(),b=request(),c=request();
  await admit(first,a);await admit(first,b);await admit(second,c);
  await admit(first,{...a,kind:'validate',operationId:randomUUID()});
  await assert.rejects(admit(first,{...b,kind:'validate',operationId:randomUUID()}),{code:'limit'});
  await admit(second,{...c,kind:'validate',operationId:randomUUID()});
 }finally{await f.close();}
});

test('without a billing business only address lookup gets the free admission path',async()=>{
 const f=await venueServiceFixture();try{
  const organisationId=f.scope.organisationId,businessId=randomUUID(),venueId=randomUUID(),installationId=randomUUID();
  await f.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[businessId,organisationId]);
  await f.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",[venueId,organisationId,businessId]);
  await f.pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installationId,venueId,installationId]);
  const box=await ownerScope(f,organisationId,venueId),call=request();
  await registration.transaction(f.pool,client=>registration.admitAddressLookup(client,box,call,policy));
  assert.equal((await f.pool.query('SELECT class FROM address_lookup_calls WHERE operation_id=$1',[call.operationId])).rows[0].class,'free');
  for(const service of ['transactional_email','content_translation'] as const)
   await assert.rejects(registration.transaction(f.pool,client=>registration.reserveAllowance(client,
    {...box,service,operationId:randomUUID(),binding:'synthetic',units:1n})),{code:'allowance_scope_not_found'});
 }finally{await f.close();}
});

test('admission labels a shared monthly refusal before the daily cap and uses the Pacific period',async()=>{
 const f=await venueServiceFixture();try{
  const box=await ownerScope(f,f.scope.organisationId,f.venues[0]!);
  const zero={freeSuggestions:0,freeValidations:0,limitMicros:0};
  const limits={...policy,cloudMonth:zero,cloudDay:zero};
  for(const [instant,day,period] of [
   ['2026-02-01T07:59:59Z','2026-01-31','2026-01'],
   ['2026-02-01T08:00:00Z','2026-02-01','2026-02'],
  ]){
   const refuse=registration.transaction(f.pool,client=>registration.admitAddressLookup(at(client,new Date(instant!),day!),box,request(),limits));
   await assert.rejects(refuse,{code:'limit',cap:{bucket:'cloud_month',scope:'*',period}});
  }
  const instant=new Date('2026-02-01T07:59:59Z');
  await assert.rejects(registration.transaction(f.pool,client=>registration.admitAddressLookup(at(client,instant,'2026-01-31'),box,request(),
   {...policy,cloudDay:zero})),{code:'limit',cap:{bucket:'cloud_day',scope:'*',period:'2026-01-31'}});
  await assert.rejects(registration.transaction(f.pool,client=>registration.admitAddressLookup(at(client,instant,'2026-01-31'),box,request(),
   {...policy,freeAccountMonth:{suggestions:0,validations:0}})),
   {code:'limit',cap:{bucket:'free_account_month',scope:box.accountId,period:'2026-01'}});
  await set(f,'connected',f.venues[0]!);
  await assert.rejects(registration.transaction(f.pool,client=>registration.admitAddressLookup(at(client,instant,'2026-01-31'),box,request(),
   {...policy,paidVenueMonth:{suggestions:0,validations:0}})),
   {code:'limit',cap:{bucket:'paid_venue_month',scope:box.venueId,period:'2026-01'}});
 }finally{await f.close();}
});

test('lookup cleanup is bounded and keeps the current Pacific month and recently expired workflows',async()=>{
 const f=await venueServiceFixture();try{
  const box=await ownerScope(f,f.scope.organisationId,f.venues[0]!);
  const rows=await f.pool.query(`INSERT INTO address_lookup_calls(installation_id,operation_id,workflow_id,venue_id,account_id,class,kind,admitted_at)
   SELECT $1,gen_random_uuid(),gen_random_uuid(),$2,$3,'free','suggest',stamp FROM
   unnest(ARRAY['2026-01-01T08:00:00Z','2026-02-01T07:49:59Z','2026-02-01T07:50:00Z','2026-02-01T07:59:59Z','2026-02-01T08:00:00Z']::timestamptz[]) stamp
   RETURNING operation_id`,[box.installationId,box.venueId,box.accountId]);
  await f.pool.query(`INSERT INTO address_lookup_calls
   SELECT installation_id,gen_random_uuid(),gen_random_uuid(),venue_id,account_id,class,kind,admitted_at
   FROM address_lookup_calls CROSS JOIN generate_series(1,1000) WHERE operation_id=$1`,[rows.rows[0].operation_id]);
  const prune=(registration as Record<string,unknown>).pruneAddressLookupCalls as (pool:typeof f.pool,now:Date)=>Promise<number>;
  assert.equal(typeof prune,'function');
  assert.equal(await prune(f.pool,new Date('2026-02-01T08:20:00Z')),1000);
  assert.equal(await prune(f.pool,new Date('2026-02-01T08:20:00Z')),2);
  assert.equal(await prune(f.pool,new Date('2026-02-01T08:30:00Z')),2);
  assert.equal(await prune(f.pool,new Date('2026-02-01T10:00:00Z')),0);
  const saved=await f.pool.query('SELECT operation_id FROM address_lookup_calls');
  assert.deepEqual(saved.rows,[rows.rows[4]]);
 }finally{await f.close();}
});

test('paid calls leave the free group’s monthly spend available',async()=>{
 const f=await venueServiceFixture();try{
  const free=await ownerScope(f,f.scope.organisationId,f.venues[0]!),paidVenue=f.venues[1]!;
  const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[paidVenue])).rows[0].id;
  await set(f,'connected',paidVenue);
  const one={freeSuggestions:1,freeValidations:1,limitMicros:0};
  const limits={...policy,freeDay:one,freeMonth:one};
  const admit=(box:Scope)=>registration.transaction(f.pool,client=>registration.admitAddressLookup(client,box,request(),limits));
  const paid={...free,venueId:paidVenue,installationId};
  await admit(paid);
  await admit(free);
  await assert.rejects(admit(free),error=>error instanceof registration.AddressLookupAdmissionError
   &&error.code==='limit'&&error.cap?.bucket==='free_month'&&error.cap.scope==='*');
  await admit(paid);
 }finally{await f.close();}
});
