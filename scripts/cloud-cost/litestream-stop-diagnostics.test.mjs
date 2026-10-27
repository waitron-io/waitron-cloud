import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createLitestreamRequestAudit } from './litestream.mjs';

// Dropping child exit details or the audit's first failure must make these smoke records incomplete.
// Only the external workload, native process and storage are replaced; the smoke and audit are real.
function run(failure) {
  const actual = new URL('./litestream.mjs', import.meta.url).href;
  const fixture = new URL('./fixtures/litestream-smoke.mjs', import.meta.url).href;
  const modules = {
    'node:fs': `export const mkdirSync=()=>{},writeFileSync=()=>{},rmSync=()=>{};
      export const readFileSync=()=>JSON.stringify({config:{},initial:{}});`,
    'node:child_process': `import {EventEmitter} from 'node:events';
      export const spawnSync=()=>({stdout:'0.5.17'});
      export function spawn(binary,args){ const child=new EventEmitter(); child.stderr=new EventEmitter();
        let killed=false;child.kill=()=>{if(killed)return true;killed=true;child.server?.close(()=>{});setImmediate(()=>{
          if(process.env.STOP_FAILURE==='audit'||process.env.STOP_FAILURE==='both')child.stderr.emit('data',Buffer.from('SDK 2026/10/27 03:00:00 DEBUG Request\\nPUT /PRIVATE_CANARY/key HTTP/1.1\\r\\nnot-a-header\\r\\n'));
          child.emit('close',process.env.STOP_FAILURE==='exit'||process.env.STOP_FAILURE==='both'?7:process.env.STOP_FAILURE==='signal'?null:0,
            process.env.STOP_FAILURE==='signal'?'SIGKILL':null);
        });return true;};
        if(args[0]==='replicate'){
          const http=process.getBuiltinModule('http');child.server=http.createServer((req,res)=>{req.resume();req.on('end',()=>res.end(JSON.stringify({status:'stopped',path:'/state/synthetic-litestream-proof/venue/venue.db',txid:0})));});
          child.server.listen('/tmp/d325-stop-'+process.pid+'.sock');
        }
        if(args[0]==='restore')setImmediate(()=>child.emit('close',0));return child; }`,
    'node:http': `const http=process.getBuiltinModule('http');export const createServer=http.createServer;
      export const request=(options,...args)=>http.request(options?.socketPath?{...options,socketPath:'/tmp/d325-stop-'+process.pid+'.sock'}:options,...args);`,
    'node:sqlite': `export class DatabaseSync {prepare(){return {get:()=>({integrity_check:'ok',n:2})};}close(){}}`,
    'node:module': `class Command{}; export const createRequire=()=>()=>({S3Client:class {async send(){return {Contents:[{Key:'stream/one.ltx',Size:1024}]};}destroy(){}},
      CreateBucketCommand:Command,ListObjectsV2Command:Command,DeleteObjectCommand:Command,DeleteBucketCommand:Command});`,
    '/code/cost-waitron-adapter.mjs': `export const openReplay=async()=>({recordSale:async()=>{},counts:()=>({attempted:2,successful:2,failed:0}),
      verify:async()=>({ok:true,issues:0}),close:async()=>{}});`,
    '/code/litestream.mjs': `export {createLitestreamAfterStop,litestreamAfterStopOutput,withLitestreamCloseDiagnostics,createLitestreamRequestAudit} from ${JSON.stringify(actual)};
      export const createLitestreamTransport=async()=>({url:'http://127.0.0.1:1',checkpoint:()=>({pending:0}),snapshot:()=>({}),whenIdle:async action=>{if(process.env.STOP_FAILURE==='stack-getter'){
        const error=Error('Synthetic Litestream check failed');Object.defineProperty(error,'stack',{get(){throw Error('PRIVATE_CANARY');}});throw error;
      }return action();},close:async()=>{}});`,
    '/code/meter.mjs': `export const createMeter=({phase})=>({phase,snapshot:()=>({})});
      export const createMeteringProxy=async()=>({url:'http://127.0.0.1:1',snapshot:()=>({}),close:async()=>{}});
      export const classifyStorageOperation=()=>{},instrumentStorageClient=()=>{},correlatedStorageAttempt=()=>{};`,
  };
  const code = `import {registerHooks} from 'node:module';
    const modules=${JSON.stringify(modules)};
    registerHooks({resolve(specifier,context,next){
      if(Object.hasOwn(modules,specifier))return {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true};
      return next(specifier,context);}});
    await import(${JSON.stringify(fixture)});`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    env: { ...process.env, COST_LITESTREAM_TRANSPORT: '1', COST_LITESTREAM_LIFETIMES: '0',
      COST_LITESTREAM_VERSIONS: '0', COST_LITESTREAM_HISTORIES: '0', STOP_FAILURE: failure },
    encoding: 'utf8', timeout: 5000,
  });
}

