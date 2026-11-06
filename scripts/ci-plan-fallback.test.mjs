import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {selectPlan} from './ci-plan.mjs';
import {loadWorkspaceAtRevision} from './ci-workspace-snapshot.mjs';

function fixture(t, count = 1) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-plan-fallback-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const put = (name, text) => {mkdirSync(join(root, name, '..'), {recursive: true}); writeFileSync(join(root, name), text);};
  git('init', '-qb', 'main'); git('config', 'user.name', 'Fallback test'); git('config', 'user.email', 'ci@example.test');
  put('package.json', '{"name":"fallback-test","private":true}\n');
  put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
  put('packages/operations/package.json', '{"name":"@waitron-cloud/operations","scripts":{"test":"node --test test/*.test.ts"}}\n');
  put('packages/operations/src/index.ts', 'export {};\n'); put('packages/operations/test/index.test.ts', 'export {};\n');
  git('add', '.'); git('commit', '-qsm', 'Baseline'); const base = git('rev-parse', 'HEAD').trim();
  for (let i = 0; i < count; i++) put(`unclassified/${i}-${'x'.repeat(65)}.txt`, 'input\n');
  git('add', '.'); git('commit', '-qsm', 'Changed inputs');
  put('unclassified/final.txt', 'another input\n'); git('add', '.'); git('commit', '-qsm', 'Final input');
  const head = git('rev-parse', 'HEAD').trim();
  const execution = git('commit-tree', git('rev-parse', 'HEAD^{tree}').trim(), '-p', base, '-p', head, '-m', 'PR execution').trim();
  const bin = join(root, '.git/bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\n[ "$CI_API_DOWN" != 1 ] || exit 7\ncase " $* " in *" --slurp "*) cat "$CI_API_JOBPAGES"; exit;; esac\nprintf \'HTTP/1.1 200 OK\\r\\n\\r\\n\'\ncase "$*" in *"/jobs?"*) cat "$CI_API_JOBFILE";; *) cat "$CI_API_RUNFILE";; esac\n', {mode: 0o700});
  const run = (key, {down = false, fork = false, branch = 'feature', repository = 'waitron-io/waitron-cloud', inputs = {}, empty = false, push = false, wrongAfter = false} = {}) => {
    rmSync(join(root, '.ci-evidence'), {recursive: true, force: true});
    const repo = {id: 123, full_name: repository}, headRepo = fork ? {id: 456, full_name: 'contributor/waitron-cloud'} : repo;
    const event = push ? {before: empty ? head : base, after: wrongAfter ? 'invalid-after' : head, forced: false, deleted: false, created: false}
      : {number: 51, pull_request: {number: 51, base: {sha: empty ? head : base, ref: 'main', repo}, head: {sha: head, ref: branch, repo: headRepo}}};
    const path = `.github/workflows/${key}.yml`, eventName = push ? 'push' : 'pull_request', ref = push ? 'refs/heads/main' : 'refs/pull/51/merge';
    const eventFile = join(root, '.git/event.json'), output = join(root, '.git/output'), api = join(root, '.git/run.json');
    writeFileSync(eventFile, JSON.stringify(event)); writeFileSync(output, '');
    writeFileSync(api, JSON.stringify({id: 42, run_attempt: 1, workflow_id: 17, path, event: eventName,
      head_sha: head, head_branch: push ? 'main' : branch, repository: repo, head_repository: headRepo,
      status: 'in_progress', conclusion: null, pull_requests: [], referenced_workflows: []}));
    let environment;
    const result = spawnSync(process.execPath, [resolve(`scripts/${key === 'ci' ? 'ci-plan' : 'ci-native-plan'}.mjs`)],
      {cwd: root, encoding: 'utf8', timeout: 30_000, env: environment = {...process.env, PATH: `${bin}:${process.env.PATH}`,
        CI_API_DOWN: down ? '1' : '0', CI_API_RUNFILE: api, CI_WORKFLOW_PATH: path, CI_WORKFLOW_INPUTS: JSON.stringify(inputs),
        CI_RECORD_EVIDENCE: 'true', CI_FULL: 'false', CI_FORCE_FULL: 'false', CI_CALLED: 'false',
        GITHUB_EVENT_PATH: eventFile, GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: eventName, GITHUB_SHA: push ? head : execution,
        GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: '123', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1',
        GITHUB_REF: ref, GITHUB_REF_NAME: push ? 'main' : '51/merge', GITHUB_WORKFLOW_REF: `${repository}/${path}@${ref}`,
        GITHUB_WORKFLOW_SHA: push ? head : execution}});
    const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(line => {const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];}));
    return {...result, outputs, env: environment};
  };
  return {root, git, base, head, run};
}

