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
