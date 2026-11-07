import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import * as registration from '../src/index.ts';
import {transaction} from '../src/transaction.ts';
import {LifecycleStore} from '../src/data-lifecycle.ts';
import {countryFixture,policy,request,storePolicy,storeBinding} from './fixtures/country-flow.ts';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const f=countryFixture(),permit={policyRevision:1,evidenceId:'test-evidence'};
type Input=registration.BoundFlow;
function authorize(client:PoolClient,input:Input):Promise<typeof permit>{
 const fn=(registration as Record<string,unknown>).authorizeFlow;
 assert.equal(typeof fn,'function','registration must export the durable country admission check');
 return (fn as (client:PoolClient,input:Input)=>Promise<typeof permit>)(client,input);
}
const admit=(input:Input=f.input())=>transaction(f.pool,c=>authorize(c,input));
const refused=(code:string,input:Input=f.input())=>assert.rejects(admit(input),{name:'FlowAuthorityError',message:code,code});

test('the exact qualified durable binding returns only the matched revision and evidence',async()=>{
 assert.deepEqual(await admit(),permit);
 assert.equal(policy.flows[0]!.qualified,true,'this is synthetic test qualification only');
 assert.deepEqual(registration.spainCountryPolicy.flows,[]);
});

for(const change of [{policyRevision:2},{placementRevision:2},{revision:2},{country:'FR'},
 {supplierId:'other-supplier'},{accountId:'other-account'},{endpoint:'https://elsewhere.example.test/'},
 {region:'eu-west-3'},{dataClass:'logs'}])test('a mismatched stored binding refuses '+JSON.stringify(change),async()=>{
 if('country' in change){
  await storePolicy(f.pool,{...policy,country:'FR'});
  await f.pool.query("INSERT INTO country_policy_heads VALUES('FR',1)");
 }
 await refused('flow_conflict',{...f.input(),...change});
});

test('a foreign venue and a missing lifecycle are unavailable',async()=>{
 await refused('flow_unavailable',{...f.input(),venueId:f.foreignVenueId});
 await f.pool.query('DELETE FROM data_lifecycles');await refused('flow_unavailable');
});

test('unqualified and cross-record destinations cannot borrow other evidence',async()=>{
 const qualified=policy.flows[0]!;
 const changed={...policy,revision:2,flows:[{...qualified,qualified:false},{...qualified,accountId:'other-account'}]};
 await storePolicy(f.pool,changed);await f.pool.query('UPDATE country_policy_heads SET revision=2');
 const next={...request,policyRevision:2};await storeBinding(f.pool,f.venueId,2,next);
 await f.pool.query('UPDATE venue_country_binding_heads SET placement_revision=2');
 await refused('flow_denied',{...f.input(),policyRevision:2,placementRevision:2});
});

for(const state of ['exit preparing','read-only until deadline','purging','purged'])test('lifecycle '+state+' denies producer admission',async()=>{
 await f.pool.query('UPDATE data_lifecycles SET state=$1',[state]);await refused('flow_denied');
});

test('database time at the exact effective end refuses an unchanged active revision',async()=>{
 await f.pool.query("UPDATE data_lifecycles SET effective_end_at='2027-01-01T00:00:00Z',deadline_at='2027-01-01T00:00:00Z'::timestamptz+interval '2160 hours'");
 await f.pool.query("CREATE FUNCTION clock_timestamp() RETURNS timestamptz LANGUAGE sql AS $$SELECT '2027-01-01T00:00:00Z'::timestamptz$$");
 await refused('flow_denied');
});

test('an active lifecycle with a future effective end still admits',async()=>{
 await f.pool.query("WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS now) UPDATE data_lifecycles SET effective_end_at=stamp.now+interval '1 day',deadline_at=stamp.now+interval '2184 hours' FROM stamp");
 assert.deepEqual(await admit(),permit);
});

