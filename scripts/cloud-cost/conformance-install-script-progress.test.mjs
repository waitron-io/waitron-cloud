import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInstallObserver} from './conformance-install-observer.mjs';

const source='/owned/source',depPath=source+'/node_modules/.pnpm/cpu-features@0.0.10/node_modules/cpu-features';
const send=(o,record)=>o.write(Buffer.from(JSON.stringify(record)+'\n'));
const observer=()=>{
  const o=createInstallObserver(source);
  send(o,{name:'pnpm:progress',packageId:'cpu-features@0.0.10',status:'resolved'});
  send(o,{name:'pnpm:lifecycle',depPath,stage:'install',script:'private-command'});
  return o;
};
const lifecycle=(o,line)=>send(o,{name:'pnpm:lifecycle',depPath,stage:'install',line,stdio:'stderr'});

// Removing a recognised milestone must lose the last completed native-build boundary.
for(const [line,want] of [
  ['gyp info using node-gyp@10.2.0',{step:'node-gyp-start'}],
  ['gyp info find Python using Python version 3.14.8 found at "/private/python3"',{step:'python-found'}],
  ['gyp http GET https://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz?private-token',{step:'headers-request'}],
  ['gyp http 200 https://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz',{step:'headers-response',httpStatus:200}],
  ['gyp http 503 https://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz',{step:'headers-response',httpStatus:503}],
  ['gyp http GET https://private.invalid/v26.11.1/SHASUMS256.txt',{step:'checksums-request'}],
  ['gyp http 200 https://private.invalid/v26.11.1/SHASUMS256.txt',{step:'checksums-response',httpStatus:200}],
  ['gyp info spawn /private/venv/bin/python3.14',{step:'configure'}],
  ['gyp info spawn make',{step:'build'}],
  ['gyp info ok ',{step:'node-gyp-complete'}],
])test('native install retains fixed '+want.step+('httpStatus' in want?' '+want.httpStatus:''),()=>{
  const o=observer();lifecycle(o,line);
  assert.deepEqual(o.snapshot().activeScripts,[{packageId:'cpu-features@0.0.10',stage:'install',lastMilestone:want}]);
  for(const hidden of ['private','node-v26','Python version','node-gyp@10'])assert.equal(JSON.stringify(o.snapshot()).includes(hidden),false);
});

test('unrecognised script output cannot replace a recognised milestone or echo output',()=>{
  const o=observer();lifecycle(o,'gyp http GET https://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz');
  for(const line of ['private stdout','gyp info spawn args [','gyp info spawn args \'make\',',
    'gyp http 999 https://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz',
    'gyp http GET https://private.invalid/unrecognised.tar.gz','gyp http GET not-a-url/node-v26.11.1-headers.tar.gz',
    'gyp http GET ftp://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz',
    'prefix gyp info spawn make','gyp info spawn make private-argument'])lifecycle(o,line);
  assert.deepEqual(o.snapshot().activeScripts,[{packageId:'cpu-features@0.0.10',stage:'install',lastMilestone:{step:'headers-request'}}]);
  assert.equal(JSON.stringify(o.snapshot()).includes('private'),false);
});

test('invalid and unsupported native download targets never become milestones',()=>{
  for(const line of ['gyp http GET ftp://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz',
    'gyp http GET not-a-url/node-v26.11.1-headers.tar.gz',
    'gyp http GET https://private.invalid/unrecognised.tar.gz',
    'gyp http 999 https://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz']){
    const o=observer();lifecycle(o,line);
    assert.deepEqual(o.snapshot().activeScripts,[{packageId:'cpu-features@0.0.10',stage:'install'}]);
  }
});

test('native progress is retained on refusal and removed on successful completion',()=>{
  for(const exitCode of [0,7]){
    const o=observer();lifecycle(o,'gyp http 503 https://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz');
    send(o,{name:'pnpm:lifecycle',depPath,stage:'install',exitCode});
    const s=o.snapshot();assert.deepEqual(s.activeScripts,[]);
    assert.deepEqual(s.failedScripts,exitCode===0?[]:[{packageId:'cpu-features@0.0.10',stage:'install',exitCode:7,lastMilestone:{step:'headers-response',httpStatus:503}}]);
  }
});

