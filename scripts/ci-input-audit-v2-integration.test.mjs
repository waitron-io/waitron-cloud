import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {performance} from 'node:perf_hooks';
import {auditAllInputModes} from './ci-input-audit.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';

const policy = 'scripts/ci-input-audit.json', marker = 'scripts/ci-input-audit-v2.json', records = 'scripts/ci-input-audit.d';
function completeFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-v2-complete-'));
  const childEnv = {...process.env}; delete childEnv.NODE_TEST_CONTEXT;
  let calls = 0, batches = 0;
  const git = (...args) => {
    calls++;
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: 'pipe'});
  };
  git.readBlobs = ids => { batches++; return readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input, maxBuffer: 64 * 1024 * 1024, stdio: 'pipe'})); };
  const node = (file, args = [], env = {}) => spawnSync(process.execPath, [file, ...args], {cwd: root, env: {...childEnv, ...env}, encoding: 'utf8', timeout: 90_000, maxBuffer: 64 * 1024 * 1024});
  const ok = result => assert.equal(result.status, 0, result.stdout + result.stderr);
  const commit = () => {git('add', '-A'); git('commit', '-sm', 'Complete v2 audit control'); return git('rev-parse', 'HEAD').trim();};
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    cpSync('scripts', join(root, 'scripts'), {recursive: true});
    git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    git('add', '-A');
    if (!git('ls-files', marker).trim()) {ok(node('scripts/ci-input-audit.mjs', ['--init-v2-staged'])); git('add', marker, records);}
    ok(node('scripts/ci-input-audit.mjs', ['--write-staged', '--mode', 'all']));
    const base = commit();
    run({root, git, node, ok, commit, base, counts: () => ({calls, batches})});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('complete v2 candidate checks real record volume with bounded batched reads', {timeout: 120_000}, () => completeFixture(({root, git, node, ok, base, counts}) => {
  const frozen = readFileSync(join(root, policy), 'utf8');
  const files = git('ls-tree', '-rz', '--full-tree', base).split('\0').filter(Boolean);
  const metadata = files.filter(row => row.split('\t')[1].startsWith(records + '/'));
  assert.ok(metadata.length >= 7000, `Complete candidate required; saw only ${metadata.length} records`);
  const before = counts(), started = performance.now();
  assert.doesNotThrow(() => auditAllInputModes(base, git));
  assert.equal(counts().batches - before.batches, 1);
  assert.ok(counts().calls - before.calls < 100, `Audit spawned ${counts().calls - before.calls} Git readers`);
  assert.ok(performance.now() - started < 60_000, 'Audit must fit existing CI budgets');
  ok(node('scripts/ci-input-audit.mjs', ['--check', base]));
  ok(node('scripts/ci-docs.mjs', ['--audit', base]));
  ok(node('scripts/ci-input-audit.mjs', ['--write-staged', '--mode', 'all']));
  assert.equal(git('diff', '--', records, marker, policy), '');
  assert.equal(readFileSync(join(root, policy), 'utf8'), frozen);
}));

test('complete v2 candidate qualifies immutable prose while dirty code cannot influence planning', {timeout: 120_000}, () => completeFixture(({root, git, node, ok, commit, base}) => {
  appendFileSync(join(root, 'README.md'), '\nComplete v2 immutable prose control.\n'); const head = commit();
  // Dirty source must neither repair nor spoil the saved inventory.
  appendFileSync(join(root, 'packages/translation/src/index.ts'), '\nthrow new Error("unstaged source");\n');
  const event = join(root, '.git', 'event.json'), output = join(root, '.git', 'plan-output');
  writeFileSync(event, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}})); writeFileSync(output, '');
  ok(node('scripts/ci-plan.mjs', [], {GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_SHA: head}));
  const plan = JSON.parse(readFileSync(output, 'utf8').split('\n').find(line => line.startsWith('plan=')).slice(5));
  assert.deepEqual(plan.packages, []); assert.equal(plan.typecheck, false); assert.ok(plan.documentation);
  ok(node('scripts/ci-docs.mjs', [], {CI_PLAN: JSON.stringify(plan)}));
  assert.notEqual(node('scripts/ci-input-audit.mjs', ['--check', head]).status, 0, 'Peer prose inventories must stay stale');
}));
