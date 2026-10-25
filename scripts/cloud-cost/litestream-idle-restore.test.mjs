import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Real HTTP forwarding, meters and audit run with a controlled writer and synthetic venue.
function run(holdReply) {
  const actual = new URL('./litestream.mjs', import.meta.url).href;
  const meter = new URL('./meter.mjs', import.meta.url).href;
  const fixture = new URL('./fixtures/litestream-smoke.mjs', import.meta.url).href;
  const modules = {
    'node:fs': `export const mkdirSync=()=>{},rmSync=()=>{};
      export const writeFileSync=(path,text)=>{const config=JSON.parse(text);if(config.socket)globalThis.writerConfig=config;};
      export const readFileSync=()=>JSON.stringify({config:{},initial:{}});`,
    'node:sqlite': `export class DatabaseSync {prepare(){return {get:()=>({integrity_check:'ok',n:2})};}close(){}}`,
    'node:module': `class Command{};export const createRequire=()=>()=>({S3Client:class {
      async send(){await globalThis.writerReady;return {Contents:[{Key:'stream/one.ltx',Size:4}]};}destroy(){}},
      CreateBucketCommand:Command,ListObjectsV2Command:Command,DeleteObjectCommand:Command,DeleteBucketCommand:Command});`,
    '/code/cost-waitron-adapter.mjs': `export const openReplay=async()=>({recordSale:async()=>{await globalThis.secondSale?.();},
      counts:()=>({attempted:2,successful:2,failed:0}),verify:async()=>({ok:true,issues:0}),close:async()=>{
        globalThis.backend.closeAllConnections();await new Promise(resolve=>globalThis.backend.close(resolve));
        globalThis.control.closeAllConnections();await new Promise(resolve=>globalThis.control.close(resolve));
        await globalThis.upload;
        console.error(JSON.stringify({kind:'collected',writerClosed:globalThis.writerClosed,
          pending:globalThis.transport.checkpoint().pending,connections:globalThis.transport.checkpoint().connections}));
      }});`,
    '/code/meter.mjs': `export {createMeter,createMeteringProxy,classifyStorageOperation,correlatedStorageAttempt} from ${JSON.stringify(meter)};
      export const instrumentStorageClient=()=>{};`,
    '/code/litestream.mjs': `import {createLitestreamTransport as open} from ${JSON.stringify(actual)};
      export * from ${JSON.stringify(actual)};
      export const createLitestreamTransport=async options=>options.phase==='restore'
        ? {url:options.target,whenIdle:async action=>action(),snapshot:()=>({}),close:async()=>{}}
        : globalThis.transport=await open(options);`,
    'node:http': `const http=process.getBuiltinModule('http');export const createServer=http.createServer;
      export function request(...args){
        if(args[0]==='http://127.0.0.1:8333')args[0]='http://127.0.0.1:'+globalThis.backendPort;
        else if(args[0]?.socketPath){const {socketPath,...options}=args[0];args[0]={...options,host:'127.0.0.1',port:globalThis.controlPort};}
        return http.request(...args);
      }`,
    'node:child_process': `import {EventEmitter} from 'node:events';
      export const spawnSync=()=>({stdout:'0.5.17'});
      export function spawn(binary,args){
        const child=new EventEmitter();child.stderr=new EventEmitter();
        if(args[0]==='restore'){
          console.error(JSON.stringify({kind:'restore-admission',writerClosed:globalThis.writerClosed,
            pending:globalThis.transport.checkpoint().pending,replyEnded:globalThis.backendReplyEnded}));
          child.kill=()=>true;setImmediate(()=>child.emit('close',0));return child;
        }
        const http=process.getBuiltinModule('http'),endpoint=globalThis.writerConfig.dbs[0].replica.endpoint;
        const put=(invocation,ordinal)=>{
          const path='/synthetic-litestream/stream/'+invocation+'.ltx';
          child.stderr.emit('data',Buffer.from('SDK 2026/10/25 03:00:00 DEBUG Request\\nPUT '+path+' HTTP/1.1\\r\\nAmz-Sdk-Invocation-Id: '+invocation+'\\r\\nAmz-Sdk-Request: attempt='+ordinal+'; max=3\\r\\n\\r\\n'));
          return new Promise((resolve,reject)=>{
            const req=http.request(endpoint+path,{method:'PUT',headers:{'content-length':'4','amz-sdk-invocation-id':invocation,
              'amz-sdk-request':'attempt='+ordinal+'; max=3'}},res=>{
              res.on('error',reject);res.on('data',()=>globalThis.replyStarted?.());
              res.on('end',()=>resolve(res.statusCode));
            });req.on('error',reject);req.end('four');
          });
        };
        let count=0;globalThis.backend=http.createServer((req,res)=>{req.resume();req.on('end',()=>{
          count++;if(count===2)res.once('finish',()=>globalThis.backendReplyEnded=true);
          res.writeHead(200,{'content-length':'4'});
          if(${holdReply} && count===2){res.write('o');globalThis.finishReply=()=>res.end('kay');}
          else res.end('okay');
        });});
        globalThis.control=http.createServer((req,res)=>{req.resume();req.on('end',()=>{
          res.end(JSON.stringify({status:'stopped',path:'/state/synthetic-litestream-proof/venue/venue.db',txid:0}));
        });});
        globalThis.writerReady=new Promise(resolve=>globalThis.control.listen(0,'127.0.0.1',()=>{
          globalThis.controlPort=globalThis.control.address().port;
          globalThis.backend.listen(0,'127.0.0.1',()=>{globalThis.backendPort=globalThis.backend.address().port;
            resolve(put('11111111-2222-4333-8444-555555555555',1).then(status=>{
              if(status!==503)throw Error('injected retry missing');return put('11111111-2222-4333-8444-555555555555',2);
            }));
          });
        }));
        globalThis.secondSale=async()=>{
          const started=new Promise(resolve=>globalThis.replyStarted=resolve);
          globalThis.upload=put('22222222-2222-4333-8444-555555555555',1);
          await (${holdReply}?started:globalThis.upload);
        };
        child.kill=()=>{if(globalThis.writerClosed)return true;globalThis.writerClosed=true;
          console.error(JSON.stringify({kind:'writer-close',pending:globalThis.transport.checkpoint().pending,
            replyEnded:globalThis.backendReplyEnded===true}));child.emit('close',0);
          if(${holdReply})setTimeout(()=>globalThis.finishReply(),50);return true;};
        return child;
      }`,
  };
  const code = `import {registerHooks} from 'node:module';const modules=${JSON.stringify(modules)};
    registerHooks({resolve(specifier,context,next){return Object.hasOwn(modules,specifier)
      ? {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true}:next(specifier,context);}});
    await import(${JSON.stringify(fixture)});`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8', timeout: 3000,
    env: { ...process.env, COST_LITESTREAM_TRANSPORT: '1', COST_LITESTREAM_LIFETIMES: '0',
      COST_LITESTREAM_VERSIONS: '0', COST_LITESTREAM_HISTORIES: '0' } });
}

