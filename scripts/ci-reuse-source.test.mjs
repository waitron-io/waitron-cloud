import assert from 'node:assert/strict';
import test, {before, after} from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {findReuse} from './ci-reuse.mjs';
import {createPlan, selectPlan} from './ci-plan.mjs';
import {loadWorkspaceAtRevision} from './ci-workspace-snapshot.mjs';
import {waitForSummary} from './ci-summary.mjs';
import {createPlanEvidence} from './ci-evidence.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';
import {auditDocumentation} from './ci-docs.mjs';

const repository = 'waitron-io/waitron-cloud', workflow = '.github/workflows/ci.yml';
const repo = {id: 123, full_name: repository, default_branch: 'main'};
let root, git, base, head, merge, execution, tree, source, jobs, artifact, bytes;
const page = items => ({items, total_count: items.length, nextPage: null, terminal: true});
const selected = {packages: [{package: '@waitron-cloud/operations', shard: 1}],
  receipts: ['test:two-venue-milestone-receipt', 'test:backup-capacity', 'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt', 'test:cloud-cost'],
  typecheck: true, reuse: null, reason: 'Shared, unaudited or unknown paths: full suite (unknown-input)'};

function archive(value) {
  const content = Buffer.from(JSON.stringify(value)), name = Buffer.from('plan.json');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc32(content), 14); local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
  const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 6);
  entry.writeUInt32LE(crc32(content), 16); entry.writeUInt32LE(content.length, 20); entry.writeUInt32LE(content.length, 24); entry.writeUInt16LE(name.length, 28);
  const data = Buffer.concat([local, name, content]), directory = Buffer.concat([entry, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(data.length, 16);
  return Buffer.concat([data, directory, end]);
}
before(() => {
  root = mkdtempSync(join(tmpdir(), 'cloud-reuse-source-'));
  const real = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const put = (path, text) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), text);};
  real('init', '-b', 'main'); real('config', 'user.name', 'CI test'); real('config', 'user.email', 'ci@example.test');
  cpSync(new URL('./', import.meta.url), join(root, 'scripts'), {recursive: true,
    filter: path => !String(path).includes('ci-input-audit.d')});
  cpSync(new URL('../.github', import.meta.url), join(root, '.github'), {recursive: true});
  cpSync(new URL('../package.json', import.meta.url), join(root, 'package.json'));
  cpSync(new URL('../pnpm-lock.yaml', import.meta.url), join(root, 'pnpm-lock.yaml'));
  put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
  put('packages/operations/package.json', '{"name":"@waitron-cloud/operations","scripts":{"test":"node --test test/*.test.ts"}}\n');
  put('packages/operations/src/index.ts', 'export const available = true;\n');
  put('packages/operations/test/index.test.ts', "import test from 'node:test'; test('available', () => {});\n");
  real('add', '.'); real('commit', '-qsm', 'Base'); base = real('rev-parse', 'HEAD').trim();
  real('checkout', '-b', 'feature'); put('unknown-input', 'new input\n'); real('add', '.'); real('commit', '-qsm', 'Feature');
  head = real('rev-parse', 'HEAD').trim(); tree = real('rev-parse', 'HEAD^{tree}').trim();
  execution = real('commit-tree', tree, '-p', base, '-p', head, '-m', 'PR execution').trim();
  merge = real('commit-tree', tree, '-p', base, '-m', 'Squash').trim(); real('checkout', '--detach', merge);
  const cache = new Map();
  git = (...args) => {
    const key = JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, real(...args));
    return cache.get(key);
  };
  git.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
  source = createPlanEvidence({version: 1, repository, repositoryId: 123, pr: 51,
    event: {name: 'pull_request', number: 51, base: {sha: base, ref: 'main', repositoryId: 123, repository},
      head: {sha: head, ref: 'feature', repositoryId: 123, repository}, mergeBase: base, sha: execution},
    checkout: {sha: head, tree}, workflow: {id: 17, path: workflow, ref: `${repository}/${workflow}@refs/pull/51/merge`, sha: execution, executionSha: execution},
    runId: 42, attempt: 2, selection: selected});
  const required = ['changes', 'summary', 'typecheck', 'root (1/4)', 'root (2/4)', 'root (3/4)', 'root (4/4)', 'package (@waitron-cloud/operations)', 'receipts'];
  jobs = [...required, 'documentation', 'scripts'].map((name, index) => ({id: index + 1, name, run_id: 42, run_attempt: 2, head_sha: head,
    status: 'completed', conclusion: required.includes(name) ? 'success' : 'skipped'}));
  bytes = archive(source);
  artifact = {id: 61, name: 'ci-plan-v1-ci-42-2', expired: false, size_in_bytes: bytes.length,
    digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
    workflow_run: {id: 42, head_sha: head, repository_id: 123, head_repository_id: 123}};
});
after(() => {if (root) rmSync(root, {recursive: true, force: true});});

