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
  const childEnv = {...process.env, GITHUB_EVENT_NAME: 'pull_request',
    CI_FULL: 'false', CI_CALLED: 'false', CI_FORCE_FULL: 'false', CI_WORKFLOW_INPUTS: '{}', CI_RECORD_EVIDENCE: 'false'};
  delete childEnv.NODE_TEST_CONTEXT;
  let calls = 0, batches = 0;
  const git = (...args) => {
    calls++;
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: 'pipe'});
  };
  git.readBlobs = ids => { batches++; return readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input, maxBuffer: 64 * 1024 * 1024, stdio: 'pipe'})); };
  const node = (file, args = [], env = {}) => spawnSync(process.execPath, [file, ...args], {cwd: root, env: {...childEnv, ...env}, encoding: 'utf8', timeout: 90_000, maxBuffer: 64 * 1024 * 1024});
  const ok = result => assert.equal(result.status, 0, result.stdout + result.stderr);
  const commit = () => {git('add', '-A'); git('commit', '--allow-empty', '-sm', 'Complete v2 audit control'); return git('rev-parse', 'HEAD').trim();};
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

test('both configured workflow freshness gates refuse the real stale v2 head', {timeout: 120_000}, () => completeFixture(({root, git, commit}) => {
  appendFileSync(join(root, 'scripts/ci-docs.mjs'), '\n// Stale-reader workflow control.\n'); commit();
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const job of ['root', 'scripts']) {
    const body = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0] ?? '';
    const gates = body.split('\n').flatMap(line => {
      const match = /^\s*(?:- )?run: (.+ci-docs\.mjs --audit .+)$/.exec(line);
      return match ? [match[1]] : [];
    });
    // Execute the configured command against the same committed stale input.
    // A missing gate becomes a successful no-op and must fail this control.
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync('/bin/sh', ['-c', gates.length ? gates.join('\n') : 'true'], {cwd: root, env, encoding: 'utf8', timeout: 30_000});
    assert.notEqual(result.status, 0, `${job} must reject stale documentation evidence`);
    assert.match(result.stderr, /Unreviewed audit input/, `${job} must run the actual immutable freshness check`);
  }
}));

test('the complete v2 migration publishes its full plan within the job output budget', {timeout: 120_000}, () => completeFixture(({root, git, node, ok, commit}) => {
  git('checkout', '--orphan', 'migration-v1');
  rmSync(join(root, marker)); rmSync(join(root, records), {recursive: true});
  git('add', '-A'); ok(node('scripts/ci-input-audit.mjs', ['--write-staged']));
  const base = commit();
  ok(node('scripts/ci-input-audit.mjs', ['--init-v2-staged']));
  const head = commit();
  const event = join(root, '.git', 'migration-event.json'), output = join(root, '.git', 'migration-output');
  writeFileSync(event, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}})); writeFileSync(output, '');
  ok(node('scripts/ci-plan.mjs', [], {GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_SHA: head}));
  const text = readFileSync(output, 'utf8');
  const values = Object.fromEntries(text.trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const plan = JSON.parse(values.plan);
  assert.equal(plan.packages.length, 29);
  assert.deepEqual(plan.receipts, ['test:two-venue-milestone-receipt', 'test:backup-capacity', 'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt', 'test:cloud-cost']);
  assert.equal(plan.typecheck, true); assert.equal(plan.reuse, null);
  assert.equal(values.packages, 'true'); assert.equal(values.receipts, 'true'); assert.equal(values.typecheck, 'true');
  assert.deepEqual(JSON.parse(values.package_matrix), {include: plan.packages});
  // GitHub estimates the per-job 1 MiB output limit using UTF-16 bytes.
  assert.ok(Buffer.byteLength(text, 'utf16le') < 1024 * 1024, 'The migration explanation must not prevent publication of required work');
}));
