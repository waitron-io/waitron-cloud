import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-ci-range-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd:root, encoding:'utf8', stdio:['ignore','pipe','pipe']});
  git('init', '-q'); git('config', 'user.name', 'CI range test'); git('config', 'user.email', 'ci@example.test');
  const write = (path, body) => {mkdirSync(join(root,path,'..'), {recursive:true}); writeFileSync(join(root,path), body);};
  const packages = [['portal', 'apps/portal'], ['ui-smoke', 'packages/ui-smoke']].map(([name,directory]) => ({name:`@waitron-cloud/${name}`, directory, scripts:{test:'node --test test/*.test.ts'}}));
  write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
  for (const pkg of packages) {
    write(`${pkg.directory}/package.json`, JSON.stringify(pkg));
    for (let i=0;i<6;i++) write(`${pkg.directory}/test/case-${i}.test.ts`, 'export {};\n');
  }
  const commit = () => {git('add','.'); git('commit','-qsm','Range fixture'); return git('rev-parse','HEAD').trim();};
  const before = commit();
  return {git,write,commit,before,packages};
}

test('a main push selects the actual changed package instead of repeating full work', t => {
  const {git,write,commit,before,packages} = fixture(t);
  write('apps/portal/test/a b.test.ts', 'export const changed = true;\n');
  const after = commit();
  const calls=[];
  const observed = (...args) => {calls.push(args); return git(...args);};
  const repository = {id: 123, full_name: 'waitron-io/waitron-cloud', default_branch: 'main'};
  const api = {readRepository: () => repository,
    readWorkflow: () => ({id: 17, path: '.github/workflows/ci.yml', state: 'active'}),
    readRun: () => ({id: 90, run_attempt: 1, workflow_id: 17, path: '.github/workflows/ci.yml', event: 'push',
      head_sha: after, head_branch: 'main', repository, head_repository: repository}),
    readCommit: sha => ({sha, tree: {sha: git('rev-parse', `${sha}^{tree}`).trim()},
      parents: git('show', '-s', '--format=%P', sha).trim().split(' ').filter(Boolean).map(sha => ({sha}))}),
    listAssociatedPRs: () => ({items: [], total_count: 0, terminal: true, nextPage: null})};
  const context = {eventName:'push',ref:'refs/heads/main',sha:after,repository:repository.full_name,repositoryId:123,
    runId:90,attempt:1,workflowId:17,branch:'main'};
  const plan=createPlan({before,after}, context, packages, observed, api);
  assert.deepEqual(plan.packages, [1,2,3,4,5,6].map(shard=>({package:'@waitron-cloud/portal',shard,shards:6})));
  assert.deepEqual(plan.receipts,['test:local-stack']);
  assert.ok(calls.some(args=>JSON.stringify(args)===JSON.stringify(['diff','--name-only','--no-renames','-z',before,after])));
  const unavailable = createPlan({before,after}, context, packages, observed,
    {...api, listAssociatedPRs: () => {throw Error('Unavailable association evidence');}});
  assert.equal(unavailable.packages.length, 7);
  assert.equal(unavailable.receipts.length, 6);
});

test('a multi-commit push covers every changed owner in before through after', t => {
  const {git,write,commit,before,packages} = fixture(t);
  write('packages/ui-smoke/test/changed.test.ts','export {};\n'); commit();
  write('apps/portal/test/changed.test.ts','export {};\n'); const after=commit();
  const calls=[];
  const plan=createPlan({before,after,commits:[]}, {eventName:'push',ref:'refs/heads/main',sha:after},packages,(...args)=>{calls.push(args);return git(...args);});
  assert.equal(plan.packages.length,7);
  assert.ok(plan.packages.some(row=>row.package==='@waitron-cloud/ui-smoke'));
  assert.ok(calls.some(args=>args[0]==='diff'&&args.at(-2)===before&&args.at(-1)===after));
});

test('invalid push evidence retains full work', t => {
  const {git,write,commit,before,packages} = fixture(t);
  write('apps/portal/test/changed.test.ts','export {};\n'); const after=commit();
  for (const event of [{before,after,forced:true},{before,after,deleted:true},{before:'0'.repeat(40),after},{before,after:'f'.repeat(40)},{before,after:before},{before:after,after:before}]) {
    const plan=createPlan(event,{eventName:'push',ref:'refs/heads/main',sha:event.after},packages,git);
    assert.equal(plan.packages.length,7);
    assert.equal(plan.receipts.length,6);
  }
  const mismatch=createPlan({before,after},{eventName:'push',ref:'refs/heads/main',sha:before},packages,git);
  assert.equal(mismatch.packages.length,7);
});

test('full invocations ignore a pull-request-shaped payload', () => {
  const packages=[{name:'@waitron-cloud/operations',directory:'packages/operations',scripts:{test:'node --test'}}];
  for (const context of [{eventName:'schedule'},{eventName:'workflow_dispatch'},{eventName:'workflow_call'},{eventName:'pull_request',called:true},{eventName:'pull_request',full:true}]) {
    let reads=0;
    const plan=createPlan({pull_request:{base:{sha:'a'.repeat(40)},head:{sha:'b'.repeat(40)}}},context,packages,()=>{reads++;throw Error('Full invocation must not inspect a PR range');});
    assert.equal(plan.packages.length,1);
    assert.equal(plan.receipts.length,6);
    assert.match(plan.reason,/full/i);
    assert.equal(reads,0);
  }
});
