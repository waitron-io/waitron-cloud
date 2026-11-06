import assert from 'node:assert/strict';
import {readFileSync, rmSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {rootReviewFixture} from './ci-root-review-fixture.mjs';
import {rootRecordFilename} from './ci-root-review.mjs';
import {receiptSuites} from './ci-scope.mjs';
import {createPlan, selectPlan} from './ci-plan.mjs';
import {assertSummary} from './ci-summary.mjs';
import {reuseProof} from './fixtures/ci-evidence.mjs';

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

test('checkout attributes at every package depth retain full work after review renewal', () => fixture(({git, write, renew, docs, commit, base, changedPaths, plan}) => {
  const workspace = [{name: '@waitron-cloud/control', directory: 'packages/control', scripts: {test: 'node --test test/*.test.mjs'}}];
  for (const withRoot of [false, true]) for (const path of ['packages/control/.gitattributes', 'packages/control/src/.gitattributes']) {
    git('reset', '--hard', base); git('clean', '-fdq');
    if (withRoot) write(rootPath, 'changed root test\n');
    write(path, '*.mjs filter=checkout-control\n');
    renew(withRoot ? [rootPath, path] : [path]); docs(); const head = commit();
    const mapped = plan(head);
    assert.equal(mapped.full, true, `${path} must not inherit package ownership`);
    assert.match(mapped.reason, /Checkout attributes require full root work/);
    const selected = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, workspace, git);
    assert.equal(selected.rootInputs, undefined);
    assert.equal(selected.rootTests, undefined);
    assert.equal(selected.typecheck, true);
    assert.deepEqual(selected.receipts, ['test:two-venue-milestone-receipt', 'test:backup-capacity',
      'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt', 'test:cloud-cost']);
    assert.doesNotThrow(() => api.assertRootInputWork(selected, {base, head, git}));
    const forged = {packages: [{package: '@waitron-cloud/control', shard: 1}], receipts: [], typecheck: true,
      rootTests: true, reuse: null, rootInputs: {version: 1, base, head, paths: changedPaths(head),
        entryIds: withRoot ? ['root-partition-contract'] : []}};
    assert.throws(() => api.assertRootInputWork(forged, {base, head, git}), /Root refusal requires full work/);
  }
}));

test('changed package test commands remain full after explicit root review renewal', () => fixture(({write, renew, docs, commit, plan}) => {
  write(rootPath, 'root change\n');
  write('packages/control/package.json', {name: '@waitron-cloud/control', scripts: {test: 'node --test a-different-test.mjs'}});
  renew([rootPath, 'packages/control/package.json']); docs();
  const result = plan(commit()); assert.equal(result.full, true); assert.match(result.reason, /test commands changed/);
}));

test('planner composes root-only receipt-only and mixed owners as nonempty work', () => fixture(({git, write, renew, docs, commit, base}) => {
  const workspace = [{name: '@waitron-cloud/control', directory: 'packages/control', scripts: {test: 'node --test test/*.test.mjs'}, sources: []}];
  const health = 'deploy/local-stack/operations-health.test.mjs', packagePath = 'packages/control/src/index.mjs';
  for (const [paths, want] of [
    [[rootPath], {packages: 0, typecheck: false, rootTests: true, receipts: [], ids: ['root-partition-contract']}],
    [[capacityPath], {packages: 0, typecheck: false, rootTests: false, receipts: ['test:backup-capacity'], ids: ['capacity-verifier-test']}],
    [[health, capacityPath, rootPath], {packages: 0, typecheck: false, rootTests: true, receipts: ['test:backup-capacity', 'test:local-stack'], ids: ['capacity-verifier-test', 'local-health-test', 'root-partition-contract']}],
    [[packagePath, capacityPath], {packages: 1, typecheck: true, rootTests: true, includes: ['test:backup-capacity'], ids: ['capacity-verifier-test']}],
    [[packagePath], {packages: 1, typecheck: true, rootTests: true, includes: [], ids: []}],
  ]) {
    git('reset', '--hard', base);
    for (const path of paths) write(path, 'reviewed change\n');
    renew(paths); docs(); const head = commit();
    const plan = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, workspace, git);
    assert.equal(plan.packages.length, want.packages, paths.join(', '));
    assert.equal(plan.typecheck, want.typecheck); assert.equal(plan.rootTests, want.rootTests);
    if (want.receipts) assert.deepEqual(plan.receipts, want.receipts);
    for (const receipt of want.includes ?? []) assert.ok(plan.receipts.includes(receipt), 'Mandatory root receipt survives omission audits');
    assert.deepEqual(plan.rootInputs.entryIds, want.ids);
    assert.equal(plan.rootInputs.base, base); assert.equal(plan.rootInputs.head, head);
    assert.deepEqual(plan.rootInputs.paths, git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean));
    assert.equal(plan.reuse, null); assert.equal(plan.documentation, undefined); assert.equal(plan.scripts, undefined);
  }
}));