const primaryState = () => ({root, base, head, merge, execution, tree, jobs, bytes, artifact});
function fixture(state = primaryState()) {
  const {root, base, head, merge, execution, tree, jobs, bytes, artifact} = state;
  const run = {id: 42, workflow_id: 17, path: workflow, event: 'pull_request', repository: repo, head_repository: repo,
    head_sha: head, head_branch: 'feature', run_attempt: 2, status: 'completed', conclusion: 'success', pull_requests: [], referenced_workflows: []};
  const pr = {id: 901, number: 51, state: 'closed', merged_at: '2026-11-05T08:00:00Z', merge_commit_sha: merge,
    base: {sha: base, ref: 'main', repo}, head: {sha: head, ref: 'feature', repo}};
  const commits = {};
  for (const sha of [base, head, merge, execution]) commits[sha] = JSON.parse(execFileSync('git', ['show', '-s', '--format={"sha":"%H","tree":{"sha":"%T"},"parents":"%P"}', sha], {cwd: root, encoding: 'utf8'}));
  for (const value of Object.values(commits)) value.parents = value.parents.split(' ').filter(Boolean).map(sha => ({sha}));
  const data = structuredClone({repo, workflow: {id: 17, path: workflow, state: 'active'}, prs: [pr], runs: [run], run, commits, jobs, artifacts: [artifact]});
  let time = 0;
  const api = {readRepository: () => data.repo, readWorkflow: () => data.workflow, readCommit: sha => data.commits[sha],
    listAssociatedPRs: () => page(data.prs), listRuns: () => page(data.runs), readRun: id => id === 90 ? {
      ...run, id: 90, event: 'push', head_sha: merge, head_branch: 'main', run_attempt: 1, status: 'in_progress', conclusion: null,
    } : data.run,
    listAttemptJobs: () => page(data.jobs), listArtifacts: () => page(data.artifacts), readPlanArtifact: () => bytes};
  const context = {repository, repositoryId: 123, sha: merge, eventName: 'push', ref: 'refs/heads/main', runId: 90, attempt: 1, workflowId: 17,
    event: {before: base, after: merge, forced: false, deleted: false, created: false}};
  return {data, api, context, now: () => time, advance: value => {time = value;}};
}
const verify = f => findReuse(f.context, {api: f.api, git, now: f.now}, workflow);
const refusal = f => {const value = verify(f); assert.equal(value?.reuse, null, JSON.stringify(value)); assert.ok(value.reason.length > 0);};