import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Real pnpm and its bundled node-gyp must distinguish waiting for response
// headers, waiting after response headers and a refused header download.
for(const mode of ['headers-stall','body-stall','refused'])test('real native build identifies '+mode+' through setup',{timeout:20000},async()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'cost-native-build-'))),bin=join(root,'bin');
  mkdirSync(bin);mkdirSync(join(root,'package'));
  writeFileSync(join(root,'package/package.json'),JSON.stringify({name:'native-build-probe',version:'1.0.0',scripts:{install:'node-gyp rebuild'}}));
  writeFileSync(join(root,'package/binding.gyp'),'{"targets":[]}');
  execFileSync('tar',['-czf',join(root,'package.tgz'),'-C',root,'package']);
  const body=readFileSync(join(root,'package.tgz')),integrity='sha512-'+createHash('sha512').update(body).digest('base64');
  let child,closed,installer,scratch,output='',headerRequests=0,archiveRequests=0;
  const server=createServer((request,response)=>{
    if(request.url==='/package.tgz'){archiveRequests++;response.end(body);return;}
    assert.match(request.url,/^\/v26\.[0-9]+\.[0-9]+\/node-v26\.[0-9]+\.[0-9]+-headers\.tar\.gz$/);
    headerRequests++;
    if(mode==='headers-stall')return;
    if(mode==='refused'){response.writeHead(404);response.end('generated-private-refusal');return;}
    response.writeHead(200,{'Content-Type':'application/octet-stream'});response.flushHeaders();
  });
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const endpoint='http://127.0.0.1:'+server.address().port;
    const manifest={name:'native-build-project',private:true,dependencies:{'native-build-probe':'1.0.0'}};
    const lock=`lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .:\n    dependencies:\n      native-build-probe:\n        specifier: 1.0.0\n        version: 1.0.0\npackages:\n  native-build-probe@1.0.0:\n    resolution: {integrity: ${integrity}, tarball: ${endpoint}/package.tgz}\n    requiresBuild: true\nsnapshots:\n  native-build-probe@1.0.0: {}\n`;
    writeFileSync(join(bin,'git'),`#!${process.execPath}
import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const a=process.argv.slice(2);
if(a[0]==='init'){
 const source=a.at(-1);mkdirSync(source,{recursive:true});
 writeFileSync(join(source,'package.json'),${JSON.stringify(JSON.stringify(manifest))});
 writeFileSync(join(source,'pnpm-lock.yaml'),${JSON.stringify(lock)});
 writeFileSync(join(source,'.npmrc'),'store-dir='+join(source,'store')+'\\ncache-dir='+join(source,'cache')+'\\ndevdir='+join(source,'headers')+'\\ndisturl=${endpoint}\\n');
}
if(a.includes('rev-parse'))console.log('fbadd15785464e59747e697c11048bfbc6e4938f');
`,{mode:0o700});
    const clock='const timeout=setTimeout,interval=setInterval;globalThis.setTimeout=(fn,ms,...args)=>timeout(fn,ms===300000?5000:ms,...args);globalThis.setInterval=(fn,ms,...args)=>interval(fn,ms===10000?50:ms,...args);';
    child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(clock),new URL('./conformance.mjs',import.meta.url).pathname,'--only','cadence-conformance.test.mjs'],
      {env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
    const collect=b=>{output+=b;for(const line of output.split('\n').filter(l=>l.startsWith('conformance_setup='))){
      let r;try{r=JSON.parse(line.slice(18));}catch{continue;}
      if(r.phase==='source-install'&&r.event==='start')installer=r.pid;
      if(r.phase==='source-init'&&r.event==='start')scratch=join(r.args.at(-1),'..');
    }};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
    const result=await Promise.race([closed,delay(10000,null,{ref:false})]);
    assert.deepEqual(result,{code:1,signal:null},'the bounded setup must refuse and release its timers');
    assert.equal(archiveRequests,1);assert.equal(headerRequests,1);
    const records=output.split('\n').filter(l=>l.startsWith('conformance_setup=')).map(l=>JSON.parse(l.slice(18))).filter(r=>r.phase==='source-install');
    const summary=records.filter(r=>r.event==='install-progress').at(-1);
    assert.ok(summary);assert.equal(summary.resolved,1);assert.equal(summary.available,1);assert.equal(summary.imported,1);
    assert.equal(summary.pendingDownloadCount,0);assert.equal(summary.pendingImportCount,0);assert.equal(summary.truncated,false);
    const lastMilestone=mode==='headers-stall'?{step:'headers-request'}:{step:'headers-response',httpStatus:mode==='refused'?404:200};
    if(mode==='refused'){
      assert.deepEqual(summary.activeScripts,[]);
      assert.deepEqual(summary.failedScripts,[{packageId:'native-build-probe@1.0.0',stage:'install',exitCode:1,lastMilestone}]);
      assert.ok(records.some(r=>r.event==='failure'&&r.code!==0));
      assert.equal(records.some(r=>r.event==='timeout'),false);
    }else{
      assert.deepEqual(summary.activeScripts,[{packageId:'native-build-probe@1.0.0',stage:'install',lastMilestone}]);
      assert.ok(records.some(r=>r.event==='timeout'&&r.timeoutMs===300000));
      assert.ok(records.some(r=>r.event==='closed'&&r.signal==='SIGKILL'));
      assert.ok(records.some(r=>r.event==='install-progress'&&r.activeScripts.some(s=>s.lastMilestone?.step===lastMilestone.step)&&r!==summary),'emit progress before the final timeout snapshot');
    }
    for(const hidden of [endpoint,'generated-private-refusal','node-gyp rebuild',root])assert.equal(JSON.stringify(summary).includes(hidden),false);
    assert.equal(output.includes('generated-private-refusal'),false);
    assert.throws(()=>process.kill(installer,0),{code:'ESRCH'});assert.equal(existsSync(scratch),false);
  }finally{
    if(installer){try{process.kill(-installer,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e;}}
    if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');if(closed)await closed;
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    if(scratch)rmSync(scratch,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});
  }
});