test('root ownership never narrows shared inputs forced runs or evidence-only changes', () => fixture(({root, git, write, renew, docs, commit, base}) => {
  const workspace = [{name: '@waitron-cloud/control', directory: 'packages/control', scripts: {test: 'node --test test/*.test.mjs'}, sources: []}];
  const peer = git('ls-tree', '-r', '--name-only', base, '--', 'scripts/ci-input-audit.d/identity/').trim().split('\n')[0];
  for (const path of ['pnpm-lock.yaml', '.github/workflows/ci.yml', 'scripts/unregistered.mjs', peer, null]) {
    git('reset', '--hard', base); git('clean', '-fdq');
    if (path) {
      write(rootPath, 'changed root check\n');
      write(path, path === peer ? {...JSON.parse(readFileSync(join(root, peer))), objectId: '0'.repeat(40)} : 'shared change\n');
      renew([rootPath, ...(path === peer ? [] : [path])]);
    }
    else renew([rootPath], 'second reviewer', 'review/provenance');
    docs(); const head = commit(), event = {pull_request: {base: {sha: base}, head: {sha: head}}};
    for (const [input, context] of [[event, {}], [event, {full: true}], [{}, {}]]) {
      const plan = createPlan(input, context, workspace, git);
      assert.equal(plan.packages.length, 1); assert.equal(plan.typecheck, true); assert.equal(plan.receipts.length, 6);
      assert.equal(plan.rootInputs, undefined); assert.equal(plan.rootTests, undefined);
    }
  }
}));

test('independent reconstruction refuses missing markers owners and forged ranges', () => fixture(({git, write, renew, docs, commit, base, changedPaths}) => {
  assert.equal(typeof api.assertRootInputWork, 'function', 'Summary must independently reconstruct required owners');
  write(rootPath, 'changed root\n'); write(capacityPath, 'changed capacity\n'); renew([rootPath, capacityPath]); docs();
  const head = commit(), context = {base, head, git};
  const plan = {packages: [], receipts: ['test:backup-capacity'], typecheck: false, reuse: null, rootTests: true,
    rootInputs: {version: 1, base, head, paths: changedPaths(head), entryIds: ['capacity-verifier-test', 'root-partition-contract']}};
  assert.doesNotThrow(() => api.assertRootInputWork(plan, context));
  for (const forged of [
    {...plan, rootInputs: undefined}, {...plan, rootTests: undefined}, {...plan, rootTests: false}, {...plan, receipts: []},
    {...plan, rootInputs: {...plan.rootInputs, paths: [rootPath]}}, {...plan, rootInputs: {...plan.rootInputs, entryIds: ['root-partition-contract']}},
    {...plan, rootInputs: {...plan.rootInputs, head: base}}, {...plan, typecheck: true}, {...plan, scripts: {base, head, paths: []}},
  ]) assert.throws(() => api.assertRootInputWork(forged, context), /root|Root|owner|work|compiler/i);
  const results = {changes: 'success', root: 'success', typecheck: 'skipped', packages: 'skipped', receipts: 'success'};
  const jobs = ['changes', 'root (1/4)', 'root (2/4)', 'root (3/4)', 'root (4/4)', 'receipts']
    .map(name => ({name, status: 'completed', conclusion: 'success'}));
  assert.doesNotThrow(() => assertSummary(plan, results, jobs, context));
  assert.throws(() => assertSummary(plan, results, jobs), /trusted|verification|context/i);
  assert.throws(() => assertSummary({...plan, rootTests: false}, {...results, root: 'skipped'}, jobs.filter(job => !job.name.startsWith('root ')), context));
  for (const job of jobs) {
    assert.throws(() => assertSummary(plan, results, jobs.filter(row => row !== job), context));
    assert.throws(() => assertSummary(plan, results, [...jobs, job], context));
  }
}));