test('database deadline comparison retains microseconds that a JavaScript Date would lose',async()=>{
 await f.pool.query("UPDATE data_lifecycles SET effective_end_at='2027-01-01T00:00:00.000002Z',deadline_at='2027-01-01T00:00:00.000002Z'::timestamptz+interval '2160 hours'");
 await f.pool.query("CREATE FUNCTION clock_timestamp() RETURNS timestamptz LANGUAGE sql AS $$SELECT '2027-01-01T00:00:00.000001Z'::timestamptz$$");
 assert.deepEqual(await admit(),permit);
 await f.pool.query("CREATE OR REPLACE FUNCTION clock_timestamp() RETURNS timestamptz LANGUAGE sql AS $$SELECT '2027-01-01T00:00:00.000002Z'::timestamptz$$");
 await refused('flow_denied');
});

for(const definition of [
 {...policy,flows:[{...policy.flows[0]!,dataClasses:'backup'}]},
 {...policy,flows:[{...policy.flows[0]!,regions:'eu-south-2'}]},
 {...policy,flows:[{...policy.flows[0]!,qualified:'true'}]},
 {...policy,country:'FR'}, {...policy,revision:2}, {...policy,extra:true},
 {...policy,flows:[{...policy.flows[0]!,endpoint:'https://BACKUP.example.test/'}]},
 {...policy,backupRegions:'eu-west-3'}, {...policy,flows:[{...policy.flows[0]!,evidenceId:''}]},
])test('malformed stored policy refuses '+JSON.stringify(definition),async()=>{
 await f.pool.query('ALTER TABLE country_policy_versions DISABLE TRIGGER country_policy_version_guard');
 try{await f.pool.query('UPDATE country_policy_versions SET definition=$1',[definition]);}finally{
  await f.pool.query('ALTER TABLE country_policy_versions ENABLE TRIGGER country_policy_version_guard');
 }
 await refused('flow_unavailable');
});

for(const change of [{extra:true},{revision:0},{policyRevision:2147483648},{placementRevision:1.5},
 {venueId:'invalid'},{endpoint:'http://backup.example.test/'},{accountId:' secret\n'}])test('invalid caller input gives a fixed refusal '+JSON.stringify(change),async()=>{
 await refused('flow_denied',{...f.input(),...change});
});

test('own getter properties and symbol keys refuse without invoking those getters',async()=>{
 let read=false;const input=f.input();Object.defineProperty(input,'accountId',{get(){read=true;return request.accountId;}});
 await refused('flow_denied',input);assert.equal(read,false);
 const symbolic={...f.input(),[Symbol('hidden')]:'secret'};await refused('flow_denied',symbolic);
});

test('a throwing caller descriptor gives an input refusal without leaking its exception',async()=>{
 const input=new Proxy(f.input(),{ownKeys(){throw new Error('private synthetic input');}});
 await refused('flow_denied',input);
});

test('autocommit and an already failed transaction return fixed errors',async()=>{
 const c=await f.pool.connect();try{
  await assert.rejects(authorize(c,f.input()),{message:'transaction_required'});
  await c.query('BEGIN');await assert.rejects(c.query('SELECT missing_country_test_column'));
  await assert.rejects(authorize(c,f.input()),{message:'flow_unavailable'});
 }finally{await c.query('ROLLBACK');c.release();}
});

test('missing country schema never restores a permissive path',async()=>{
 await f.pool.query('DROP TABLE venue_country_binding_heads');await refused('flow_unavailable');
});

async function waitForLock(pending:Promise<unknown>,blocker:number|null=null,queryPrefix:string|null=null){
 let settled=false;void pending.then(()=>{settled=true;},()=>{settled=true;});
 for(let n=0;n<100&&!settled;n++){
  if((await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND pid<>pg_backend_pid() AND ($2::int IS NULL OR $2=ANY(pg_blocking_pids(pid))) AND ($3::text IS NULL OR query LIKE $3)",[f.schema,blocker,queryPrefix])).rowCount)return;
  await delay(10);
 }
 assert.fail('country admission did not reach its row lock');
}

test('admission holds the current policy against a concurrent setter until commit',async()=>{
 await storePolicy(f.pool,{...policy,revision:2});
 const held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');assert.deepEqual(await authorize(held,f.input()),permit);
  pending=transaction(f.pool,c=>c.query('UPDATE country_policy_heads SET revision=2'));
  await waitForLock(pending);assert.equal((await f.pool.query('SELECT revision FROM country_policy_heads')).rows[0].revision,1);
  await held.query('COMMIT');await pending;await refused('flow_conflict');
 }finally{await held.query('ROLLBACK');await pending;held.release();}
});

test('a venue foreign-key insert and a concurrent cancellation finish without deadlock',async()=>{
 const held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await authorize(held,f.input());
  const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=new LifecycleStore(f.pool).request({venueId:f.venueId,operationId:randomUUID(),expectedRevision:1,kind:'cancel',fingerprint:'a'.repeat(64)}).catch(error=>error);
  await waitForLock(pending,blocker);
  const insertError=await storeBinding(held,f.venueId,2,request).then(()=>null,error=>error);
  assert.equal(insertError,null,'the admitted foreign-key insert must not deadlock');
  await held.query('COMMIT');
  const outcome=await pending;
  assert.deepEqual(outcome,{venueId:f.venueId,revision:2},'cancellation must complete without a deadlock victim');
 }finally{await held.query('ROLLBACK');await pending;held.release();}
});

