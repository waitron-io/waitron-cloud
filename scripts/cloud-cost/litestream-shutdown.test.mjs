import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Cancelling the native writer after commit can still cut off its unacknowledged PUT.
test('the smoke waits for a committed PUT reply before stopping its writer', () => {
  const actual = new URL('./litestream.mjs', import.meta.url).href;
  const fixture = new URL('./fixtures/litestream-smoke.mjs', import.meta.url).href;
  const modules = {
    'node:fs': `export const mkdirSync=()=>{},writeFileSync=()=>{},rmSync=()=>{};
      export const readFileSync=()=>JSON.stringify({config:{},initial:{}});`,
    'node:sqlite': `export class DatabaseSync {prepare(){return {get:()=>({integrity_check:'ok',n:2})};}close(){}}`,
    'node:module': `class Command{}; export const createRequire=()=>()=>({S3Client:class {
      async send(){return {Contents:[{Key:'stream/one.ltx',Size:100}]};}destroy(){}},
      CreateBucketCommand:Command,ListObjectsV2Command:Command,DeleteObjectCommand:Command,DeleteBucketCommand:Command});`,
    '/code/cost-waitron-adapter.mjs': `export const openReplay=async()=>({recordSale:async()=>{},counts:()=>({attempted:2,successful:2,failed:0}),
      verify:async()=>({ok:true,issues:0}),close:async()=>{}});`,
    '/code/meter.mjs': `export const createMeter=()=>({observeAttempt(){},invalidate(){},snapshot:()=>({})});
      export const createMeteringProxy=async()=>({url:'http://127.0.0.1:1',close:async()=>{}});
      export const classifyStorageOperation=()=>{},instrumentStorageClient=()=>{},correlatedStorageAttempt=()=>{};`,
    '/code/litestream.mjs': `import {createServer} from 'node:http';import {once} from 'node:events';
      import {createLitestreamTransport as open} from ${JSON.stringify(actual)};
      export {createLitestreamRequestAudit,withLitestreamCloseDiagnostics} from ${JSON.stringify(actual)};
      export const createLitestreamTransport=async({phase,meter})=>{
        if(phase==='restore')return {url:'http://127.0.0.1:1',whenIdle:async action=>action(),close:async()=>{},snapshot:()=>({})};
        let committed,reply;const stored=new Promise(resolve=>committed=resolve);
        const server=createServer((req,res)=>{req.resume();req.on('end',()=>{reply=()=>res.end();committed();});});
        server.listen(0,'127.0.0.1');await once(server,'listening');
        const front=await open({target:'http://127.0.0.1:'+server.address().port,meter,phase});
        globalThis.shutdownFixture={stored,reply:()=>reply(),url:front.url};
        return {...front,close:async()=>{try{await front.close();}finally{
          server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}};
      };`,
    'node:child_process': `import {EventEmitter} from 'node:events';
      export const spawnSync=()=>({stdout:'0.5.17'});
      export function spawn(binary,args){const state=globalThis.shutdownFixture;
        if(args[0]==='replicate'){
          const code="import {request} from 'node:http';const headers={'amz-sdk-invocation-id':'11111111-2222-4333-8444-555555555555','amz-sdk-request':'attempt=1; max=3','content-length':'100'};const req=request("+JSON.stringify(state.url+"/synthetic/key")+",{method:'PUT',headers},res=>{res.on('error',()=>{});res.resume();});req.on('error',()=>{});process.on('SIGTERM',()=>{req.destroy();process.exitCode=0;});req.end('x'.repeat(100));setInterval(()=>{},10000).unref();";
          return process.getBuiltinModule('child_process').spawn(process.execPath,['--input-type=module','--eval',code],{stdio:['ignore','ignore','pipe']});
        }
        const child=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>true;
        state.stored.then(()=>{setTimeout(()=>state.reply(),75);setImmediate(()=>child.emit('close',0));});
        return child;
      }`,
  };
  const code = `import {registerHooks} from 'node:module';const modules=${JSON.stringify(modules)};
    registerHooks({resolve(specifier,context,next){if(Object.hasOwn(modules,specifier))
      return {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true};return next(specifier,context);}});
    await import(${JSON.stringify(fixture)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    env: { ...process.env, COST_LITESTREAM_TRANSPORT: '1', COST_LITESTREAM_LIFETIMES: '0',
      COST_LITESTREAM_VERSIONS: '0', COST_LITESTREAM_HISTORIES: '0' }, encoding: 'utf8', timeout: 3000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /"stage":"replication-transport","status":"fulfilled"/);
});