test('stale head fails mandatory summary even for full or legacy work and after all metadata is removed', () => fixture(({root, git, write, docs, commit, base}) => {
  assert.equal(typeof api.assertRootInputWork, 'function', 'Full work cannot bypass mandatory head review');
  write('scripts/reader.mjs', 'unreviewed change\n'); docs(); const stale = commit();
  for (const plan of [
    {packages: [], receipts: [], typecheck: false, documentation: {base, head: stale, paths: ['docs/explanation.md']}},
    {packages: [{package: '@waitron-cloud/control', shard: 1}], receipts: [], typecheck: true},
  ]) assert.throws(() => api.assertRootInputWork(plan, {base, head: stale, git}), /Unreviewed root input/);
  rmSync(join(root, registryPath)); rmSync(join(root, recordRoot), {recursive: true}); docs(); const removed = commit();
  assert.throws(() => api.assertRootInputWork({packages: [], receipts: [], typecheck: true}, {base, head: removed, git}), /Missing root registry/);
}));

for (const [label, path, source] of [
  ['workspace policy', 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\nonlyBuiltDependencies: []\n"],
  ['workspace pattern', 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n  - 'tools/*'\n"],
  ['unowned app directory', 'apps/placeholder/notes.txt', 'workspace notes\n'],
  ['package directory file', 'packages/notes.txt', 'package notes\n'],
]) test(`shared workspace changes retain executable full work and every receipt owner: ${label}`, () => fixture(({root, git, write, renew, docs, commit}) => {
  const receipts = ['test:two-venue-milestone-receipt', 'test:backup-capacity', 'test:public-gateway-limits',
    'test:local-stack', 'test:database-recovery-receipt', 'test:cloud-cost'];
  write('packages/control/package.json', {name: '@waitron-cloud/identity', scripts: {test: 'node --test test/*.test.mjs'}});
  write('scripts/ci-another.test.mjs', 'another root check\n');
  write('package.json', {scripts: Object.fromEntries(receipts.map(name => [name, 'node --version']))});
  renew(['packages/control/package.json', 'scripts/ci-another.test.mjs', 'package.json']); docs(); const base = commit();
  const full = {packages: [{package: '@waitron-cloud/identity', shard: 1}], receipts, typecheck: true, reuse: null};
  const jobs = ['changes', 'typecheck', 'root (1/4)', 'root (2/4)', 'root (3/4)', 'root (4/4)',
    'package (@waitron-cloud/identity)', 'receipts'].map(name => ({name, status: 'completed', conclusion: 'success'}));
  const results = {changes: 'success', typecheck: 'success', root: 'success', packages: 'success', receipts: 'success'};
  {
    write(path, source); renew([path]); docs(); const head = commit();
    const context = {base, head, git};
    assert.equal(api.rootInputPlan(git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean), base, head, git).full, true);
    assert.doesNotThrow(() => assertSummary(full, results, jobs, context), path);
    write('event.json', JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
    const checked = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-root-inputs.mjs', import.meta.url)), '--check'], {
      cwd: root, encoding: 'utf8', timeout: 30_000, env: {...process.env, GITHUB_EVENT_PATH: join(root, 'event.json'), CI_HEAD_SHA: head, CI_PLAN: JSON.stringify(full)}});
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    for (const omitted of receipts) assert.throws(() => assertSummary({...full, receipts: receipts.filter(name => name !== omitted)}, results, jobs, context),
      /Root fallback requires every receipt owner/, omitted);
  }
}));

