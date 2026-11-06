import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rm, writeFile, symlink, chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {git, gitExecutable, put, commit, repository} from './ui-build-fixtures.mjs';

const api = () => import('./ui-build-inputs.mjs');
const sha1 = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');

test('readUiGitTree returns verified raw commit, recursive trees and regular blob bytes', async t => {
  const f = await repository(t, {'nested/a.txt': 'original\n', 'binary': Buffer.from([255,0,10])});
  const {readUiGitTree} = await api();
  const result = await readUiGitTree({repo: f.repo, commit: f.commit, git: gitExecutable});
  assert.equal(sha1('commit', result.commitBytes), f.commit);
  assert.equal(result.trees.size, 2);
  for (const [id, bytes] of result.trees) assert.equal(sha1('tree', bytes), id);
  assert.deepEqual([...result.files.keys()], ['binary','nested/a.txt']);
  assert.deepEqual(result.files.get('binary').bytes, Buffer.from([255,0,10]));
  assert.deepEqual(result.files.get('nested/a.txt'), {mode:'100644',
    objectId: '4b48deed3a433909bfd6b6ab3d4b91348b6af464', bytes:Buffer.from('original\n')});
});

test('immutable reader ignores dirty, ignored, flagged and nested working files', async t => {
  const f = await repository(t, {'file': 'original\n','.gitignore':'dist/\n'});
  const {readUiGitTree} = await api();
  const before = await readUiGitTree({repo:f.repo, commit:f.commit, git:gitExecutable});
  git(f.repo, 'update-index', '--assume-unchanged', 'file');
  await put(f.repo, 'file', 'foreign sentinel\n');
  await put(f.repo, 'dist/ignored', 'stale');
  const nested = join(f.repo, 'nested'); await mkdir(nested);
  git(nested, 'init', '-q', '--initial-branch=main');
  await put(nested, 'untracked', 'foreign');
  const after = await readUiGitTree({repo:f.repo, commit:f.commit, git:gitExecutable});
  assert.deepEqual(after,before);
  git(f.repo,'update-index','--no-assume-unchanged','file');
  git(f.repo,'update-index','--skip-worktree','file');
  assert.deepEqual(await readUiGitTree({repo:f.repo,commit:f.commit,git:gitExecutable}),before);
  assert.equal(await readFile(join(f.repo,'file'),'utf8'),'foreign sentinel\n');
  assert.equal(await readFile(join(nested,'untracked'),'utf8'),'foreign');
});

test('immutable reader ignores replacement commit, tree and blob refs, config and inherited Git redirects', async t => {
  const f = await repository(t, {'file':'original\n'});
  const {readUiGitTree} = await api();
  const before = await readUiGitTree({repo:f.repo,commit:f.commit,git:gitExecutable});
  await put(f.repo,'file','replacement\n'); const other = commit(f.repo);
  const firstTree=git(f.repo,'rev-parse',f.commit+'^{tree}').toString().trim();
  const nextTree=git(f.repo,'rev-parse',other+'^{tree}').toString().trim();
  const nextBlob=git(f.repo,'rev-parse',other+':file').toString().trim();
  for(const [oldId,newId] of [[f.commit,other],[firstTree,nextTree],[before.files.get('file').objectId,nextBlob]]) git(f.repo,'replace',oldId,newId);
  const foreign=await repository(t,{'file':'wrong repository'});
  const saved={...process.env};
  try {
    Object.assign(process.env,{GIT_DIR:join(foreign.repo,'.git'),GIT_WORK_TREE:foreign.repo,
      GIT_OBJECT_DIRECTORY:join(foreign.repo,'.git/objects'), GIT_CONFIG_COUNT:'1',
      GIT_CONFIG_KEY_0:'core.bare',GIT_CONFIG_VALUE_0:'true',GIT_CONFIG:join(foreign.repo,'.git/config')});
    git(f.repo,'config','include.path',join(foreign.repo,'.git/config'));
    assert.deepEqual(await readUiGitTree({repo:f.repo,commit:f.commit,git:gitExecutable}),before);
  } finally {for (const key of Object.keys(process.env)) if(!(key in saved)) delete process.env[key]; Object.assign(process.env,saved);}
});

test('immutable reader supports registered linked worktrees without trusting their working copy', async t=>{
  const f=await repository(t);const linked=join(f.root,'linked');git(f.repo,'worktree','add','--detach',linked,f.commit);
  await put(linked,'context.txt','foreign sentinel');
  const {readUiGitTree}=await api();
  const tree=await readUiGitTree({repo:linked,commit:f.commit,git:gitExecutable});
  assert.equal(tree.files.get('context.txt').bytes.toString(),'original\n');
  assert.equal(await readFile(join(linked,'context.txt'),'utf8'),'foreign sentinel');
});

