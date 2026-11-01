import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {LifecycleStore} from '../src/data-lifecycle.ts';
import {lifecycleFixture} from './fixtures/data-lifecycle.ts';

const f=lifecycleFixture('lifecycle'),store=new LifecycleStore(f.pool);
const request=(extra:Record<string,unknown>={})=>({venueId:f.venueId,operationId:randomUUID(),expectedRevision:0,
 kind:'cancel' as const,fingerprint:'a'.repeat(64),effectiveEndAt:'2027-03-28T00:30:00.000Z',...extra});
async function waitForLock(prefix:string,pending:Promise<unknown>){
 let settled=false;void pending.then(()=>{settled=true;},()=>{settled=true;});
 for(let attempt=0;attempt<100&&!settled;attempt++){
  const rows=await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1 AND application_name=$2",[prefix+'%',f.schema]);
  if(rows.rowCount)return;await delay(10);
 }
 assert.fail('mutation did not acknowledge the lifecycle row lock');
}

test('fixed_utc_deadline_survives_retry_restart',async()=>{
 const input=request();
 const before=(await f.pool.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
 let ref:unknown;
 await assert.doesNotReject(async()=>{ref=await store.request(input);});
 assert.deepEqual(ref,{venueId:f.venueId,revision:1});
 const first=await store.read(f.venueId);
 assert.equal(first.state,'exit preparing');
 assert.equal(first.effectiveEndAt,'2027-03-28T00:30:00.000Z');
 assert.equal(first.deadlineAt,'2027-06-26T00:30:00.000Z');
 const now=(await f.pool.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
 assert.ok(Date.parse(first.requestedAt)>=before.getTime()&&Date.parse(first.requestedAt)<=now.getTime());
 assert.deepEqual(await new LifecycleStore(f.pool).request(input),ref);
 assert.deepEqual(await new LifecycleStore(f.pool).read(f.venueId),first);
});

test('an omitted service end uses the database clock instead of the worker clock',async()=>{
 await f.pool.query("CREATE FUNCTION clock_timestamp() RETURNS timestamptz LANGUAGE sql AS $$SELECT '2027-01-01T12:00:00.000Z'::timestamptz$$");
 await store.request(request({effectiveEndAt:undefined}));
 const value=await store.read(f.venueId);
 assert.equal(value.requestedAt,'2027-01-01T12:00:00.000Z');
 assert.equal(value.effectiveEndAt,'2027-01-01T12:00:00.000Z');
 assert.equal(value.deadlineAt,'2027-04-01T12:00:00.000Z');
});

for(const [end,deadline] of [
 ['2024-02-29T12:00:00.000Z','2024-05-29T12:00:00.000Z'],
 ['2027-10-31T00:30:00.000Z','2028-01-29T00:30:00.000Z'],
] as const)test(`cancellation fixes 2160 hours across leap and daylight-saving boundaries: ${end}`,async()=>{
 await store.request(request({effectiveEndAt:end}));
 assert.equal((await store.read(f.venueId)).deadlineAt,deadline);
});

test('changed_input_conflicts without moving the fixed deadline',async()=>{
 const input=request(),ref=await store.request(input),before=await store.read(f.venueId);
 for(const changed of [{fingerprint:'b'.repeat(64)},{kind:'delete' as const,effectiveEndAt:undefined},{effectiveEndAt:'2027-03-29T00:30:00.000Z'},{expectedRevision:1}])
  await assert.rejects(store.request({...input,...changed}),{message:'lifecycle_conflict'});
 await assert.rejects(store.request(request({expectedRevision:ref.revision,effectiveEndAt:'2027-03-29T00:30:00.000Z'})),{message:'lifecycle_conflict'});
 assert.deepEqual(await store.read(f.venueId),before);
});

test('new concurrent requests serialize on the venue revision',async()=>{
 const results=await Promise.allSettled([store.request(request()),new LifecycleStore(f.pool).request(request())]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.message==='lifecycle_conflict').length,1);
 assert.equal((await store.read(f.venueId)).operations.length,1);
});

test('unknown venues and malformed input cannot create a lifecycle',async()=>{
 await assert.rejects(store.request(request({venueId:randomUUID()})),{message:'lifecycle_unavailable'});
 for(const extra of [{fingerprint:'private payload'},{expectedRevision:-1},{expectedRevision:1.5},{kind:'purge'},
  {effectiveEndAt:'2027-03-28'},{venueId:'bad'},{operationId:'bad'},{extra:true}])
  await assert.rejects(store.request(request(extra)),{message:'invalid_lifecycle_input'});
 assert.equal((await f.pool.query('SELECT count(*) FROM data_lifecycles')).rows[0].count,'0');
});

test('purging_blocks_resubscribe and retains a payload-free purged tombstone',async()=>{
 const ref=await store.request(request());
 for(const state of ['purging','purged']){
  await f.pool.query('UPDATE data_lifecycles SET state=$2 WHERE venue_id=$1',[f.venueId,state]);
  const before=await store.read(f.venueId);
  await assert.rejects(store.request(request({expectedRevision:ref.revision,kind:'resubscribe',effectiveEndAt:undefined})),{message:'lifecycle_unavailable'});
  assert.deepEqual(await store.read(f.venueId),before);
 }
});

test('exact deadline refuses resubscribe and an earlier request grants no service authority',async()=>{
 const ref=await store.request(request());
 await f.pool.query("UPDATE data_lifecycles SET state='read-only until deadline' WHERE venue_id=$1",[f.venueId]);
 const next=await store.request(request({expectedRevision:ref.revision,kind:'resubscribe',effectiveEndAt:undefined}));
 assert.equal((await store.read(f.venueId)).state,'read-only until deadline','retained-data proof belongs to a later adapter');
 await f.pool.query("CREATE FUNCTION clock_timestamp() RETURNS timestamptz LANGUAGE sql AS $$SELECT '2027-06-26T00:30:00.000Z'::timestamptz$$");
 assert.equal((await f.pool.query('SELECT clock_timestamp() AS now')).rows[0].now.toISOString(),(await store.read(f.venueId)).deadlineAt);
 await assert.rejects(store.request(request({expectedRevision:next.revision,kind:'resubscribe',effectiveEndAt:undefined})),{message:'lifecycle_unavailable'});
});

test('two_claimants_one_outcome and stale_completion_refused after lease takeover',async()=>{
 const input=request(),ref=await store.request(input);
 const claim=()=>Promise.resolve().then(()=>store.claim(ref,input.operationId));
 const results=await Promise.allSettled([claim(),claim()]);
 const winners=results.filter(r=>r.status==='fulfilled'&&r.value!==null);
 assert.equal(winners.length,1);
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value===null).length,1);
 const old=(winners[0] as PromiseFulfilledResult<{claimRevision:number}>).value;
 await f.pool.query("UPDATE data_lifecycle_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE venue_id=$1",[f.venueId]);
 const current=await store.claim(ref,input.operationId);assert.ok(current);assert.equal(current.claimRevision,old.claimRevision+1);
 const effect={effectId:randomUUID(),requestFingerprint:'b'.repeat(64),phase:'intent' as const};
 await assert.rejects(store.recordEffect(ref,input.operationId,old.claimRevision,effect),{message:'stale_lifecycle_claim'});
 await assert.doesNotReject(()=>store.recordEffect(ref,input.operationId,current.claimRevision,effect));
});

