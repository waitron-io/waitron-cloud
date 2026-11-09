import assert from 'node:assert/strict';
import test, {before, after} from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync} from 'node:fs';
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
import {readDocumentation} from './ci-docs.mjs';
import {conformanceMatrix} from './cloud-cost/conformance.mjs';
import {createDecisionEvidence, readbackDecision} from './ci-decision.mjs';

const repository = 'waitron-io/waitron-cloud', workflow = '.github/workflows/ci.yml';
const repo = {id: 123, full_name: repository, default_branch: 'main'};
let root, git, base, head, merge, execution, tree, source, jobs, artifact, bytes;
const page = items => ({items, total_count: items.length, nextPage: null, terminal: true});
const selected = {packages: [{package: '@waitron-cloud/operations', shard: 1}],
  receipts: ['test:two-venue-milestone-receipt', 'test:backup-capacity', 'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt', 'test:cloud-cost'],
  typecheck: true, reuse: null, reason: 'Shared or unknown paths: full suite (unknown-input)'};

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
  cpSync(new URL('./', import.meta.url), join(root, 'scripts'), {recursive: true});
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
  const required = ['changes', 'summary', 'typecheck', 'root (1/8)', 'root (2/8)', 'root (3/8)', 'root (4/8)', 'root (5/8)', 'root (6/8)', 'root (7/8)', 'root (8/8)', 'package (@waitron-cloud/operations)', 'receipts'];
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

const siblingCases = [
  ['aws-infrastructure', ['verify (guards-1)', 'verify (guards-2)', 'verify (guards-3)', 'verify (suites)']],
  ['venue-services-proof', ['service-receipts (venue)']],
  ['cloud-cost', [
    ...['cadence', 'day', 'foreground'].map(name => `cost (${name}-conformance.test.mjs, 1/1)`),
    ...[1, 2, 3].map(n => `cost (isolated-replay-conformance.test.mjs, ${n}/3)`),
    ...['mail', 'paced-replay', 'private-replay', 'remote-browser', 'remote', 'remote-waitron', 'replay', 'service-receipt',
      'source-bills', 'source-clock', 'source-days'].map(name => `cost (${name}-conformance.test.mjs, 1/1)`),
    ...[1, 2, 3].map(n => `cost (stack-conformance.test.mjs, ${n}/3)`),
    'cost (worker-storage-conformance.test.mjs, 1/1)',
  ]],
];

function siblingFixture(key, names) {
  const f = fixture(), nativeWorkflow = `.github/workflows/${key}.yml`;
  const selection = {base, head, paths: ['unknown-input'], required: true,
    ...(key === 'cloud-cost' ? {matrix: conformanceMatrix()} : {})};
  const record = structuredClone(source);
  Object.assign(record.workflow, {path: nativeWorkflow, ref: `${repository}/${nativeWorkflow}@refs/pull/51/merge`});
  record.selection = selection;
  const content = archive(createPlanEvidence(record));
  f.data.workflow.path = nativeWorkflow;
  f.data.run.path = nativeWorkflow; f.data.runs[0].path = nativeWorkflow;
  const originalReadRun = f.api.readRun;
  f.api.readRun = id => ({...originalReadRun(id), path: nativeWorkflow});
  f.data.artifacts[0] = {...artifact, name: `ci-plan-v1-${key}-42-2`, size_in_bytes: content.length,
    digest: 'sha256:' + createHash('sha256').update(content).digest('hex')};
  f.api.readPlanArtifact = () => content;
  f.data.jobs = [key === 'cloud-cost' ? 'discover' : 'changes', ...names, 'summary'].map((name, i) => ({
    id: i + 1, run_id: 42, run_attempt: 2, head_sha: head, name, status: 'completed', conclusion: 'success',
  }));
  return {...f, nativeWorkflow, selection};
}

for (const [key, names] of siblingCases) {
  test(`${key} independently reconstructs its native source and requires every exact job`, () => {
    const f = siblingFixture(key, names);
    const verifyNative = () => findReuse(f.context, {api: f.api, git, now: f.now}, f.nativeWorkflow);
    const accepted = verifyNative();
    assert.equal(accepted.reuse?.workflowPath, f.nativeWorkflow, accepted.reason);
    assert.equal(accepted.reuse?.runId, 42);
    for (let i = 0; i < f.data.jobs.length; i++) {
      const previous = f.data.jobs[i];
      f.data.jobs.splice(i, 1);
      assert.equal(verifyNative().reuse, null, `Missing ${previous.name} must refuse this workflow`);
      f.data.jobs.splice(i, 0, previous);
    }
    f.data.run.conclusion = 'failure'; f.data.runs[0].conclusion = 'failure';
    assert.equal(verifyNative().reuse, null, 'A red native workflow cannot borrow CI evidence');
    assert.equal(verify(fixture()).reuse?.runId, 42, 'An independent CI proof still qualifies');
  });
}