for (const kind of ['docs', 'scoped']) {
  test(`a legitimate ${kind} PR source reuses only its reconstructed successes and explicit skips`, () => {
    const directory = mkdtempSync(join(tmpdir(), `cloud-reuse-${kind}-`));
    try {
      execFileSync('git', ['clone', '--shared', '--quiet', root, directory], {stdio: 'pipe'});
      const variantGit = (...args) => {
        const binary = typeof args.at(-1) === 'object' && args.pop().binary;
        return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: directory, encoding: binary ? null : 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
      };
      variantGit.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: directory, input}));
      variantGit('config', 'user.name', 'CI source test'); variantGit('config', 'user.email', 'ci@example.test');
      variantGit('checkout', '--detach', base);
      execFileSync(process.execPath, ['scripts/ci-input-audit.mjs', '--write-staged'], {cwd: directory, stdio: 'pipe'});
      variantGit('add', '.'); variantGit('commit', '-qsm', 'Audited source baseline');
      const originalBase = variantGit('rev-parse', 'HEAD').trim();
      const path = kind === 'docs' ? 'docs/guide.md' : 'packages/operations/test/scoped.test.ts';
      mkdirSync(join(directory, path, '..'), {recursive: true});
      writeFileSync(join(directory, path), kind === 'docs' ? '# Operations guide\n' : 'export const scoped = true;\n');
      variantGit('add', '.'); variantGit('commit', '-qsm', 'Scoped source');
      const originalHead = variantGit('rev-parse', 'HEAD').trim(), originalTree = variantGit('rev-parse', 'HEAD^{tree}').trim();
      const originalExecution = variantGit('commit-tree', originalTree, '-p', originalBase, '-p', originalHead, '-m', 'PR execution').trim();
      const squash = variantGit('commit-tree', originalTree, '-p', originalBase, '-m', 'Squash').trim();
      variantGit('checkout', '--detach', squash);
      if (kind === 'docs') {
        auditDocumentation(originalBase, variantGit);
        auditDocumentation(originalHead, variantGit);
      }
      const selection = selectPlan({base: originalBase, head: originalHead}, loadWorkspaceAtRevision(originalHead, variantGit), variantGit);
      const required = kind === 'docs' ? ['changes', 'documentation', 'summary']
        : ['changes', 'summary', 'typecheck', 'root (1/4)', 'root (2/4)', 'root (3/4)', 'root (4/4)', 'package (@waitron-cloud/operations)', 'receipts'];
      const skipped = kind === 'docs' ? ['scripts', 'typecheck', 'root (${{ matrix.shard }}/4)',
        "package (${{ matrix.package }}${{ ((matrix.shards && format(', shard {0}/{1}', matrix.shard, matrix.shards)) || '') }})", 'receipts'] : ['scripts', 'documentation'];
      if (kind === 'docs') {
        assert.deepEqual(selection.documentation, {base: originalBase, head: originalHead, paths: ['docs/guide.md']});
        assert.deepEqual(selection.packages, []); assert.deepEqual(selection.receipts, []); assert.equal(selection.typecheck, false);
      } else {
        assert.deepEqual(selection.packages, [{package: '@waitron-cloud/operations', shard: 1}]);
        assert.deepEqual(selection.receipts, ['test:two-venue-milestone-receipt', 'test:backup-capacity', 'test:public-gateway-limits',
          'test:local-stack', 'test:database-recovery-receipt', 'test:cloud-cost']);
        assert.equal(selection.typecheck, true, selection.reason);
      }
      const record = structuredClone(source);
      Object.assign(record.event, {mergeBase: originalBase, sha: originalExecution});
      record.event.base.sha = originalBase; record.event.head.sha = originalHead;
      Object.assign(record.checkout, {sha: originalHead, tree: originalTree});
      Object.assign(record.workflow, {sha: originalExecution, executionSha: originalExecution});
      record.selection = selection;
      const content = archive(createPlanEvidence(record));
      const metadata = {...artifact, size_in_bytes: content.length, digest: 'sha256:' + createHash('sha256').update(content).digest('hex'),
        workflow_run: {...artifact.workflow_run, head_sha: originalHead}};
      const variantJobs = [...required, ...skipped].map((name, i) => ({id: i + 1, run_id: 42, run_attempt: 2, head_sha: originalHead,
        name, status: 'completed', conclusion: required.includes(name) ? 'success' : 'skipped'}));
      const f = fixture({root: directory, base: originalBase, head: originalHead, merge: squash, execution: originalExecution,
        tree: originalTree, jobs: variantJobs, bytes: content, artifact: metadata});
      const accepted = findReuse(f.context, {api: f.api, git: variantGit, now: f.now}, workflow);
      assert.equal(accepted.reuse?.runId, 42, accepted.reason);
      for (const job of variantJobs) {
        const changed = f.data.jobs.find(value => value.id === job.id), previous = changed.conclusion;
        changed.conclusion = previous === 'success' ? 'skipped' : 'success';
        assert.equal(findReuse(f.context, {api: f.api, git: variantGit, now: f.now}, workflow).reuse, null, job.name);
        changed.conclusion = previous;
      }
    } finally {rmSync(directory, {recursive: true, force: true});}
  });
}

test('only independently reconstructed, complete exact-attempt source evidence grants versioned reuse', () => {
  const result = verify(fixture());
  assert.equal(result?.reuse?.version, 1, `Complete source evidence must grant a versioned proof: ${result?.reason}`);
  assert.deepEqual({...result.reuse, planDigest: null, jobsDigest: null}, {version: 1, repository, repositoryId: 123, pr: 51,
    mergeSha: merge, sha: head, tree, workflowId: 17, workflowPath: workflow, runId: 42, attempt: 2, planDigest: null, jobsDigest: null});
  assert.match(result.reuse.planDigest, /^[a-f0-9]{64}$/); assert.match(result.reuse.jobsDigest, /^[a-f0-9]{64}$/);
});

test('the main planner grants empty work only after independently qualifying the exact source', () => {
  const f = fixture(), workspace = loadWorkspaceAtRevision(head, git).packages;
  const plan = createPlan(f.context.event, f.context, workspace, git, f.api);
  assert.equal(plan.reuse?.runId, 42, `The planner must use the verified source: ${plan.reason}`);
  assert.deepEqual(plan.packages, []);
  assert.deepEqual(plan.receipts, []);
  assert.equal(plan.typecheck, false);
  assert.equal(plan.documentation, undefined);
  assert.equal(plan.scripts, undefined);
  f.data.jobs.pop();
  const refused = createPlan(f.context.event, f.context, workspace, git, f.api);
  assert.equal(refused.reuse, null);
  assert.deepEqual(refused.packages, [{package: '@waitron-cloud/operations', shard: 1}]);
  assert.equal(refused.receipts.length, 6);
  assert.equal(refused.typecheck, true);
});

