import assert from 'node:assert/strict';
import test, {before, after} from 'node:test';
import {execFileSync} from 'node:child_process';
import {cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {findReuse} from './ci-reuse.mjs';
import {createPlanEvidence} from './ci-evidence.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';

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

function fixture() {
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

test('only independently reconstructed, complete exact-attempt source evidence grants versioned reuse', () => {
  const result = verify(fixture());
  assert.equal(result?.reuse?.version, 1, `Complete source evidence must grant a versioned proof: ${result?.reason}`);
  assert.deepEqual({...result.reuse, planDigest: null, jobsDigest: null}, {version: 1, repository, repositoryId: 123, pr: 51,
    mergeSha: merge, sha: head, tree, workflowId: 17, workflowPath: workflow, runId: 42, attempt: 2, planDigest: null, jobsDigest: null});
  assert.match(result.reuse.planDigest, /^[a-f0-9]{64}$/); assert.match(result.reuse.jobsDigest, /^[a-f0-9]{64}$/);
});

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
