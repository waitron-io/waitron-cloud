import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {workPlan} from './ci-scope.mjs';

test('saved test inventory allocates shards even after the working directory loses those tests', t => {
  const root=mkdtempSync(join(tmpdir(),'cloud-ci-saved-tests-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const packages=[{name:'@waitron-cloud/portal',directory:'apps/account-console',scripts:{test:'node --test'}}];
  const testFilesByPackage={'@waitron-cloud/portal':['one','two','three','four','five','six'].map(name=>`apps/account-console/test/${name}.test.ts`)};
  let plan;
  assert.doesNotThrow(()=>{plan=workPlan({full:false,packages:['@waitron-cloud/portal']},packages,root,undefined,testFilesByPackage);});
  assert.deepEqual(plan.packages,[1,2,3,4,5,6].map(shard=>({package:'@waitron-cloud/portal',shard,shards:6})));
  assert.throws(()=>workPlan({full:false,packages:['@waitron-cloud/portal']},packages,root,undefined,{}),/inventory/);
  assert.throws(()=>workPlan({full:false,packages:['@waitron-cloud/portal']},packages,root,undefined,{'@waitron-cloud/portal':testFilesByPackage['@waitron-cloud/portal'].slice(1)}),/empty test shard/);
});

test('duplicate or foreign saved test paths cannot manufacture a complete shard inventory', () => {
  const packages=[{name:'@waitron-cloud/portal',directory:'apps/account-console',scripts:{test:'node --test'}}];
  for (const files of [Array(6).fill('apps/account-console/test/one.test.ts'),Array.from({length:6},(_,i)=>`apps/foreign/test/${i}.test.ts`)]) {
    assert.throws(()=>workPlan({full:false,packages:['@waitron-cloud/portal']},packages,tmpdir(),undefined,{'@waitron-cloud/portal':files}),/inventory/);
  }
});

test('historical workspace reconstruction ignores newer manifests, source dependencies and test inventory', async t => {
  const root=mkdtempSync(join(tmpdir(),'cloud-ci-snapshot-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-c','maintenance.auto=false',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const write=(path,body)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),body);};
  git('init','-q');git('config','user.name','Snapshot test');git('config','user.email','ci@example.test');
  write('pnpm-workspace.yaml',"packages:\n  - 'packages/*'\n  - 'apps/*'\n");
  write('apps/account-console/package.json',JSON.stringify({name:'@waitron-cloud/portal',scripts:{test:'node --test'},dependencies:{'@waitron-cloud/identity':'workspace:*'}}));
  write('packages/identity/package.json',JSON.stringify({name:'@waitron-cloud/identity',scripts:{test:'node --test'}}));
  write('apps/account-console/src/app.ts',"import '@waitron-cloud/identity';\n");
  for(let i=0;i<6;i++)write(`apps/account-console/test/${i}.test.ts`,'export {};\n');
  git('add','.');git('commit','-qsm','Saved workspace');const base=git('rev-parse','HEAD').trim();
  write('apps/account-console/src/app.ts',"import '@waitron-cloud/identity';\nexport const changed = true;\n");
  git('add','.');git('commit','-qsm','Saved change');const head=git('rev-parse','HEAD').trim();
  write('apps/account-console/package.json',JSON.stringify({name:'@waitron-cloud/replaced',scripts:{test:'node --test'}}));
  write('apps/account-console/src/app.ts','throw Error("Historical modules must not execute");\n');
  rmSync(join(root,'apps/account-console/test'),{recursive:true});
  write('packages/new-owner/package.json',JSON.stringify({name:'@waitron-cloud/new-owner'}));
  const {loadWorkspaceAtRevision}=await import('./ci-workspace-snapshot.mjs');
  const {selectPlan}=await import('./ci-plan.mjs');
  const snapshot=loadWorkspaceAtRevision(head,git);
  assert.equal(snapshot.revision,head);
  assert.deepEqual(snapshot.packages.map(pkg=>pkg.name).sort(),['@waitron-cloud/identity','@waitron-cloud/portal']);
  assert.deepEqual(snapshot.packages.find(pkg=>pkg.name==='@waitron-cloud/portal').pathDependencies,{'@waitron-cloud/identity':'file'});
  const plan=selectPlan({base,head},snapshot,git);
  assert.deepEqual(plan.packages,[1,2,3,4,5,6].map(shard=>({package:'@waitron-cloud/portal',shard,shards:6})));
  assert.throws(()=>selectPlan({base,head},{...snapshot,revision:base},git),/revision/);
  assert.throws(()=>selectPlan({base,head},{...snapshot,testFilesByPackage:undefined},git),/inventory/);
  const truncated=(...args)=>{const value=git(...args);return args[0]==='ls-tree'?value.slice(0,-1):value;};
  assert.throws(()=>loadWorkspaceAtRevision(head,truncated),/Incomplete workspace inventory/);
  const duplicated=(...args)=>{const value=git(...args);return args[0]==='ls-tree'?value+value.split('\0')[0]+'\0':value;};
  assert.throws(()=>loadWorkspaceAtRevision(head,duplicated),/Duplicate workspace path/);
  git('reset','--hard',head);
  write('.gitattributes','* -text\n');git('add','.gitattributes');git('commit','-qsm','Attributed checkout');
  const attributed=git('rev-parse','HEAD').trim();
  assert.throws(()=>loadWorkspaceAtRevision(attributed,git),/Checkout attributes require full work/);
});

test('saved workspace preserves direct test readers without reviving unrelated manifest consumers', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-ci-direct-snapshot-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const put = (path, body) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), body);};
  git('init', '-qb', 'main'); git('config', 'user.name', 'Snapshot test'); git('config', 'user.email', 'ci@example.test');
  put('package.json', '{"name":"snapshot-test","private":true}\n');
  put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
  put('packages/operations/package.json', '{"name":"@waitron-cloud/operations","scripts":{"test":"node --test"}}\n');
  put('packages/translation/package.json', '{"name":"@waitron-cloud/translation","scripts":{"test":"node --test"},"dependencies":{"@waitron-cloud/operations":"workspace:*"}}\n');
  put('packages/operations/src/index.ts', 'export {};\n'); put('packages/translation/src/index.ts', 'export {};\n');
  const changed = 'packages/operations/test/shared.test.ts';
  put(changed, 'export const value = 1;\n'); put('packages/translation/test/index.test.ts', 'export {};\n');
  git('add', '.'); git('commit', '-qsm', 'Direct reader baseline');
  const {loadWorkspace, scopeForPaths} = await import('./ci-scope.mjs');
  const {loadWorkspaceAtRevision} = await import('./ci-workspace-snapshot.mjs');
  const check = expected => {
    const head = git('rev-parse', 'HEAD').trim();
    assert.deepEqual(scopeForPaths([changed], loadWorkspace(root), {direct: true}).packages, expected);
    assert.deepEqual(scopeForPaths([changed], loadWorkspaceAtRevision(head, git).packages, {direct: true}).packages, expected);
  };
  check(['@waitron-cloud/operations']);
  put('packages/translation/package.json', '{"name":"@waitron-cloud/translation","scripts":{"test":"node --test"}}\n');
  put('packages/translation/tsconfig.json', '{"include":["../operations/test/*.ts"]}\n');
  git('add', '.'); git('commit', '-qsm', 'Declared metadata reader');
  check(['@waitron-cloud/operations', '@waitron-cloud/translation']);
});