test('large reviewed package changes retain a bounded full plan instead of overflowing a step environment', () => fixture(({git, write, renew, docs, commit, base}) => {
  const paths = Array.from({length: 400}, (_, i) => `packages/control/src/${'long-'.repeat(25)}${i}.mjs`);
  for (const path of paths) write(path, 'export const value = 1;\n');
  renew(paths); docs(); const head = commit();
  const workspace = [{name: '@waitron-cloud/control', directory: 'packages/control', scripts: {test: 'node --test test/*.test.mjs'}}];
  const plan = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, workspace, git);
  assert.ok(Buffer.byteLength(JSON.stringify(plan), 'utf8') < 120_000, 'The complete executable plan must fit one Linux environment value');
  assert.equal(plan.rootInputs, undefined); assert.equal(plan.typecheck, true);
  assert.deepEqual(plan.packages, [{package: '@waitron-cloud/control', shard: 1}]);
  assert.equal(plan.receipts.length, 6);
  assert.match(plan.reason, /Root.*(large|budget|size)/i);
  assert.doesNotThrow(() => api.assertRootInputWork(plan, {base, head, git}));
  const launched = spawnSync(process.execPath, ['-e', 'JSON.parse(process.env.CI_PLAN)'], {
    encoding: 'utf8', timeout: 30_000, env: {...process.env, CI_PLAN: JSON.stringify(plan)}});
  assert.equal(launched.status, 0, launched.error?.message ?? launched.stderr);
}));