test('final summary requalifies the exact proof after current jobs settle and refuses changed source evidence', async () => {
  const f = fixture(), proof = verify(f).reuse;
  const plan = {packages: [], receipts: [], typecheck: false, reuse: proof};
  const results = {changes: 'success', packages: 'skipped', receipts: 'skipped', typecheck: 'skipped'};
  const options = {readJobs: () => [{name: 'changes', status: 'completed', conclusion: 'success'}],
    reuseContext: f.context, reuseDependencies: {api: f.api, git, now: f.now}};
  await waitForSummary(plan, results, options);
  f.data.run.run_attempt = 3;
  await assert.rejects(waitForSummary(plan, results, options), /[Rr]euse|[Ss]ource/);
  const changed = fixture();
  await assert.rejects(waitForSummary({...plan, reuse: {...proof, jobsDigest: 'f'.repeat(64)}}, results,
    {...options, reuseDependencies: {api: changed.api, git, now: changed.now}}), /[Pp]roof|[Ee]vidence/);
  const racing = fixture();
  await assert.rejects(waitForSummary(plan, results, {...options,
    reuseDependencies: {api: racing.api, git, now: racing.now},
    readJobs: () => {racing.data.run.conclusion = 'failure'; return options.readJobs();},
  }), /[Rr]euse|[Ss]ource/);
});

function runtimeFixture(f) {
  const directory = mkdtempSync(join(tmpdir(), 'cloud-reuse-runtime-'));
  const endpoint = `repos/${repository}`;
  const responses = {[endpoint]: f.data.repo,
    [`${endpoint}/actions/workflows/ci.yml`]: f.data.workflow,
    [`${endpoint}/commits/${merge}/pulls?per_page=100&page=1`]: f.data.prs,
    [`${endpoint}/actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=100&page=1`]: {total_count: f.data.runs.length, workflow_runs: f.data.runs},
    [`${endpoint}/actions/runs/42`]: f.data.run,
    [`${endpoint}/actions/runs/90`]: f.api.readRun(90),
    [`${endpoint}/actions/runs/42/attempts/2/jobs?per_page=100&page=1`]: {total_count: f.data.jobs.length, jobs: f.data.jobs},
    [`${endpoint}/actions/runs/42/artifacts?per_page=100&page=1`]: {total_count: f.data.artifacts.length, artifacts: f.data.artifacts},
    [`${endpoint}/actions/artifacts/61/zip`]: {binary: bytes.toString('base64')},
    [`${endpoint}/actions/runs/90/jobs?filter=latest&per_page=100`]: [{jobs: [
      {name: 'changes', status: 'completed', conclusion: 'success'},
    ]}],
  };
  for (const [sha, value] of Object.entries(f.data.commits)) responses[`${endpoint}/git/commits/${sha}`] = value;
  writeFileSync(join(directory, 'responses.json'), JSON.stringify(responses));
  writeFileSync(join(directory, 'event.json'), JSON.stringify(f.context.event));
  writeFileSync(join(directory, 'output'), '');
  writeFileSync(join(directory, 'gh'), `#!${process.execPath}
import {readFileSync, appendFileSync} from 'node:fs';
const endpoint = process.argv.at(-1);
appendFileSync(process.env.CI_API_CALLS, endpoint + '\\n');
const response = JSON.parse(readFileSync(process.env.CI_API_RESPONSES))[endpoint];
if (response === undefined) process.exit(2);
if (response.binary) process.stdout.write(Buffer.from(response.binary, 'base64'));
else process.stdout.write((process.argv.includes('--include') ? 'HTTP/2 200 OK\\r\\n\\r\\n' : '') + JSON.stringify(response));
`, {mode: 0o700});
  return {directory, responses, env: {...process.env, PATH: `${directory}:${process.env.PATH}`,
    CI_API_CALLS: join(directory, 'calls'), CI_API_RESPONSES: join(directory, 'responses.json'),
    GITHUB_EVENT_PATH: join(directory, 'event.json'), GITHUB_OUTPUT: join(directory, 'output'),
    GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: '123', GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'main', GITHUB_SHA: merge, GITHUB_RUN_ID: '90', GITHUB_RUN_ATTEMPT: '1',
    CI_WORKFLOW_ID: '17', GITHUB_WORKFLOW_REF: `${repository}/${workflow}@refs/heads/main`,
    CI_FULL: 'false', CI_CALLED: 'false', CI_WORKFLOW_INPUTS: '{}'}};
}