for(const kind of ['missing','tree','blob','corrupt','symlink','gitlink','case-collision','unsafe-path','invalid-utf8','high-bit-mode']) test(`immutable reader refuses ${kind}`,{timeout:5000},async t=>{
  const f=await repository(t); const {readUiGitTree}=await api(); let id=f.commit;
  if(kind==='missing')id='f'.repeat(40);
  if(kind==='tree')id=git(f.repo,'rev-parse','HEAD^{tree}').toString().trim();
  if(kind==='blob')id=git(f.repo,'rev-parse','HEAD:context.txt').toString().trim();
  if(kind==='corrupt'){const path=join(f.repo,'.git/objects',id.slice(0,2),id.slice(2));await chmod(path,0o644);await writeFile(path,Buffer.from('invalid object'));}
  if(kind==='symlink'){await symlink('/outside',join(f.repo,'link'));id=commit(f.repo);}
  if(kind==='gitlink'){git(f.repo,'update-index','--add','--cacheinfo','160000,'+f.commit+',submodule');git(f.repo,'commit','-s','-qm','gitlink');id=git(f.repo,'rev-parse','HEAD').toString().trim();}
  if(kind==='case-collision'||kind==='unsafe-path'||kind==='invalid-utf8'||kind==='high-bit-mode'){
    const blob=git(f.repo,'rev-parse','HEAD:context.txt').toString().trim();
    const names=kind==='case-collision'?[Buffer.from('A'),Buffer.from('a')]:[kind==='unsafe-path'?Buffer.from('..'):kind==='high-bit-mode'?Buffer.from('valid'):Buffer.from([255])];
    const raw=Buffer.concat(names.map(n=>Buffer.concat([Buffer.from('100644 '),n,Buffer.from([0]),Buffer.from(blob,'hex')])));
    if(kind==='high-bit-mode')raw[0]|=128;
    const tree=gitInput(f.repo,['hash-object','-t','tree','--literally','-w','--stdin'],raw);
    id=gitInput(f.repo,['commit-tree',tree],Buffer.from('invalid tree\n'));
  }
  await assert.rejects(readUiGitTree({repo:f.repo,commit:id,git:gitExecutable}),/commit|object|regular|collision|path|UTF|tree/i);
});

import {execFileSync} from 'node:child_process';
import {fixtureEnv} from './ui-build-fixtures.mjs';
function gitInput(repo,args,input){return execFileSync(gitExecutable,['-C',repo,...args],{env:fixtureEnv(),input}).toString().trim();}

test('computeUiBuildEvidence exports the immutable evidence interface',async()=>{
  const {computeUiBuildEvidence}=await api();
  assert.equal(typeof computeUiBuildEvidence,'function');
});

import {createBuildFixture} from './ui-build-fixtures.mjs';
const sha512=bytes=>createHash('sha512').update(bytes).digest('hex');
const framed=value=>sha512(Buffer.from(JSON.stringify(value)+'\n'));