for (const key of ['ci', 'aws-infrastructure', 'cloud-cost', 'venue-services-proof', 'download-supervision-diagnostic']) {
  test(`${key} ordinary checks survive unavailable or ineligible reuse evidence`, async t => {
    const f = fixture(t);
    for (const options of [{down: true}, {fork: true}, {repository: 'someone/waitron-cloud'}, {branch: 'deps/bump+pkg@2'}, {inputs: null}, {empty: true}, {empty: true, push: true}, {push: true, wrongAfter: true}]) {
      await t.test(JSON.stringify(options), () => {
      const result = f.run(key, options);
      assert.equal(result.status, 0, JSON.stringify(options) + ': ' + result.stdout + result.stderr);
      const plan = JSON.parse(result.outputs.plan);
      assert.equal(key === 'ci' ? plan.typecheck : plan.required, true);
      if (options.down || options.empty || options.wrongAfter) assert.equal(result.outputs.mode, 'full');
      if (options.down || options.fork || options.repository) assert.equal(result.outputs.source_artifact, undefined);
      if (options.branch) assert.ok(result.outputs.source_artifact, 'A valid Git branch can record source evidence');
      });
    }
  });
}

test('large native selections keep full work while source and main evidence stay bounded', t => {
  const f = fixture(t, 4000);
  for (const push of [false, true]) {
    const result = f.run('aws-infrastructure', {push});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.outputs.mode, 'full');
    assert.equal(JSON.parse(result.outputs.plan).required, true);
    assert.ok(Buffer.byteLength(readFileSync(join(f.root, '.ci-evidence', push ? 'decision/plan.json' : 'source/plan.json'))) <= 256 * 1024);
  }
});

test('recorded long CI explanations equal their independently reconstructed selection', t => {
  const f = fixture(t, 120);
  const result = f.run('ci');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const observed = JSON.parse(result.outputs.plan);
  assert.ok(observed.reason.length <= 4123);
  assert.equal(observed.typecheck, true);
  assert.deepEqual(observed.packages, [{package: '@waitron-cloud/operations', shard: 1}]);
  assert.equal(observed.receipts.length, 6);
  assert.deepEqual(observed, selectPlan({base: f.base, head: f.head}, loadWorkspaceAtRevision(f.head, f.git), f.git));
});


for (const key of ['ci', 'aws-infrastructure']) {
  test(`${key} final summary completes a real full decision after planner metadata refusal`, t => {
    const f = fixture(t), planned = f.run(key, {push: true, down: true});
    assert.equal(planned.status, 0, planned.stdout + planned.stderr);
    assert.equal(planned.outputs.mode, 'full'); assert.equal(planned.outputs.decision_artifact, undefined);
    const names = key === 'ci' ? ['changes', 'typecheck', 'root (1/8)', 'root (2/8)', 'root (3/8)', 'root (4/8)', 'root (5/8)', 'root (6/8)', 'root (7/8)', 'root (8/8)',
      'package (@waitron-cloud/operations)', 'receipts', 'summary', 'scripts', 'documentation']
      : ['changes', 'verify (guards-1)', 'verify (guards-2)', 'verify (guards-3)', 'verify (suites)', 'summary'];
    const jobs = names.map((name, i) => ({id: i + 1, name, run_id: 42, run_attempt: 1, head_sha: f.head,
      status: name === 'summary' ? 'in_progress' : 'completed', conclusion: name === 'summary' ? null : ['scripts', 'documentation'].includes(name) ? 'skipped' : 'success'}));
    const jobFile = join(f.root, '.git/jobs.json'), jobPages = join(f.root, '.git/job-pages.json');
    writeFileSync(jobFile, JSON.stringify({total_count: jobs.length, jobs})); writeFileSync(jobPages, JSON.stringify([{total_count: jobs.length, jobs}]));
    const results = key === 'ci' ? {changes: {result: 'success'}, root: {result: 'success'}, typecheck: {result: 'success'},
      packages: {result: 'success'}, receipts: {result: 'success'}, scripts: {result: 'skipped'}, documentation: {result: 'skipped'}}
      : {changes: {result: 'success'}, verify: {result: 'success'}};
    const completed = spawnSync(process.execPath, [resolve(`scripts/${key === 'ci' ? 'ci-summary' : 'ci-native-summary'}.mjs`)],
      {cwd: f.root, encoding: 'utf8', timeout: 30_000, env: {...planned.env, CI_API_DOWN: '0', CI_API_JOBFILE: jobFile,
        CI_API_JOBPAGES: jobPages, CI_PLAN: planned.outputs.plan, CI_MODE: 'full', CI_RECORD_DECISION: 'true',
        CI_DECISION_ARTIFACT: '', CI_RESULTS: JSON.stringify(results), CI_HEAD_SHA: f.head, CI_JOB_PREFIX: ''}});
    assert.equal(completed.status, 0, completed.stdout + completed.stderr);
    const record = JSON.parse(readFileSync(join(f.root, '.ci-evidence/decision/plan.json'), 'utf8'));
    assert.equal(record.mode, 'full'); assert.equal(record.context.workflowId, 17); assert.equal(record.context.sha, f.head);
    assert.equal(Boolean(record.selection.reuse), false);
  });
}
