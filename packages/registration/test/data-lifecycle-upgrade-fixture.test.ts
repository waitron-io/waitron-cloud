import assert from 'node:assert/strict';
import {test} from 'node:test';
import {lifecycleFixture} from './fixtures/data-lifecycle.ts';
const f=lifecycleFixture('lifecycle_upgrade_fixture');
const root=new URL('../../../',import.meta.url).pathname;
const load=()=>import(new URL('../../../scripts/schema-upgrade-lifecycle-fixture.mjs',import.meta.url).href).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
// Dropping restored operations, moving deadlines or admitting an old claimant must fail qualification.
test('lifecycle recovery preserves pending effects and fixed dates then refuses stale reconciliation',async()=>{
 const fixture=await load();
 for(const key of ['seedLifecycle','lifecycleState','restoredLifecycle','emptyLifecycle'])assert.equal(typeof fixture[key],'function',key);
 assert.equal(await fixture.emptyLifecycle(f.pool),true);
 const proof=await fixture.seedLifecycle(root,f.pool,{installations:[{venueId:f.venueId},{venueId:f.foreignVenueId}]});
 const before=await fixture.lifecycleState(f.pool);
 const checks=await fixture.restoredLifecycle(root,f.pool,proof,before);
 assert.deepEqual(checks,{pendingOperationsRestored:true,effectsRestored:true,fixedDeadlinesRestored:true,retryStable:true,changedInputRefused:true,staleWorkerRefused:true,uncertainRetryRefused:true,reconciliationPreserved:true,foreignEffectRefused:true});
 const after=await fixture.lifecycleState(f.pool);
 assert.equal(after.data_lifecycles.length,2);assert.equal(after.data_lifecycle_operations.length,2);assert.equal(after.data_lifecycle_effects.length,2);
});
for(const fault of ['operation','effect','deadline'])test('recovery refuses lost or changed lifecycle '+fault,async()=>{
 const fixture=await load();assert.equal(typeof fixture.seedLifecycle,'function');
 const proof=await fixture.seedLifecycle(root,f.pool,{installations:[{venueId:f.venueId},{venueId:f.foreignVenueId}]});
 const before=await fixture.lifecycleState(f.pool);
 if(fault==='operation')await f.pool.query('DELETE FROM data_lifecycle_effects; DELETE FROM data_lifecycle_operations');
 if(fault==='effect')await f.pool.query('DELETE FROM data_lifecycle_effects');
 if(fault==='deadline')await f.pool.query("UPDATE data_lifecycles SET effective_end_at=effective_end_at+interval '1 second',deadline_at=deadline_at+interval '1 second'");
 await assert.rejects(fixture.restoredLifecycle(root,f.pool,proof,before));
});
