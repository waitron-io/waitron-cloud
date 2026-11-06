import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {writeFileSync, readFileSync, rmSync, mkdtempSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {fixture, recordPath} from './ci-input-audit-v2-fixture.mjs';
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
    git('add', '-A'); ok(node(root, './ci-input-audit.mjs', ['--write-staged', '--mode', 'all']));
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

test('v2 preserves isolated document and root-script plans through actual CLI adapters', () => consumerFixture(({root, git, put, commit, base, plan, cliPlan}) => {
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

test('v2 stale docs fail the required gate while retaining full work', () => consumerFixture(({root, put, commit, cliPlan}) => {
  put('scripts/new-reader.mjs', 'export const reader = true;\n'); const head = commit();
  const selected = cliPlan(head); assert.equal(selected.packages.length, 2); assert.equal(selected.typecheck, true);
  assert.ok(selected.receipts.length > 0); bad(node(root, './ci-docs.mjs', ['--audit', head]));
  const output = join(root, 'proof-output'); writeFileSync(output, '');
  ok(node(root, './ci-docs.mjs', ['--plan'], {GITHUB_OUTPUT: output, GITHUB_EVENT_PATH: join(root, '.git', 'event.json')}));
  assert.equal(readFileSync(output, 'utf8'), 'required=true\n');
}));

test('v2 mixed evidence requires all four current head modes', () => consumerFixture(({root, git, put, commit, base, plan}) => {
  put('packages/stock/src/index.mjs', 'export const value = 2;\n'); put('docs/backlog.md', '# Backlog change\n'); git('add', '-A');
  ok(node(root, './ci-input-audit.mjs', ['--write-staged'])); const docsOnlyRenewal = commit();
  assert.equal(plan(docsOnlyRenewal).packages.length, 2, 'Stale head peers cannot remove evidence from the scope');
  ok(node(root, './ci-input-audit.mjs', ['--write-staged', '--mode', 'all'])); const head = commit();
  assert.deepEqual(plan(head).packages.map(row => row.package), ['stock']);
  ok(node(root, './ci-docs.mjs', ['--audit', head]));
  assert.notEqual(head, base);
}));

test('v2 fresh head cannot bless a stale base and novel prose peers retain full work', () => consumerFixture(({root, git, put, commit, plan}) => {
  put('packages/stock/src/index.mjs', 'export const value = 2;\n'); const stale = commit();
  git('add', '-A'); ok(node(root, './ci-input-audit.mjs', ['--write-staged', '--mode', 'all'])); const renewed = commit();
  put('README.md', '# Prose child\n'); const head = commit();
  assert.throws(() => documentationPlan(['README.md'], stale, head, git));
  const proseOnly = documentationPlan(['README.md'], renewed, head, git); assert.ok(proseOnly);
  assert.equal(checkDocumentation({documentation: proseOnly}, git), 1);
  bad(node(root, './ci-input-audit.mjs', ['--check', head])); ok(node(root, './ci-docs.mjs', ['--audit', head]));
  const main = createPlan({}, {sha: head}, workspace, git, () => {throw Error('No API');});
  assert.equal(main.packages.length, 2); assert.equal(main.typecheck, true);
}));

test('v2 owning script behavior still fails with valid audit evidence', () => consumerFixture(({root, git, put, commit, base, cliPlan}) => {
  put('scripts/identity-upstream.test.mjs', "import assert from 'node:assert/strict';\nassert.fail('owning behavior failed');\n");
  const head = commit(); const selected = cliPlan(head); assert.ok(selected.scripts);
  const result = node(root, './ci-scripts.mjs', [], {CI_PLAN: JSON.stringify(selected)});
  bad(result); assert.match(result.stdout + result.stderr, /owning behavior failed/);
  put('scripts/identity-upstream.mjs', 'invalid ! javascript\n'); const invalid = commit();
  bad(node(root, './ci-scripts.mjs', [], {CI_PLAN: JSON.stringify(cliPlan(invalid))}));
  assert.ok(scriptPlan(['scripts/identity-upstream.mjs'], base, invalid, git));
}));

test('v2 refuses shallow history and accepts the unchanged revision after full fetch', () => consumerFixture(({root, git, base}) => {
  const clone = mkdtempSync(join(tmpdir(), 'cloud-v2-shallow-'));
  try {
    execFileSync('git', ['clone', '--quiet', '--depth=1', `file://${root}`, clone], {stdio: 'pipe'});
    bad(node(clone, './ci-docs.mjs', ['--audit', base]));
    const result = node(clone, './ci-docs.mjs', ['--audit', base]); assert.match(result.stderr, /complete history/);
    execFileSync('git', ['-C', clone, 'fetch', '--unshallow'], {stdio: 'pipe'});
    ok(node(clone, './ci-docs.mjs', ['--audit', base]));
  } finally {rmSync(clone, {recursive: true, force: true});}
}));

test('v2 lock selection retains types and every receipt with both immutable lock audits', () => consumerFixture(({root, git, put, commit}) => {
  const lock = {lockfileVersion: '9.0', settings: {autoInstallPeers: true, excludeLinksFromLockfile: false},
    importers: {'.': {}, 'packages/stock': {dependencies: {adapter: {specifier: '^1', version: '1.0.0'}}}, 'packages/other': {}},
    packages: {'adapter@1.0.0': {resolution: {integrity: 'sha512-YQ=='}}}, snapshots: {'adapter@1.0.0': {}}};
  const save = () => put('pnpm-lock.yaml', Object.entries(lock).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join(''));
  save(); git('add', '-A'); ok(node(root, './ci-input-audit.mjs', ['--write-staged', '--mode', 'all'])); const base = commit();
  lock.packages['adapter@1.0.0'].resolution.integrity = 'sha512-Yw=='; save(); const head = commit();
  const selected = createPlan(event(base, head), {sha: head}, workspace, git, () => {throw Error('No API');});
  assert.deepEqual(selected.packages.map(row => row.package), ['stock']); assert.equal(selected.typecheck, true);
  assert.equal(selected.receipts.length, 6); assert.match(selected.reason, /audited package selection/);
}));

test('v2 fresh evidence never repairs a stale v1 base in either revision order', () => consumerFixture(({root, git, put, commit}) => {
  git('checkout', '--orphan', 'historical-v1');
  rmSync(join(root, 'scripts/ci-input-audit.d'), {recursive: true}); unlinkSync(join(root, 'scripts/ci-input-audit-v2.json'));
  const staleV1 = commit(); put('README.md', '# Changed prose\n'); git('add', '-A');
  ok(node(root, './ci-input-audit.mjs', ['--init-v2-staged'])); const freshV2 = commit();
  ok(node(root, './ci-docs.mjs', ['--audit', freshV2]));
  for (const [base, head] of [[staleV1, freshV2], [freshV2, staleV1]]) {
    assert.throws(() => documentationPlan(['README.md'], base, head, git));
    const selected = createPlan(event(base, head), {sha: head}, workspace, git, () => {throw Error('No API');});
    assert.equal(selected.packages.length, 2); assert.equal(selected.typecheck, true);
  }
}));

test('v2 shallow refusal cannot hide record deletion behind unrelated children and a merge', () => consumerFixture(({root, git, put, commit, base}) => {
  git('rm', 'packages/stock/src/index.mjs', recordPath('docs', 'packages/stock/src/index.mjs'));
  commit(); put('README.md', '# Unrelated child after deletion\n'); const deleted = commit();
  git('checkout', '-b', 'side-before-merge', base); put('docs/backlog.md', '# Independent side\n'); commit();
  git('merge', '--no-ff', '--no-edit', '--signoff', deleted); const head = git('rev-parse', 'HEAD').trim();
  const clone = mkdtempSync(join(tmpdir(), 'cloud-v2-hidden-deletion-'));
  try {
    execFileSync('git', ['clone', '--quiet', '--depth=1', `file://${root}`, clone], {stdio: 'pipe'});
    const shallow = node(clone, './ci-docs.mjs', ['--audit', head]); bad(shallow); assert.match(shallow.stderr, /complete history/);
    execFileSync('git', ['-C', clone, 'fetch', '--unshallow'], {stdio: 'pipe'});
    const complete = node(clone, './ci-docs.mjs', ['--audit', head]); bad(complete); assert.match(complete.stderr, /retained/);
  } finally {rmSync(clone, {recursive: true, force: true});}
}));