test('native progress obeys the existing script display bounds without losing the total',()=>{
  const o=createInstallObserver(source);
  for(let n=0;n<30;n++){
    const id='native-builder-'+n+'@1.0.0';send(o,{name:'pnpm:progress',packageId:id,status:'resolved'});
    send(o,{name:'pnpm:lifecycle',depPath:source+'/node_modules/.pnpm/'+id+'/node_modules/native-builder-'+n,stage:'install',line:'gyp info using node-gyp@10.2.0'});
  }
  const s=o.snapshot();assert.equal(s.activeScriptCount,30);assert.equal(s.activeScripts.length,20);assert.equal(s.truncated,true);
  for(const script of s.activeScripts)assert.deepEqual(script.lastMilestone,{step:'node-gyp-start'});
});

test('script cap keeps the truncation receipt after later completions reduce the active set',()=>{
  const o=createInstallObserver(source);
  for(let n=0;n<2048;n++){
    const id='capped-builder-'+n+'@1.0.0';send(o,{name:'pnpm:progress',packageId:id,status:'resolved'});
    send(o,{name:'pnpm:progress',packageId:id,status:'fetched'});
    send(o,{name:'pnpm:progress',status:'imported',to:source+'/node_modules/.pnpm/'+id+'/node_modules/capped-builder-'+n});
    send(o,{name:'pnpm:lifecycle',depPath:source+'/node_modules/.pnpm/'+id+'/node_modules/capped-builder-'+n,stage:'install'});
  }
  send(o,{name:'pnpm:lifecycle',depPath:source+'/node_modules/.pnpm/capped-builder-0@1.0.0/node_modules/capped-builder-0',stage:'install',line:'gyp info spawn make'});
  for(let n=1;n<2048;n++)send(o,{name:'pnpm:lifecycle',depPath:source+'/node_modules/.pnpm/capped-builder-'+n+'@1.0.0/node_modules/capped-builder-'+n,stage:'install',exitCode:0});
  const s=o.snapshot();assert.equal(s.activeScriptCount,1);assert.equal(s.truncated,true);
  assert.deepEqual(s.activeScripts,[{packageId:'capped-builder-0@1.0.0',stage:'install'}]);
});

test('a repeated script failure cannot inherit the earlier attempt milestone',()=>{
  const o=observer();lifecycle(o,'gyp http 404 https://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz');
  send(o,{name:'pnpm:lifecycle',depPath,stage:'install',exitCode:1});
  send(o,{name:'pnpm:lifecycle',depPath,stage:'install',script:'private-second-attempt'});
  send(o,{name:'pnpm:lifecycle',depPath,stage:'install',exitCode:2});
  const s=o.snapshot();assert.equal(s.failedScriptCount,1);
  assert.deepEqual(s.failedScripts,[{packageId:'cpu-features@0.0.10',stage:'install',exitCode:2}]);
});

test('later native output leaves an earlier snapshot unchanged',()=>{
  const o=observer();lifecycle(o,'gyp http GET https://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz');
  const before=o.snapshot();
  lifecycle(o,'gyp http 200 https://private.invalid/v26.11.1/node-v26.11.1-headers.tar.gz');
  assert.deepEqual(before.activeScripts,[{packageId:'cpu-features@0.0.10',stage:'install',lastMilestone:{step:'headers-request'}}]);
  assert.deepEqual(o.snapshot().activeScripts,[{packageId:'cpu-features@0.0.10',stage:'install',lastMilestone:{step:'headers-response',httpStatus:200}}]);
});