test('outcomes need an unchanged intent and terminal outcomes cannot be rewritten',async()=>{
 const input=request(),ref=await store.request(input),claim=await store.claim(ref,input.operationId);assert.ok(claim);
 const effect={effectId:randomUUID(),requestFingerprint:'b'.repeat(64),phase:'intent' as const};
 await assert.rejects(store.recordEffect(ref,input.operationId,claim.claimRevision,{...effect,phase:'confirmed'}),{message:'lifecycle_conflict'});
 await store.recordEffect(ref,input.operationId,claim.claimRevision,effect);
 await assert.rejects(store.recordEffect(ref,input.operationId,claim.claimRevision,{...effect,requestFingerprint:'c'.repeat(64),phase:'confirmed'}),{message:'lifecycle_conflict'});
 await store.recordEffect(ref,input.operationId,claim.claimRevision,{...effect,phase:'confirmed',resourceReference:'object/123'});
 const before=await store.read(f.venueId);
 await store.recordEffect(ref,input.operationId,claim.claimRevision,{...effect,phase:'confirmed',resourceReference:'object/123'});
 await assert.rejects(store.recordEffect(ref,input.operationId,claim.claimRevision,{...effect,phase:'refused'}),{message:'lifecycle_conflict'});
 await assert.rejects(store.recordEffect(ref,input.operationId,claim.claimRevision,{...effect,phase:'confirmed',resourceReference:'object/other'}),{message:'lifecycle_conflict'});
 assert.deepEqual(await store.read(f.venueId),before);
});