test('executed main planner and summary use bounded source reads and fail after a newer source turns red', () => {
  const f = fixture(), runtime = runtimeFixture(f);
  try {
    const run = script => spawnSync(process.execPath, [script], {cwd: root, env: runtime.env, encoding: 'utf8', timeout: 30_000});
    const planned = run('scripts/ci-plan.mjs');
    assert.equal(planned.status, 0, planned.stderr);
    const output = Object.fromEntries(readFileSync(join(runtime.directory, 'output'), 'utf8').trim().split('\n').map(line => {
      const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
    }));
    const plan = JSON.parse(output.plan);
    assert.equal(plan.reuse?.runId, 42, `Executable planner must qualify its source: ${plan.reason}`);
    for (const name of ['packages', 'receipts', 'typecheck', 'documentation', 'scripts']) assert.equal(output[name], 'false');
    runtime.env.CI_PLAN = JSON.stringify(plan);
    runtime.env.CI_RESULTS = JSON.stringify({changes: {result: 'success'}, packages: {result: 'skipped'},
      receipts: {result: 'skipped'}, typecheck: {result: 'skipped'}});
    const summary = run('scripts/ci-summary.mjs');
    assert.equal(summary.status, 0, summary.stdout + summary.stderr);
    f.data.run.conclusion = 'failure';
    writeFileSync(join(runtime.directory, 'responses.json'), JSON.stringify(runtime.responses));
    const refused = run('scripts/ci-summary.mjs');
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /[Rr]euse|[Ss]ource/);
  } finally {rmSync(runtime.directory, {recursive: true, force: true});}
});

test('operator readback binds the local decision to its main artifact, final jobs and a still-green source', () => {
  const f = fixture(), runtime = runtimeFixture(f);
  try {
    runtime.env.GITHUB_WORKFLOW_SHA = merge;
    runtime.env.CI_MODE = 'reused';
    runtime.env.CI_PLAN = JSON.stringify({packages: [], receipts: [], typecheck: false, reuse: verify(f).reuse, reason: 'Verified source'});
    const decisionPath = join(runtime.directory, 'decision.json');
    const write = spawnSync(process.execPath, ['scripts/ci-evidence.mjs', '--decision', decisionPath],
      {cwd: root, env: runtime.env, encoding: 'utf8', timeout: 30_000});
    assert.equal(write.status, 0, `Decision writer must publish the actual main decision: ${write.stderr}`);
    const decision = JSON.parse(readFileSync(decisionPath));
    assert.equal(decision.mode, 'reused');
    assert.equal(decision.context.event.before, base);
    const decisionBytes = archive(decision), endpoint = `repos/${repository}`;
    runtime.responses[`${endpoint}/actions/runs/90`].status = 'completed';
    runtime.responses[`${endpoint}/actions/runs/90`].conclusion = 'success';
    const unused = ['scripts', 'documentation', 'typecheck', 'root (${{ matrix.shard }}/4)',
      "package (${{ matrix.package }}${{ ((matrix.shards && format(', shard {0}/{1}', matrix.shard, matrix.shards)) || '') }})", 'receipts'];
    const currentJobs = ['changes', 'summary', ...unused].map((name, i) => ({id: i + 100, run_id: 90, run_attempt: 1,
      head_sha: merge, name, status: 'completed', conclusion: unused.includes(name) ? 'skipped' : 'success'}));
    runtime.responses[`${endpoint}/actions/runs/90/attempts/1/jobs?per_page=100&page=1`] = {total_count: currentJobs.length, jobs: currentJobs};
    runtime.responses[`${endpoint}/actions/runs/90/artifacts?per_page=100&page=1`] = {total_count: 1, artifacts: [{id: 62,
      name: 'ci-decision-v1-ci-90-1', expired: false, size_in_bytes: decisionBytes.length,
      digest: 'sha256:' + createHash('sha256').update(decisionBytes).digest('hex'),
      workflow_run: {id: 90, head_sha: merge, repository_id: 123, head_repository_id: 123}}]};
    runtime.responses[`${endpoint}/actions/artifacts/62/zip`] = {binary: decisionBytes.toString('base64')};
    const readback = () => {
      writeFileSync(join(runtime.directory, 'responses.json'), JSON.stringify(runtime.responses));
      return spawnSync(process.execPath, ['scripts/ci-evidence.mjs', '--readback', decisionPath],
        {cwd: root, env: runtime.env, encoding: 'utf8', timeout: 30_000});
    };
    const accepted = readback();
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.match(accepted.stdout, /inherited|[Rr]eused/);
    const mainRun = runtime.responses[`${endpoint}/actions/runs/90`];
    for (const change of [{run_attempt: 2}, {head_sha: head}, {event: 'pull_request'}, {workflow_id: 18},
      {path: '.github/workflows/other.yml'}, {status: 'in_progress'}, {conclusion: 'failure'}]) {
      const original = {...mainRun}; Object.assign(mainRun, change);
      assert.equal(readback().status, 1, `Main identity/result must be final and exact: ${JSON.stringify(change)}`);
      Object.assign(mainRun, original);
    }
    for (const change of [{run_id: 91}, {run_attempt: 2}, {head_sha: head}, {name: 'unknown'},
      {status: 'in_progress'}, {conclusion: 'failure'}]) {
      const original = {...currentJobs[0]}; Object.assign(currentJobs[0], change);
      assert.equal(readback().status, 1, `Main job must match the exact attempt and plan: ${JSON.stringify(change)}`);
      Object.assign(currentJobs[0], original);
    }
    const forged = structuredClone(decision); forged.context.event.before = head;
    writeFileSync(decisionPath, JSON.stringify(forged));
    assert.equal(readback().status, 1, 'Locally forged event fields cannot replace the hosted artifact');
    const forgedExplanation = structuredClone(decision); forgedExplanation.selection.reason = 'Locally altered decision';
    writeFileSync(decisionPath, JSON.stringify(forgedExplanation));
    const altered = readback();
    assert.equal(altered.status, 1, altered.stdout + altered.stderr);
    assert.match(altered.stderr, /Local decision differs from hosted/);
    writeFileSync(decisionPath, JSON.stringify(decision));
    currentJobs.pop();
    runtime.responses[`${endpoint}/actions/runs/90/attempts/1/jobs?per_page=100&page=1`].total_count--;
    assert.equal(readback().status, 1, 'A missing current skipped family is not qualified reuse');
    runtime.responses[`${endpoint}/actions/runs/90/attempts/1/jobs?per_page=100&page=1`].jobs = [
      ...currentJobs, {id: 999, run_id: 90, run_attempt: 1, head_sha: merge, name: 'receipts', status: 'completed', conclusion: 'skipped'}];
    runtime.responses[`${endpoint}/actions/runs/90/attempts/1/jobs?per_page=100&page=1`].total_count++;
    f.data.run.conclusion = 'failure';
    const red = readback();
    assert.equal(red.status, 1, red.stdout + red.stderr);
    assert.match(red.stderr, /[Rr]euse|[Ss]ource/);
  } finally {rmSync(runtime.directory, {recursive: true, force: true});}
});

