import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Run the actual fixture with unavailable external workload dependencies replaced at module boundaries.
// Removing any wrapper in the fixture must lose its corresponding close record here.
function run(failure) {
  const actual = new URL('./litestream.mjs', import.meta.url).href;
  const fixture = new URL('./fixtures/litestream-smoke.mjs', import.meta.url).href;
  const modules = {
    'node:fs': `export const mkdirSync=()=>{},writeFileSync=()=>{},rmSync=()=>{};
      export const readFileSync=()=>JSON.stringify({config:{},initial:{}});`,
    'node:child_process': `import {EventEmitter} from 'node:events';
      export const spawnSync=()=>({stdout:'0.5.17'});
      export function spawn(binary,args){ const child=new EventEmitter(); child.stderr=new EventEmitter();
        child.kill=()=>{child.server?.close(()=>{});setImmediate(()=>child.emit('close',0));return true;};
        if(args[0]==='replicate'){
          const http=process.getBuiltinModule('http');child.server=http.createServer((req,res)=>{req.resume();req.on('end',()=>res.end(JSON.stringify({status:'stopped',path:'/state/synthetic-litestream-proof/venue/venue.db',txid:0})));});
          child.server.listen('/tmp/d152-diagnostics-'+process.pid+'.sock');
        }
        if(args[0]==='restore')setImmediate(()=>child.emit('close',0));return child; }`,
    'node:http': `const http=process.getBuiltinModule('http');export const createServer=http.createServer;
      export const request=(options,...args)=>http.request(options?.socketPath?{...options,socketPath:'/tmp/d152-diagnostics-'+process.pid+'.sock'}:options,...args);`,
    'node:sqlite': `export class DatabaseSync {prepare(){return {get:()=>({integrity_check:'ok',n:2})};}close(){}}`,
    'node:module': `class Command{}; export const createRequire=()=>()=>({S3Client:class {async send(){return {Contents:[{Key:'stream/one.ltx',Size:1024}]};}destroy(){}},
      CreateBucketCommand:Command,ListObjectsV2Command:Command,DeleteObjectCommand:Command,DeleteBucketCommand:Command});`,
    '/code/cost-waitron-adapter.mjs': `export const openReplay=async()=>({recordSale:async()=>{},counts:()=>({attempted:2,successful:2,failed:0}),
      verify:async()=>({ok:true,issues:0}),close:async()=>{}});`,
    '/code/litestream.mjs': `export {createLitestreamAfterStop,litestreamAfterStopOutput,withLitestreamCloseDiagnostics} from ${JSON.stringify(actual)};
      export const createLitestreamRequestAudit=()=>({write(){},end(){},snapshot:()=>({})});
      export const createLitestreamTransport=async({phase})=>({url:'http://127.0.0.1:1',checkpoint:()=>({pending:0}),snapshot:()=>({}),whenIdle:async action=>action(),
        close:async()=>{if(process.env.CLOSE_FAILURE===(phase==='workload'?'replication-transport':'restore-transport'))throw Error('PRIVATE_CANARY');}});`,
    '/code/meter.mjs': `export const createMeter=({phase})=>({phase,snapshot:()=>({})});
      export const createMeteringProxy=async({meter})=>({url:'http://127.0.0.1:1',snapshot:()=>({}),close:async()=>{
        if(process.env.CLOSE_FAILURE==='cleanup-admin-proxy' && meter.phase==='observer')throw Error('PRIVATE_CANARY');}});
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
      COST_LITESTREAM_VERSIONS: '0', COST_LITESTREAM_HISTORIES: '0', CLOSE_FAILURE: failure },
    encoding: 'utf8', timeout: 5000,
  });
}

for (const failure of ['', 'replication-transport', 'restore-transport', 'cleanup-admin-proxy']) {
  test(`the smoke fixture reports its actual main and cleanup closes: ${failure || 'success'}`, () => {
    const result = run(failure);
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    assert.equal(result.status, failure ? 1 : 0, result.stderr);
    assert.equal(result.stderr.includes('PRIVATE_CANARY'), false);
    const records = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    const stages = ['replication-transport', ...(failure==='replication-transport'?[]:['restore-transport']),
      'cleanup-replication-transport', 'cleanup-restore-transport', 'cleanup-replication-proxy', 'cleanup-restore-proxy', 'cleanup-admin-proxy'];
    for (const stage of stages) {
      assert.equal(records.filter(r => r.stage === stage && r.status === 'started').length, 1, stage);
      const rejected = stage === failure || stage === 'cleanup-'+failure;
      assert.equal(records.filter(r => r.stage === stage && r.status === (rejected?'rejected':'fulfilled')).length, 1, stage);
    }
    if (!failure) assert.equal(JSON.parse(result.stdout).restoredSales, 2);
    else if (failure!=='cleanup-admin-proxy') assert.ok(result.stderr.includes('Synthetic Litestream phase: '+failure+'-close'));
  });
}
