import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function writerProcess() {
  const http = process.getBuiltinModule('http');
  let endpoint, held;
  const put = (invocation, ordinal, reportStart = false) => {
    const path = '/synthetic-litestream/stream/' + invocation + '.ltx';
    process.stderr.write('SDK 2026/10/25 03:00:00 DEBUG Request\nPUT ' + path + ' HTTP/1.1\r\nAmz-Sdk-Invocation-Id: ' + invocation + '\r\nAmz-Sdk-Request: attempt=' + ordinal + '; max=3\r\n\r\n');
    return new Promise((resolve, reject) => {
      const req = http.request(endpoint + path, { method: 'PUT', headers: {
        'content-length': '4', 'amz-sdk-invocation-id': invocation,
        'amz-sdk-request': 'attempt=' + ordinal + '; max=3' } }, res => {
        res.on('error', reject);
        res.once('data', () => { if (reportStart && held) process.send('second-started'); });
        res.on('end', () => { if (reportStart && !held) process.send('second-started'); resolve(res.statusCode); });
      });
      req.on('error', reject); req.end('four');
    });
  };
  process.on('SIGTERM', () => process.exit(0));
  process.on('disconnect', () => process.exit(1));
  process.on('message', async message => {
    try {
      if (message.kind === 'init') {
        endpoint = message.endpoint; held = message.held;
        if (await put('11111111-2222-4333-8444-555555555555', 1) !== 503) throw Error('injected retry missing');
        if (await put('11111111-2222-4333-8444-555555555555', 2) !== 200) throw Error('initial upload refused');
        process.send('initial-ready');
      } else if (message.kind === 'sale') {
        await put('22222222-2222-4333-8444-555555555555', 1, true);
      }
    } catch (error) { process.stderr.write(String(error)); process.exit(1); }
  });
}

