import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {rootReviewFixture} from './ci-root-review-fixture.mjs';
import {rootRecordFilename, checkRootReview} from './ci-root-review.mjs';
import {recordFilename} from './ci-input-audit-records.mjs';
import {proofInputPlan} from './ci-proof-inputs.mjs';

function fixture(run) {
  rootReviewFixture(context => {
    const {git, write, renew, commit} = context;
    const portal = 'apps/portal/src/account.ts';
    const preparation = [portal, 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'scripts/identity-upstream.mjs',
      'scripts/identity-upstream.test.mjs', 'scripts/verify-gateway-reconnection-receipt.mjs',
      'scripts/verify-gateway-reconnection-receipt.test.mjs'];
    for (const path of preparation) write(path, path === 'pnpm-workspace.yaml'
      ? "packages:\n  - 'packages/*'\n  - 'apps/*'\n" : 'export const selected = false;\n');
    write('apps/portal/package.json', {name: '@waitron-cloud/portal', scripts: {test: 'node --test test/*.test.mjs'}});
    renew([...preparation, 'apps/portal/package.json']); git('add', '-A');
    const audit = args => {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-input-audit.mjs', import.meta.url)), ...args],
        {cwd: context.root, encoding: 'utf8', timeout: 30_000});
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    audit(['--init-v2-staged']); const base = commit();
    const docs = () => {git('add', '-A'); audit(['--write-staged', '--mode', 'docs']);};
    const plan = (kind, old = base, head = git('rev-parse', 'HEAD').trim()) =>
      proofInputPlan(kind, {pull_request: {base: {sha: old}, head: {sha: head}}}, git);
    const change = paths => {
      for (const path of paths) write(path, 'export const selected = true;\n');
      renew(paths); docs(); return commit();
    };
    assert.doesNotThrow(() => checkRootReview(base, git));
    run({...context, base, docs, plan, change, portal});
  });
}

test('reviewed portal renewal preserves both original proof omissions', () => fixture(({change, portal, plan}) => {
  change([portal]);
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind).required, false, `${kind} must not execute for review metadata`);
}));

test('executed proof planners use saved review evidence and forced full overrides omission', () => fixture(({root, git, base, change, portal}) => {
  const head = change([portal]);
  const output = join(root, '.git', 'proof-output'), eventPath = join(root, '.git', 'proof-event.json');
  writeFileSync(eventPath, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
  for (const kind of ['cost', 'venue']) for (const forced of [false, true]) {
    writeFileSync(output, '');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-docs.mjs', import.meta.url)), '--plan'], {
      cwd: root, encoding: 'utf8', timeout: 30_000, env: {...process.env, CI_PROOF_KIND: kind,
        GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output, CI_FORCE_FULL: String(forced)}});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(output, 'utf8'), forced ? 'required=true\n' : 'required=false\n');
  }
  assert.equal(git('rev-parse', 'HEAD').trim(), head);
}));

test('reviewed renewal still selects each real proof input', () => fixture(({git, base, change, portal, plan}) => {
  for (const [path, expected] of [
    ['scripts/cloud-cost/conformance-prepare.mjs', [true, true]],
    ['packages/registration/src/signup.ts', [true, false]],
    ['packages/registration/test/venue-service-rules.test.ts', [false, true]],
    ['deploy/test-cloud/proof.mjs', [false, true]],
  ]) {
    git('reset', '--hard', base); git('clean', '-fdq'); change([portal, path]);
    assert.deepEqual(['cost', 'venue'].map(kind => plan(kind).required), expected, path);
  }
}));

test('stale base and head reviews independently retain both proofs', () => fixture(({git, base, change, write, docs, commit, renew, portal, plan}) => {
  write(portal, 'stale base\n'); docs(); const stale = commit();
  change([portal]);
  for (const kind of ['cost', 'venue']) {
    const result = plan(kind, stale); assert.equal(result.required, true); assert.match(result.reason, /Unreviewed root input/);
  }
  git('reset', '--hard', base); change([portal]); write('scripts/reader.mjs', 'unreviewed reader\n'); docs(); commit();
  for (const kind of ['cost', 'venue']) {
    const result = plan(kind); assert.equal(result.required, true); assert.match(result.reason, /Unreviewed root input/);
  }
  renew(['scripts/reader.mjs']); docs(); commit();
  // The reader is itself a real root-script input even with renewed review.
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind).required, true);
}));

