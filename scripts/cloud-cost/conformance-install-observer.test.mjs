import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInstallObserver} from './conformance-install-observer.mjs';
const send=(observer,record)=>observer.write(Buffer.from(JSON.stringify(record)+'\n'));
const progress=(observer,packageId,status)=>send(observer,{name:'pnpm:progress',packageId,status});

test('completed downloads and imports leave no unfinished package labels',()=>{
  const o=createInstallObserver('/owned/source');
  progress(o,'@babel/core@8.0.1','resolved');progress(o,'esbuild@0.28.2','resolved');
  progress(o,'@babel/core@8.0.1','found_in_store');progress(o,'esbuild@0.28.2','fetched');
  send(o,{name:'pnpm:progress',status:'imported',to:'/owned/source/node_modules/.pnpm/@babel+core@8.0.1_support@1.0.0/node_modules/@babel/core'});
  send(o,{name:'pnpm:progress',status:'imported',to:'/owned/source/node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild'});
  const s=o.snapshot();assert.equal(s.resolved,2);assert.equal(s.available,2);assert.equal(s.imported,2);
  assert.deepEqual(s.pendingDownloads,[]);assert.deepEqual(s.pendingImports,[]);
});
test('unfinished dependency and workspace scripts are named without their commands or output',()=>{
  const o=createInstallObserver('/owned/source');progress(o,'esbuild@0.28.2','resolved');
  const depPath='/owned/source/node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild';
  send(o,{name:'pnpm:lifecycle',depPath,stage:'postinstall',script:'secret-install-command',line:'secret-output'});
  send(o,{name:'pnpm:lifecycle',depPath:'/owned/source',stage:'prepare',script:'secret-prepare-command'});
  assert.deepEqual(o.snapshot().activeScripts,[{packageId:'esbuild@0.28.2',stage:'postinstall'},{packageId:'workspace',stage:'prepare'}]);
  send(o,{name:'pnpm:lifecycle',depPath,stage:'postinstall',exitCode:0});
  send(o,{name:'pnpm:lifecycle',depPath:'/owned/source',stage:'prepare',exitCode:1});
  assert.deepEqual(o.snapshot().activeScripts,[]);
  assert.equal(JSON.stringify(o.snapshot()).includes('secret'),false);
});
test('partial lines and a final line without newline retain transfer progress',()=>{
  const o=createInstallObserver();const line=JSON.stringify({name:'pnpm:fetching-progress',packageId:'typescript@7.0.0',status:'started',size:9000,attempt:2});
  for(const character of line)o.write(Buffer.from(character));o.end();
  assert.deepEqual(o.snapshot().pendingDownloads,[{packageId:'typescript@7.0.0',attempt:2,size:9000}]);
});
test('negative and unsafe transfer counts never become diagnostic measurements',()=>{
  const o=createInstallObserver();send(o,{name:'pnpm:fetching-progress',packageId:'typescript@7.0.0',status:'started',size:-1,attempt:Infinity,downloaded:9007199254740992});
  assert.deepEqual(o.snapshot().pendingDownloads,[{packageId:'typescript@7.0.0'}]);
});
test('malformed input and unrecognised events cannot echo arbitrary values',()=>{
  const o=createInstallObserver();o.write(Buffer.from('not-json\nnull\n123\n"private-line"\n'));
  for(const packageId of ['https://user:secret@example.test/file','secret/path@1.0.0','tool@1.0.0?secret','x'.repeat(300)+'@1.0.0'])
    send(o,{name:'pnpm:progress',packageId,status:'resolved'});
  send(o,{name:'pnpm:package-manifest',packageId:'private-name@1.0.0',status:'resolved',message:'secret'});
  send(o,{name:'pnpm:progress',packageId:'private-name@1.0.0',status:'secret-state'});
  send(o,{name:'pnpm:fetching-progress',packageId:'private-name@1.0.0',status:'secret-state'});
  send(o,{name:'pnpm:lifecycle',depPath:'/secret',stage:'secret-command'});
  assert.deepEqual(o.snapshot().pendingDownloads,[]);assert.deepEqual(o.snapshot().activeScripts,[]);
  assert.equal(JSON.stringify(o.snapshot()).includes('secret'),false);
});
test('oversized lines are discarded through their newline and the next package still appears',()=>{
  const o=createInstallObserver();o.write(Buffer.from('x'.repeat(70000)));
  o.write(Buffer.from('x'.repeat(70000)+'\n'));
  progress(o,'esbuild@0.28.2','resolved');
  assert.deepEqual(o.snapshot().pendingDownloads,[{packageId:'esbuild@0.28.2'}]);
  assert.equal(o.snapshot().discardedLines,1);
});
test('package and displayed-label limits explicitly report incomplete diagnostics',()=>{
  const o=createInstallObserver();for(let n=0;n<2100;n++)progress(o,'package-'+n+'@1.0.0','resolved');
  const s=o.snapshot();assert.equal(s.resolved,2048);assert.equal(s.pendingDownloadCount,2048);
  assert.equal(s.pendingDownloads.length,20);assert.equal(s.truncated,true);
});
test('a refused install exposes only a fixed pnpm error code',()=>{
  const o=createInstallObserver();send(o,{name:'pnpm',level:'error',code:'ERR_PNPM_TARBALL_INTEGRITY',message:'secret',stack:'secret-stack',url:'https://user:password@host'});
  send(o,{name:'pnpm',level:'error',code:'private error details'});
  assert.deepEqual(o.snapshot().errorCodes,['ERR_PNPM_TARBALL_INTEGRITY']);assert.equal(JSON.stringify(o.snapshot()).includes('secret'),false);
});