// Real HTTP forwarding, meters and audit run with a generated writer and synthetic venue.
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
      export const createLitestreamTransport=async options=>{
        if(options.phase==='restore')return {url:options.target,whenIdle:async action=>action(),snapshot:()=>({}),close:async()=>{}};
        const transport=await open(options);
        return globalThis.transport={...transport,whenIdle:action=>{
          console.error(JSON.stringify({kind:'idle-admission',writerClosed:globalThis.writerClosed,pending:transport.checkpoint().pending}));
          return transport.whenIdle(action);
        }};
      };`,
    'node:http': `const http=process.getBuiltinModule('http');export const createServer=http.createServer;
      export function request(...args){
        if(args[0]==='http://127.0.0.1:8333')args[0]='http://127.0.0.1:'+globalThis.backendPort;
        else if(args[0]?.socketPath){const {socketPath,...options}=args[0];args[0]={...options,host:'127.0.0.1',port:globalThis.controlPort};}
        return http.request(...args);
      }`,
    'node:child_process': `import {EventEmitter} from 'node:events';
      export const spawnSync=()=>({stdout:'0.5.17'});
      export function spawn(binary,args){
        if(args[0]==='restore'){
          const child=new EventEmitter();child.stderr=new EventEmitter();
          console.error(JSON.stringify({kind:'restore-admission',writerClosed:globalThis.writerClosed,
            pending:globalThis.transport.checkpoint().pending,replyEnded:globalThis.backendReplyEnded===true}));
          child.kill=()=>true;setImmediate(()=>child.emit('close',0));return child;
        }
        const http=process.getBuiltinModule('http');
        const child=process.getBuiltinModule('child_process').spawn(process.execPath,['--eval',${JSON.stringify('('+writerProcess.toString()+')()')}],
          {stdio:['ignore','ignore','pipe','ipc']});
        const kill=child.kill.bind(child);
        child.kill=signal=>{
          console.error(JSON.stringify({kind:'writer-signal',signal,pending:globalThis.transport.checkpoint().pending,
            replyEnded:globalThis.backendReplyEnded===true}));return kill(signal);
        };
        globalThis.upload=new Promise(resolve=>child.prependOnceListener('close',(code,signal)=>{
          globalThis.writerClosed=true;
          console.error(JSON.stringify({kind:'real-writer-close',pid:child.pid,code,signal}));resolve();
        }));
        let count=0;globalThis.backend=http.createServer((req,res)=>{req.resume();req.on('end',()=>{
          count++;if(count===2)res.once('finish',()=>globalThis.backendReplyEnded=true);
          res.writeHead(200,{'content-length':'4'});
          if(${holdReply} && count===2)res.write('o');else res.end('okay');
        });});
        globalThis.control=http.createServer((req,res)=>{req.resume();req.on('end',()=>{
          res.end(JSON.stringify({status:'stopped',path:'/state/synthetic-litestream-proof/venue/venue.db',txid:0}));
        });});
        globalThis.writerReady=new Promise(resolve=>{
          child.on('message',message=>{if(message==='initial-ready')resolve();if(message==='second-started')globalThis.secondStarted();});
          globalThis.control.listen(0,'127.0.0.1',()=>{
            globalThis.controlPort=globalThis.control.address().port;
            globalThis.backend.listen(0,'127.0.0.1',()=>{
              globalThis.backendPort=globalThis.backend.address().port;
              child.send({kind:'init',endpoint:globalThis.writerConfig.dbs[0].replica.endpoint,held:${holdReply}});
            });
          });
        });
        globalThis.secondSale=()=>new Promise(resolve=>{globalThis.secondStarted=resolve;child.send({kind:'sale'});});
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

// Omitting the smoke idle wait must expose restore before the unfinished reply settles.
for (const held of [true, false]) test(`real writer exit before final smoke restore: held=${held}`, () => {
  const result = run(held);
  assert.equal(result.error, undefined, 'collect the smoke and writer inside the subprocess deadline');
  assert.equal(result.signal, null);
  const records = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const closed = records.filter(row => row.kind === 'real-writer-close');
  assert.equal(closed.length, 1, result.stderr);
  assert.equal(closed[0].code, 0);
  assert.equal(closed[0].signal, null);
  for (const idle of records.filter(row => row.kind === 'idle-admission')) {
    assert.equal(idle.writerClosed, true, 'the actual writer must close before the transport idle wait');
  }
  assert.deepEqual(records.filter(row => row.kind === 'writer-signal'),
    [{ kind: 'writer-signal', signal: 'SIGTERM', pending: held ? 1 : 0, replyEnded: !held }]);
  assert.ok(Number.isSafeInteger(closed[0].pid) && closed[0].pid > 0);
  assert.deepEqual(records.filter(row => row.kind === 'collected'),
    [{ kind: 'collected', writerClosed: true, pending: 0, connections: 0 }]);
  if (held) {
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '', 'an interrupted writer cannot publish measurement');
    assert.equal(records.some(row => row.kind === 'restore-admission'), false, result.stderr);
    const stop = records.find(row => row.kind === 'litestream-stop');
    assert.equal(stop?.step, 'idle', result.stderr);
    assert.ok(stop.beforeSignal, 'retain the transport state before signalling the writer');
    assert.equal(stop.beforeSignal.pending, 1, 'retain active transfers before the real writer closes');
    assert.equal(stop.beforeSignal.truncated, false);
    assert.equal(stop.beforeSignal.transfers.length, 1);
    const transfer = stop.beforeSignal.transfers[0];
    assert.equal(transfer.operation, 'put');
    assert.equal(transfer.phase, 'workload');
    assert.equal(transfer.retryOrdinal, 0);
    assert.equal(transfer.bytesIn, 1);
    assert.equal(transfer.expectedIn, 4);
    assert.equal(transfer.bytesOut, 4);
    assert.equal(transfer.expectedOut, 4);
    assert.equal(transfer.requestSent, true);
    assert.equal(transfer.responseReceived, false);
    assert.equal(transfer.statusCode, 200);
    assert.equal(transfer.clientClosed, false);
    assert.ok(Number.isInteger(transfer.elapsedMs) && transfer.elapsedMs >= 0);
    assert.equal(stop.diagnostic.clientClosed, true, result.stderr);
    assert.equal(stop.diagnostic.responseHeadersSeen, true, result.stderr);
    assert.deepEqual(stop.diagnostic.accounting.producer, { attempts: 3, bytesIn: 5, bytesOut: 12 });
    assert.deepEqual(stop.diagnostic.accounting.observer, { attempts: 3, bytesIn: 5, bytesOut: 12 });
    assert.equal(stop.diagnostic.pending, 0);
    assert.equal(stop.diagnostic.completed, 3);
  } else {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(records.filter(row => row.kind === 'restore-admission'),
      [{ kind: 'restore-admission', writerClosed: true, pending: 0, replyEnded: true }]);
    const output = JSON.parse(result.stdout);
    assert.equal(output.restoredSales, 2);
    assert.equal(output.integrity, 'ok');
    assert.deepEqual(output.observed.accounting.producer, { attempts: 3, bytesIn: 8, bytesOut: 12 });
    assert.deepEqual(output.observed.accounting.observer, { attempts: 3, bytesIn: 8, bytesOut: 12 });
    assert.deepEqual(output.observed.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
    assert.equal(output.afterStop.used, 0);
    assert.equal(output.afterStop.bodiesReconciled, true);
  }
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event|uncaughtException/);
});