test('a refused base still inspects head and its documentation authority is mandatory', () => fixture(({git, write, renew, docs, commit, change, portal, plan}) => {
  write(portal, 'changed without documentation review\n'); renew([portal]); const stale = commit();
  change([portal]);
  const head = git('rev-parse', 'HEAD').trim(), seen = new Set();
  const registryObjectId = git('rev-parse', `${head}:scripts/ci-root-inputs.json`).trim();
  let lastInventory;
  const observe = (...args) => {if (args[0] === 'ls-tree') lastInventory = args[3]; return git(...args);};
  observe.readBlobs = ids => {
    if (ids.length === 1 && ids[0] === registryObjectId) seen.add(lastInventory);
    return git.readBlobs(ids);
  };
  for (const kind of ['cost', 'venue']) {
    const result = proofInputPlan(kind, {pull_request: {base: {sha: stale}, head: {sha: head}}}, observe);
    assert.equal(result.required, true); assert.match(result.reason, /Unreviewed audit input/);
    assert.ok(seen.has(stale) && seen.has(head), 'Both saved root inventories must be inspected on refusal');
  }
  write(portal, 'another reviewed change\n'); renew([portal]); docs(); commit();
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, head).required, false);
}));

test('root review and documentation authority each independently refuse forged metadata', () => fixture(({root, git, base, change, portal, write, docs, commit, plan}) => {
  for (const authority of ['root', 'docs']) {
    git('reset', '--hard', base); change([portal]);
    const path = authority === 'root' ? rootRecordFilename(portal) : recordFilename('docs', portal);
    const record = JSON.parse(readFileSync(join(root, path), 'utf8'));
    write(path, {...record, objectId: '0'.repeat(40)});
    if (authority === 'root') docs();
    commit();
    for (const kind of ['cost', 'venue']) {
      const result = plan(kind); assert.equal(result.required, true, authority);
      assert.match(result.reason, authority === 'root' ? /Unreviewed root input: apps\/portal\/src\/account.ts/
        : /Unreviewed audit input: apps\/portal\/src\/account.ts/);
    }
  }
}));

test('noncanonical removed and orphan review records keep both proofs', () => fixture(({root, git, base, change, portal, write, docs, commit, plan}) => {
  for (const mode of ['renamed', 'removed', 'orphan']) {
    git('reset', '--hard', base); git('clean', '-fdq'); change([portal]);
    const path = rootRecordFilename(portal);
    if (mode === 'removed') rmSync(join(root, path));
    else if (mode === 'renamed') git('mv', path, 'scripts/ci-root-review.d/not-canonical.json');
    else {
      const record = JSON.parse(readFileSync(join(root, path), 'utf8'));
      write(rootRecordFilename('scripts/nonexistent.mjs'), {...record, path: 'scripts/nonexistent.mjs'});
    }
    docs(); commit();
    for (const kind of ['cost', 'venue']) assert.equal(plan(kind).required, true, mode);
  }
}));

test('changed registry checker and unactivated base cannot grant a proof omission', () => fixture(({root, git, base, change, portal, write, renew, docs, commit, plan}) => {
  for (const path of ['scripts/ci-root-review.mjs', 'scripts/ci-root-inputs.json']) {
    git('reset', '--hard', base); change([portal]);
    if (path.endsWith('.json')) {
      const registry = JSON.parse(readFileSync(join(root, path), 'utf8'));
      registry.entries[0].sites[0].site = 'reviewed replacement:2'; write(path, registry);
      git('add', '-A');
      const paths = git('ls-tree', '-rz', '--full-tree', git('write-tree').trim()).split('\0').filter(Boolean).map(row => row.split('\t')[1])
        .filter(input => !input.startsWith('scripts/ci-root-review.d/') && !input.startsWith('scripts/ci-input-audit.d/') &&
          !['scripts/ci-input-audit.json', 'scripts/ci-input-audit-v2.json'].includes(input) && !input.endsWith('.md'));
      renew(paths);
    } else {write(path, 'changed checker\n'); renew([path]);}
    docs(); commit();
    for (const kind of ['cost', 'venue']) assert.equal(plan(kind).required, true, path);
  }
  git('reset', '--hard', base);
  rmSync(join(root, 'scripts/ci-root-inputs.json')); rmSync(join(root, 'scripts/ci-root-review.d'), {recursive: true});
  docs(); const noMetadata = commit();
  // Compare an unactivated historical branch, not a descendant hiding activation.
  git('checkout', '--orphan', 'unactivated-control'); const unactivated = commit();
  assert.equal(git('rev-parse', `${unactivated}^{tree}`).trim(), git('rev-parse', `${noMetadata}^{tree}`).trim());
  git('checkout', '--detach', base); git('reset', '--soft', unactivated); const bootstrap = commit();
  git('checkout', '--detach', bootstrap); change([portal]);
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, unactivated).required, true);
}));