test('hashes_immutable_inputs_and_recipe with independent tuple framing and complete inventories',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  const result=await computeUiBuildEvidence(f);
  assert.equal(result.schema,1);assert.deepEqual(result.source,f.source);assert.equal(result.recipeCommit,f.recipeCommit);
  const paths=git(f.sourceRepo,'ls-tree','-r','--name-only',f.source.commit).toString().trim().split('\n');
  assert.deepEqual(result.inputs.map(e=>e[1]).sort(),paths.sort());
  for(const [role,path,mode,length,hash] of result.inputs){
    const raw=git(f.sourceRepo,'show',f.source.commit+':'+path);
    assert.equal(mode,'100644');assert.equal(length,raw.length);assert.equal(hash,sha512(raw));
    if(path==='pnpm-lock.yaml'||path==='packages/ui-core/src/index.ts'||path==='LICENSE')assert.equal(role,'build');
    if(path.startsWith('.github/workflows/'))assert.equal(role,'check-definition');
  }
  const order=entries=>[...entries].sort((a,b)=>Buffer.compare(Buffer.from(a[0]),Buffer.from(b[0]))||Buffer.compare(Buffer.from(a[1]),Buffer.from(b[1])));
  assert.deepEqual(result.inputs,order(result.inputs));assert.deepEqual(result.recipeInputs,order(result.recipeInputs));
  assert.equal(result.inputsSha512,framed(['ui-build-evidence',1,'inputs',f.source.repository,f.source.commit,'0.1.0',result.inputs]));
  const recipe=JSON.parse(await readFile(new URL('./ui-build-policy.json',import.meta.url)));
  const expectedCommands=[
    ['pnpm','source',['install','--frozen-lockfile','--ignore-scripts','--store-dir','<store>'],[['CI','true'],['LC_ALL','C'],['TZ','UTC']]],
    ['node','source',['scripts/release/prepare-ui.mjs','<source>','<output>','--release-version','<releaseVersion>','--source-commit','<sourceCommit>'],[['CI','true'],['LC_ALL','C'],['TZ','UTC']]],
    ['pnpm','ui-package',['run','build'],[]],
    ['pnpm','ui-package',['pack','--pack-destination','<scratch>'],[['npm_config_ignore_scripts','true']]],
    ['tar','source',['-xzf','<sourceArchive>','--strip-components=1','-C','<staging>'],[]],
    ['npm','staging',['pack','--ignore-scripts','--pack-destination','<scratch>'],[]],
  ];
  assert.equal(result.recipeSha512,framed(['ui-build-evidence',1,'recipe','waitron-io/waitron-cloud',f.recipeCommit,
    f.source.commit,1,expectedCommands,result.toolchain,result.recipeInputs]));
  assert.equal(result.sourceChecksSha512,sha512(f.sourceChecks));
  assert.deepEqual(result.toolchain.map(e=>e[0]),['git','node','npm','pnpm','sh','tar']);
  for(const [name,version,os,arch,entries] of result.toolchain){
    assert.equal(typeof version,'string');assert.equal(os,process.platform);assert.equal(arch,process.arch);
    assert(entries.some(e=>e[0]==='tool'&&e[1]===name&&e[2]==='100755'));
  }
  for(const path of ['source/pnpm-lock.yaml','source/scripts/release/prepare-ui.mjs','scripts/release/support.mjs','scripts/release/ui-build-policy.json'])assert(result.recipeInputs.some(e=>e[1]===path),path);
  assert.equal(recipe.programs['scripts/release/prepare-ui.mjs'],'031e6f59eb80f403229d7082157a37eff15237068df16bb55cc77088210a6786c9bedebc331c9ecc01ecc78c729dc7f4793298c9297716327fb9cbb62e218ec7');
  assert.equal(recipe.programs['packages/ui-core/scripts/build.mjs'],'9b8585f537be82a0a847389dfdbf02984088b69ee0583b6483ece6a1b40d2eac85c05635ad23e53f43b71bed812cdcc26f878351319883bee0003fd8fd936479');
  for(const [name,path] of [['prepare-ui.mjs','scripts/release/prepare-ui.mjs'],['build.mjs','packages/ui-core/scripts/build.mjs']])assert.equal(sha512(await readFile(new URL('./fixtures/ui-build-source/'+name,import.meta.url))),recipe.programs[path]);
});

test('tool bytes and modes change recipe with unchanged version text, source checks remain opaque bytes',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  const before=await computeUiBuildEvidence(f);
  await writeFile(join(f.tools.node.distributionRoot,'support'),'distribution bytes');
  const after=await computeUiBuildEvidence(f);
  assert.equal(after.inputsSha512,before.inputsSha512);assert.notEqual(after.recipeSha512,before.recipeSha512);
  assert.equal(after.toolchain.find(e=>e[0]==='node')[1],before.toolchain.find(e=>e[0]==='node')[1]);
  f.sourceChecks=Buffer.from([255,0,13,10]);const opaque=await computeUiBuildEvidence(f);
  assert.equal(opaque.sourceChecksSha512,'8b2fc9a554c5be7b129bea38938c9647448d6025c1a2ef909a64cdf27ff7c09569b3eca6bf3faa1269d333c6f22dd997b0037bbcda40fb6dc562fe55070e4966');
  assert.equal(opaque.recipeSha512,after.recipeSha512);assert.equal(opaque.inputsSha512,after.inputsSha512);
});

