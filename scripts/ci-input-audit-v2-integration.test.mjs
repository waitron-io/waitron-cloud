import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

function completeFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-v2-complete-'));
  const childEnv = {...process.env, GITHUB_EVENT_NAME: 'pull_request',
    CI_FULL: 'false', CI_CALLED: 'false', CI_FORCE_FULL: 'false', CI_WORKFLOW_INPUTS: '{}', CI_RECORD_EVIDENCE: 'false'};
  delete childEnv.NODE_TEST_CONTEXT;
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: 'pipe'});
  };

  const node = (file, args = [], env = {}) => spawnSync(process.execPath, [file, ...args], {cwd: root, env: {...childEnv, ...env}, encoding: 'utf8', timeout: 90_000, maxBuffer: 64 * 1024 * 1024});
  const ok = result => assert.equal(result.status, 0, result.stdout + result.stderr);
  const commit = () => {git('add', '-A'); git('commit', '--allow-empty', '-sm', 'Complete input fixture'); return git('rev-parse', 'HEAD').trim();};
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    cpSync('scripts', join(root, 'scripts'), {recursive: true});
    git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    const base = commit();
    run({root, git, node, ok, commit, base});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('complete candidate qualifies immutable prose while dirty code cannot influence planning', {timeout: 120_000}, () => completeFixture(({root, git, node, ok, commit, base}) => {
  appendFileSync(join(root, 'README.md'), '\nComplete immutable prose control.\n'); const head = commit();
  // Dirty source must neither repair nor spoil the saved inventory.
  appendFileSync(join(root, 'packages/translation/src/index.ts'), '\nthrow new Error("unstaged source");\n');
  const event = join(root, '.git', 'event.json'), output = join(root, '.git', 'plan-output');
  writeFileSync(event, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}})); writeFileSync(output, '');
  ok(node('scripts/ci-plan.mjs', [], {GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_SHA: head}));
  const plan = JSON.parse(readFileSync(output, 'utf8').split('\n').find(line => line.startsWith('plan=')).slice(5));
  assert.deepEqual(plan.packages, []); assert.equal(plan.typecheck, false); assert.ok(plan.documentation);
  ok(node('scripts/ci-docs.mjs', [], {CI_PLAN: JSON.stringify(plan)}));
}));

test('the configured root preflight accepts full actual work without review records', {timeout: 120_000}, () => completeFixture(({root, git, node, ok, commit, base}) => {
  appendFileSync(join(root, 'scripts/ci-docs.mjs'), '\n// Changed reader fixture.\n'); const head = commit();
  const event = join(root, '.git', 'event.json'), output = join(root, '.git', 'plan-output');
  writeFileSync(event, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}})); writeFileSync(output, '');
  ok(node('scripts/ci-plan.mjs', [], {GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_SHA: head}));
  const plan = JSON.parse(readFileSync(output, 'utf8').split('\n').find(line => line.startsWith('plan=')).slice(5));
  assert.equal(plan.packages.length, 29); assert.equal(plan.receipts.length, 6); assert.equal(plan.typecheck, true);
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const rootJob = workflow.split('\n  root:\n')[1].split(/\n  [\w-]+:\n/)[0];
  const command = /run: (node scripts\/ci-root-inputs.mjs --check)/.exec(rootJob)?.[1];
  assert.ok(command, 'The real root preflight must remain configured');
  const result = spawnSync(process.execPath, command.split(' ').slice(1), {cwd: root, encoding: 'utf8', timeout: 30_000,
    env: {...process.env, CI_PLAN: JSON.stringify(plan), GITHUB_EVENT_PATH: event, GITHUB_SHA: head, CI_HEAD_SHA: head}});
  assert.equal(result.status, 0, result.stdout + result.stderr);
}));

test('a complete changed selector publishes its full plan within the job output budget', {timeout: 120_000}, () => completeFixture(({root, git, node, ok, commit}) => {
  const base = commit();
  mkdirSync(join(root, 'scripts/output-budget'));
  for (let i = 0; i < 4000; i++) writeFileSync(join(root, 'scripts/output-budget', 'input-'.repeat(30) + i + '.json'), '{}\n');
  const head = commit();
  const paths = git('diff', '--name-only', base, head).trim();
  assert.ok(Buffer.byteLength(paths, 'utf16le') > 1024 * 1024, 'Exercise a changed-path explanation beyond the job output budget');
  const event = join(root, '.git', 'large-change-event.json'), output = join(root, '.git', 'large-change-output');
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
  assert.ok(Buffer.byteLength(text, 'utf16le') < 1024 * 1024, 'A long changed-path explanation must not prevent publication of required work');
}));