test('configured root and receipt preflights verify the event plan before running tests', () => fixture(({root, git, write, renew, docs, commit, base, changedPaths}) => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const health = 'deploy/local-stack/operations-health.test.mjs';
  write(health, 'changed health check\n'); renew([health]); docs(); const head = commit();
  const plan = {packages: [], receipts: ['test:local-stack'], typecheck: false, rootTests: false, reuse: null,
    rootInputs: {version: 1, base, head, paths: changedPaths(head), entryIds: ['local-health-test']}};
  write('event.json', JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
  for (const job of ['root', 'receipts']) {
    const body = new RegExp(`^  ${job}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm').exec(workflow)?.[1] ?? '';
    const step = /- name: Verify exact root input work\n\s+run: ([^\n]+)\n\s+env:\n\s+CI_PLAN: ([^\n]+)/.exec(body);
    assert.ok(step, `Missing executed preflight in ${job}`);
    assert.equal(step[2], '${{ needs.changes.outputs.plan }}');
    assert.ok(step.index < body.indexOf(job === 'root' ? '- run: node --test' : '- run: node scripts/ci-run-receipts.mjs'));
    const [runtime, program, ...args] = step[1].split(' '); assert.equal(runtime, 'node');
    const run = () => spawnSync(process.execPath, [fileURLToPath(new URL(`../${program}`, import.meta.url)), ...args], {
      cwd: root, encoding: 'utf8', timeout: 30_000, env: {...process.env, GITHUB_EVENT_PATH: join(root, 'event.json'), CI_HEAD_SHA: head, CI_PLAN: JSON.stringify(plan)}});
    let result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
    write(health, 'dirty tracked health bytes\n'); result = run();
    assert.notEqual(result.status, 0); assert.match(result.stderr, /dirty tracked checkout|dirty bytes|clean tracked checkout/);
    git('restore', '--', health);
  }
}));

test('removal evidence must survive a squash onto the trusted pull request base', () => fixture(({root, git, write, renew, docs, commit, base, plan}) => {
  git('checkout', '-b', 'unlanded-removal');
  const changed = 'packages/control/src/index.mjs';
  write(changed, 'export const value = 2;\n'); renew([changed]); docs(); const unlanded = commit();
  const removed = 'scripts/reader.mjs', recordPath = rootRecordFilename(removed);
  const record = JSON.parse(readFileSync(join(root, recordPath), 'utf8'));
  rmSync(join(root, removed));
  const removal = previousRevision => write(recordPath, {version: 1, path: removed, state: 'absent', previousRevision,
    registryObjectId: record.registryObjectId, reviewer: 'Removal control', reference: 'review/squash-retention'});
  removal(unlanded); docs(); const head = commit();
  const full = {packages: [{package: '@waitron-cloud/control', shard: 1}], receipts: [...receiptSuites], typecheck: true, reuse: null};
  assert.throws(() => api.assertRootInputWork(full, {base, head, git}), /Root removal.*shared.*base/);
  assert.match(plan(head).reason, /head.*Root removal.*shared.*base/);
  removal(base); docs(); const repaired = commit();
  assert.doesNotThrow(() => api.assertRootInputWork(full, {base, head: repaired, git}));
  git('checkout', 'main'); git('merge', '--squash', 'unlanded-removal'); const squash = commit();
  assert.throws(() => git('merge-base', '--is-ancestor', unlanded, squash));
  assert.doesNotThrow(() => api.assertRootInputWork(full, {head: squash, git}));
}));

test('trusted root and receipt summaries reject every incomplete required job', () => fixture(({git, write, renew, docs, commit, base, changedPaths}) => {
  const health = 'deploy/local-stack/operations-health.test.mjs';
  for (const mode of ['root', 'receipt', 'mixed']) {
    git('reset', '--hard', base); git('clean', '-fdq');
    const paths = mode === 'root' ? [rootPath] : mode === 'receipt' ? [health] : [rootPath, health];
    for (const path of paths) write(path, `changed ${mode} check\n`);
    renew(paths); docs(); const head = commit(), verification = {base, head, git};
    const root = mode !== 'receipt', receipts = mode !== 'root';
    const plan = {packages: [], receipts: receipts ? ['test:local-stack'] : [], typecheck: false, reuse: null, rootTests: root,
      rootInputs: {version: 1, base, head, paths: changedPaths(head), entryIds: mode === 'root' ? ['root-partition-contract']
        : mode === 'receipt' ? ['local-health-test'] : ['local-health-test', 'root-partition-contract']}};
    const results = {changes: 'success', typecheck: 'skipped', packages: 'skipped', root: root ? 'success' : 'skipped',
      receipts: receipts ? 'success' : 'skipped'};
    const names = ['changes', ...(root ? ['root (1/4)', 'root (2/4)', 'root (3/4)', 'root (4/4)'] : []), ...(receipts ? ['receipts'] : [])];
    const jobs = names.map(name => ({name, status: 'completed', conclusion: 'success'}));
    const skipped = {name: 'typecheck', status: 'completed', conclusion: 'skipped'};
    const self = {name: 'summary', status: 'in_progress', conclusion: null};
    assert.doesNotThrow(() => assertSummary(plan, results, [...jobs, skipped, self], verification), mode);
    for (const job of jobs) {
      const remaining = jobs.filter(row => row !== job);
      assert.throws(() => assertSummary(plan, results, remaining, verification), /Missing or duplicate job/, `${mode}: omitted ${job.name}`);
      assert.throws(() => assertSummary(plan, results, [...jobs, job], verification), /Missing or duplicate job/, `${mode}: duplicated ${job.name}`);
      for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
        assert.throws(() => assertSummary(plan, results, [...remaining, {...job, conclusion}], verification), /did not pass/,
          `${mode}: ${job.name} ${conclusion}`);
      }
      for (const status of ['queued', 'in_progress']) {
        assert.throws(() => assertSummary(plan, results, [...remaining, {...job, status}], verification), /unfinished/,
          `${mode}: ${job.name} ${status}`);
      }
    }
    assert.throws(() => assertSummary(plan, results, [...jobs, skipped, skipped], verification), /duplicate job/);
    assert.throws(() => assertSummary(plan, results, [...jobs, self, self], verification), /duplicate job/);
    assert.throws(() => assertSummary(plan, results, [...jobs, {...skipped, name: 'undeclared owner'}], verification), /Unexpected executed job/);
    for (const group of ['changes', ...(root ? ['root'] : []), ...(receipts ? ['receipts'] : [])]) {
      for (const status of ['failure', 'cancelled', 'skipped', undefined]) {
        assert.throws(() => assertSummary(plan, {...results, [group]: status}, jobs, verification), /must succeed|did not match its plan/);
      }
    }
    const forged = {...plan}; delete forged.rootInputs; delete forged.rootTests;
    assert.throws(() => assertSummary(forged, {...results, root: 'skipped', receipts: 'skipped'}, [jobs[0]], verification), /Root refusal requires full work/);
  }
}));

test('execution preflight rejects a different checkout dirty tracked bytes and forged command metadata', () => fixture(({root, git, write, renew, docs, commit, base, changedPaths}) => {
  const program = fileURLToPath(new URL('./ci-root-inputs.mjs', import.meta.url));
  write(capacityPath, 'changed capacity\n'); renew([capacityPath]); docs(); const head = commit();
  const plan = {packages: [], receipts: ['test:backup-capacity'], typecheck: false, rootTests: false, reuse: null,
    rootInputs: {version: 1, base, head, paths: changedPaths(head), entryIds: ['capacity-verifier-test']}};
  const eventPath = join(root, 'event.json');
  write('event.json', JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
  const run = value => spawnSync(process.execPath, [program, '--check'], {cwd: root, encoding: 'utf8', timeout: 30_000,
    env: {...process.env, CI_PLAN: JSON.stringify(value), GITHUB_EVENT_PATH: eventPath, CI_HEAD_SHA: head}});
  let result = run(plan); assert.equal(result.status, 0, result.stdout + result.stderr);
  write(capacityPath, 'dirty bytes\n'); result = run(plan); assert.notEqual(result.status, 0); assert.match(result.stderr, /dirty|checkout|diff/i);
  git('restore', '--', capacityPath);
  for (const value of [{...plan, receipts: ['provider apply']}, {...plan, rootInputs: {...plan.rootInputs, command: 'touch /unowned'}}]) {
    result = run(value); assert.notEqual(result.status, 0); assert.match(result.stderr, /root|receipt/i);
  }
  git('commit', '--allow-empty', '-s', '-qm', 'Different commit with the same tree');
  result = run(plan); assert.notEqual(result.status, 0); assert.match(result.stderr, /exact head checkout/);
}));

test('executed summary derives ownership from the event before trusting a forged plan or job API', () => fixture(({root, git, write, renew, docs, commit, base, changedPaths}) => {
  write(capacityPath, 'changed capacity\n'); renew([capacityPath]); docs(); const head = commit();
  const plan = {packages: [], receipts: ['test:backup-capacity'], typecheck: false, rootTests: false, reuse: null,
    rootInputs: {version: 1, base, head, paths: changedPaths(head), entryIds: ['capacity-verifier-test']}};
  const scratch = mkdtempSync(join(tmpdir(), 'cloud-root-summary-event-'));
  try {
    const event = revision => writeFileSync(join(scratch, 'event.json'), JSON.stringify({pull_request: {base: {sha: base}, head: {sha: revision}}}));
    event(head);
    writeFileSync(join(scratch, 'jobs.json'), JSON.stringify([{jobs: ['changes', 'receipts'].map(name => ({name, status: 'completed', conclusion: 'success'}))}]));
    writeFileSync(join(scratch, 'gh'), '#!/bin/sh\ncat "$ROOT_JOB_FIXTURE"\n', {mode: 0o700});
    const results = {changes: {result: 'success'}, typecheck: {result: 'skipped'}, root: {result: 'skipped'}, packages: {result: 'skipped'}, receipts: {result: 'success'}};
    const run = (value, expectedHead = head) => spawnSync(process.execPath, [fileURLToPath(new URL('./ci-summary.mjs', import.meta.url))], {
      cwd: root, encoding: 'utf8', timeout: 30_000, env: {...process.env, PATH: `${scratch}:${process.env.PATH}`,
        ROOT_JOB_FIXTURE: join(scratch, 'jobs.json'), GITHUB_EVENT_PATH: join(scratch, 'event.json'), CI_HEAD_SHA: expectedHead,
        CI_PLAN: JSON.stringify(value), CI_RESULTS: JSON.stringify(results), GITHUB_REPOSITORY: 'waitron-io/waitron-cloud', GITHUB_RUN_ID: '42'}});
    let result = run(plan); assert.equal(result.status, 0, result.stdout + result.stderr);
    const forged = {...plan}; delete forged.rootInputs; delete forged.rootTests;
    result = run(forged); assert.notEqual(result.status, 0); assert.match(result.stderr, /Root refusal requires full work/);
    write('scripts/reader.mjs', 'unreviewed reader\n'); docs(); const stale = commit(); event(stale);
    result = run(forged, stale); assert.notEqual(result.status, 0); assert.match(result.stderr, /Unreviewed root input: scripts\/reader.mjs/);
  } finally {rmSync(scratch, {recursive: true, force: true});}
}));

test('root execution preflight refuses missing required files and extra undiscovered tests', () => fixture(({root, git, write, renew, docs, commit}) => {
  write('scripts/ci-another.test.mjs', 'another check\n'); renew(['scripts/ci-another.test.mjs']); docs(); const base = commit();
  write(rootPath, 'changed root\n'); renew([rootPath]); docs(); const head = commit();
  const plan = {packages: [], receipts: [], typecheck: false, rootTests: true, reuse: null,
    rootInputs: {version: 1, base, head, paths: git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean), entryIds: ['root-partition-contract']}};
  write('event.json', JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('./ci-root-inputs.mjs', import.meta.url)), '--check'], {
    cwd: root, encoding: 'utf8', timeout: 30_000, env: {...process.env, GITHUB_EVENT_PATH: join(root, 'event.json'), CI_HEAD_SHA: head, CI_PLAN: JSON.stringify(plan)}});
  let result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  write('scripts/ci-untracked.test.mjs', 'throw Error("must not run");\n');
  result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /root.*inventory/i);
  rmSync(join(root, 'scripts/ci-untracked.test.mjs'));
  rmSync(join(root, 'scripts/identity-upstream.test.mjs'));
  result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /dirty|checkout|inventory/i);
}));

test('executed planner publishes every root-only receipt-only mixed and forced-full gate', () => fixture(({root, git, write, renew, docs, commit, base}) => {
  const health = 'deploy/local-stack/operations-health.test.mjs', packagePath = 'packages/control/src/index.mjs';
  const scratch = mkdtempSync(join(tmpdir(), 'cloud-root-output-'));
  try {
    for (const [paths, full, want] of [
      [[rootPath], false, {root_tests: 'true', typecheck: 'false', packages: 'false', receipts: 'false', ids: ['root-partition-contract']}],
      [[health], false, {root_tests: 'false', typecheck: 'false', packages: 'false', receipts: 'true', ids: ['local-health-test']}],
      [[packagePath, health], false, {root_tests: 'true', typecheck: 'true', packages: 'true', receipts: 'true', ids: ['local-health-test']}],
      [[rootPath], true, {root_tests: 'true', typecheck: 'true', packages: 'true', receipts: 'true', ids: null}],
    ]) {
      git('reset', '--hard', base);
      for (const path of paths) write(path, 'reviewed output control\n');
      renew(paths); docs(); const head = commit();
      const event = join(scratch, 'event.json'), output = join(scratch, 'output');
      writeFileSync(event, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}})); writeFileSync(output, '');
      const callerEnv = {...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', CI_FULL: 'true', CI_CALLED: 'true', CI_WORKFLOW_INPUTS: '{"full":true}'};
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-plan.mjs', import.meta.url))],
        {cwd: root, encoding: 'utf8', timeout: 30_000, env: {...callerEnv, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output,
          GITHUB_EVENT_NAME: 'pull_request', CI_FULL: 'false', CI_CALLED: 'false', CI_WORKFLOW_INPUTS: '{}',
          GITHUB_SHA: head, CI_FORCE_FULL: String(full)}});
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const rows = readFileSync(output, 'utf8').trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]);
      assert.equal(rows.length, 9, 'Every gate, mode and matrix must be published exactly once');
      assert.deepEqual(rows.map(([key]) => key).sort(), ['documentation', 'mode', 'package_matrix', 'packages', 'plan', 'receipts', 'root_tests', 'scripts', 'typecheck'], 'Outputs cannot silently overwrite a gate');
      const outputs = Object.fromEntries(rows), plan = JSON.parse(outputs.plan);
      for (const key of ['root_tests', 'typecheck', 'packages', 'receipts']) assert.equal(outputs[key], want[key], `${paths}: ${key}`);
      for (const key of ['documentation', 'scripts']) assert.equal(outputs[key], 'false');
      assert.equal(plan.reuse, null);
      assert.deepEqual(plan.rootInputs?.entryIds ?? null, want.ids);
      assert.deepEqual(JSON.parse(outputs.package_matrix), {include: want.packages === 'true'
        ? [{package: '@waitron-cloud/control', shard: 1}] : [{package: 'unused', shard: 1}]});
      if (paths.length === 1 && paths[0] === health) assert.deepEqual(plan.receipts, ['test:local-stack']);
      if (full) assert.equal(plan.receipts.length, 6);
    }
  } finally {rmSync(scratch, {recursive: true, force: true});}
}));

test('receipt-only preflight refuses a missing head command instead of accepting an empty check', () => fixture(({root, git, write, renew, docs, commit}) => {
  const health = 'deploy/local-stack/operations-health.test.mjs';
  write('package.json', {scripts: {'test:backup-capacity': `node --test ${capacityPath}`}});
  renew(['package.json']); docs(); const base = commit();
  write(health, 'changed health check\n'); renew([health]); docs(); const head = commit();
  const plan = {packages: [], receipts: ['test:local-stack'], typecheck: false, rootTests: false, reuse: null,
    rootInputs: {version: 1, base, head, paths: git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean),
      entryIds: ['local-health-test']}};
  const event = join(root, '.git', 'root-event.json');
  writeFileSync(event, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-root-inputs.mjs', import.meta.url)), '--check'],
    {cwd: root, encoding: 'utf8', timeout: 30_000, env: {...process.env, GITHUB_EVENT_PATH: event, CI_HEAD_SHA: head, CI_PLAN: JSON.stringify(plan)}});
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Missing root receipt command: test:local-stack/);
}));


test('source reconstruction refuses stale root reviews even for package-only work', () => fixture(({git, write, renew, docs, commit, base}) => {
  const path = 'packages/control/src/index.mjs';
  const workspace = [{name: '@waitron-cloud/control', directory: 'packages/control', scripts: {test: 'node --test test/*.test.mjs'}, sources: []}];
  write(path, 'export const changed = true;\n'); docs(); const stale = commit();
  const snapshot = head => ({revision: head, packages: workspace, testFilesByPackage: {'@waitron-cloud/control': []}});
  assert.throws(() => selectPlan({base, head: stale}, snapshot(stale), git), /Unreviewed root input: packages\/control\/src\/index.mjs/);
  renew([path]); docs(); const current = commit();
  const selected = selectPlan({base, head: current}, snapshot(current), git);
  assert.equal(selected.typecheck, true);
  assert.equal(selected.packages.length, 1);
}));


test('main root preflight derives the literal push range and refuses a forced narrow plan', () => fixture(({root, git, write, renew, docs, commit, base, changedPaths}) => {
  write(capacityPath, 'changed capacity check\n'); renew([capacityPath]); docs(); const head = commit();
  const plan = {packages: [], receipts: ['test:backup-capacity'], typecheck: false, rootTests: false, reuse: null,
    rootInputs: {version: 1, base, head, paths: changedPaths(head), entryIds: ['capacity-verifier-test']}};
  const event = join(root, '.git', 'root-push.json');
  const env = {...process.env, GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: head, CI_HEAD_SHA: head, CI_PLAN: JSON.stringify(plan), CI_FULL: 'false', CI_CALLED: 'false', CI_WORKFLOW_INPUTS: '{}'};
  const run = value => {
    writeFileSync(event, JSON.stringify(value));
    return spawnSync(process.execPath, [fileURLToPath(new URL('./ci-root-inputs.mjs', import.meta.url)), '--check'],
      {cwd: root, encoding: 'utf8', timeout: 30_000, env});
  };
  let result = run({before: base, after: head});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const value of [{before: head, after: head}, {before: base, after: head, forced: true}, {before: '0'.repeat(40), after: head}]) {
    result = run(value); assert.notEqual(result.status, 0); assert.match(result.stderr, /trusted event range/);
  }
}));


test('reuse keeps complete head review without requiring previously checked root work again', () => fixture(({git, write, renew, docs, commit, base}) => {
  write(rootPath, 'reviewed root change\n'); renew([rootPath]); docs(); const head = commit();
  const reused = {packages: [], receipts: [], typecheck: false, reuse: reuseProof()};
  assert.doesNotThrow(() => api.assertRootInputWork(reused, {base, head, git}));
  for (const bad of [{...reused, rootTests: false}, {...reused, reuse: {sha: head, runId: 42}}]) {
    assert.throws(() => api.assertRootInputWork(bad, {base, head, git}));
  }
  write(rootPath, 'unreviewed root change\n'); docs(); const stale = commit();
  assert.throws(() => api.assertRootInputWork(reused, {base, head: stale, git}), /Unreviewed root input/);
}));