const badInputs=[
 ['escaped import','packages/ui-core/src/index.ts', 'export * from "../../../outside.ts";\n'],
 ['dynamic import','packages/ui-core/src/index.ts', 'export const load=()=>import(name);\n'],
 ['unclassified config','packages/ui-core/tsconfig.json','{"extends":"../../elsewhere.json"}'],
 ['npm config','.npmrc','registry=https://example.invalid\n'],
 ['nested npm config','packages/.npmrc','registry=https://example.invalid\n'],
 ['package npm config','packages/ui-core/.npmrc','registry=https://example.invalid\n'],
 ['pnpm hook','.pnpmfile.cjs','throw Error("must not run")'],
 ['alternate lock','package-lock.json','{}'],
 ['missing notice','LICENSE',null],
 ['missing package readme','packages/ui-core/README.md',null],
 ['changed F recipe','scripts/release/prepare-ui.mjs','throw Error("changed recipe")'],
 ['changed bundler','packages/ui-core/scripts/build.mjs','throw Error("changed bundler")'],
 ['workspace policy','pnpm-workspace.yaml','packages: ["anywhere/**"]\n'],
 ['YAML duplicate','pnpm-lock.yaml','lockfileVersion: "9.0"\nlockfileVersion: "9.0"\n'],
 ['invalid UTF JSON','packages/ui-core/package.json',Buffer.from([255])],
 ['JSON duplicate','packages/ui-core/package.json','{"name":"@waitron/ui-core","name":"other"}'],
];
for(const [name,path,bytes] of badInputs)test('refuses_unclassified_or_ambiguous_inputs: '+name,async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  if(bytes===null)await rm(join(f.sourceRepo,path));else await put(f.sourceRepo,path,bytes);
  f.source.commit=commit(f.sourceRepo);
  await assert.rejects(computeUiBuildEvidence(f),/unsupported|unclassified|missing|duplicate|UTF|JSON|recipe|input|config|import|workspace/i);
});
for(const [name,mutate] of [
 ['prebuild',p=>p.scripts.prebuild='touch marker'],
 ['postbuild',p=>p.scripts.postbuild='touch marker'],
 ['build command',p=>p.scripts.build+=' && touch marker'],
 ['prepack command',p=>p.scripts.prepack='touch marker'],
 ['runtime dependency',p=>p.dependencies={other:'workspace:*'}],
 ['external dependency URL',p=>p.devDependencies.esbuild='https://example.invalid/tool.tgz'],
 ['patches',p=>p.pnpm={patchedDependencies:{lit:'patches/lit.patch'}}],
])test('refuses unsupported package execution: '+name,async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api(),path='packages/ui-core/package.json';
  const manifest=JSON.parse(await readFile(join(f.sourceRepo,path)));mutate(manifest);
  await put(f.sourceRepo,path,JSON.stringify(manifest));f.source.commit=commit(f.sourceRepo);
  await assert.rejects(computeUiBuildEvidence(f),/unsupported|dependency|build|hook|patch|command/i);
});

test('recipe import escape and new production extensions refuse',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  await put(f.recipeRepo,'scripts/release/support.js','export default 1;');f.recipeCommit=commit(f.recipeRepo);
  await assert.rejects(computeUiBuildEvidence(f),/recipe|extension|unclassified/i);
  await rm(join(f.recipeRepo,'scripts/release/support.js'));
  await put(f.recipeRepo,'scripts/release/entry.mjs','import "../elsewhere.mjs";');f.recipeCommit=commit(f.recipeRepo);
  await assert.rejects(computeUiBuildEvidence(f),/recipe|import|closure/i);
});

test('byte and framing bounds refuse instead of returning partial evidence',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  await assert.rejects(computeUiBuildEvidence({...f,sourceChecks:Buffer.alloc(16*1024*1024+1)}),/source.check|limit|16 MiB/i);
  await assert.rejects(computeUiBuildEvidence({...f,sourceChecks:'not bytes'}),/Buffer|bytes/i);
  await assert.rejects(computeUiBuildEvidence({...f,source:{...f.source,version:'0.2.0'}}),/version/);
  await assert.rejects(computeUiBuildEvidence({...f,tools:{...f.tools,unknown:f.tools.node}}),/tool/);
  await symlink('/outside',join(f.tools.node.distributionRoot,'escape'));
  await assert.rejects(computeUiBuildEvidence(f),/tool|link|regular/);
});

test('nested tool files keep their full logical paths and internal executable links are resolved',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  await put(f.tools.node.distributionRoot,'lib/support','nested bytes');
  await symlink('lib/support',join(f.tools.node.distributionRoot,'internal'));
  const result=await computeUiBuildEvidence(f),entries=result.toolchain.find(e=>e[0]==='node')[4];
  assert(entries.some(e=>e[1]==='lib/support'&&e[4]===sha512(Buffer.from('nested bytes'))));
  assert(entries.some(e=>e[1]==='internal'&&e[4]===sha512(Buffer.from('nested bytes'))));
});