test('build metadata in a package version remains recognisable when its import finishes',()=>{
  const o=createInstallObserver('/owned/source');progress(o,'worker@1.0.0+build.1','resolved');progress(o,'worker@1.0.0+build.1','fetched');
  send(o,{name:'pnpm:progress',status:'imported',to:'/owned/source/node_modules/.pnpm/worker@1.0.0+build.1/node_modules/worker'});
  assert.deepEqual(o.snapshot().pendingImports,[]);assert.equal(o.snapshot().imported,1);
});
test('underscores in public package names are retained when an import finishes',()=>{
  const o=createInstallObserver('/owned/source');progress(o,'string_decoder@1.3.0','resolved');progress(o,'string_decoder@1.3.0','fetched');
  send(o,{name:'pnpm:progress',status:'imported',to:'/owned/source/node_modules/.pnpm/string_decoder@1.3.0/node_modules/string_decoder'});
  assert.deepEqual(o.snapshot().pendingImports,[]);assert.equal(o.snapshot().imported,1);
});
test('failed root and dependency scripts remain identified after leaving the active set',()=>{
  const o=createInstallObserver('/owned/source');progress(o,'esbuild@0.28.2','resolved');
  const depPath='/owned/source/node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild';
  for(const [path,stage,exitCode] of [[depPath,'postinstall',1],['/owned/source','postinstall',7]]){
    send(o,{name:'pnpm:lifecycle',depPath:path,stage,script:'private-command'});
    send(o,{name:'pnpm:lifecycle',depPath:path,stage,exitCode,line:'private-output'});
  }
  send(o,{name:'pnpm',level:'error',code:'ELIFECYCLE',message:'private-failure'});
  assert.deepEqual(o.snapshot().activeScripts,[]);
  assert.deepEqual(o.snapshot().failedScripts,[{packageId:'esbuild@0.28.2',stage:'postinstall',exitCode:1},{packageId:'workspace',stage:'postinstall',exitCode:7}]);
  assert.equal(o.snapshot().failedScriptCount,2);assert.deepEqual(o.snapshot().errorCodes,['ELIFECYCLE']);
  assert.equal(JSON.stringify(o.snapshot()).includes('private'),false);
});
test('failed scripts retain bounded labels with an explicit total',()=>{
  const o=createInstallObserver('/owned/source');
  for(let n=0;n<30;n++){
    const id='builder-'+n+'@1.0.0';progress(o,id,'resolved');progress(o,id,'fetched');
    const depPath='/owned/source/node_modules/.pnpm/'+id+'/node_modules/builder-'+n;
    send(o,{name:'pnpm:progress',status:'imported',to:depPath});
    send(o,{name:'pnpm:lifecycle',depPath,stage:'install',exitCode:1});
  }
  const s=o.snapshot();assert.equal(s.failedScriptCount,30);assert.equal(s.failedScripts.length,20);assert.equal(s.truncated,true);
  assert.deepEqual(s.pendingDownloads,[]);assert.deepEqual(s.pendingImports,[]);
});