test('two read-only admissions for the same venue finish before the first transaction commits',async()=>{
 const held=await f.pool.connect(),second=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await authorize(held,f.input());await second.query('BEGIN');
  const pid=(await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let settled=false,blocked=false;
  pending=authorize(second,f.input()).then(value=>{settled=true;return value;},error=>{settled=true;throw error;});
  for(let n=0;n<100&&!settled;n++){
   blocked=Boolean((await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",[pid])).rowCount);
   if(blocked)break;await delay(10);
  }
  assert.equal(blocked,false,'read-only admissions must share the lifecycle lock');
  assert.equal(settled,true,'the second admission must finish while the first remains open');
  assert.deepEqual(await pending,permit);
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});await second.query('ROLLBACK');second.release();held.release();}
});

test('admission waits directly on the binding head and refuses the replaced revision',async()=>{
 const held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await held.query('SELECT id FROM venues WHERE id=$1 FOR KEY SHARE',[f.venueId]);
  await held.query('SELECT * FROM country_policy_heads FOR SHARE');
  await storeBinding(held,f.venueId,2,request);await held.query('UPDATE venue_country_binding_heads SET placement_revision=2');
  const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=admit();const outcome=assert.rejects(pending,{message:'flow_conflict'});
  await waitForLock(pending,blocker,'SELECT placement_revision FROM venue_country_binding_heads%');
  await held.query('COMMIT');await outcome;
  assert.deepEqual(await admit({...f.input(),placementRevision:2}),permit);
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});held.release();}
});

test('an admission waiting through rebinding refuses its old placement and snapshots caller input',async()=>{
 const held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await held.query('SELECT * FROM country_policy_heads FOR SHARE');
  await held.query('SELECT * FROM data_lifecycles FOR UPDATE');
  await storeBinding(held,f.venueId,2,request);
  await held.query('UPDATE venue_country_binding_heads SET placement_revision=2');
  const input=f.input();pending=admit(input);const outcome=assert.rejects(pending,{message:'flow_conflict'});
  await waitForLock(pending);input.placementRevision=2;await held.query('COMMIT');await outcome;
  assert.deepEqual(await admit({...f.input(),placementRevision:2}),permit);
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});held.release();}
});

test('a cancellation ahead of a waiting admission is rechecked at the new lifecycle revision',async()=>{
 const held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await held.query('SELECT * FROM data_lifecycles FOR UPDATE');
  pending=admit();const outcome=assert.rejects(pending,{message:'flow_conflict'});await waitForLock(pending);
  await held.query("UPDATE data_lifecycles SET revision=2,state='exit preparing'");
  await held.query('COMMIT');await outcome;
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});held.release();}
});

test('a lifecycle request waits for an admitted transaction and cannot change its authority mid-transaction',async()=>{
 const held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await authorize(held,f.input());
  pending=new LifecycleStore(f.pool).request({venueId:f.venueId,operationId:randomUUID(),expectedRevision:1,kind:'cancel',fingerprint:'a'.repeat(64)});
  await waitForLock(pending);await held.query('COMMIT');await pending;await refused('flow_conflict');
 }finally{await held.query('ROLLBACK');await pending;held.release();}
});
