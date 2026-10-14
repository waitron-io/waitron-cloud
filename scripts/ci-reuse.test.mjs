import assert from 'node:assert/strict';
import test from 'node:test';
import {findReuse} from './ci-reuse.mjs';
const merge = 'a'.repeat(40), head = 'b'.repeat(40), repository = 'waitron-io/waitron-cloud';
function fixture() {
  const pr = {number:9, state:'closed', merged_at:'2026-10-14T09:00:00Z', merge_commit_sha:merge, base:{ref:'main',repo:{full_name:repository}}, head:{sha:head, ref:'test-branch', repo:{full_name:repository}}};
  const run = {id:42, head_sha:head, head_branch:'test-branch', head_repository:{full_name:repository}, event:'pull_request', path:'.github/workflows/ci.yml',status:'completed',conclusion:'success'};
  const jobs = ['changes','typecheck','summary'].map(name=>({name,status:'completed',conclusion:'success'}));
  const data = {prs:[pr], runs:{workflow_runs:[run]}, jobs:{total_count:3,jobs}};
  return {data, api:path=>path.includes('/commits/')?data.prs:path.includes('/jobs?')?data.jobs:data.runs};
}
const trees = ()=>'c'.repeat(40);
test('only the merged associated PR, exact head workflow and equal trees permit reuse', () => {
  const {api} = fixture();
  assert.deepEqual(findReuse({sha:merge, repository, branch:'main'}, api, trees), {sha:head, runId:42});
});
test('behind merge, unrelated PR, changed workflow and every lookup failure require full testing', () => {
  for (const mutate of [
    d=>d.prs[0].merge_commit_sha='d'.repeat(40), d=>d.prs[0].merged_at=null,
    d=>d.prs[0].base.ref='other', d=>d.prs[0].head.repo.full_name='outsider/fork',
    d=>d.prs.push({...d.prs[0],number:10}), d=>d.runs.workflow_runs[0].head_sha=merge,
    d=>d.runs.workflow_runs[0].path='.github/workflows/other.yml',
    d=>d.runs.workflow_runs[0].event='push', d=>d.runs.workflow_runs[0].conclusion='failure',
    d=>d.runs.workflow_runs[0].status='in_progress',d=>d.runs.workflow_runs[0].head_branch='other',
    d=>d.runs.workflow_runs[0].head_repository.full_name='outsider/fork',
    d=>d.runs.workflow_runs.push({...d.runs.workflow_runs[0],id:43,conclusion:'failure'}),
    d=>d.jobs.jobs[2].conclusion='skipped',d=>d.jobs.jobs[1].conclusion='cancelled',
    d=>d.jobs.jobs[1].status='queued',d=>d.jobs.total_count=4,
  ]) {
    const {data,api}=fixture(); mutate(data);
    assert.equal(findReuse({sha:merge,repository,branch:'main'},api,trees),null);
  }
  const {api}=fixture();
  assert.equal(findReuse({sha:merge,repository,branch:'main'},api,sha=>sha===merge?'c'.repeat(40):'d'.repeat(40)),null);
  assert.equal(findReuse({sha:merge,repository,branch:'main'},()=>{throw Error('API unavailable');},trees),null);
  assert.equal(findReuse({sha:merge,repository,branch:'main'},api,()=>{throw Error('missing object');}),null);
  assert.equal(findReuse({sha:merge,repository,branch:'main'},()=>[],trees),null);
});
