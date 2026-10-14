import assert from 'node:assert/strict';
import test from 'node:test';
import {scopeForPaths, loadWorkspace, workPlan} from './ci-scope.mjs';

const workspace = [
  {name: 'leaf', directory: 'apps/leaf', scripts: {test:'node --test'}, dependencies: {}},
  {name: 'core', directory: 'packages/core', scripts: {test:'node --test'}, dependencies: {}},
  {name: 'api', directory: 'packages/api', scripts: {test:'node --test'}, dependencies: {core:'workspace:*'}},
  {name: 'page', directory: 'apps/page', scripts: {test:'node --test'}, devDependencies: {api:'workspace:*'}},
];
test('package paths include transitive production and test dependents, never their unrelated dependencies', () => {
  assert.deepEqual(scopeForPaths(['packages/core/src/a.ts'], workspace), {full:false, packages:['api','core','page']});
  assert.deepEqual(scopeForPaths(['apps/page/README.md'], workspace), {full:false, packages:['page']});
  assert.deepEqual(scopeForPaths(['apps/leaf/a.ts','packages/api/a.ts'], workspace), {full:false, packages:['api','leaf','page']});
});
test('root, deleted unknown packages, and unknown diffs run every package', () => {
  for (const paths of [[], ['pnpm-lock.yaml'], ['scripts/tool.mjs'], ['docs/backlog.md'], ['packages/gone/a.ts'], ['apps/page-old/a.ts'], ['apps/page/a.ts','deploy/file']]) {
    assert.deepEqual(scopeForPaths(paths, workspace), {full:true, packages:['api','core','leaf','page']});
  }
});
test('actual manifests resolve portal alone and identity dependents without a hardcoded graph', () => {
  const real = loadWorkspace();
  assert.deepEqual(scopeForPaths(['apps/portal/src/app.ts'], real).packages, ['@waitron-cloud/portal']);
  assert.deepEqual(scopeForPaths(['packages/identity/src/index.ts'], real).packages,
    ['@waitron-cloud/account-http','@waitron-cloud/backups','@waitron-cloud/fiscal-allocation','@waitron-cloud/identity','@waitron-cloud/portal','@waitron-cloud/registration','@waitron-cloud/remote-access']);
});
test('actual work plans preserve all twenty nonempty package shards and five receipts', () => {
  const real = loadWorkspace();
  const full = workPlan(scopeForPaths(['pnpm-lock.yaml'], real), real);
  assert.equal(full.packages.length, 20);
  assert.equal(full.receipts.length, 5);
  assert.equal(full.typecheck, true);
  const portal = workPlan(scopeForPaths(['apps/portal/src/app.ts'], real), real);
  assert.deepEqual(portal.packages, [1,2,3].map(shard=>({package:'@waitron-cloud/portal',shard,shards:3})));
  assert.deepEqual(portal.receipts, ['test:local-stack']);
  assert.equal(portal.typecheck, true);
});