for (const [failure, code, signal, invalid] of [['exit',7,null,false],['signal',null,'SIGKILL',false],['audit',0,null,true],['both',7,null,true]]) {
  test(`the stop exit refusal identifies its child and audit outcome: ${failure}`, () => {
    const result=run(failure);
    assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,1,result.stderr);
    assert.equal(result.stdout,'');
    const records=result.stderr.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
    const record=records.find(row=>row.kind==='litestream-stop');
    assert.equal(record.step,'exit');
    assert.deepEqual(record.process,{code,signal,invalid});
    assert.ok(record.audit,'retain audit evidence at the stop refusal');
    assert.equal(record.audit.invalid,invalid);
    assert.equal(record.audit.producerAttempts,0);assert.equal(record.audit.observerAttempts,0);
    if(invalid)assert.equal(record.audit.failure.stage,'request-header');
    else assert.equal(record.audit.failure,undefined);
    assert.equal(record.error.name,'Error');assert.equal(record.error.message,'Synthetic Litestream check failed');
    assert.match(record.error.stack,/Synthetic Litestream check failed/);
    assert.doesNotMatch(result.stderr,/PRIVATE_CANARY/);
    assert.ok(records.some(row=>row.stage==='cleanup-admin-proxy'&&row.status==='fulfilled'));
  });
}

test('a successful child stop emits no rejection and preserves the smoke result',()=>{
  const result=run('');assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(result.stderr,/litestream-stop/);assert.equal(JSON.parse(result.stdout).restoredSales,2);
});

// A generic poisoned flag cannot distinguish malformed request syntax from incomplete producer output.
for (const [text,stage,end] of [
  ['SDK now DEBUG Request\nSDK now DEBUG Request\n','request-start',false],
  ['SDK now DEBUG Request\nBAD /PRIVATE_CANARY HTTP/1.1\n','request-operation',false],
  ['SDK now DEBUG Request\nPUT /PRIVATE_CANARY/key HTTP/1.1\nnot-a-header\n','request-header',false],
  ['SDK now DEBUG Request\nPUT /PRIVATE_CANARY/key HTTP/1.1\n\n','request-identity',false],
  ['SDK now DEBUG Request\nPUT /PRIVATE_CANARY/key HTTP/1.1\n','end',true],
])test(`the audit retains the first rejected validation stage: ${stage}`,()=>{
  const audit=createLitestreamRequestAudit({phase:'workload'});
  assert.throws(()=>{audit.write(Buffer.from(text));if(end)audit.end();},/Invalid cloud cost Litestream audit/);
  assert.throws(()=>audit.observe({headers:{},operation:'put'}));
  assert.equal(typeof audit.checkpoint,'function','a poisoned audit must retain diagnostic evidence');
  const diagnostic=audit.checkpoint();
  assert.equal(diagnostic.invalid,true);assert.equal(diagnostic.failure.stage,stage);
  assert.equal(diagnostic.producerAttempts,0);assert.equal(diagnostic.observerAttempts,0);
  assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_CANARY/);
  assert.throws(()=>audit.snapshot(),/Invalid cloud cost Litestream audit/);
});

test('an unreadable stop error stack cannot discard its readable reason or cleanup',()=>{
  const result=run('stack-getter');assert.equal(result.error,undefined);assert.equal(result.status,1,result.stderr);
  const records=result.stderr.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
  const record=records.find(row=>row.kind==='litestream-stop');
  assert.ok(record,'report the original stop refusal even when its stack is unreadable');
  assert.equal(record.error.message,'Synthetic Litestream check failed');assert.equal(record.error.stack,undefined);
  assert.doesNotMatch(result.stderr,/PRIVATE_CANARY/);
  assert.ok(records.some(row=>row.stage==='cleanup-admin-proxy'&&row.status==='fulfilled'));
});

test('an oversized unfinished log line names the buffer limit instead of the preceding request start',()=>{
  const audit=createLitestreamRequestAudit({phase:'workload'});
  assert.throws(()=>audit.write(Buffer.from('SDK now DEBUG Request\n'+'x'.repeat(65537))));
  assert.equal(audit.checkpoint().failure.stage,'buffer-size');
  assert.throws(()=>audit.snapshot());
});
