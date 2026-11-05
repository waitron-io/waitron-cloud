import assert from 'node:assert/strict';
import {readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {rootReviewFixture} from './ci-root-review-fixture.mjs';

const api = await import('./ci-root-inputs.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const rootPath = 'scripts/ci-root-shards.test.mjs';
const capacityPath = 'scripts/verify-backup-capacity-receipt.test.mjs';
const registryPath = 'scripts/ci-root-inputs.json';
const recordRoot = 'scripts/ci-root-review.d/';

function fixture(run) {
  assert.equal(typeof api.rootInputPlan, 'function', 'Root input owners need a two-tree mapper');
  rootReviewFixture(context => {
    const {git, write, renew, commit} = context;
    for (const path of ['scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs',
      'scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs']) write(path, 'historical peer\n');
    write('pnpm-lock.yaml', 'lockfileVersion: 9\n');
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    write('packages/control/package.json', {name: '@waitron-cloud/control', scripts: {test: 'node --test test/*.test.mjs'}});
    write('packages/control/src/index.mjs', 'export const value = 1;\n');
    write('package.json', {scripts: {'test:backup-capacity': `node --test ${capacityPath}`, 'test:local-stack': 'node --test deploy/local-stack/*.test.mjs'}});
    git('add', '-A');
    const paths = git('ls-tree', '-rz', '--full-tree', git('write-tree').trim()).split('\0').filter(Boolean)
      .map(row => row.split('\t')[1]).filter(path => !path.startsWith(recordRoot) && path !== 'scripts/ci-input-audit.json' && !path.endsWith('.md'));
    const audit = args => spawnSync(process.execPath, [fileURLToPath(new URL('./ci-input-audit.mjs', import.meta.url)), ...args],
      {cwd: context.root, encoding: 'utf8', timeout: 30_000});
    renew(paths); git('add', '-A'); let result = audit(['--init-v2-staged']); assert.equal(result.status, 0, result.stdout + result.stderr);
    const base = commit();
    const docs = () => {
      git('add', '-A'); result = audit(['--write-staged', '--mode', 'docs']); assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    const changedPaths = head => git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean);
    const plan = head => api.rootInputPlan(changedPaths(head), base, head, git);
    run({...context, docs, base, changedPaths, plan});
  });
}

test('two saved trees need current review and return exact root owners', () => fixture(({git, write, renew, docs, commit, base, changedPaths, plan}) => {
  write(rootPath, 'changed root test\n'); renew([rootPath]); docs(); const head = commit();
  assert.deepEqual(plan(head), {rootInputs: {version: 1, base, head, paths: changedPaths(head), entryIds: ['root-partition-contract']},
    rootTests: true, receipts: [], packagePaths: []});
  write(rootPath, 'stale head\n'); docs(); const stale = commit();
  assert.match(plan(stale).reason, /head.*Unreviewed root input/);
  renew([rootPath]); docs(); const current = commit();
  assert.match(api.rootInputPlan(changedPaths(current), stale, current, git).reason, /base.*Unreviewed root input/);
}));

test('receipt-only and mixed registered inputs deduplicate exact owners without package work', () => fixture(({write, renew, docs, commit, plan}) => {
  const health = 'deploy/local-stack/operations-health.test.mjs';
  write(capacityPath, 'new capacity check\n'); renew([capacityPath]); docs();
  assert.deepEqual(plan(commit()).receipts, ['test:backup-capacity']);
  write(health, 'new health check\n'); write(rootPath, 'new root check\n'); renew([health, rootPath]); docs();
  const result = plan(commit());
  assert.equal(result.rootTests, true);
  assert.deepEqual(result.receipts, ['test:backup-capacity', 'test:local-stack']);
  assert.deepEqual(result.rootInputs.entryIds, ['capacity-verifier-test', 'local-health-test', 'root-partition-contract']);
  assert.deepEqual(result.packagePaths, []);
}));

test('registry edit stays full even with complete renewed evidence', () => fixture(({root, git, write, renew, docs, commit, plan}) => {
  const registry = JSON.parse(readFileSync(join(root, registryPath))); registry.entries[0].sites[0].site = 'reviewed replacement:2';
  write(registryPath, registry); git('add', '-A');
  const paths = git('ls-tree', '-rz', '--full-tree', git('write-tree').trim()).split('\0').filter(Boolean).map(row => row.split('\t')[1])
    .filter(path => !path.startsWith(recordRoot) && !path.startsWith('scripts/ci-input-audit.d/') &&
      path !== 'scripts/ci-input-audit-v2.json' && path !== 'scripts/ci-input-audit.json' && !path.endsWith('.md'));
  renew(paths); docs(); const result = plan(commit());
  assert.equal(result.full, true); assert.match(result.reason, /registry changed/);
}));

test('new readers and directory members cannot inherit review through docs renewal', () => fixture(({write, renew, docs, commit, plan}) => {
  write(rootPath, 'changed check\n'); renew([rootPath]);
  write('scripts/another-reader.mjs', "readFileSync('scripts/ci-root-shards.test.mjs');\n"); docs();
  const result = plan(commit()); assert.equal(result.full, true); assert.match(result.reason, /Unreviewed root input: scripts\/another-reader.mjs/);
}));

test('missing bootstrap and a stale base still inspect both saved inventories', () => fixture(({git, write, docs, commit, base, changedPaths}) => {
  write(rootPath, 'stale check\n'); docs(); const head = commit();
  const seen = new Set();
  const observe = (...args) => {if (args[0] === 'ls-tree') seen.add(args[3]); return git(...args);}; observe.readBlobs = git.readBlobs;
  const result = api.rootInputPlan(changedPaths(head), head, base, observe);
  assert.equal(result.full, true);
  assert.ok(seen.has(base) && seen.has(head), 'Both immutable trees must be inspected on review refusal');
}));

test('registered work plus prose and package inputs preserves exact immutable package membership', () => fixture(({write, renew, docs, commit, plan}) => {
  const path = 'packages/control/src/index.mjs';
  write(rootPath, 'root change\n'); write(path, 'package change\n'); write('docs/explanation.md', 'new prose\n');
  renew([rootPath, path]); docs(); const result = plan(commit());
  assert.deepEqual(result.packagePaths, [path]); assert.equal(result.rootTests, true);
}));

test('shared unknown and deleted inputs win over registered ownership', () => fixture(({root, git, write, renew, docs, commit, base, plan}) => {
  for (const path of ['pnpm-lock.yaml', '.github/workflows/ci.yml', 'scripts/unknown.mjs', 'packages/unknown/src/read.mjs']) {
    git('reset', '--hard', base); git('clean', '-fdq');
    write(rootPath, 'root change\n'); write(path, 'unknown change\n'); renew([rootPath, path]); docs();
    const result = plan(commit()); assert.equal(result.full, true, path); assert.match(result.reason, /Shared or unknown root input/);
  }
  git('reset', '--hard', base); git('clean', '-fdq'); rmSync(join(root, rootPath)); docs();
  const result = plan(commit()); assert.equal(result.full, true); assert.match(result.reason, /Missing regular root registry target/);
}));

test('evidence alone cannot create empty work and ordinary unregistered paths retain the existing route', () => fixture(({write, renew, docs, commit, plan, base, git}) => {
  renew([rootPath], 'another reviewer', 'review/again'); docs();
  assert.match(plan(commit()).reason, /Evidence or prose alone/);
  assert.equal(api.rootInputPlan(['scripts/unknown.mjs'], base, base, git), null);
}));

test('an unreviewed long path produces a bounded refusal diagnostic', () => fixture(({write, renew, docs, commit, plan}) => {
  write(rootPath, 'root change\n'); renew([rootPath]);
  write('scripts/' + ('x'.repeat(150) + '/').repeat(5) + 'reader.mjs', 'new reader\n'); docs();
  const result = plan(commit()); assert.equal(result.full, true);
  assert.match(result.reason, /Unreviewed root input/); assert.ok(result.reason.length <= 512, 'Refusals must not serialize an unbounded inventory');
}));

test('changed package test commands remain full after explicit root review renewal', () => fixture(({write, renew, docs, commit, plan}) => {
  write(rootPath, 'root change\n');
  write('packages/control/package.json', {name: '@waitron-cloud/control', scripts: {test: 'node --test a-different-test.mjs'}});
  renew([rootPath, 'packages/control/package.json']); docs();
  const result = plan(commit()); assert.equal(result.full, true); assert.match(result.reason, /test commands changed/);
}));