for (const kind of ['docs', 'scoped', 'dependent-source']) {
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
      if (kind === 'dependent-source') {
        mkdirSync(join(directory, 'packages/consumer/src'), {recursive: true});
        writeFileSync(join(directory, 'packages/consumer/package.json'), JSON.stringify({name: '@waitron-cloud/consumer',
          scripts: {test: 'node --test test/*.test.ts'}, dependencies: {'@waitron-cloud/operations': 'workspace:*'}}));
        writeFileSync(join(directory, 'packages/consumer/src/index.ts'), "import '@waitron-cloud/operations';\n");
        variantGit('add', '.'); variantGit('commit', '-qsm', 'Saved dependent source');
      }
      const originalBase = variantGit('rev-parse', 'HEAD').trim();
      const path = kind === 'docs' ? 'docs/guide.md' : kind === 'dependent-source'
        ? 'packages/operations/src/index.ts' : 'packages/operations/test/scoped.test.ts';
      mkdirSync(join(directory, path, '..'), {recursive: true});
      writeFileSync(join(directory, path), kind === 'docs' ? '# Operations guide\n' : 'export const scoped = true;\n');
      variantGit('add', '.'); variantGit('commit', '-qsm', 'Scoped source');
      const originalHead = variantGit('rev-parse', 'HEAD').trim(), originalTree = variantGit('rev-parse', 'HEAD^{tree}').trim();
      const originalExecution = variantGit('commit-tree', originalTree, '-p', originalBase, '-p', originalHead, '-m', 'PR execution').trim();
      const squash = variantGit('commit-tree', originalTree, '-p', originalBase, '-m', 'Squash').trim();
      variantGit('checkout', '--detach', squash);
      if (kind === 'docs') {
        readDocumentation(originalBase, variantGit);
        readDocumentation(originalHead, variantGit);
      }
      const selection = selectPlan({kind: 'pr', base: originalBase, head: originalHead}, loadWorkspaceAtRevision(originalHead, variantGit), variantGit);
      const required = kind === 'docs' ? ['changes', 'documentation', 'summary']
        : ['changes', 'summary', 'typecheck', 'root (1/8)', 'root (2/8)', 'root (3/8)', 'root (4/8)', 'root (5/8)', 'root (6/8)', 'root (7/8)', 'root (8/8)', 'package (@waitron-cloud/operations)', 'receipts'];
      const skipped = kind === 'docs' ? ['scripts', 'typecheck', 'root (${{ matrix.shard }}/8)',
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
      if (kind === 'docs') for (const key of ['cloud-cost', 'venue-services-proof']) {
        const nativeWorkflow = `.github/workflows/${key}.yml`;
        const nativeRecord = structuredClone(record);
        Object.assign(nativeRecord.workflow, {path: nativeWorkflow, ref: `${repository}/${nativeWorkflow}@refs/pull/51/merge`});
        nativeRecord.selection = {base: originalBase, head: originalHead, paths: ['docs/guide.md'], required: false};
        const nativeBytes = archive(createPlanEvidence(nativeRecord));
        const skippedName = key === 'cloud-cost' ? 'cost (${{ matrix.file }}, ${{ matrix.group }})' : 'service-receipts (${{ matrix.receipt }})';
        const nativeJobs = [key === 'cloud-cost' ? 'discover' : 'changes', 'summary', skippedName].map((name, i) => ({
          id: i + 1, name, run_id: 42, run_attempt: 2, head_sha: originalHead,
          status: 'completed', conclusion: name === skippedName ? 'skipped' : 'success',
        }));
        const native = fixture({root: directory, base: originalBase, head: originalHead, merge: squash, execution: originalExecution,
          tree: originalTree, jobs: nativeJobs, bytes: nativeBytes, artifact: {...metadata, name: `ci-plan-v1-${key}-42-2`,
            size_in_bytes: nativeBytes.length, digest: 'sha256:' + createHash('sha256').update(nativeBytes).digest('hex')}});
        native.data.workflow.path = nativeWorkflow; native.data.run.path = nativeWorkflow; native.data.runs[0].path = nativeWorkflow;
        const readRun = native.api.readRun;
        native.api.readRun = id => ({...readRun(id), path: nativeWorkflow});
        const verifyNative = () => findReuse(native.context, {api: native.api, git: variantGit, now: native.now}, nativeWorkflow);
        assert.equal(verifyNative().reuse?.workflowPath, nativeWorkflow, verifyNative().reason);
        for (const conclusion of ['success', 'failure', 'cancelled']) {
          native.data.jobs.at(-1).conclusion = conclusion;
          assert.equal(verifyNative().reuse, null, `A ${conclusion} unselected native job contradicts its docs plan`);
        }
        const context = {...native.context, workflowPath: nativeWorkflow, workflowRef: `${repository}/${nativeWorkflow}@refs/heads/main`,
          workflowSha: squash, full: false, called: false};
        const decision = createDecisionEvidence(context, {...nativeRecord.selection, head: squash}, variantGit, 'unselected');
        const decisionBytes = archive(decision);
        const hostedArtifact = {id: 62, name: `ci-decision-v1-${key}-90-1`, expired: false, size_in_bytes: decisionBytes.length,
          digest: 'sha256:' + createHash('sha256').update(decisionBytes).digest('hex'),
          workflow_run: {id: 90, head_sha: squash, repository_id: 123, head_repository_id: 123}};
        native.api.remaining = () => 30_000;
        native.api.listArtifacts = () => page([hostedArtifact]);
        native.api.readPlanArtifact = () => decisionBytes;
        const originalRun = native.api.readRun;
        native.api.readRun = id => ({...originalRun(id), status: 'completed', conclusion: 'success'});
        const mainJobs = nativeJobs.map(job => ({...job, head_sha: squash, run_id: 90, run_attempt: 1}));
        native.api.listAttemptJobs = () => page(mainJobs);
        const observed = readbackDecision(decision, {api: native.api, git: variantGit, now: native.now});
        assert.equal(observed.mode, 'unselected');
        assert.equal(observed.inherited, null, 'Unselected work does not borrow a PR source');
        assert.deepEqual(observed.succeeded, [key === 'cloud-cost' ? 'discover' : 'changes', 'summary']);
        assert.deepEqual(observed.skipped, [skippedName]);
        mainJobs.pop();
        assert.throws(() => readbackDecision(decision, {api: native.api, git: variantGit, now: native.now}), /Incomplete main/);
      }
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
    [`${endpoint}/actions/runs/42/attempts/2/jobs?per_page=30&page=1`]: {total_count: f.data.jobs.length, jobs: f.data.jobs},
    [`${endpoint}/actions/runs/42/artifacts?per_page=100&page=1`]: {total_count: f.data.artifacts.length, artifacts: f.data.artifacts},
    [`${endpoint}/actions/artifacts/61/zip`]: {binary: bytes.toString('base64')},
    [`${endpoint}/actions/runs/90/jobs?filter=latest&per_page=30`]: [{total_count: 1, jobs: [
      {id: 101, name: 'changes', status: 'completed', conclusion: 'success'},
    ]}],
  };
  for (const [sha, value] of Object.entries(f.data.commits)) responses[`${endpoint}/git/commits/${sha}`] = value;
  writeFileSync(join(directory, 'responses.json'), JSON.stringify(responses));
  writeFileSync(join(directory, 'event.json'), JSON.stringify(f.context.event));
  writeFileSync(join(directory, 'output'), '');
  // An explicit module entry keeps the CLI fixture independent of Node's syntax detection.
  writeFileSync(join(directory, 'gh.mjs'), `#!${process.execPath}
import {readFileSync, appendFileSync} from 'node:fs';
const endpoint = process.argv.at(-1);
appendFileSync(process.env.CI_API_CALLS, endpoint + '\\n');
const response = JSON.parse(readFileSync(process.env.CI_API_RESPONSES))[endpoint];
if (response === undefined) process.exit(2);
if (response.binary) process.stdout.write(Buffer.from(response.binary, 'base64'));
else process.stdout.write((process.argv.includes('--include') ? 'HTTP/2 200 OK\\r\\n\\r\\n' : '') + JSON.stringify(response));
`, {mode: 0o700});
  symlinkSync('gh.mjs', join(directory, 'gh'));
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
    const unused = ['scripts', 'documentation', 'typecheck', 'root (${{ matrix.shard }}/8)',
      "package (${{ matrix.package }}${{ ((matrix.shards && format(', shard {0}/{1}', matrix.shard, matrix.shards)) || '') }})", 'receipts'];
    const currentJobs = ['changes', 'summary', ...unused].map((name, i) => ({id: i + 100, run_id: 90, run_attempt: 1,
      head_sha: merge, name, status: 'completed', conclusion: unused.includes(name) ? 'skipped' : 'success'}));
    runtime.responses[`${endpoint}/actions/runs/90/attempts/1/jobs?per_page=30&page=1`] = {total_count: currentJobs.length, jobs: currentJobs};
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
    for (const change of [{id: currentJobs[1].id}, {run_id: 91}, {run_attempt: 2}, {head_sha: head}, {name: 'unknown'},
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
    runtime.responses[`${endpoint}/actions/runs/90/attempts/1/jobs?per_page=30&page=1`].total_count--;
    assert.equal(readback().status, 1, 'A missing current skipped family is not qualified reuse');
    runtime.responses[`${endpoint}/actions/runs/90/attempts/1/jobs?per_page=30&page=1`].jobs = [
      ...currentJobs, {id: 999, run_id: 90, run_attempt: 1, head_sha: merge, name: 'receipts', status: 'completed', conclusion: 'skipped'}];
    runtime.responses[`${endpoint}/actions/runs/90/attempts/1/jobs?per_page=30&page=1`].total_count++;
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
    name: `ci-decision-v1-${decision.workflowPath.slice('.github/workflows/'.length, -4)}-90-1`, expired: false, size_in_bytes: content.length,
    digest: 'sha256:' + createHash('sha256').update(content).digest('hex'),
    workflow_run: {id: 90, head_sha: merge, repository_id: 123, head_repository_id: 123}}]};
  runtime.responses[`${endpoint}/actions/artifacts/62/zip`] = {binary: content.toString('base64')};
  runtime.responses[`${endpoint}/actions/runs/90/attempts/1/jobs?per_page=30&page=1`] = {total_count: currentJobs.length, jobs: currentJobs};
  writeFileSync(join(runtime.directory, 'responses.json'), JSON.stringify(runtime.responses));
}