test('executable selection inside one distribution changes recipe even when versions and all files match',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  const code=await readFile(f.tools.node.executable);await put(f.tools.node.distributionRoot,'alternate',code,0o755);
  const before=await computeUiBuildEvidence(f);f.tools.node.executable=join(f.tools.node.distributionRoot,'alternate');
  const after=await computeUiBuildEvidence(f);assert.notEqual(after.recipeSha512,before.recipeSha512);
});

test('escaping declaration references and implicit package imports are unclassified',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  await put(f.sourceRepo,'packages/ui-core/src/index.ts','/// <reference path="../../../outside.ts" />\nexport {};');
  f.source.commit=commit(f.sourceRepo);await assert.rejects(computeUiBuildEvidence(f),/reference|unclassified/);
  git(f.sourceRepo,'reset','--hard','HEAD^');
  const path='packages/ui-core/package.json',manifest=JSON.parse(await readFile(join(f.sourceRepo,path)));
  manifest.imports={'#outside':'../../../outside.ts'};await put(f.sourceRepo,path,JSON.stringify(manifest));f.source.commit=commit(f.sourceRepo);
  await assert.rejects(computeUiBuildEvidence(f),/imports|unclassified/);
});

test('unknown pnpm configuration cannot enter via a workspace manifest',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api(),path='package.json';
  const manifest=JSON.parse(await readFile(join(f.sourceRepo,path)));manifest.pnpm??={};manifest.pnpm.onlyBuiltDependencies=['malicious'];
  await put(f.sourceRepo,path,JSON.stringify(manifest));f.source.commit=commit(f.sourceRepo);
  await assert.rejects(computeUiBuildEvidence(f),/pnpm|unclassified|unsupported/);
});

test('recipe closure inventory on real fixtures includes no executable fixture data',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  await put(f.recipeRepo,'scripts/release/fixtures/unexecuted.txt','context');
  f.recipeCommit=commit(f.recipeRepo);const result=await computeUiBuildEvidence(f);
  assert(!result.recipeInputs.some(e=>e[1].includes('/fixtures/')));
});

test('tool probes cannot change their distribution after it was inventoried',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  const marker=join(f.tools.node.distributionRoot,'support');await writeFile(marker,'before');
  await writeFile(f.tools.node.executable,'#!/bin/sh\nprintf changed > "'+marker+'"\nprintf "node fixture-v1\\n"\n');
  await assert.rejects(computeUiBuildEvidence(f),/tool.*changed|distribution.*changed/i);
});

test('caller mutation during asynchronous reads cannot rewrite source or opaque evidence identity',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api(),source={...f.source},checks=Buffer.from(f.sourceChecks);
  const pending=computeUiBuildEvidence(f);f.source.version='0.2.0';f.sourceChecks.fill(0);
  const result=await pending;assert.deepEqual(result.source,source);assert.equal(result.sourceChecksSha512,sha512(checks));
});

import {deflateSync} from 'node:zlib';
test('correct zlib framing with a mismatched Git content hash refuses',async t=>{
  const f=await repository(t),path=join(f.repo,'.git/objects',f.commit.slice(0,2),f.commit.slice(2));
  await chmod(path,0o644);const replacement=Buffer.from('tree '+'0'.repeat(40)+'\n');
  await writeFile(path,deflateSync(Buffer.concat([Buffer.from(`commit ${replacement.length}\0`),replacement])));
  const {readUiGitTree}=await api();await assert.rejects(readUiGitTree({repo:f.repo,commit:f.commit,git:gitExecutable}),/hash differs/);
});

test('oversized declared object and truncated protocol stop before returning inventory',async t=>{
  const f=await repository(t),{readUiGitTree}=await api();
  const fake=join(f.root,'fake-git');
  for(const response of [f.commit+' commit '+(16*1024*1024+1)+'\n',f.commit+' commit 120\ntruncated']){
    await writeFile(fake,'#!/bin/sh\nread identity\nprintf %s '+"'"+response+"'"+'\n',{mode:0o755});
    await assert.rejects(readUiGitTree({repo:f.repo,commit:f.commit,git:fake}),/byte limit|truncated/);
  }
});

import {truncate} from 'node:fs/promises';
test('tool file size is refused before reading a sparse oversized distribution file',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api(),path=join(f.tools.node.distributionRoot,'large');
  await writeFile(path,'');await truncate(path,256*1024*1024+1);
  await assert.rejects(computeUiBuildEvidence(f),/oversized|byte limit/);
});

