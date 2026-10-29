import assert from 'node:assert/strict';
import {test} from 'node:test';
const api=await import(new URL('../src/organisation-plans.ts',import.meta.url).href);
// Catch accidental production enablement or mixing the two independent test modes.
for(const [legacy,levels,want] of [[undefined,undefined,'existing'],['0','0','existing'],['1',undefined,'test-free-paid'],['1','0','test-free-paid'],[undefined,'test','test-venue-levels'],['0','test','test-venue-levels']] as const)
 test(`plan flags ${String(legacy)}/${String(levels)} select ${want}`,()=>assert.equal(api.parsePlanMode(legacy,levels),want));
for(const [legacy,levels] of [['1','test'],['','test'],['production','test'],[undefined,''],[undefined,'production'],[undefined,'true'],[undefined,'1'],[undefined,' test'],[undefined,'test '],[undefined,'TEST']] as const)
 test(`plan flags ${String(legacy)}/${JSON.stringify(levels)} refuse startup`,()=>assert.throws(()=>api.parsePlanMode(legacy,levels),/invalid_plan_mode/));
test('venue-level mode refuses production venues before service work',()=>{
 api.requireTestPlanVenue('test','test-venue-levels');
 assert.throws(()=>api.requireTestPlanVenue('production','test-venue-levels'),/permission_denied/);
});