// Removing the smoke's passive idle wait must expose restore while a real transfer is pending.
for (const held of [true, false]) test(`final smoke restore waits for the reply after writer close: held=${held}`, () => {
  const result = run(held);
  assert.equal(result.error, undefined, 'collect the smoke before its subprocess deadline');
  assert.equal(result.signal, null);
  const records = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.deepEqual(records.filter(row => row.kind === 'writer-close'),
    [{ kind: 'writer-close', pending: held ? 1 : 0, replyEnded: !held }]);
  assert.deepEqual(records.filter(row => row.kind === 'restore-admission'),
    [{ kind: 'restore-admission', writerClosed: true, pending: 0, replyEnded: true }]);
  assert.deepEqual(records.filter(row => row.kind === 'collected'),
    [{ kind: 'collected', writerClosed: true, pending: 0, connections: 0 }]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.restoredSales, 2);
  assert.equal(output.integrity, 'ok');
  assert.equal(output.observed.accounting.producer.attempts, 3);
  assert.equal(output.observed.accounting.observer.attempts, 3);
  assert.equal(output.afterStop.used, held ? 1 : 0);
  assert.equal(output.afterStop.bodiesReconciled, true);
  assert.deepEqual(output.afterStop.producer, { attempts: held ? 1 : 0, bytesIn: held ? 4 : 0, bytesOut: held ? 4 : 0 });
  assert.deepEqual(output.afterStop.observer, { attempts: held ? 1 : 0, bytesIn: held ? 4 : 0, bytesOut: held ? 4 : 0 });
});
