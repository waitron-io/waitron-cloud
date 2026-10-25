import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// The real smoke, audit, counters and forwarding proxy run against a local HTTP store.
// Only the external venue, SDK administration, SQLite reader and native process are substituted.
function run({ backendStatus = 200, versionId = null, transport = '1', holdInitialReply = false, holdRetry = false, incomplete = null } = {}) {
  const actual = new URL('./litestream.mjs', import.meta.url).href;
  const meter = new URL('./meter.mjs', import.meta.url).href;
  const fixture = new URL('./fixtures/litestream-smoke.mjs', import.meta.url).href;
  const modules = {
    'node:fs': `export const mkdirSync=()=>{},rmSync=()=>{};
      export const writeFileSync=(path,text)=>{const config=JSON.parse(text);if(config.socket)globalThis.nativeConfig=config;};
      export const readFileSync=()=>JSON.stringify({config:{},initial:{}});`,
    'node:sqlite': `export class DatabaseSync {prepare(){return {get:()=>({integrity_check:'ok',n:globalThis.closedWriter?2:0})};}close(){}}`,
    'node:module': `class Command{};export const createRequire=()=>()=>({S3Client:class {
      async send(){if(globalThis.writerReady)await (globalThis.retryWaiting??globalThis.initialReplyHeld??globalThis.writerReady);return {Contents:[{Key:'stream/one.ltx',Size:4}]};}destroy(){}},
      CreateBucketCommand:Command,ListObjectsV2Command:Command,DeleteObjectCommand:Command,DeleteBucketCommand:Command});`,
    '/code/cost-waitron-adapter.mjs': `export const openReplay=async()=>({recordSale:async()=>{if(globalThis.secondSale)await globalThis.secondSale();},
      counts:()=>({attempted:2,successful:2,failed:0}),verify:async()=>({ok:true,issues:0}),close:async()=>{}});`,
    '/code/meter.mjs': `export {createMeter,createMeteringProxy,classifyStorageOperation,correlatedStorageAttempt} from ${JSON.stringify(meter)};
      export const instrumentStorageClient=()=>{};`,
    '/code/litestream.mjs': `import {createLitestreamTransport as open} from ${JSON.stringify(actual)};
      export * from ${JSON.stringify(actual)};
      export const createLitestreamTransport=async options=>options.phase==='restore'
        ? {url:options.target,whenIdle:async action=>action(),snapshot:()=>({}),close:async()=>{}}:open(options);`,
    'node:http': `const http=process.getBuiltinModule('http');let firstServer=true;
      export function createServer(listener){
        if(!firstServer)return http.createServer(listener);firstServer=false;
        return http.createServer((req,res)=>{
          if(req.headers['amz-sdk-invocation-id']==='22222222-2222-4333-8444-555555555555')globalThis.commitRequest=req;
          listener(req,res);
        });
      }
      export function request(...args){
        if(args[0]==='http://127.0.0.1:8333'){
          args[0]='http://127.0.0.1:'+globalThis.backendPort;
          const callback=args[2];args[2]=incoming=>{
            if(args[1].headers['amz-sdk-invocation-id']==='22222222-2222-4333-8444-555555555555'){
              globalThis.releaseBackend=()=>{
                if(${incomplete !== null})incoming.prependOnceListener('end',()=>{
                  const req=globalThis.commitRequest;
                  if(${JSON.stringify(incomplete)}==='request')req.complete=false;
                  if(${JSON.stringify(incomplete)}==='response')incoming.complete=false;
                  console.error(JSON.stringify({kind:'commit-completeness',requestComplete:req.complete,responseComplete:incoming.complete}));
                });
                callback(incoming);
                // Restore the parser observations after the smoke's commit listener has read them.
                if(${incomplete !== null})incoming.once('end',()=>{globalThis.commitRequest.complete=true;incoming.complete=true;});
              };globalThis.secondCommitted();
            }else if(${holdInitialReply} && args[1].headers['amz-sdk-invocation-id']==='11111111-2222-4333-8444-555555555555'){
              globalThis.initialStored();setTimeout(()=>callback(incoming),50);
            }else callback(incoming);
          };
        }else if(args[0]?.socketPath)args[0]={...args[0],socketPath:'/tmp/d152-commit-'+process.pid+'.sock'};
        return http.request(...args);
      }`,
    'node:child_process': `import {EventEmitter} from 'node:events';
      export const spawnSync=()=>({stdout:'0.5.17'});
      export function spawn(binary,args){
        const child=new EventEmitter();child.stderr=new EventEmitter();
        if(args[0]==='restore'){child.kill=()=>true;setImmediate(()=>child.emit('close',0));return child;}
        const http=process.getBuiltinModule('http'),endpoint=globalThis.nativeConfig.dbs[0].replica.endpoint;
        let active=Promise.resolve();let requests=0;
        const put=async(invocation,ordinal)=>{
          const path='/synthetic-litestream/stream/'+invocation+'.ltx';
          const headers={'content-length':'4','amz-sdk-invocation-id':invocation,'amz-sdk-request':'attempt='+ordinal+'; max=3'};
          child.stderr.emit('data',Buffer.from('SDK 2026/10/25 03:00:00 DEBUG Request\\nPUT '+path+' HTTP/1.1\\r\\nAmz-Sdk-Invocation-Id: '+invocation+'\\r\\nAmz-Sdk-Request: attempt='+ordinal+'; max=3\\r\\n\\r\\n'));
          return new Promise((resolve,reject)=>{const req=http.request(endpoint+path,{method:'PUT',headers},res=>{
            res.on('error',reject);res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('four');});
        };
        const socket=http.createServer((req,res)=>{req.resume();req.on('end',()=>{
          res.end(JSON.stringify({status:'stopped',path:'/state/synthetic-litestream-proof/venue/venue.db',txid:0}));
          setTimeout(()=>globalThis.releaseBackend?.(),25);
        });});socket.listen('/tmp/d152-commit-'+process.pid+'.sock');
        const backend=http.createServer((req,res)=>{req.resume();req.on('end',()=>{requests++;
          res.writeHead(requests===2?${backendStatus}:200,${versionId === null ? '{}' : JSON.stringify({ 'x-amz-version-id': versionId })});res.end();});});
        backend.listen(0,'127.0.0.1',()=>{
          globalThis.backendPort=backend.address().port;
          active=put('11111111-2222-4333-8444-555555555555',1).then(async status=>{
            if(status!==503)throw Error('missing injected retry');
            if(${holdRetry}){globalThis.retryBackoff();await new Promise(resolve=>setTimeout(resolve,100));}
            await put('11111111-2222-4333-8444-555555555555',2);globalThis.retryComplete=true;
          });
          active.then(()=>globalThis.initialReplyComplete=true);ready(active);
        });
        let ready;globalThis.writerReady=new Promise(resolve=>ready=resolve);
        if(${holdInitialReply})globalThis.initialReplyHeld=new Promise(resolve=>globalThis.initialStored=resolve);
        if(${holdRetry})globalThis.retryWaiting=new Promise(resolve=>globalThis.retryBackoff=resolve);
        globalThis.secondSale=async()=>{let committed;const wait=new Promise(resolve=>committed=resolve);globalThis.secondCommitted=committed;
          if(${holdInitialReply} && !globalThis.initialReplyComplete)throw Error('INITIAL_REPLY_PENDING');
          if(${holdRetry} && !globalThis.retryComplete)throw Error('RETRY_STILL_WAITING');
          active=put('22222222-2222-4333-8444-555555555555',1);active.catch(()=>{});await wait;};
        let stopping=false;child.kill=()=>{if(stopping)return true;stopping=true;
          active.catch(()=>{}).then(()=>{globalThis.closedWriter=true;socket.close(()=>{});backend.closeAllConnections();backend.close(()=>{});child.emit('close',0);});return true;};
        return child;
      }`,
  };
  const code = `import {registerHooks} from 'node:module';const modules=${JSON.stringify(modules)};
    registerHooks({resolve(specifier,context,next){return Object.hasOwn(modules,specifier)
      ? {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true}:next(specifier,context);}});
    await import(${JSON.stringify(fixture)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8', timeout: 3000,
    env: { ...process.env, COST_LITESTREAM_TRANSPORT: transport, COST_LITESTREAM_LIFETIMES: '0', COST_LITESTREAM_VERSIONS: '0', COST_LITESTREAM_HISTORIES: '0' } });
  return result;
}

test('the smoke counts a prior PUT only after its real backend commit acknowledgement', () => {
  const result = run();assert.equal(result.error, undefined);assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.afterStop?.used, 1);
  assert.equal(output.afterStop.lateAdmissions, 0);assert.equal(output.afterStop.lateSettlements, 1);
  assert.deepEqual(output.afterStop.producer, { attempts: 1, bytesIn: 0, bytesOut: 4 });
  assert.deepEqual(output.afterStop.observer, { attempts: 1, bytesIn: 0, bytesOut: 4 });
  assert.equal(output.afterStop.bodiesReconciled, true);
  assert.deepEqual(output.costAccuracy, { status: 'incomplete', reason: 'after-stop', message: 'Cost may be a few requests short after stop.' });
  assert.equal(output.observed.accounting.producer.attempts, 3);assert.equal(output.observed.accounting.observer.attempts, 3);
  assert.equal(output.injectedFailures, 1);assert.equal(output.restoredSales, 2);assert.equal(output.integrity, 'ok');
});
test('a failed backend response cannot certify an underway after-stop PUT', () => {
  const result = run({ backendStatus: 503 });assert.equal(result.error, undefined);assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
});

test('the basic smoke also measures both hops for its after-stop allowance', () => {
  const result = run({ transport: '0' });assert.equal(result.error, undefined);assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);assert.equal(output.afterStop.used, 1);
  assert.deepEqual(output.afterStop.producer, { attempts: 1, bytesIn: 0, bytesOut: 4 });
  assert.deepEqual(output.afterStop.observer, { attempts: 1, bytesIn: 0, bytesOut: 4 });
  assert.equal(output.costAccuracy.status, 'incomplete');
});

test('initial upload readiness waits for its reply even when the stored object is visible', () => {
  const result = run({ holdInitialReply: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.restoredSales, 2); assert.equal(output.injectedFailures, 1);
});

test('initial readiness waits for the injected upload retry across an idle backoff gap', () => {
  const result = run({ holdRetry: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.restoredSales, 2); assert.equal(output.injectedFailures, 1);
  assert.ok(output.replication.requests.some(r => r.operation === 'put' && r.retryOrdinal === 1));
});

// Equal byte counts and a 200 reply cannot replace either HTTP completeness observation.
for (const incomplete of ['request', 'response']) test(`the smoke refuses an incomplete ${incomplete} in its backend commit witness`, () => {
  const result = run({ incomplete });
  assert.equal(result.error, undefined, 'the refusal must finish inside the process deadline');
  const records = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.deepEqual(records.filter(row => row.kind === 'commit-completeness'), [{ kind: 'commit-completeness',
    requestComplete: incomplete !== 'request', responseComplete: incomplete !== 'response' }]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /Synthetic Litestream phase: restore/);
});
