import assert from 'node:assert/strict';
import test from 'node:test';
import {loadWorkspace} from './ci-scope.mjs';
import {createPlan} from './ci-plan.mjs';
const workspace=loadWorkspace();
const head='a'.repeat(40), base='b'.repeat(40), before='c'.repeat(40);
const repository='waitron-io/waitron-cloud';
const api=()=>{throw Error('unavailable');};
test('PR planner uses exact SHAs and NUL paths, preserving spaces and both rename owners', () => {
  const calls=[];
  const git=(...args)=>{calls.push(args);return args[0]==='merge-base'?base:'apps/portal/test/a b.ts\0packages/identity/old.ts\0';};
  const plan=createPlan({pull_request:{head:{sha:head},base:{sha:base}}},{sha:head,repository,branch:'main'},workspace,git,api);
  assert.equal(plan.packages.length,18);
  assert.deepEqual(calls,[['merge-base',base,head],['diff','--name-only','--no-renames','-z',base,head]]);
});
test('every direct, multi-commit, unknown and failed-evidence push falls back to the full twenty jobs', () => {
  for (const event of [{}, {before,commits:[{},{}]}, {before,commits:[{}],forced:true}, {before,commits:[{}]}]) {
    const plan=createPlan(event,{sha:head,repository,branch:'main'},workspace,()=>before,api);
    assert.equal(plan.packages.length,20);
    assert.equal(plan.receipts.length,5);
    assert.equal(plan.reuse,null);
  }
  const plan=createPlan({pull_request:{head:{sha:head},base:{sha:base}}},{sha:head,repository,branch:'main'},workspace,()=>{throw Error('missing base');},api);
  assert.equal(plan.packages.length,20);
});
