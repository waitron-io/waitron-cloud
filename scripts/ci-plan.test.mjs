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
  assert.deepEqual(calls,[['merge-base',base,head],['diff','--name-only','--no-renames','-z',base,head],['ls-tree','-rz','--full-tree',base],['ls-tree','-rz','--full-tree',base],['ls-tree','-rz','--full-tree',base],['ls-tree','-rz','--full-tree',base],['ls-tree','-rz','--full-tree',base]]);
});
test('every direct, multi-commit, unknown and failed-evidence push falls back to the full eighteen jobs', () => {
  for (const event of [{}, {before,commits:[{},{}]}, {before,commits:[{}],forced:true}, {before,commits:[{}]}]) {
    const plan=createPlan(event,{sha:head,repository,branch:'main'},workspace,()=>before,api);
    assert.equal(plan.packages.length,18);
    assert.equal(plan.receipts.length,5);
    assert.equal(plan.reuse,null);
  }
  const plan=createPlan({pull_request:{head:{sha:head},base:{sha:base}}},{sha:head,repository,branch:'main'},workspace,()=>{throw Error('missing base');},api);
  assert.equal(plan.packages.length,18);
});

test('forced, multiple, direct and non-parent pushes cannot reuse even when API evidence is green',()=>{
  const prHead='d'.repeat(40);
  const green=path=>path.includes('/commits/')?[{state:'closed',merged_at:'2026-10-14T09:00:00Z',merge_commit_sha:head,base:{ref:'main',repo:{full_name:repository}},head:{sha:prHead,ref:'feature',repo:{full_name:repository}}}]:path.includes('/jobs?')?{total_count:2,jobs:['changes','summary'].map(name=>({name,status:'completed',conclusion:'success'}))}:{workflow_runs:[{id:42,head_sha:prHead,head_branch:'feature',head_repository:{full_name:repository},event:'pull_request',path:'.github/workflows/ci.yml',status:'completed',conclusion:'success'}]};
  const git=(...args)=>args[1].endsWith('^')?before:'e'.repeat(40);
  assert.deepEqual(createPlan({before,commits:[{}]},{sha:head,repository,branch:'main'},workspace,git,green).reuse,{sha:prHead,runId:42});
  for (const event of [{}, {before,commits:[{},{}]}, {before,commits:[{}],forced:true}, {before:'f'.repeat(40),commits:[{}]}]) {
    const plan=createPlan(event,{sha:head,repository,branch:'main'},workspace,git,green);
    assert.equal(plan.reuse,null);assert.equal(plan.packages.length,18);
  }
});