function hostDecision(runtime, decision, currentJobs) {
  const endpoint = `repos/${repository}`, content = archive(decision);
  Object.assign(runtime.responses[`${endpoint}/actions/runs/90`], {status: 'completed', conclusion: 'success'});
  runtime.responses[`${endpoint}/actions/runs/90/artifacts?per_page=100&page=1`] = {total_count: 1, artifacts: [{id: 62,
    name: 'ci-decision-v1-ci-90-1', expired: false, size_in_bytes: content.length,
    digest: 'sha256:' + createHash('sha256').update(content).digest('hex'),
    workflow_run: {id: 90, head_sha: merge, repository_id: 123, head_repository_id: 123}}]};
  runtime.responses[`${endpoint}/actions/artifacts/62/zip`] = {binary: content.toString('base64')};
  runtime.responses[`${endpoint}/actions/runs/90/attempts/1/jobs?per_page=100&page=1`] = {total_count: currentJobs.length, jobs: currentJobs};
  writeFileSync(join(runtime.directory, 'responses.json'), JSON.stringify(runtime.responses));
}

test('executed planner forces full work for an explicit false-input call and every full invocation without API reads', () => {
  for (const overrides of [{CI_WORKFLOW_INPUTS: '{"full":false}'}, {CI_FULL: 'true'}, {CI_CALLED: 'true'},
    ...['schedule', 'workflow_dispatch', 'workflow_call'].map(GITHUB_EVENT_NAME => ({GITHUB_EVENT_NAME}))]) {
    const runtime = runtimeFixture(fixture());
    try {
      const run = spawnSync(process.execPath, ['scripts/ci-plan.mjs'], {cwd: root,
        env: {...runtime.env, ...overrides}, encoding: 'utf8', timeout: 30_000});
      assert.equal(run.status, 0, run.stderr);
      const line = readFileSync(join(runtime.directory, 'output'), 'utf8').split('\n').find(line => line.startsWith('plan='));
      const plan = JSON.parse(line.slice(5));
      assert.equal(plan.reuse, null, JSON.stringify(overrides));
      assert.equal(plan.typecheck, true);
      assert.deepEqual(plan.packages, [{package: '@waitron-cloud/operations', shard: 1}]);
      assert.equal(plan.receipts.length, 6);
      assert.equal(existsSync(join(runtime.directory, 'calls')), false, 'Full invocations must not consult PR evidence');
    } finally {rmSync(runtime.directory, {recursive: true, force: true});}
  }
});

