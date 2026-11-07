import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {selectionFixture as fixture} from './fixtures/ci-selection.mjs';
import {createPlan} from './ci-plan.mjs';
import {documentationPlan, checkDocumentation} from './ci-docs.mjs';
import {scriptPlan} from './ci-scripts.mjs';
import {assertSummary} from './ci-summary.mjs';

const path = name => fileURLToPath(new URL(name, import.meta.url));
const node = (root, name, args = [], env = {}) => {
  const childEnv = {...process.env, GITHUB_EVENT_NAME: 'pull_request',
    CI_FULL: 'false', CI_CALLED: 'false', CI_FORCE_FULL: 'false', CI_WORKFLOW_INPUTS: '{}', CI_RECORD_EVIDENCE: 'false', ...env};
  delete childEnv.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [path(name), ...args], {cwd: root, encoding: 'utf8', timeout: 30_000, env: childEnv});
};
const ok = result => assert.equal(result.status, 0, result.stderr + result.stdout);
const bad = result => assert.notEqual(result.status, 0, result.stderr + result.stdout);
const workspace = ['stock', 'other'].map(name => ({name, directory: `packages/${name}`, scripts: {test: 'node --test'}}));
const event = (base, head) => ({pull_request: {base: {sha: base}, head: {sha: head}}});
function consumerFixture(run) {
  fixture(context => {
    const {root, git, put, commit} = context;
    put('packages/other/package.json', '{"name":"other","scripts":{"test":"node --test"}}\n');
    put('packages/other/src/index.mjs', 'export const value = 1;\n');
    git('add', '-A');
    const base = commit();
    const plan = head => createPlan(event(base, head), {sha: head}, workspace, git, () => {throw Error('No network');});
    const cliPlan = head => {
      const output = join(root, '.git', 'event-output'), eventFile = join(root, '.git', 'event.json');
      writeFileSync(output, ''); writeFileSync(eventFile, JSON.stringify(event(base, head)));
      const result = node(root, './ci-plan.mjs', [], {GITHUB_OUTPUT: output, GITHUB_EVENT_PATH: eventFile, GITHUB_SHA: head});
      ok(result);
      return JSON.parse(readFileSync(output, 'utf8').split('\n').find(line => line.startsWith('plan=')).slice(5));
    };
    run({...context, base, plan, cliPlan});
  });
}

test('isolated document and root-script plans stay narrow through actual CLI adapters', () => consumerFixture(({root, git, put, commit, base, plan, cliPlan}) => {
  put('README.md', '# Revised prose\n'); const head = commit();
  for (const selected of [plan(head), cliPlan(head)]) {
    assert.deepEqual(selected.packages, []); assert.equal(selected.typecheck, false); assert.ok(selected.documentation);
    ok(node(root, './ci-docs.mjs', [], {CI_PLAN: JSON.stringify(selected)}));
    const results = {changes: 'success', documentation: 'success', scripts: 'skipped', root: 'skipped', typecheck: 'skipped', receipts: 'skipped', packages: 'skipped'};
    assert.doesNotThrow(() => assertSummary(selected, results, ['changes', 'documentation'].map(name => ({name, status: 'completed', conclusion: 'success'}))));
  }
  for (const target of ['scripts/identity-upstream.mjs', 'scripts/verify-gateway-reconnection-receipt.mjs']) {
    git('reset', '--hard', base); put(target, 'export const value = 2;\n'); const scriptHead = commit();
    const selected = cliPlan(scriptHead); assert.ok(selected.scripts); assert.deepEqual(selected.packages, []);
    ok(node(root, './ci-scripts.mjs', [], {CI_PLAN: JSON.stringify(selected)}));
  }
}));