test('repository blob limit admits the exact bound and refuses the next byte',async t=>{
  const f=await repository(t),{readUiGitTree}=await api();
  await put(f.repo,'bound',Buffer.alloc(16*1024*1024));let id=commit(f.repo);
  assert.equal((await readUiGitTree({repo:f.repo,commit:id,git:gitExecutable})).files.get('bound').bytes.length,16*1024*1024);
  await put(f.repo,'bound',Buffer.alloc(16*1024*1024+1));id=commit(f.repo);
  await assert.rejects(readUiGitTree({repo:f.repo,commit:id,git:gitExecutable}),/byte limit/);
});

test('repository repeated blobs count toward the aggregate byte bound',async t=>{
  const f=await repository(t),{readUiGitTree}=await api();
  const blob=gitInput(f.repo,['hash-object','-w','--stdin'],Buffer.alloc(16*1024*1024));
  const tree=gitInput(f.repo,['mktree'],Buffer.from(Array.from({length:33},(_,i)=>'100644 blob '+blob+'\tf'+String(i).padStart(2,'0')+'\n').join('')));
  const id=gitInput(f.repo,['commit-tree',tree],Buffer.from('aggregate bound\n'));
  await assert.rejects(readUiGitTree({repo:f.repo,commit:id,git:gitExecutable}),/byte limit/);
});

test('repository entry bound refuses a 50001-file tree',async t=>{
  const f=await repository(t),{readUiGitTree}=await api(),blob=git(f.repo,'rev-parse','HEAD:context.txt').toString().trim();
  const tree=gitInput(f.repo,['mktree'],Buffer.from(Array.from({length:50001},(_,i)=>'100644 blob '+blob+'\tf'+String(i).padStart(5,'0')+'\n').join('')));
  const id=gitInput(f.repo,['commit-tree',tree],Buffer.from('entry bound\n'));
  await assert.rejects(readUiGitTree({repo:f.repo,commit:id,git:gitExecutable}),/entry limit/);
});

for(const [name,mutate]of [
 ['missing dependency identity',lock=>{delete lock.packages[Object.keys(lock.packages)[0]];}],
 ['missing installed snapshot',lock=>{delete lock.snapshots[Object.keys(lock.snapshots)[0]];}],
 ['unlocked transitive dependency',lock=>{lock.snapshots[Object.keys(lock.snapshots)[0]].dependencies={unlocked:'9.9.9'};}],
 ['external snapshot dependency',lock=>{lock.snapshots[Object.keys(lock.snapshots)[0]].dependencies={unlocked:'https://outside.invalid/payload.tgz'};}],
])test('complete dependency graph refuses '+name,async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api(),path='pnpm-lock.yaml';
  const {parse,stringify}=await import('yaml');const lock=parse(await readFile(join(f.sourceRepo,path),'utf8'));mutate(lock);
  await put(f.sourceRepo,path,stringify(lock));f.source.commit=commit(f.sourceRepo);
  await assert.rejects(computeUiBuildEvidence(f),/lock|dependency|snapshot|integrity/);
});

test('env-based version launchers use the selected Node rather than ambient PATH',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  await writeFile(f.tools.npm.executable,'#!/usr/bin/env node\nthrow Error("ambient Node executed this program");\n');
  const result=await computeUiBuildEvidence(f);
  assert.equal(result.toolchain.find(e=>e[0]==='npm')[1],'node fixture-v1');
});

test('a later tool probe cannot change an already verified tool distribution',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  const marker=join(f.tools.node.distributionRoot,'support');await writeFile(marker,'before');
  await writeFile(f.tools.npm.executable,'#!/bin/sh\nprintf changed > "'+marker+'"\nprintf "npm fixture-v1\\n"\n');
  await assert.rejects(computeUiBuildEvidence(f),/tool.*changed|distribution.*changed/i);
});

for(const [name,path,value]of [
 ['browser mapping','packages/ui-core/package.json',{browser:{'./src/index.ts':'../../../outside.ts'}}],
 ['nested package resolution','packages/ui-core/src/package.json',{type:'commonjs',main:'../../../outside.js'}],
 ['nested compile configuration','packages/ui-core/src/tsconfig.json',{extends:'../../../outside.json'}],
])test('unclassified consumed configuration refuses '+name,async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  let current={};try{current=JSON.parse(await readFile(join(f.sourceRepo,path)));}catch(error){if(error.code!=='ENOENT')throw error;}
  await put(f.sourceRepo,path,JSON.stringify({...current,...value}));f.source.commit=commit(f.sourceRepo);
  await assert.rejects(computeUiBuildEvidence(f),/unclassified|unsupported|configuration|config/);
});

