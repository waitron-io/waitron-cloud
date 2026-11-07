import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {rootSelectionFixture} from './fixtures/ci-selection.mjs';
import {proofInputPlan} from './ci-proof-inputs.mjs';

function fixture(run) {
  rootSelectionFixture(context => {
    const {git, write, commit} = context;
    const portal = 'apps/portal/src/account.ts';
    const preparation = [portal, 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'scripts/identity-upstream.mjs',
      'scripts/identity-upstream.test.mjs', 'scripts/verify-gateway-reconnection-receipt.mjs',
      'scripts/verify-gateway-reconnection-receipt.test.mjs'];
    for (const path of preparation) write(path, path === 'pnpm-workspace.yaml'
      ? "packages:\n  - 'packages/*'\n  - 'apps/*'\n" : 'export const selected = false;\n');
    write('apps/portal/package.json', {name: '@waitron-cloud/portal', scripts: {test: 'node --test test/*.test.mjs'}});
    const base = commit();
    const plan = (kind, old = base, head = git('rev-parse', 'HEAD').trim()) =>
      proofInputPlan(kind, {pull_request: {base: {sha: old}, head: {sha: head}}}, git);
    const change = paths => {
      for (const path of paths) write(path, 'export const selected = true;\n');
      return commit();
    };
    run({...context, base, plan, change, portal});
  });
}

test('portal changes preserve both original proof omissions', () => fixture(({change, portal, plan}) => {
  change([portal]);
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind).required, false, `${kind} must not execute for review metadata`);
}));

test('executed proof planners use saved inputs and forced full overrides omission', () => fixture(({root, git, base, change, portal}) => {
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

test('each real proof input retains its own work', () => fixture(({git, base, change, portal, plan}) => {
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

test('proof work follows real changes in both saved revisions', () => fixture(({git, base, change, write, commit, portal, plan}) => {
  write(portal, 'stale base\n'); const stale = commit();
  change([portal]);
  for (const kind of ['cost', 'venue']) {
    const result = plan(kind, stale); assert.equal(result.required, false); assert.match(result.reason, /No .* proof inputs/);
  }
  git('reset', '--hard', base); change([portal]); write('scripts/reader.mjs', 'unreviewed reader\n'); commit();
  for (const kind of ['cost', 'venue']) {
    const result = plan(kind); assert.equal(result.required, true); assert.match(result.reason, /Selected .*proof inputs/);
  }
}));

test('proof diffs inspect both saved revisions without documentation authority', () => fixture(({git, write, commit, change, portal, plan}) => {
  write(portal, 'changed without documentation review\n'); const stale = commit();
  change([portal]);
  const head = git('rev-parse', 'HEAD').trim(), seen = new Set();
  const observe = (...args) => {
    if (args[0] === 'diff') {for (const saved of [stale, head]) if (args.includes(saved)) seen.add(saved);}
    return git(...args);
  };
  for (const kind of ['cost', 'venue']) {
    const result = proofInputPlan(kind, {pull_request: {base: {sha: stale}, head: {sha: head}}}, observe);
    assert.equal(result.required, false); assert.match(result.reason, /No .* proof inputs/);
    assert.ok(seen.has(stale) && seen.has(head), 'Both saved revisions must define the proof diff');
  }
  write(portal, 'another reviewed change\n'); commit();
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, head).required, false);
}));

for (const path of ['scripts/unknown.json', 'scripts/ci-root-inputs.mjs']) {
  test(`unregistered ${path} retains both proof jobs`, () => fixture(({change, portal, plan}) => {
    change([portal, path]);
    for (const kind of ['cost', 'venue']) assert.equal(plan(kind).required, true, kind);
  }));
}
