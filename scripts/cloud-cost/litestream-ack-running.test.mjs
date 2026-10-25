import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Control HTTP and the allowance ledger are real; the writer's close notification is controlled.
function run(exitAtAcknowledgement) {
  const actual = new URL('./litestream.mjs', import.meta.url).href;
  const fixture = new URL('./fixtures/litestream-smoke.mjs', import.meta.url).href;
  const modules = {
    'node:fs': `export const mkdirSync=()=>{},writeFileSync=()=>{},rmSync=()=>{};
      export const readFileSync=()=>JSON.stringify({config:{},initial:{}});`,
    'node:sqlite': `export class DatabaseSync {prepare(){return {get:()=>({integrity_check:'ok',n:2})};}close(){}}`,
    'node:timers/promises': `export const setTimeout=async()=>{};`,
    'node:module': `class Command{};export const createRequire=()=>()=>({S3Client:class {
      async send(){await globalThis.controlReady;return {Contents:[{Key:'stream/one.ltx',Size:4}]};}destroy(){}},
      CreateBucketCommand:Command,ListObjectsV2Command:Command,DeleteObjectCommand:Command,DeleteBucketCommand:Command});`,
    '/code/cost-waitron-adapter.mjs': `export const openReplay=async()=>({recordSale:async()=>{},
      counts:()=>({attempted:2,successful:2,failed:0}),verify:async()=>({ok:true,issues:0}),close:async()=>{
        const attempt={invocation:'11111111-2222-4333-8444-555555555555',ordinal:0,operation:'put'};
        let newPutAllowed=false;
        try{globalThis.ledger.issue(attempt);globalThis.ledger.admit({...attempt,hop:'producer',phase:'workload'});newPutAllowed=true;}catch{}
        console.error(JSON.stringify({kind:'ack-ledger',newPutAllowed,writerRunning:globalThis.writerRunning,
          closeNotifications:globalThis.closeNotifications,signals:globalThis.signals,restores:globalThis.restores}));
        globalThis.controlServer.closeAllConnections();await new Promise(resolve=>globalThis.controlServer.close(resolve));
      }});`,
    '/code/meter.mjs': `export const createMeter=({afterStop})=>({afterStop,observeAttempt(){},invalidate(){},snapshot:()=>({})});
      export const createMeteringProxy=async()=>({url:'http://127.0.0.1:1',close:async()=>{}});
      export const classifyStorageOperation=()=>{},instrumentStorageClient=()=>{},correlatedStorageAttempt=()=>{};`,
    '/code/litestream.mjs': `import {createLitestreamAfterStop as create} from ${JSON.stringify(actual)};
      export {litestreamAfterStopOutput,withLitestreamCloseDiagnostics} from ${JSON.stringify(actual)};
      export const createLitestreamAfterStop=options=>globalThis.ledger=create(options);
      export const createLitestreamRequestAudit=()=>({write(){},end(){},snapshot:()=>({})});
      export const createLitestreamTransport=async()=>({url:'http://127.0.0.1:1',whenIdle:async action=>action(),
        checkpoint:()=>({pending:0}),snapshot:()=>({}),close:async()=>{}});`,
    'node:http': `const http=process.getBuiltinModule('http');export const createServer=http.createServer;
      export function request(...args){
        if(args[0]?.socketPath){
          const {socketPath,...options}=args[0];args[0]={...options,host:'127.0.0.1',port:globalThis.controlPort};
          const callback=args[1];args[1]=response=>{
            let body='';response.on('data',bytes=>body+=bytes);
            response.prependOnceListener('end',()=>{
              if(${exitAtAcknowledgement})globalThis.closeWriter();
              console.error(JSON.stringify({kind:'ack-response',statusCode:response.statusCode,complete:response.complete,
                reply:JSON.parse(body),writerRunning:globalThis.writerRunning,closeNotifications:globalThis.closeNotifications}));
            });
            callback(response);
          };
        }
        return http.request(...args);
      }`,
    'node:child_process': `import {EventEmitter} from 'node:events';
      export const spawnSync=()=>({stdout:'0.5.17'});
      export function spawn(binary,args){
        const child=new EventEmitter();child.stderr=new EventEmitter();
        if(args[0]==='restore'){globalThis.restores++;child.kill=()=>true;setImmediate(()=>child.emit('close',0));return child;}
        globalThis.writerRunning=true;globalThis.closeNotifications=0;globalThis.signals=[];globalThis.restores=0;
        globalThis.closeWriter=()=>{if(!globalThis.writerRunning)return;globalThis.writerRunning=false;
          globalThis.closeNotifications++;child.emit('close',0);};
        child.kill=signal=>{globalThis.signals.push(signal);globalThis.closeWriter();return true;};
        const http=process.getBuiltinModule('http');
        const server=http.createServer((req,res)=>{let body='';req.on('data',bytes=>body+=bytes);req.on('end',()=>{
          console.error(JSON.stringify({kind:'stop-request',method:req.method,path:req.url,body:JSON.parse(body)}));
          res.end(JSON.stringify({status:'stopped',path:'/state/synthetic-litestream-proof/venue/venue.db',txid:0}));
        });});
        globalThis.controlServer=server;
        globalThis.controlReady=new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{globalThis.controlPort=server.address().port;resolve();}));
        return child;
      }`,
  };
  const code = `import {registerHooks} from 'node:module';const modules=${JSON.stringify(modules)};
    registerHooks({resolve(specifier,context,next){return Object.hasOwn(modules,specifier)
      ? {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true}:next(specifier,context);}});
    await import(${JSON.stringify(fixture)});`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8', timeout: 3000,
    env: { ...process.env, COST_LITESTREAM_TRANSPORT: '1', COST_LITESTREAM_LIFETIMES: '0',
      COST_LITESTREAM_VERSIONS: '0', COST_LITESTREAM_HISTORIES: '0' },
  });
}

// Probe the real ledger's new-PUT permission, so refusal elsewhere cannot hide an acknowledgement.
for (const exited of [true, false]) test(`stop acknowledgement retains the writer-running boundary: exited=${exited}`, () => {
  const result = run(exited);
  assert.equal(result.error, undefined, 'the controlled smoke must collect its HTTP peers before the process deadline');
  assert.equal(result.signal, null);
  const records = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.ok(records.length >= 3, result.stderr);
  assert.deepEqual(records.filter(row => row.kind === 'stop-request'), [{ kind: 'stop-request', method: 'POST', path: '/stop',
    body: { path: '/state/synthetic-litestream-proof/venue/venue.db', timeout: 2 } }], result.stderr);
  assert.deepEqual(records.filter(row => row.kind === 'ack-response'), [{ kind: 'ack-response', statusCode: 200, complete: true,
    reply: { status: 'stopped', path: '/state/synthetic-litestream-proof/venue/venue.db', txid: 0 },
    writerRunning: !exited, closeNotifications: exited ? 1 : 0 }]);
  assert.deepEqual(records.filter(row => row.kind === 'ack-ledger'), [{ kind: 'ack-ledger', newPutAllowed: exited,
    writerRunning: false, closeNotifications: 1, signals: exited ? [] : ['SIGTERM'], restores: exited ? 0 : 1 }]);
  assert.equal(result.status, exited ? 1 : 0, result.stderr);
  if (exited) {
    assert.equal(result.stdout, '');
    assert.equal(records.find(row => row.kind === 'litestream-stop')?.step, 'control');
  } else {
    const output = JSON.parse(result.stdout);
    assert.equal(output.restoredSales, 2); assert.equal(output.integrity, 'ok'); assert.equal(output.afterStop.used, 0);
  }
});