test('workspace-glob directories without manifests remain hashed context',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  await put(f.sourceRepo,'bench/tools/helper.txt','nonmember context');f.source.commit=commit(f.sourceRepo);
  const result=await computeUiBuildEvidence(f);assert(result.inputs.some(e=>e[0]==='context'&&e[1]==='bench/tools/helper.txt'&&e[4]===sha512(Buffer.from('nonmember context'))));
});

test('a locked workspace importer cannot survive deletion of its selected manifest',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  await rm(join(f.sourceRepo,'packages/another/package.json'));f.source.commit=commit(f.sourceRepo);
  await assert.rejects(computeUiBuildEvidence(f),/lock|workspace|manifest/);
});

test('a consumer-test-only tsconfig is inventoried without entering the compiled closure',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  const path='packages/ui-core/test/consumer/tsconfig.json';await put(f.sourceRepo,path,'{"extends":"../../tsconfig.json"}\n');f.source.commit=commit(f.sourceRepo);
  const result=await computeUiBuildEvidence(f);assert(result.inputs.some(e=>e[0]==='build'&&e[1]===path));
});

test('an unavailable POSIX-shell version cannot become a fabricated tool version',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  await writeFile(f.tools.sh.executable,'#!/bin/sh\nprintf "POSIX-sh\\n"\n');
  await assert.rejects(computeUiBuildEvidence(f),/shell.*version|version.*unavailable/i);
});

test('a semver lock reference keeps its dependency name when peers contain at signs',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api(),path='pnpm-lock.yaml';
  const {parse,stringify}=await import('yaml'),lock=parse(await readFile(join(f.sourceRepo,path),'utf8'));
  lock.importers['packages/ui-core'].devDependencies.esbuild.version='0.28.2(lit@3.2.0)';
  lock.snapshots['esbuild@0.28.2(lit@3.2.0)']={};delete lock.snapshots['esbuild@0.28.2'];
  await put(f.sourceRepo,path,stringify(lock));f.source.commit=commit(f.sourceRepo);
  const result=await computeUiBuildEvidence(f);assert(result.inputs.some(e=>e[1]===path&&e[4]===sha512(Buffer.from(stringify(lock)))));
});

test('Git tree-output framing refuses a declared tree larger than 32 MiB',async t=>{
  const f=await repository(t),{readUiGitTree}=await api(),fake=join(f.root,'fake-git');
  const bytes=git(f.repo,'cat-file','commit',f.commit),tree=bytes.toString().split('\n')[0].slice(5);
  await writeFile(fake,'#!'+process.execPath+'\n'+
    'let buffer="";process.stdin.on("data",chunk=>{buffer+=chunk;while(buffer.includes("\\n")){const p=buffer.indexOf("\\n"),id=buffer.slice(0,p);buffer=buffer.slice(p+1);'+
    'if(id==='+JSON.stringify(f.commit)+'){const bytes=Buffer.from('+JSON.stringify(bytes.toString('base64'))+',"base64");process.stdout.write(id+" commit "+bytes.length+"\\n");process.stdout.write(bytes);process.stdout.write("\\n");}'+
    'else process.stdout.write('+JSON.stringify(tree+' tree '+(32*1024*1024+1)+'\n')+');}});\n',{mode:0o755});
  await assert.rejects(readUiGitTree({repo:f.repo,commit:f.commit,git:fake}),/byte limit/);
});

test('tool distribution entry bound includes directories and files',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api(),root=f.tools.node.distributionRoot;
  for(let offset=0;offset<20000;offset+=250)await Promise.all(Array.from({length:250},(_,i)=>writeFile(join(root,'f'+String(offset+i).padStart(5,'0')),'')));
  await assert.rejects(computeUiBuildEvidence(f),/tool distribution entry limit/);
});

test('a timed-out version probe stops its own group before removing its owned directory',{timeout:40000},async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api(),marker=join(f.root,'probe-owner');
  await writeFile(f.tools.node.executable,'#!/bin/sh\nprintf "%s\\n%s\\n" "$$" "$PWD" > "'+marker+'"\n/bin/sleep 35\nprintf version\n');
  await assert.rejects(computeUiBuildEvidence(f),/tool probe failed: tool probe timed out/);
  const [pid,directory]=(await readFile(marker,'utf8')).trim().split('\n');
  assert.throws(()=>process.kill(-Number(pid),0),{code:'ESRCH'});
  await assert.rejects(readFile(join(directory,'bin','node')),{code:'ENOENT'});
});