test('lost_reply_requires_lookup instead of replaying an unresolved effect',async()=>{
 const input=request(),ref=await store.request(input),claim=await store.claim(ref,input.operationId);assert.ok(claim);
 const effect={effectId:randomUUID(),requestFingerprint:'b'.repeat(64),phase:'intent' as const};
 await store.recordEffect(ref,input.operationId,claim.claimRevision,effect);
 await assert.rejects(store.recordEffect(ref,input.operationId,claim.claimRevision,effect),{message:'effect_uncertain'});
 await f.pool.query("UPDATE data_lifecycle_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE venue_id=$1",[f.venueId]);
 const next=await new LifecycleStore(f.pool).claim(ref,input.operationId);assert.ok(next);
 assert.equal((await store.read(f.venueId)).effects[0]!.phase,'uncertain');
 await assert.rejects(store.recordEffect(ref,input.operationId,next.claimRevision,effect),{message:'effect_uncertain'});
 await assert.rejects(store.recordEffect(ref,input.operationId,next.claimRevision,{...effect,effectId:randomUUID()}),{message:'effect_uncertain'});
 await store.recordEffect(ref,input.operationId,next.claimRevision,{...effect,phase:'refused'});
 assert.equal((await store.read(f.venueId)).effects[0]!.phase,'refused');
});

test('new requests fence old completions and a current claim can reconcile their intent',async()=>{
 const input=request(),ref=await store.request(input),claim=await store.claim(ref,input.operationId);assert.ok(claim);
 const effect={effectId:randomUUID(),requestFingerprint:'b'.repeat(64),phase:'intent' as const};
 await store.recordEffect(ref,input.operationId,claim.claimRevision,effect);
 const next=await store.request(request({expectedRevision:ref.revision,kind:'export',effectiveEndAt:undefined}));
 await assert.rejects(store.recordEffect(ref,input.operationId,claim.claimRevision,{...effect,phase:'confirmed'}),{message:'lifecycle_conflict'});
 assert.equal((await store.read(f.venueId)).effects[0]!.phase,'uncertain');
 const replacement=await store.claim(next,input.operationId);assert.ok(replacement);
 await store.recordEffect(next,input.operationId,replacement.claimRevision,{...effect,phase:'confirmed'});
 assert.deepEqual(await store.request(input),ref,'lost request replies retain their original result');
 assert.equal((await store.read(f.venueId)).ref.revision,next.revision);
});

test('venue bindings and database lease time fence every mutation',async()=>{
 const input=request(),ref=await store.request(input),claim=await store.claim(ref,input.operationId);assert.ok(claim);
 const foreign=await store.request(request({venueId:f.foreignVenueId}));
 assert.equal(await store.claim(foreign,input.operationId),null);
 const effect={effectId:randomUUID(),requestFingerprint:'b'.repeat(64),phase:'intent' as const};
 await assert.rejects(store.recordEffect(foreign,input.operationId,claim.claimRevision,effect),{message:'stale_lifecycle_claim'});
 await f.pool.query("UPDATE data_lifecycle_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE venue_id=$1",[f.venueId]);
 await assert.rejects(store.recordEffect(ref,input.operationId,claim.claimRevision,effect),{message:'stale_lifecycle_claim'});
 assert.equal((await store.read(f.venueId)).effects.length,0);
 assert.equal((await store.read(f.foreignVenueId)).effects.length,0);
});

test('later cancellation cannot reopen a read-only period or replace its deadline',async()=>{
 const ref=await store.request(request());
 await f.pool.query("UPDATE data_lifecycles SET state='read-only until deadline' WHERE venue_id=$1",[f.venueId]);
 await store.request(request({expectedRevision:ref.revision}));
 const value=await store.read(f.venueId);
 assert.equal(value.state,'read-only until deadline');
 assert.equal(value.deadlineAt,'2027-06-26T00:30:00.000Z');
});

test('later requests preserve the database deadline including sub-millisecond precision',async()=>{
 const ref=await store.request(request());
 await f.pool.query(`UPDATE data_lifecycles SET effective_end_at='2027-03-28T00:30:00.000123Z',
  deadline_at='2027-03-28T00:30:00.000123Z'::timestamptz+interval '2160 hours' WHERE venue_id=$1`,[f.venueId]);
 const before=(await f.pool.query('SELECT effective_end_at::text,deadline_at::text FROM data_lifecycles WHERE venue_id=$1',[f.venueId])).rows;
 await store.request(request({expectedRevision:ref.revision,kind:'export',effectiveEndAt:undefined}));
 assert.deepEqual((await f.pool.query('SELECT effective_end_at::text,deadline_at::text FROM data_lifecycles WHERE venue_id=$1',[f.venueId])).rows,before);
});

test('the SQL journal refuses partial deadlines and partial lease bindings',async()=>{
 await store.request(request());
 await assert.rejects(f.pool.query('UPDATE data_lifecycles SET deadline_at=NULL WHERE venue_id=$1',[f.venueId]),{code:'23514'});
 await assert.rejects(f.pool.query('UPDATE data_lifecycle_operations SET lease_until=clock_timestamp() WHERE venue_id=$1',[f.venueId]),{code:'23514'});
});