for (const [key, names] of siblingCases) for (const mode of ['reused', 'selected', 'full']) {
  test(`${key} ${mode} operator CLI reads its own hosted decision and complete native jobs`, () => {
    const f = siblingFixture(key, names), runtime = runtimeFixture(f);
    try {
      const endpoint = `repos/${repository}`;
      for (const path of Object.keys(runtime.responses)) if (path.includes('/workflows/ci.yml')) {
        runtime.responses[path.replace('/workflows/ci.yml', `/workflows/${key}.yml`)] = runtime.responses[path];
        delete runtime.responses[path];
      }
      runtime.responses[`${endpoint}/actions/artifacts/61/zip`] = {binary: f.api.readPlanArtifact().toString('base64')};
      runtime.env.GITHUB_WORKFLOW_REF = `${repository}/${f.nativeWorkflow}@refs/heads/main`;
      runtime.env.GITHUB_WORKFLOW_SHA = merge;
      runtime.env.CI_MODE = mode;
      const proof = findReuse(f.context, {api: f.api, git, now: f.now}, f.nativeWorkflow).reuse;
      assert.ok(proof, 'Native source qualifies before readback');
      runtime.env.CI_PLAN = JSON.stringify(mode === 'reused' ? {required: false, reuse: proof} : mode === 'full'
        ? {full: true, head: merge, required: true, ...(key === 'cloud-cost' ? {matrix: conformanceMatrix()} : {})}
        : {...f.selection, head: merge});
      const decisionPath = join(runtime.directory, 'decision.json');
      const written = spawnSync(process.execPath, ['scripts/ci-evidence.mjs', '--decision', decisionPath],
        {cwd: root, env: runtime.env, encoding: 'utf8', timeout: 30_000});
      assert.equal(written.status, 0, written.stdout + written.stderr);
      const decision = JSON.parse(readFileSync(decisionPath));
      assert.equal(decision.workflowPath, f.nativeWorkflow, 'Decision belongs to the invoked workflow');
      const unused = mode !== 'reused' ? [] : [key === 'cloud-cost' ? 'cost (${{ matrix.file }}, ${{ matrix.group }})'
        : key === 'venue-services-proof' ? 'service-receipts (${{ matrix.receipt }})'
        : key === 'aws-infrastructure' ? 'verify (${{ matrix.cell }})' : 'linux-contention'];
      const currentJobs = [key === 'cloud-cost' ? 'discover' : 'changes', 'summary', ...(mode !== 'reused' ? names : unused)]
        .map((name, i) => ({id: i + 100, run_id: 90, run_attempt: 1, head_sha: merge, name,
          status: 'completed', conclusion: unused.includes(name) ? 'skipped' : 'success'}));
      const readback = () => {
        writeFileSync(decisionPath, JSON.stringify(decision));
        hostDecision(runtime, decision, currentJobs);
        return spawnSync(process.execPath, ['scripts/ci-evidence.mjs', '--readback', decisionPath],
          {cwd: root, env: runtime.env, encoding: 'utf8', timeout: 30_000});
      };
      const accepted = readback();
      assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
      const result = JSON.parse(accepted.stdout);
      assert.equal(result.inherited?.proof.workflowPath ?? null, mode === 'reused' ? f.nativeWorkflow : null);
      assert.deepEqual(result.succeeded.sort(), (mode !== 'reused'
        ? [key === 'cloud-cost' ? 'discover' : 'changes', 'summary', ...names]
        : [key === 'cloud-cost' ? 'discover' : 'changes', 'summary']).sort());
      assert.deepEqual(result.skipped, unused);
      if (mode === 'selected') {
        const savedPaths = decision.selection.paths;
        decision.selection.paths = ['unrelated-input'];
        const forged = readback();
        assert.equal(forged.status, 1, 'A hosted decision still needs independent range reconstruction');
        assert.match(forged.stderr, /Recomputed main selection/);
        decision.selection.paths = savedPaths;
      } else if (mode === 'reused') {
        const sourceRun = runtime.responses[`${endpoint}/actions/runs/42`], previous = sourceRun.conclusion;
        sourceRun.conclusion = 'failure';
        assert.equal(readback().status, 1, 'Native readback must requalify its own source');
        sourceRun.conclusion = previous;
      }
      currentJobs.pop();
      assert.equal(readback().status, 1, 'Every current native job/skip is required');
      if (mode === 'reused') assert.equal(result.newlyExecutedProductChecks, 0);
    } finally {rmSync(runtime.directory, {recursive: true, force: true});}
  });
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
      currentJobs.splice(currentJobs.findIndex(job => job.name === 'root (3/8)'), 1);
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

test('source qualification follows a second run page and refuses its latest red result', () => {
  const f = fixture(), record = structuredClone(source);
  record.runId = 142;
  const content = archive(createPlanEvidence(record));
  f.data.run.id = 142; f.data.runs[0].id = 142;
  for (const job of f.data.jobs) job.run_id = 142;
  Object.assign(f.data.artifacts[0], {name: 'ci-plan-v1-ci-142-2', size_in_bytes: content.length,
    digest: 'sha256:' + createHash('sha256').update(content).digest('hex'),
    workflow_run: {...artifact.workflow_run, id: 142}});
  f.api.readPlanArtifact = () => content;
  const older = Array.from({length: 100}, (_, i) => ({...f.data.run, id: i + 1, conclusion: 'failure'}));
  f.api.listRuns = (_path, _head, number) => number === 1
    ? {items: older, total_count: 101, nextPage: 2, terminal: false}
    : {items: [f.data.run], total_count: 101, nextPage: null, terminal: true};
  const accepted = verify(f);
  assert.equal(accepted.reuse?.runId, 142, accepted.reason);
  f.data.run.conclusion = 'failure';
  assert.equal(verify(f).reuse, null, 'The latest run on the second page must defeat all older results');
  f.data.run.conclusion = 'success';
  const complete = f.api.listRuns;
  f.api.listRuns = (...args) => args[2] === 2 ? {...complete(...args), total_count: 102} : complete(...args);
  assert.equal(verify(f).reuse, null, 'Changing page totals cannot certify a latest result');
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
  for (const path of ['scripts/ci-plan.mjs', 'scripts/ci-input-audit.mjs', 'scripts/cloud-cost/conformance.mjs', 'package.json', 'pnpm-lock.yaml']) {
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
  for (const fault of ['execution-definition', 'operator-tree', 'unreviewed-workflow']) {
    const f = fixture();
    const altered = (...args) => {
      const value = git(...args);
      if (fault === 'operator-tree' && args.join(' ') === 'rev-parse HEAD^{tree}') return 'e'.repeat(40);
      if (args[0] === 'ls-tree' && ((fault === 'execution-definition' && args.at(-1) === execution) ||
        (fault === 'unreviewed-workflow' && [head, execution].includes(args.at(-1))))) {
        return value.split('\0').map(entry => entry.endsWith(`\t${workflow}`) ? entry.replace(/blob [a-f0-9]{40}/, 'blob ' + 'e'.repeat(40)) : entry).join('\0');
      }
      return value;
    };
    altered.readBlobs = git.readBlobs;
    const result = findReuse(f.context, {api: f.api, git: altered, now: f.now}, workflow);
    assert.equal(result.reuse, null, fault);
  }
});

// A clean main checkout has only commits reachable from main. GitHub can still
// serve the immutable PR head and execution commit after their refs disappear.
test('fresh main checkout fetches exact PR proof objects without changing HEAD', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cloud-main-proof-objects-'));
  const remote = join(directory, 'origin.git'), checkout = join(directory, 'main');
  const command = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  try {
    command(directory, 'init', '--bare', '--initial-branch=main', remote);
    command(root, 'push', remote, `${merge}:refs/heads/main`, `${head}:refs/heads/source`, `${execution}:refs/heads/execution`);
    command(remote, 'update-ref', '-d', 'refs/heads/source'); command(remote, 'update-ref', '-d', 'refs/heads/execution');
    command(remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    command(directory, 'clone', '--no-local', '--single-branch', '--branch', 'main', remote, checkout);
    const freshGit = (...args) => {
      const binary = typeof args.at(-1) === 'object' && args.pop().binary;
      return execFileSync('git', args, {cwd: checkout, encoding: binary ? null : 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    };
    freshGit.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: checkout, input}));
    assert.throws(() => freshGit('cat-file', '-e', `${head}^{commit}`), 'Source head is absent before verification');
    assert.throws(() => freshGit('cat-file', '-e', `${execution}^{commit}`), 'Synthetic execution is absent before verification');
    const f = fixture(), refs = freshGit('show-ref');
    const refusingGit = (...args) => {
      if (args[0] === 'fetch') throw Error('Controlled source object fetch refused');
      return freshGit(...args);
    };
    refusingGit.readBlobs = freshGit.readBlobs;
    const refused = findReuse(f.context, {api: f.api, git: refusingGit, now: f.now}, workflow);
    assert.equal(refused.reuse, null);
    assert.match(refused.reason, /Controlled source object fetch refused/);
    assert.equal(freshGit('rev-parse', 'HEAD').trim(), merge);
    const result = findReuse(f.context, {api: f.api, git: freshGit, now: f.now}, workflow);
    assert.equal(result.reuse?.runId, 42, result.reason);
    assert.equal(freshGit('show-ref'), refs, 'Fetching proof objects cannot move branch refs');
    assert.equal(freshGit('rev-parse', 'HEAD').trim(), merge);
    assert.equal(freshGit('rev-parse', `${head}^{commit}`).trim(), head);
    assert.equal(freshGit('rev-parse', `${execution}^{commit}`).trim(), execution);
  } finally {rmSync(directory, {recursive: true, force: true});}
});

function sourceWithRecord(record) {
  const f = fixture(), forged = archive(createPlanEvidence(record));
  f.data.artifacts[0].size_in_bytes = forged.length;
  f.data.artifacts[0].digest = 'sha256:' + createHash('sha256').update(forged).digest('hex');
  f.api.readPlanArtifact = () => forged;
  return f;
}

test('source execution must be the original base and head merge even when its tracked tree matches', () => {
  const singleParent = execFileSync('git', ['commit-tree', tree, '-p', base, '-m', 'Single-parent execution control'],
    {cwd: root, encoding: 'utf8'}).trim();
  const record = structuredClone(source);
  record.event.sha = record.workflow.sha = record.workflow.executionSha = singleParent;
  const f = sourceWithRecord(record);
  f.data.commits[singleParent] = {sha: singleParent, tree: {sha: tree}, parents: [{sha: base}]};
  const result = verify(f);
  assert.equal(result.reuse, null);
  assert.match(result.reason, /Original PR execution topology differs/);
});

test('a self-consistent selection cannot replace the actual original merge base with an earlier ancestor', () => {
  const commit = (savedTree, parents, label) => execFileSync('git', ['commit-tree', savedTree,
    ...parents.flatMap(parent => ['-p', parent]), '-m', label], {cwd: root, encoding: 'utf8'}).trim();
  const originalBase = commit(git('rev-parse', `${base}^{tree}`).trim(), [base], 'Advanced original base');
  const originalHead = commit(tree, [originalBase], 'Original feature');
  const originalExecution = commit(tree, [originalBase, originalHead], 'Original execution');
  const squash = commit(tree, [originalBase], 'Original squash');
  const record = structuredClone(source);
  record.event.base.sha = originalBase; record.event.head.sha = record.checkout.sha = originalHead;
  record.event.sha = record.workflow.sha = record.workflow.executionSha = originalExecution;
  record.event.mergeBase = base; // An ancestor of both sides, but not their actual merge base.
  record.selection = selectPlan({base, head: originalHead}, loadWorkspaceAtRevision(originalHead, git), git);
  const forged = archive(createPlanEvidence(record));
  const metadata = {...artifact, size_in_bytes: forged.length, digest: 'sha256:' + createHash('sha256').update(forged).digest('hex'),
    workflow_run: {...artifact.workflow_run, head_sha: originalHead}};
  const f = fixture({root, base: originalBase, head: originalHead, merge: squash, execution: originalExecution, tree,
    jobs: jobs.map(job => ({...job, head_sha: originalHead})), bytes: forged, artifact: metadata});
  f.data.commits[base] = fixture().data.commits[base];
  const result = verify(f);
  assert.equal(result.reuse, null);
  assert.match(result.reason, /Original merge base differs/);
});

test('a source listing cannot recycle the current main run identity', () => {
  const record = structuredClone(source); record.runId = 90;
  const f = sourceWithRecord(record), current = f.api.readRun(90);
  f.data.run.id = 90; f.data.runs[0].id = 90;
  f.data.jobs = f.data.jobs.map(job => ({...job, run_id: 90}));
  Object.assign(f.data.artifacts[0], {name: 'ci-plan-v1-ci-90-2', workflow_run: {...f.data.artifacts[0].workflow_run, id: 90}});
  let reads = 0;
  f.api.readRun = id => id === 90 && ++reads === 1 ? current : f.data.run;
  const result = verify(f);
  assert.equal(result.reuse, null);
  assert.match(result.reason, /Current run cannot be its own source/);
});

function mainReadbackFixture() {
  const f = fixture(), proof = verify(f).reuse;
  assert.ok(proof);
  const context = {...f.context, workflowPath: workflow, workflowRef: `${repository}/${workflow}@refs/heads/main`,
    workflowSha: merge, full: false, called: false};
  const decision = createDecisionEvidence(context, {packages: [], receipts: [], typecheck: false, reuse: proof}, git, 'reused');
  const content = archive(decision);
  const metadata = {id: 62, name: 'ci-decision-v1-ci-90-1', expired: false, size_in_bytes: content.length,
    digest: 'sha256:' + createHash('sha256').update(content).digest('hex'),
    workflow_run: {id: 90, head_sha: merge, repository_id: 123, head_repository_id: 123}};
  const skipped = ['scripts', 'documentation', 'typecheck', 'root (${{ matrix.shard }}/8)',
    "package (${{ matrix.package }}${{ ((matrix.shards && format(', shard {0}/{1}', matrix.shard, matrix.shards)) || '') }})", 'receipts'];
  const mainJobs = ['changes', 'summary', ...skipped].map((name, i) => ({id: i + 100, name, run_id: 90, run_attempt: 1,
    head_sha: merge, status: 'completed', conclusion: skipped.includes(name) ? 'skipped' : 'success'}));
  const readRun = f.api.readRun;
  f.api.readRun = id => id === 90 ? {...readRun(id), status: 'completed', conclusion: 'success'} : readRun(id);
  const listArtifacts = f.api.listArtifacts, readArtifact = f.api.readPlanArtifact, listJobs = f.api.listAttemptJobs;
  f.api.remaining = () => 30_000;
  f.api.listArtifacts = id => id === 90 ? page([metadata]) : listArtifacts(id);
  f.api.readPlanArtifact = id => id === 62 ? content : readArtifact(id);
  f.api.listAttemptJobs = (id, ...args) => id === 90 ? page(mainJobs) : listJobs(id, ...args);
  return {...f, decision};
}

test('main readback rechecks its own run after the inherited source has been qualified', () => {
  const f = mainReadbackFixture();
  assert.equal(readbackDecision(f.decision, {api: f.api, git, now: f.now}).mode, 'reused');
  const readRun = f.api.readRun;
  let sourceReads = 0;
  f.api.readRun = id => {
    if (id === 42) sourceReads++;
    const result = readRun(id);
    return id === 90 && sourceReads >= 2 ? {...result, run_attempt: 2} : result;
  };
  assert.throws(() => readbackDecision(f.decision, {api: f.api, git, now: f.now}));
  assert.equal(sourceReads, 2, 'The refusal must happen after source qualification');
});

test('main readback binds its first inherited job snapshot even when a later source read is green', () => {
  const f = mainReadbackFixture();
  assert.equal(readbackDecision(f.decision, {api: f.api, git, now: f.now}).mode, 'reused');
  const listJobs = f.api.listAttemptJobs;
  let inheritedReads = 0;
  f.api.listAttemptJobs = (id, ...args) => {
    const result = listJobs(id, ...args);
    return id === 42 && ++inheritedReads === 1 ? {...result, items: result.items.map((job, i) => i ? job : {...job, id: 99999})} : result;
  };
  assert.throws(() => readbackDecision(f.decision, {api: f.api, git, now: f.now}), /Inherited job evidence differs/);
});

test('full readback preserves an invalid range and still requires every native check on the actual head', () => {
  const f = fixture(), path = '.github/workflows/aws-infrastructure.yml';
  const context = {...f.context, event: {...f.context.event, after: 'invalid-after'}, workflowPath: path,
    workflowRef: `${repository}/${path}@refs/heads/main`, workflowSha: merge, full: false, called: false};
  const decision = createDecisionEvidence(context, {full: true, head: merge, required: true}, git, 'full');
  const content = archive(decision);
  const metadata = {id: 62, name: 'ci-decision-v1-aws-infrastructure-90-1', expired: false, size_in_bytes: content.length,
    digest: 'sha256:' + createHash('sha256').update(content).digest('hex'),
    workflow_run: {id: 90, head_sha: merge, repository_id: 123, head_repository_id: 123}};
  const names = ['changes', 'verify (guards-1)', 'verify (guards-2)', 'verify (guards-3)', 'verify (suites)', 'summary'];
  let currentJobs = names.map((name, i) => ({id: i + 100, name, run_id: 90, run_attempt: 1,
    head_sha: merge, status: 'completed', conclusion: 'success'}));
  const main = f.api.readRun(90);
  f.api.remaining = () => 30_000;
  f.api.readWorkflow = () => ({id: 17, path, state: 'active'});
  f.api.readRun = id => {assert.equal(id, 90, 'Full work cannot borrow source success'); return {...main, path, status: 'completed', conclusion: 'success'};};
  f.api.listArtifacts = () => page([metadata]); f.api.readPlanArtifact = () => content;
  f.api.listAttemptJobs = () => page(currentJobs);
  const observed = readbackDecision(decision, {api: f.api, git, now: f.now});
  assert.equal(observed.mode, 'full'); assert.equal(observed.mergeSha, merge); assert.equal(observed.inherited, null);
  assert.deepEqual(observed.succeeded, names);
  currentJobs = currentJobs.filter(job => job.name !== 'verify (guards-3)');
  assert.throws(() => readbackDecision(decision, {api: f.api, git, now: f.now}), /Incomplete main job inventory/);
});

test('source qualification and reused main readback require every page of a legitimate 43-job source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cloud-reuse-paginated-'));
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', root, directory], {stdio: 'pipe'});
    const variantGit = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args],
      {cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    variantGit.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: directory, input}));
    variantGit('config', 'user.name', 'CI pagination test'); variantGit('config', 'user.email', 'ci@example.test');
    variantGit('checkout', '--detach', base);
    const allocations = [['account-http', 3], ['backups', 7], ['portal', 6], ['registration', 6],
      ['remote-access', 4], ['translation', 1], ['ui-smoke', 1]];
    const rows = allocations.flatMap(([name, count]) => Array.from({length: count}, (_, i) =>
      count === 1 ? {package: `@waitron-cloud/${name}`, shard: 1}
        : {package: `@waitron-cloud/${name}`, shard: i + 1, shards: count}));
    rows.push({package: '@waitron-cloud/identity + @waitron-cloud/operations',
      members: ['@waitron-cloud/identity', '@waitron-cloud/operations'], shard: 1});
    for (const [name, count] of [...allocations, ['identity', 1]]) {
      const path = join(directory, 'packages', name);
      mkdirSync(join(path, 'test'), {recursive: true});
      writeFileSync(join(path, 'package.json'), JSON.stringify({name: `@waitron-cloud/${name}`, scripts: {test: 'node --test test/*.test.ts'}}));
      for (let n = 1; n <= count; n++) writeFileSync(join(path, `test/case-${n}.test.ts`),
        "import test from 'node:test'; test('available', () => {});\n");
    }
    variantGit('add', '.'); variantGit('commit', '-qsm', 'Independent package inventory');
    const originalBase = variantGit('rev-parse', 'HEAD').trim();
    writeFileSync(join(directory, 'pagination-input'), 'Unknown input requires every package\n');
    variantGit('add', '.'); variantGit('commit', '-qsm', 'Full source work');
    const originalHead = variantGit('rev-parse', 'HEAD').trim(), originalTree = variantGit('rev-parse', 'HEAD^{tree}').trim();
    const originalExecution = variantGit('commit-tree', originalTree, '-p', originalBase, '-p', originalHead, '-m', 'PR execution').trim();
    const squash = variantGit('commit-tree', originalTree, '-p', originalBase, '-m', 'Squash').trim();
    variantGit('checkout', '--detach', squash);
    const selection = selectPlan({base: originalBase, head: originalHead}, loadWorkspaceAtRevision(originalHead, variantGit), variantGit);
    assert.deepEqual(selection.packages, rows);
    const record = structuredClone(source);
    Object.assign(record.event, {mergeBase: originalBase, sha: originalExecution});
    record.event.base.sha = originalBase; record.event.head.sha = originalHead;
    Object.assign(record.checkout, {sha: originalHead, tree: originalTree});
    Object.assign(record.workflow, {sha: originalExecution, executionSha: originalExecution});
    record.selection = selection;
    const content = archive(createPlanEvidence(record));
    const metadata = {...artifact, size_in_bytes: content.length, digest: 'sha256:' + createHash('sha256').update(content).digest('hex'),
      workflow_run: {...artifact.workflow_run, head_sha: originalHead}};
    const required = ['changes', 'summary', 'typecheck', 'root (1/8)', 'root (2/8)', 'root (3/8)', 'root (4/8)', 'root (5/8)', 'root (6/8)', 'root (7/8)', 'root (8/8)',
      'receipts', ...rows.map(row => `package (${row.package}${row.shards ? `, shard ${row.shard}/${row.shards}` : ''})`)];
    const sourceJobs = [...required, 'scripts', 'documentation'].map((name, i) => ({id: i + 1, name, run_id: 42,
      run_attempt: 2, head_sha: originalHead, status: 'completed', conclusion: required.includes(name) ? 'success' : 'skipped'}));
    assert.equal(sourceJobs.length, 43);
    const f = fixture({root: directory, base: originalBase, head: originalHead, merge: squash, execution: originalExecution,
      tree: originalTree, jobs: sourceJobs, bytes: content, artifact: metadata});
    const pagesRead = [];
    f.api.listAttemptJobs = (_id, _attempt, number) => {
      pagesRead.push(number);
      return {items: f.data.jobs.slice((number - 1) * 30, number * 30), total_count: 43,
        nextPage: number === 1 ? 2 : null, terminal: number !== 1};
    };
    const qualify = () => findReuse(f.context, {api: f.api, git: variantGit, now: f.now}, workflow);
    const accepted = qualify();
    assert.equal(accepted.reuse?.runId, 42, accepted.reason);
    assert.deepEqual(pagesRead, [1, 2]);
    const context = {...f.context, workflowPath: workflow, workflowRef: `${repository}/${workflow}@refs/heads/main`,
      workflowSha: squash, full: false, called: false};
    const decision = createDecisionEvidence(context, {packages: [], receipts: [], typecheck: false, reuse: accepted.reuse}, variantGit, 'reused');
    const decisionBytes = archive(decision);
    const hosted = {id: 62, name: 'ci-decision-v1-ci-90-1', expired: false, size_in_bytes: decisionBytes.length,
      digest: 'sha256:' + createHash('sha256').update(decisionBytes).digest('hex'),
      workflow_run: {id: 90, head_sha: squash, repository_id: 123, head_repository_id: 123}};
    const skipped = ['scripts', 'documentation', 'typecheck', 'root (${{ matrix.shard }}/8)',
      "package (${{ matrix.package }}${{ ((matrix.shards && format(', shard {0}/{1}', matrix.shard, matrix.shards)) || '') }})", 'receipts'];
    const mainJobs = ['changes', 'summary', ...skipped].map((name, i) => ({id: i + 100, name, run_id: 90, run_attempt: 1,
      head_sha: squash, status: 'completed', conclusion: skipped.includes(name) ? 'skipped' : 'success'}));
    const readRun = f.api.readRun, listArtifacts = f.api.listArtifacts, readArtifact = f.api.readPlanArtifact, listJobs = f.api.listAttemptJobs;
    f.api.remaining = () => 30_000;
    f.api.readRun = id => id === 90 ? {...readRun(id), status: 'completed', conclusion: 'success'} : readRun(id);
    f.api.listArtifacts = id => id === 90 ? page([hosted]) : listArtifacts(id);
    f.api.readPlanArtifact = id => id === 62 ? decisionBytes : readArtifact(id);
    f.api.listAttemptJobs = (id, ...args) => id === 90 ? page(mainJobs) : listJobs(id, ...args);
    const readback = () => readbackDecision(decision, {api: f.api, git: variantGit, now: f.now});
    const observed = readback();
    assert.equal(observed.mode, 'reused');
    assert.equal(observed.inherited.succeeded.length, 41);
    assert.equal(observed.inherited.skipped.length, 2);
    assert.equal(observed.newlyExecutedProductChecks, 0);
    f.data.jobs[31].conclusion = 'failure';
    assert.equal(qualify().reuse, null, 'A red required job on page two must defeat reuse');
    assert.throws(readback, /Inherited job evidence differs|not pass|Source|source/i);
    f.data.jobs[31].conclusion = 'success';
    f.data.jobs.pop();
    assert.equal(qualify().reuse, null, 'A missing second-page job must defeat reuse');
    assert.throws(readback, /Incomplete terminal page/);
  } finally {rmSync(directory, {recursive: true, force: true});}
});