for (const mode of ['selected', 'full']) {
  test(`${mode} main readback reconstructs required work independently of PR success and refuses omitted receipts`, () => {
    const f = fixture(), runtime = runtimeFixture(f);
    try {
      runtime.env.GITHUB_WORKFLOW_SHA = merge;
      runtime.env.CI_MODE = mode;
      runtime.env.CI_PLAN = JSON.stringify(selected);
      const decisionPath = join(runtime.directory, 'decision.json');
      const write = spawnSync(process.execPath, ['scripts/ci-evidence.mjs', '--decision', decisionPath],
        {cwd: root, env: runtime.env, encoding: 'utf8', timeout: 30_000});
      assert.equal(write.status, 0, `${mode} decision emission must work: ${write.stderr}`);
      const decision = JSON.parse(readFileSync(decisionPath));
      const currentJobs = jobs.map(job => ({...job, id: job.id + 100, run_id: 90, run_attempt: 1, head_sha: merge}));
      f.data.run.conclusion = 'failure';
      const readback = record => {
        writeFileSync(decisionPath, JSON.stringify(record));
        hostDecision(runtime, record, currentJobs);
        return spawnSync(process.execPath, ['scripts/ci-evidence.mjs', '--readback', decisionPath],
          {cwd: root, env: runtime.env, encoding: 'utf8', timeout: 30_000});
      };
      const accepted = readback(decision);
      assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
      assert.equal(JSON.parse(accepted.stdout).inherited, null);
      assert.equal(readFileSync(join(runtime.directory, 'calls'), 'utf8').includes('/actions/runs/42'), false,
        'Freshly executed work cannot require an old PR source');
      const omitted = structuredClone(decision); omitted.selection.receipts = ['test:local-stack'];
      const refused = readback(omitted);
      assert.equal(refused.status, 1, refused.stdout + refused.stderr);
      assert.match(refused.stderr, /[Rr]ecomputed|[Ff]ull decision/);
      currentJobs.splice(currentJobs.findIndex(job => job.name === 'root (3/4)'), 1);
      assert.equal(readback(decision).status, 1, 'Current executed work still needs every partition');
    } finally {rmSync(runtime.directory, {recursive: true, force: true});}
  });
}

test('wrong repository, PR, commit, workflow, run and attempt identities refuse reuse', () => {
  for (const mutate of [
    f => {f.context.full = true;}, f => {f.context.called = true;}, f => {f.context.eventName = 'schedule';},
    f => {f.context.ref = 'refs/heads/feature';}, f => {f.context.event.forced = true;}, f => {f.context.event.after = head;},
    f => {f.data.repo.id = 999;}, f => {f.data.repo.full_name = 'attacker/fork';}, f => {f.data.repo.default_branch = 'other';},
    f => {f.data.prs.push({...f.data.prs[0], id: 902});}, f => {f.data.prs[0].state = 'open';}, f => {f.data.prs[0].merged_at = null;},
    f => {f.data.prs[0].number = 52;}, f => {f.data.prs[0].merge_commit_sha = head;}, f => {f.data.prs[0].base.ref = 'other';},
    f => {f.data.prs[0].head.repo = {...repo, id: 999};}, f => {f.data.prs[0].head.sha = base;},
    f => {f.data.commits[head].sha = merge;}, f => {f.data.commits[head].tree.sha = '0'.repeat(40);},
    f => {f.data.commits[merge].tree.sha = 'd'.repeat(40);}, f => {f.data.commits[execution].parents.reverse();},
    f => {f.data.workflow.id = 18;}, f => {f.data.workflow.path = '.github/workflows/other.yml';}, f => {f.data.workflow.state = 'disabled_manually';},
    ...['event', 'path', 'head_sha', 'head_branch', 'status', 'conclusion', 'workflow_id', 'run_attempt'].map(key => f => {
      for (const value of [f.data.run, f.data.runs[0]]) value[key] = ({workflow_id: 18, run_attempt: 0})[key] ?? 'wrong';
    }),
    f => {f.data.run.head_repository = {...repo, full_name: 'attacker/fork'}; f.data.runs[0] = f.data.run;},
    f => {f.data.run.pull_requests = [{number: 52}]; f.data.runs[0] = f.data.run;},
    f => {f.data.run.referenced_workflows = [{path: 'attacker/fork/.github/workflows/a.yml@main', sha: head}]; f.data.runs[0] = f.data.run;},
  ]) {const f = fixture(); mutate(f); refusal(f);}
});

test('every selected job and justified skip is required; overall green cannot hide omissions', () => {
  for (const index of jobs.keys()) {
    const f = fixture(); f.data.jobs.splice(index, 1); refusal(f);
  }
  for (const change of [{id: 0}, {name: 'unknown'}, {run_id: 43}, {run_attempt: 1}, {head_sha: merge},
    {status: 'queued'}, {conclusion: 'failure'}, {conclusion: 'cancelled'}, {conclusion: 'skipped'}]) {
    const f = fixture(); Object.assign(f.data.jobs[1], change); refusal(f);
  }
  for (const change of [{id: 1}, {name: 'changes'}, {conclusion: 'success'}]) {
    const f = fixture(); Object.assign(f.data.jobs.at(-1), change); refusal(f);
  }
});