test('only one operation per venue can have a live claim',async()=>{
 const first=request(),ref=await store.request(first),second=request({expectedRevision:ref.revision,kind:'export',effectiveEndAt:undefined});
 const current=await store.request(second);
 assert.ok(await store.claim(current,first.operationId));
 assert.equal(await store.claim(current,second.operationId),null);
});

test('claims and effects acknowledge the common lifecycle row lock',async()=>{
 const input=request(),ref=await store.request(input),held=await f.pool.connect();
 const pending:Promise<unknown>[]=[];
 async function waiting(pending:Promise<unknown>){
  let settled=false;void pending.then(()=>{settled=true;},()=>{settled=true;});
  for(let attempt=0;attempt<100&&!settled;attempt++){
   const rows=await f.pool.query(`SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock'
    AND query LIKE 'SELECT * FROM data_lifecycles WHERE venue_id=%FOR UPDATE' AND application_name=$1`,[f.schema]);
   if(rows.rowCount)return;await delay(10);
  }
  assert.fail('mutation did not acknowledge the lifecycle row lock');
 }
 try{
  await held.query('BEGIN');await held.query('SELECT * FROM data_lifecycles WHERE venue_id=$1 FOR UPDATE',[f.venueId]);
  const claiming=store.claim(ref,input.operationId);pending.push(claiming);await waiting(claiming);await held.query('COMMIT');const claim=await claiming;assert.ok(claim);
  await held.query('BEGIN');await held.query('SELECT * FROM data_lifecycles WHERE venue_id=$1 FOR UPDATE',[f.venueId]);
  const effect=store.recordEffect(ref,input.operationId,claim.claimRevision,{effectId:randomUUID(),requestFingerprint:'b'.repeat(64),phase:'intent'});
  pending.push(effect);await waiting(effect);await held.query('COMMIT');await effect;
 }finally{await held.query('ROLLBACK');held.release();await Promise.allSettled(pending);}
});

test('request arguments stay bound while the venue lock is awaited',async()=>{
 const input=request(),original={...input},held=await f.pool.connect();
 let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await held.query('SELECT id FROM venues WHERE id=$1 FOR UPDATE',[f.venueId]);
  pending=store.request(input);await waitForLock('SELECT id FROM venues WHERE id=',pending);
  input.venueId=f.foreignVenueId;input.operationId=randomUUID();input.fingerprint='c'.repeat(64);
  await held.query('COMMIT');
  assert.deepEqual(await pending,{venueId:f.venueId,revision:1});
  assert.equal((await store.read(f.venueId)).operations[0]!.operationId,original.operationId);
  assert.deepEqual(await store.request(original),{venueId:f.venueId,revision:1});
  await assert.rejects(store.read(f.foreignVenueId),{message:'lifecycle_unavailable'});
 }finally{await held.query('ROLLBACK');held.release();await pending?.catch(()=>{});}
});

test('claim references and effect fingerprints stay bound across the lifecycle lock',async()=>{
 const input=request(),ref=await store.request(input),held=await f.pool.connect();
 let pending:Promise<unknown>|undefined;
 try{
  const mutableRef={...ref};
  await held.query('BEGIN');await held.query('SELECT * FROM data_lifecycles WHERE venue_id=$1 FOR UPDATE',[f.venueId]);
  const claiming=store.claim(mutableRef,input.operationId);pending=claiming;await waitForLock('SELECT * FROM data_lifecycles WHERE venue_id=',claiming);
  mutableRef.venueId=f.foreignVenueId;
  await held.query('COMMIT');const claim=await claiming;assert.ok(claim);
  const effect={effectId:randomUUID(),requestFingerprint:'b'.repeat(64),phase:'intent' as const},original={...effect};
  await held.query('BEGIN');await held.query('SELECT * FROM data_lifecycles WHERE venue_id=$1 FOR UPDATE',[f.venueId]);
  const effectRef={...ref};
  pending=store.recordEffect(effectRef,input.operationId,claim.claimRevision,effect);await waitForLock('SELECT * FROM data_lifecycles WHERE venue_id=',pending);
  effectRef.venueId=f.foreignVenueId;
  effect.effectId=randomUUID();effect.requestFingerprint='c'.repeat(64);
  await held.query('COMMIT');await assert.doesNotReject(()=>pending!);
  const recorded=(await store.read(f.venueId)).effects[0]!;
  assert.equal(recorded.effectId,original.effectId);assert.equal(recorded.requestFingerprint,original.requestFingerprint);
 }finally{await held.query('ROLLBACK');held.release();await pending?.catch(()=>{});}
});