test('source and recipe share the 512 MiB budget before reading a rejected blob body',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  const zero=Buffer.alloc(16*1024*1024),blob=gitInput(f.sourceRepo,['hash-object','-w','--stdin'],zero);
  for(let i=0;i<31;i++)git(f.sourceRepo,'update-index','--add','--cacheinfo','100644,'+blob+',context'+String(i).padStart(2,'0'));
  git(f.sourceRepo,'commit','-s','-qm','large logical source inventory');f.source.commit=git(f.sourceRepo,'rev-parse','HEAD').toString().trim();
  await put(f.recipeRepo,'aaa-context',zero);f.recipeCommit=commit(f.recipeRepo);
  const path=join(f.recipeRepo,'.git/objects',blob.slice(0,2),blob.slice(2));await chmod(path,0o644);
  const different=Buffer.alloc(zero.length,1);await writeFile(path,deflateSync(Buffer.concat([Buffer.from(`blob ${different.length}\0`),different])));
  await assert.rejects(computeUiBuildEvidence(f),/byte limit/);
});

test('serialized inventory refuses over 32 MiB even when Git tree and entry bounds admit it',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api();
  const blob=gitInput(f.sourceRepo,['hash-object','-w','--stdin'],Buffer.alloc(0));
  let tree=gitInput(f.sourceRepo,['mktree'],Buffer.from(Array.from({length:40000},(_,i)=>'100644 blob '+blob+'\tf'+String(i).padStart(5,'0')+'x'.repeat(174)+'\n').join('')));
  for(let depth=0;depth<3;depth++)tree=gitInput(f.sourceRepo,['mktree'],Buffer.from('040000 tree '+tree+'\td'+String(depth)+'x'.repeat(218)+'\n'));
  const entries=git(f.sourceRepo,'ls-tree',f.source.commit);
  tree=gitInput(f.sourceRepo,['mktree'],Buffer.concat([entries,Buffer.from('040000 tree '+tree+'\tcontext\n')]));
  f.source.commit=gitInput(f.sourceRepo,['commit-tree',tree],Buffer.from('serialized bound\n'));
  await assert.rejects(computeUiBuildEvidence(f),/serialised.*byte limit/);
});

test('source mode, content, path and lock bytes and a later Cloud commit change their bound identities',async t=>{
  const f=await createBuildFixture(t),{computeUiBuildEvidence}=await api(),path='policy-context.txt';
  await put(f.sourceRepo,path,'before');f.source.commit=commit(f.sourceRepo);
  let before=await computeUiBuildEvidence(f);
  for(const change of ['mode','content','path','lock']){
    if(change==='mode')await chmod(join(f.sourceRepo,path),0o755);
    if(change==='content')await writeFile(join(f.sourceRepo,path),'after');
    if(change==='path'){await put(f.sourceRepo,'renamed-context.txt',await readFile(join(f.sourceRepo,path)));await rm(join(f.sourceRepo,path));}
    if(change==='lock')await writeFile(join(f.sourceRepo,'pnpm-lock.yaml'),(await readFile(join(f.sourceRepo,'pnpm-lock.yaml'),'utf8'))+'\n# input identity\n');
    f.source.commit=commit(f.sourceRepo);const after=await computeUiBuildEvidence(f);
    assert.notEqual(after.inputsSha512,before.inputsSha512,change);assert.notEqual(after.recipeSha512,before.recipeSha512,change);
    if(change==='mode')assert.equal(after.inputs.find(e=>e[1]===path)[2],'100755');
    if(change==='content')assert.equal(after.inputs.find(e=>e[1]===path)[4],sha512(Buffer.from('after')));
    if(change==='path')assert(after.inputs.some(e=>e[1]==='renamed-context.txt')&&!after.inputs.some(e=>e[1]===path));
    if(change==='lock'){const hash=sha512(await readFile(join(f.sourceRepo,'pnpm-lock.yaml')));assert(after.recipeInputs.some(e=>e[1]==='source/pnpm-lock.yaml'&&e[4]===hash));}
    before=after;
  }
  await put(f.recipeRepo,'recipe-context.txt','later Cloud commit');f.recipeCommit=commit(f.recipeRepo);
  const after=await computeUiBuildEvidence(f);assert.equal(after.inputsSha512,before.inputsSha512);assert.notEqual(after.recipeSha512,before.recipeSha512);
});
