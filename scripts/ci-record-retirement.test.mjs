import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {documentationPlan, checkDocumentation} from './ci-docs.mjs';
import {rootInputPlan, rootVerificationContext} from './ci-root-inputs.mjs';
import {scriptPlan} from './ci-scripts.mjs';
import {proofInputPlanRange} from './ci-proof-inputs.mjs';

const rootTest = 'scripts/ci-root-shards.test.mjs';
const healthTest = 'deploy/local-stack/operations-health.test.mjs';
const workspace = [{name: '@waitron-cloud/identity', directory: 'packages/identity', scripts: {test: 'node --test test/*.test.mjs'}, sources: []}];
const metadata = ['scripts/ci-input-audit.json', 'scripts/ci-input-audit-v2.json',
  'scripts/ci-root-inputs.json', 'scripts/ci-input-audit.d/docs/invalid.json', 'scripts/ci-root-review.d/invalid.json'];
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-ci-record-retirement-'));
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root,
      encoding: binary ? undefined : 'utf8', stdio: 'pipe'});
  };
  const put = (path, value = 'export const value = 1;\n') => {
    mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), value);
  };
  const commit = () => {git('add', '-A'); git('commit', '--allow-empty', '-sqm', 'Save retirement fixture'); return git('rev-parse', 'HEAD').trim();};
  const paths = (base, head) => git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean);
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.test');
    put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    put('package.json', '{}\n'); put('packages/identity/package.json', JSON.stringify(workspace[0]));
    put('packages/identity/src/index.mjs'); put(rootTest); put(healthTest);
    put('scripts/identity-upstream.mjs'); put('scripts/identity-upstream.test.mjs');
    put('docs/guide.md', '# Guide\n');
    run({root, git, put, commit, paths});
  } finally {rmSync(root, {recursive: true, force: true});}
}

// Reintroducing renewal into any live selector must refuse these deliberately invalid records.
for (const location of ['base', 'head', 'both']) test(`prose selection ignores malformed records in ${location}`, () => fixture(({git, put, commit}) => {
  if (location !== 'head') for (const path of metadata) put(path, '{not a record\n');
  const base = commit();
  if (location !== 'base') for (const path of metadata) put(path, 'not JSON\n');
  put('docs/guide.md', '# Updated guide\n'); const head = commit();
  const selected = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {sha: head}, workspace, git);
  assert.deepEqual(selected.packages, []); assert.deepEqual(selected.receipts, []);
  assert.deepEqual(selected.documentation, {base, head, paths: ['docs/guide.md']});
  assert.equal(checkDocumentation(selected, git), 1);
  for (const kind of ['cost', 'venue']) assert.equal(proofInputPlanRange(kind, {base, head}, git).required, false);
}));

test('both root owners select their real checks without activation or renewal', () => fixture(({git, put, commit, paths}) => {
  const base = commit();
  put(rootTest, 'export const value = 2;\n'); put(healthTest, 'export const value = 2;\n');
  for (const path of metadata) put(path, 'ignored\n'); const head = commit();
  const plan = rootInputPlan(paths(base, head), base, head, git);
  assert.equal(plan.full, undefined); assert.equal(plan.rootTests, true);
  assert.deepEqual(plan.receipts, ['test:local-stack']);
  assert.deepEqual(plan.rootInputs.entryIds, ['local-health-test', 'root-partition-contract']);
}));

test('deleting either owner target keeps full work', () => fixture(({root, git, put, commit, paths}) => {
  const base = commit();
  for (const target of [rootTest, healthTest]) {
    git('reset', '--hard', base); rmSync(join(root, target)); put(rootTest === target ? healthTest : rootTest, 'changed\n');
    const head = commit(); assert.equal(rootInputPlan(paths(base, head), base, head, git).full, true, target);
  }
}));

test('prose links in either saved tree cannot inherit a regular-file exemption', () => fixture(({root, git, put, commit}) => {
  const initial = commit();
  for (const linked of ['base', 'head']) {
    git('reset', '--hard', initial);
    if (linked === 'base') {rmSync(join(root, 'docs/guide.md')); symlinkSync('../package.json', join(root, 'docs/guide.md'));}
    const base = commit(); rmSync(join(root, 'docs/guide.md'));
    if (linked === 'head') symlinkSync('../package.json', join(root, 'docs/guide.md'));
    else put('docs/guide.md', '# Restored\n');
    const head = commit(); assert.throws(() => documentationPlan(['docs/guide.md'], base, head, git), /regular/i);
  }
}));

test('script-only selection needs regular saved targets but no record files', () => fixture(({git, put, commit}) => {
  const base = commit(); put('scripts/identity-upstream.mjs', 'export const value = 2;\n'); const head = commit();
  assert.deepEqual(scriptPlan(['scripts/identity-upstream.mjs'], base, head, git),
    {base, head, paths: ['scripts/identity-upstream.mjs']});
}));

test('unmarked full work refuses wrong checkouts and dirty tracked bytes without activation', () => fixture(({root, put, commit}) => {
  const base = commit(); put('docs/guide.md', '# Updated\n'); const head = commit();
  const cwd = process.cwd(); process.chdir(root);
  try {
    const full = {packages: [], receipts: [], typecheck: true};
    assert.throws(() => rootVerificationContext(full, {GITHUB_SHA: base}), /exact head checkout/);
    assert.throws(() => rootVerificationContext(full, {GITHUB_SHA: head, GITHUB_ACTIONS: 'true'}), /original event/);
    put('docs/guide.md', '# Dirty tracked prose\n');
    assert.throws(() => rootVerificationContext(full, {GITHUB_SHA: head}), /clean tracked checkout/);
  } finally {process.chdir(cwd);}
}));

// A root test reads this verifier test's live bytes, so its receipt is not its only owner.
test('the capacity verifier test stays unregistered and retains full work', () => fixture(({git, put, commit}) => {
  const path = 'scripts/verify-backup-capacity-receipt.test.mjs';
  put(path); const base = commit(); put(path, 'export const value = 2;\n'); const head = commit();
  const selected = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {sha: head}, workspace, git);
  assert.deepEqual(selected.packages, [{package: '@waitron-cloud/identity', shard: 1}]);
  assert.equal(selected.typecheck, true); assert.equal(selected.rootInputs, undefined);
  assert.deepEqual(selected.receipts, ['test:two-venue-milestone-receipt', 'test:backup-capacity',
    'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt', 'test:cloud-cost']);
}));
