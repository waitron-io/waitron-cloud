import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {source} from './schema-upgrade-fixture.mjs';

const tables=['data_lifecycles','data_lifecycle_operations','data_lifecycle_effects'];
export async function lifecycleState(pool){
 const result={};
 for(const table of tables)result[table]=(await pool.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
 return result;
}
export async function emptyLifecycle(pool){
 for(const table of tables)assert.equal((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0',table);
 return true;
}
export async function seedLifecycle(root,pool,state){
 const {LifecycleStore}=await source(root,'packages/registration/src/data-lifecycle.ts');
 const store=new LifecycleStore(pool),items=[];
 await emptyLifecycle(pool);
 for(const {venueId} of state.installations){
  const input={venueId,operationId:randomUUID(),expectedRevision:0,kind:'cancel',fingerprint:'1'.repeat(64),effectiveEndAt:'2028-02-29T23:30:00.000Z'};
  const ref=await store.request(input),claim=await store.claim(ref,input.operationId);assert.ok(claim);
  const effect={effectId:randomUUID(),requestFingerprint:'2'.repeat(64),phase:'intent'};
  await store.recordEffect(ref,input.operationId,claim.claimRevision,effect);
  if(items.length)await store.recordEffect(ref,input.operationId,claim.claimRevision,{...effect,phase:'uncertain'});
  items.push({input,ref,claim,effect});
 }
 assert.equal(items.length,2);
 // A copied lease must already be expired before backup; the restored worker must reclaim it.
 await pool.query("UPDATE data_lifecycle_operations SET lease_until=clock_timestamp()-interval '1 second'");
 return {items};
}
export async function restoredLifecycle(root,pool,proof,expected){
 const {LifecycleStore}=await source(root,'packages/registration/src/data-lifecycle.ts');
 const store=new LifecycleStore(pool),checks={};
 assert.deepEqual(await lifecycleState(pool),expected,'pending operations and effects survive the logical backup exactly');
 checks.pendingOperationsRestored=true;checks.effectsRestored=true;
 for(const item of proof.items){
  const before=await store.read(item.ref.venueId);
  assert.equal(before.state,'exit preparing');assert.equal(before.effectiveEndAt,'2028-02-29T23:30:00.000Z');
  assert.equal(before.deadlineAt,'2028-05-29T23:30:00.000Z');
  assert.equal(before.operations.length,1);assert.equal(before.effects.length,1);
  assert.equal(before.operations[0].deadlineAt,'2028-05-29T23:30:00.000Z');
  assert.deepEqual(await store.request(item.input),item.ref);
  assert.deepEqual(await store.read(item.ref.venueId),before);
  await assert.rejects(store.request({...item.input,fingerprint:'3'.repeat(64)}),{code:'lifecycle_conflict'});
  const claim=await store.claim(item.ref,item.input.operationId);assert.ok(claim);
  assert.equal(claim.claimRevision,item.claim.claimRevision+1);
  await assert.rejects(store.recordEffect(item.ref,item.input.operationId,item.claim.claimRevision,{...item.effect,phase:'confirmed'}),{code:'stale_lifecycle_claim'});
  await assert.rejects(store.recordEffect(item.ref,item.input.operationId,claim.claimRevision,item.effect),{code:'effect_uncertain'});
  const foreign=proof.items.find(other=>other.ref.venueId!==item.ref.venueId);
  await assert.rejects(store.recordEffect(foreign.ref,item.input.operationId,claim.claimRevision,{...item.effect,phase:'confirmed'}),{code:'stale_lifecycle_claim'});
  await store.recordEffect(item.ref,item.input.operationId,claim.claimRevision,{...item.effect,phase:'confirmed',resourceReference:'fixture:observed'});
  const after=await store.read(item.ref.venueId);
  assert.equal(after.effects[0].phase,'confirmed');assert.equal(after.effects[0].resourceReference,'fixture:observed');
  assert.equal(after.effectiveEndAt,before.effectiveEndAt);assert.equal(after.deadlineAt,before.deadlineAt);
  assert.equal(after.requestedAt,before.requestedAt);assert.equal(after.operations[0].requestedAt,before.operations[0].requestedAt);
  await store.recordEffect(item.ref,item.input.operationId,claim.claimRevision,{...item.effect,phase:'confirmed',resourceReference:'fixture:observed'});
  assert.deepEqual(await store.read(item.ref.venueId),after);
 }
 for(const name of ['fixedDeadlinesRestored','retryStable','changedInputRefused','staleWorkerRefused','uncertainRetryRefused','reconciliationPreserved','foreignEffectRefused'])checks[name]=true;
 return checks;
}