test('newest red run and changes during final rereads invalidate an older green proof', () => {
  const red = fixture(); red.data.runs.push({...red.data.runs[0], id: 43, conclusion: 'failure'}); refusal(red);
  for (const action of ['attempt', 'new-run', 'red', 'deadline']) {
    const f = fixture();
    const original = f.api.listAttemptJobs;
    f.api.listAttemptJobs = (...args) => {
      const result = original(...args);
      if (action === 'attempt') f.data.run = {...f.data.run, run_attempt: 3};
      if (action === 'new-run') f.data.runs.push({...f.data.run, id: 43});
      if (action === 'red') f.data.run = {...f.data.run, conclusion: 'failure'};
      if (action === 'deadline') f.advance(30_000);
      return result;
    };
    refusal(f);
  }
});

test('expired, forged, duplicate or unavailable artifacts and all failed reads refuse reuse', () => {
  for (const change of [{expired: true}, {digest: 'sha256:' + '0'.repeat(64)}, {name: 'ci-plan-v1-ci-42-1'}, {size_in_bytes: 0}]) {
    const f = fixture(); Object.assign(f.data.artifacts[0], change); refusal(f);
  }
  const duplicate = fixture(); duplicate.data.artifacts.push({...duplicate.data.artifacts[0], id: 62}); refusal(duplicate);
  for (const method of ['readRepository', 'readWorkflow', 'readCommit', 'listAssociatedPRs', 'listRuns', 'readRun', 'listAttemptJobs', 'listArtifacts', 'readPlanArtifact']) {
    const f = fixture(); f.api[method] = () => {throw Error('Unavailable evidence');}; refusal(f);
  }
  const f = fixture();
  assert.equal(findReuse(f.context, {api: f.api, git: () => {throw Error('Missing immutable object');}, now: f.now}, workflow)?.reuse, null);
});

test('historical selector and native directory inventories must match the running reviewed code', () => {
  for (const path of ['scripts/ci-plan.mjs', 'scripts/ci-input-audit-records.mjs', 'scripts/cloud-cost/conformance.mjs']) {
    const f = fixture();
    const changed = (...args) => {
      let result = git(...args);
      if (args[0] === 'ls-tree' && args.at(-1) === head) {
        result = result.split('\0').map(entry => entry.endsWith(`\t${path}`) ? entry.replace(/blob [a-f0-9]{40}/, 'blob ' + 'd'.repeat(40)) : entry).join('\0');
      }
      return result;
    };
    changed.readBlobs = git.readBlobs;
    const result = findReuse(f.context, {api: f.api, git: changed, now: f.now}, workflow);
    assert.equal(result.reuse, null, `Changed reviewed input ${path} must refuse reuse`);
  }
  const f = fixture();
  const addedFixture = (...args) => git(...args) + (args[0] === 'ls-tree' && args.at(-1) === head
    ? `100644 blob ${'d'.repeat(40)}\tscripts/cloud-cost/fixtures/additional-conformance.test.mjs\0` : '');
  addedFixture.readBlobs = git.readBlobs;
  assert.equal(findReuse(f.context, {api: f.api, git: addedFixture, now: f.now}, workflow).reuse, null, 'Historical native discovery cannot use today’s fixture list');
});

test('a self-consistent artifact cannot forge original provenance or alter the reconstructed plan', () => {
  for (const mutate of [
    record => {record.pr = record.event.number = 52; record.workflow.ref = `${repository}/${workflow}@refs/pull/52/merge`;},
    record => {record.event.head.ref = 'other';}, record => {record.workflow.id = 18;},
    record => {record.workflow.sha = head;}, record => {record.selection.reason = 'forged selection';},
    record => {record.event.base.sha = head;}, record => {record.event.mergeBase = head;},
  ]) {
    const f = fixture(), record = structuredClone(source); mutate(record);
    const forged = archive(createPlanEvidence(record));
    f.data.artifacts[0].size_in_bytes = forged.length;
    f.data.artifacts[0].digest = 'sha256:' + createHash('sha256').update(forged).digest('hex');
    f.api.readPlanArtifact = () => forged;
    refusal(f);
  }
});

test('execution definitions and the operator checkout must match the exact source', () => {
  for (const fault of ['execution-definition', 'operator-tree']) {
    const f = fixture();
    const altered = (...args) => {
      const value = git(...args);
      if (fault === 'operator-tree' && args.join(' ') === 'rev-parse HEAD^{tree}') return 'e'.repeat(40);
      if (fault === 'execution-definition' && args[0] === 'ls-tree' && args.at(-1) === execution) {
        return value.split('\0').map(entry => entry.endsWith(`\t${workflow}`) ? entry.replace(/blob [a-f0-9]{40}/, 'blob ' + 'e'.repeat(40)) : entry).join('\0');
      }
      return value;
    };
    altered.readBlobs = git.readBlobs;
    const result = findReuse(f.context, {api: f.api, git: altered, now: f.now}, workflow);
    assert.equal(result.reuse, null, fault);
  }
});