test('an unknown reader retains full work and both proofs', () => consumerFixture(({root, put, commit, cliPlan}) => {
  put('scripts/new-reader.mjs', 'export const reader = true;\n'); const head = commit();
  const selected = cliPlan(head); assert.equal(selected.packages.length, 2); assert.equal(selected.typecheck, true);
  assert.ok(selected.receipts.length > 0);
  const output = join(root, 'proof-output'); writeFileSync(output, '');
  ok(node(root, './ci-docs.mjs', ['--plan'], {GITHUB_OUTPUT: output, GITHUB_EVENT_PATH: join(root, '.git', 'event.json')}));
  assert.equal(readFileSync(output, 'utf8'), 'required=true\n');
}));

test('mixed prose selects actual package ownership', () => consumerFixture(({root, git, put, commit, base, plan}) => {
  put('packages/stock/src/index.mjs', 'export const value = 2;\n'); put('docs/backlog.md', '# Backlog change\n'); git('add', '-A');
  const head = commit();
  assert.deepEqual(plan(head).packages.map(row => row.package), ['stock']);
  assert.notEqual(head, base);
}));

test('a merged main tree admits later prose and retains the no-event full fallback', () => consumerFixture(({git, put, commit, base}) => {
  git('checkout', '-b', 'reader-change', base); put('scripts/first-reader.mjs', 'export const first = true;\n'); const first = commit();
  git('checkout', 'main'); put('scripts/second-reader.mjs', 'export const second = true;\n'); commit();
  git('merge', '--no-ff', '--no-edit', '--signoff', first); const merged = git('rev-parse', 'HEAD').trim();
  put('README.md', '# Prose child on merged main\n'); const head = commit();
  const proseOnly = documentationPlan(['README.md'], merged, head, git); assert.ok(proseOnly);
  assert.equal(checkDocumentation({documentation: proseOnly}, git), 1);
  const selected = createPlan(event(merged, head), {sha: head}, workspace, git, () => {throw Error('No API');});
  assert.ok(selected.documentation); assert.equal(selected.typecheck, false);
  const main = createPlan({}, {sha: head}, workspace, git, () => {throw Error('No API');});
  assert.equal(main.packages.length, 2); assert.equal(main.typecheck, true);
}));

test('the owning script still rejects invalid behavior and syntax', () => consumerFixture(({root, git, put, commit, base, cliPlan}) => {
  put('scripts/identity-upstream.test.mjs', "import assert from 'node:assert/strict';\nassert.fail('owning behavior failed');\n");
  const head = commit(); const selected = cliPlan(head); assert.ok(selected.scripts);
  const result = node(root, './ci-scripts.mjs', [], {CI_PLAN: JSON.stringify(selected)});
  bad(result); assert.match(result.stdout + result.stderr, /owning behavior failed/);
  put('scripts/identity-upstream.mjs', 'invalid ! javascript\n'); const invalid = commit();
  bad(node(root, './ci-scripts.mjs', [], {CI_PLAN: JSON.stringify(cliPlan(invalid))}));
  assert.ok(scriptPlan(['scripts/identity-upstream.mjs'], base, invalid, git));
}));

test('lock selection retains types and every receipt from both saved revisions', () => consumerFixture(({root, git, put, commit}) => {
  const lock = {lockfileVersion: '9.0', settings: {autoInstallPeers: true, excludeLinksFromLockfile: false},
    importers: {'.': {}, 'packages/stock': {dependencies: {adapter: {specifier: '^1', version: '1.0.0'}}}, 'packages/other': {}},
    packages: {'adapter@1.0.0': {resolution: {integrity: 'sha512-YQ=='}}}, snapshots: {'adapter@1.0.0': {}}};
  const save = () => put('pnpm-lock.yaml', Object.entries(lock).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join(''));
  save(); git('add', '-A'); const base = commit();
  lock.packages['adapter@1.0.0'].resolution.integrity = 'sha512-Yw=='; save(); const head = commit();
  const selected = createPlan(event(base, head), {sha: head}, workspace, git, () => {throw Error('No API');});
  assert.deepEqual(selected.packages.map(row => row.package), ['stock']); assert.equal(selected.typecheck, true);
  assert.equal(selected.receipts.length, 6); assert.match(selected.reason, /saved package selection/);
}));
