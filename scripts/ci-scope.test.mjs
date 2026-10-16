import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
    ['@waitron-cloud/account-http','@waitron-cloud/backups','@waitron-cloud/fiscal-allocation','@waitron-cloud/identity','@waitron-cloud/operations','@waitron-cloud/portal','@waitron-cloud/registration','@waitron-cloud/remote-access','@waitron-cloud/ui-smoke']);
});
test('actual work plans preserve all sixteen nonempty package shards and five receipts', () => {
  const real = loadWorkspace();
  const full = workPlan(scopeForPaths(['pnpm-lock.yaml'], real), real);
  assert.equal(full.packages.length, 16);
  assert.equal(full.receipts.length, 5);
  assert.equal(full.typecheck, true);
  const portal = workPlan(scopeForPaths(['apps/portal/src/app.ts'], real), real);
  assert.deepEqual(portal.packages, [1,2,3].map(shard=>({package:'@waitron-cloud/portal',shard,shards:3})));
  assert.deepEqual(portal.receipts, ['test:local-stack']);
  assert.equal(portal.typecheck, true);
});

test('relative sibling imports include their actual test consumers',()=>{
  const real=loadWorkspace();
  for (const [changed,consumer] of [
    ['remote-access','ui-smoke'], ['remote-access','backups'],
    ['account-http','backups'], ['account-http','registration'], ['account-http','operations'], ['account-http','remote-access'],
    ['registration','operations'], ['operations','registration'],
  ]) assert.ok(scopeForPaths([`packages/${changed}/src/change.ts`],real).packages.includes(`@waitron-cloud/${consumer}`),`${changed} must test ${consumer}`);
});
test('backend work keeps all five receipts and no selected shard can be empty',()=>{
  const real=loadWorkspace();
  assert.deepEqual(workPlan({full:false,packages:['@waitron-cloud/operations']},real).receipts,
    ['test:two-venue-milestone-receipt','test:backup-capacity','test:public-gateway-limits','test:local-stack','test:database-recovery-receipt']);
  const empty=[{name:'@waitron-cloud/portal',directory:'packages/identity',scripts:{test:'node --test'}}];
  assert.throws(()=>workPlan({full:false,packages:['@waitron-cloud/portal']},empty),/empty test shard/);
});

test('workspace source reads include undeclared names, root paths and uncertain sibling templates',()=>{
  const root=mkdtempSync(join(tmpdir(),'cloud-ci-graph-'));
  try {
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'fixture',private:true}));
    writeFileSync(join(root,'pnpm-workspace.yaml'),"packages:\n  - 'packages/*'\n");
    for (const name of ['core','named','root-path','opaque']) {
      const dir=join(root,'packages',name);mkdirSync(join(dir,'src'),{recursive:true});
      writeFileSync(join(dir,'package.json'),JSON.stringify({name,private:true,scripts:{test:'node --test'}}));
    }
    writeFileSync(join(root,'packages/named/src/read.mjs'),"import 'core';\n");
    writeFileSync(join(root,'packages/root-path/src/read.mjs'),"const path='packages/core/src/a.mjs';\n");
    writeFileSync(join(root,'packages/opaque/src/read.mjs'),'import(`../../${name}/src/a.mjs`);\n');
    const graph=loadWorkspace(root);
    assert.deepEqual(scopeForPaths(['packages/core/src/a.mjs'],graph).packages,['core','named','opaque','root-path']);
    assert.deepEqual(scopeForPaths(['packages/named/src/a.mjs'],graph).packages,['named','opaque']);
  } finally {rmSync(root,{recursive:true,force:true});}
});
