import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function shutdownWriter(options, url) {
  const { request, createServer } = process.getBuiltinModule('http');
  const headers = { 'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555',
    'amz-sdk-request': 'attempt=1; max=3', 'content-length': '100' };
  let upload;
  process.once('message', () => {
    upload = request(url + '/synthetic/key', { method: 'PUT', headers }, response => {
      response.on('error', () => {}); response.resume();
    });
    upload.on('error', () => {}); upload.end('x'.repeat(100));
  });
  let acknowledged = false;
  const server = createServer((request, response) => {
    let body = ''; request.on('data', bytes => body += bytes);
    request.on('end', () => {
      const input = JSON.parse(body);
      if (request.method !== 'POST' || request.url !== '/stop' || input.path !== '/state/synthetic-litestream-proof/venue/venue.db'
        || input.timeout !== 2 || Object.keys(input).length !== 2) { response.writeHead(400); response.end(); return; }
      if (options.ack === 'missing') return;
      if (options.ack === 'early-exit') { process.exit(0); return; }
      const result = { status: 'stopped', path: input.path, txid: 0 };
      if (options.ack === 'already') result.status = 'already_stopped';
      if (options.ack === 'wrong-path') result.path = 'PRIVATE_CANARY';
      if (options.ack === 'extra') result.private = 'PRIVATE_CANARY';
      if (options.ack === 'negative') result.txid = -1;
      setTimeout(() => {
        response.writeHead(options.ack === 'status' ? 503 : 200);
        response.end(options.ack === 'oversized' ? 'x'.repeat(1025) : options.ack === 'malformed' ? 'PRIVATE_CANARY' : JSON.stringify(result));
        acknowledged = true;
      }, options.controlDelay);
    });
  });
  if (options.ack !== 'exit-held-reply') server.listen(process.env.STOP_TEST_SOCKET);
  process.on('message', message => { if (message === 'exit-held-reply') process.exit(0); });
  const alive = setInterval(() => {}, 1000), deadline = setTimeout(() => process.exit(2), 2500);
  process.on('SIGTERM', () => {
    if (options.requireControl && !acknowledged) { process.stderr.write('CONTROL_BEFORE_SIGNAL_REQUIRED'); process.exit(3); }
    setTimeout(() => {
      const finish = () => { clearInterval(alive); clearTimeout(deadline); server.close(() => {}); process.disconnect(); process.exitCode = 0; };
      if (options.reply) { if (upload.closed) finish(); else upload.once('close', finish); }
      else { upload.destroy(); finish(); }
    }, options.exitDelay);
  });
}

// Cancelling the native writer after commit can still cut off its unacknowledged PUT.
function run({ reply, ack = 'valid', controlDelay = 0, exitDelay = 0, requireControl = false, finalSales = 2 }) {
  const root = mkdtempSync(join(tmpdir(), 'd152-stop-'));
  const options = { ack, controlDelay, exitDelay, requireControl, finalSales, reply };
  const actual = new URL('./litestream.mjs', import.meta.url).href;
  const fixture = new URL('./fixtures/litestream-smoke.mjs', import.meta.url).href;
  const modules = {
    'node:fs': `export const mkdirSync=()=>{},writeFileSync=()=>{},rmSync=()=>{};
      export const readFileSync=()=>JSON.stringify({config:{},initial:{}});`,
    'node:http': `const http=process.getBuiltinModule('http');export const createServer=http.createServer;
      export const request=(...args)=>{const isControl=Boolean(args[0]?.socketPath);if(isControl){args[0]={...args[0],socketPath:process.env.STOP_TEST_SOCKET};
        if(${reply})setTimeout(()=>globalThis.shutdownFixture.reply(),75);}
        const control = http.request(...args);
        if (isControl && ${JSON.stringify(ack === 'exit-held-reply')}) globalThis.heldStopControl = control;
        return control;};`,
    'node:timers/promises': `export const setTimeout=async ms=>{if(ms!==1000)await process.getBuiltinModule('timers/promises').setTimeout(ms);};`,
    'node:sqlite': `export class DatabaseSync {prepare(){return {get:()=>({integrity_check:'ok',n:globalThis.writerEnded?${finalSales}:2})};}close(){}}`,
    'node:module': `class Command{}; export const createRequire=()=>()=>({S3Client:class {
      async send(){return {Contents:[{Key:'stream/one.ltx',Size:100}]};}destroy(){}},
      CreateBucketCommand:Command,ListObjectsV2Command:Command,DeleteObjectCommand:Command,DeleteBucketCommand:Command});`,
    '/code/cost-waitron-adapter.mjs': `export const openReplay=async()=>({recordSale:async()=>{
      if(globalThis.writerChild){globalThis.writerChild.send('sale');await globalThis.shutdownFixture.stored;}
    },counts:()=>({attempted:2,successful:2,failed:0}),
      verify:async()=>({ok:true,issues:0}),close:async()=>{}});`,
    '/code/meter.mjs': `export const createMeter=()=>({observeAttempt(){},invalidate(){},snapshot:()=>({})});
      export const createMeteringProxy=async()=>({url:'http://127.0.0.1:1',close:async()=>{}});
      export const classifyStorageOperation=()=>{},instrumentStorageClient=()=>{},correlatedStorageAttempt=()=>{};`,
    '/code/litestream.mjs': `import {createServer} from 'node:http';import {once} from 'node:events';
      import {createLitestreamTransport as open} from ${JSON.stringify(actual)};
      export {createLitestreamAfterStop,litestreamAfterStopOutput,withLitestreamCloseDiagnostics} from ${JSON.stringify(actual)};
      export const createLitestreamRequestAudit=()=>({write(){},end(){},snapshot:()=>({})});
      export const createLitestreamTransport=async({phase,meter,afterStop})=>{
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
          const code='('+${JSON.stringify(shutdownWriter.toString())}+')('+JSON.stringify(${JSON.stringify(options)})+','+JSON.stringify(state.url)+')';
          const child=process.getBuiltinModule('child_process').spawn(process.execPath,['--input-type=module','--eval',code],{stdio:['ignore','ignore','pipe','ipc']});
          globalThis.writerChild=child;child.once('close',()=>globalThis.writerEnded=true);
          if (${JSON.stringify(ack === 'exit-held-reply')}) {
            // The parent holds the reply open so socket closure cannot stand in for the writer-exit race.
            const http=process.getBuiltinModule('http');
            const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>child.send('exit-held-reply'));});
            server.listen(process.env.STOP_TEST_SOCKET);
            child.once('close',(code,signal)=>setImmediate(()=>{
              console.error(JSON.stringify({kind:'held-stop-at-writer-exit',code,signal,cancelled:globalThis.heldStopControl?.destroyed===true}));
              server.closeAllConnections();server.close(()=>{});
            }));
          }
          return child;
        }
        const child=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>true;
        state.stored.then(()=>{if(${reply})setTimeout(()=>state.reply(),75);setImmediate(()=>child.emit('close',0));});
        return child;
      }`,
  };
  const code = `import {registerHooks} from 'node:module';const modules=${JSON.stringify(modules)};
    registerHooks({resolve(specifier,context,next){if(Object.hasOwn(modules,specifier))
      return {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true};return next(specifier,context);}});
    await import(${JSON.stringify(fixture)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    env: { ...process.env, COST_LITESTREAM_TRANSPORT: '1', COST_LITESTREAM_LIFETIMES: '0',
      COST_LITESTREAM_VERSIONS: '0', COST_LITESTREAM_HISTORIES: '0', STOP_TEST_SOCKET: join(root,'control.sock') }, encoding: 'utf8', timeout: 3000, detached: true,
  });
  // The detached group belongs only to this harness and its writer, including a timed-out run.
  if (result.pid > 0) {
    try { process.kill(-result.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  rmSync(root, { recursive: true, force: true });
  return result;
}

test('the smoke waits for the committed PUT reply and writer exit before final restore', () => {
  const result = run({ reply: true });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /"stage":"replication-transport","status":"fulfilled"/);
});

test('a silent storage backend refuses at the bounded stop step', () => {
  const result = run({ reply: false });
  assert.equal(result.error, undefined, 'the smoke must refuse before the outer process deadline');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Synthetic Litestream phase: stop/);
  assert.doesNotMatch(result.stderr, /"stage":"replication-transport","status":"fulfilled"/);
});

// A stop that signals first or accepts a bad reply must not certify this real child.
test('the smoke validates official socket acknowledgement before signalling the writer', () => {
  const result = run({ reply: true, requireControl: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
});
for (const ack of ['missing', 'already', 'wrong-path', 'extra', 'negative', 'status', 'oversized', 'malformed', 'early-exit']) {
  test(`the smoke refuses an invalid runtime stop acknowledgement: ${ack}`, () => {
    const result = run({ reply: true, ack });
    assert.equal(result.error, undefined, 'the internal stop deadline must finish before 3000ms');
    assert.equal(result.status, 1, result.stderr); assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes('PRIVATE_CANARY'), false);
  });
}
test('control and child exit share the original two-second stop budget', () => {
  const result = run({ reply: true, controlDelay: 1100, exitDelay: 1100 });
  assert.equal(result.error, undefined); assert.equal(result.status, 1, result.stderr);
});
test('the final restore refuses lost sales after the writer stops', () => {
  const result = run({ reply: true, finalSales: 1 });
  assert.equal(result.error, undefined); assert.equal(result.status, 1, result.stderr);
});

// Exported smoke evidence must stay closed even if a future producer adds private fields.
const stream = await import('./litestream.mjs');
const emptyLedger = () => ({ cap: 3, used: 0, lateAdmissions: 0, lateSettlements: 0, requests: [],
  producer: { attempts: 0, bytesIn: 0, bytesOut: 0 }, observer: { attempts: 0, bytesIn: 0, bytesOut: 0 },
  requestsReconciled: true, bodiesReconciled: true, status: 'measured', gaps: [] });
const incompleteLedger = () => ({ ...emptyLedger(), used: 1, lateSettlements: 1, bodiesReconciled: false, status: 'unknown',
  producer: { attempts: 1, bytesIn: 2, bytesOut: 0 }, observer: { attempts: 1, bytesIn: 8, bytesOut: 0 },
  requests: [
    { hop: 'producer', phase: 'workload', operation: 'list', retryOrdinal: 0, outcome: 'transport-error', attempts: 1,
      bytesIn: 2, bytesOut: 0, attemptedBytesIn: 8, attemptedBytesOut: 0 },
    { hop: 'observer', phase: 'workload', operation: 'list', retryOrdinal: 0, outcome: 'success', attempts: 1,
      bytesIn: 8, bytesOut: 0, attemptedBytesIn: 8, attemptedBytesOut: 0 },
  ], gaps: ['after-stop:list-response-interrupted', 'after-stop:body-bytes-unpaired'] });
test('empty after-stop output keeps exact accounting without a cost caveat', () => {
  assert.deepEqual(stream.litestreamAfterStopOutput(emptyLedger()), { afterStop: emptyLedger() });
});
test('incomplete after-stop output retains both byte observations and the cost caveat', () => {
  const result = stream.litestreamAfterStopOutput(incompleteLedger());
  assert.deepEqual(result, { afterStop: incompleteLedger(), costAccuracy: { status: 'incomplete', reason: 'after-stop',
    message: 'Cost may be a few requests short after stop.' } });
});
for (const [name, mutate] of [
  ['unknown private field', x => x.path = 'PRIVATE_CANARY'],
  ['private request field', x => x.requests[0].invocation = 'PRIVATE_CANARY'],
  ['unpaired count', x => x.observer.attempts = 0],
  ['erased observed bytes', x => x.producer.bytesIn = 0],
  ['fourth distinct request', x => { x.used = 4; x.lateSettlements = 4; x.producer.attempts = 4; x.observer.attempts = 4;
    x.requests[0].attempts = 4; x.requests[1].attempts = 4; }],
  ['unknown reason', x => x.gaps.push('PRIVATE_CANARY')],
  ['false precision', x => x.status = 'measured'],
  ['false body equality', x => { x.bodiesReconciled = true; x.status = 'measured'; x.gaps = ['after-stop:list-response-interrupted']; }],
  ['unclassified interruption', x => x.gaps = []],
  ['fresh write', x => x.requests[0].operation = 'delete'],
  ['retry', x => x.requests[0].retryOrdinal = 1],
]) test(`smoke after-stop output refuses ${name}`, () => {
  const value = incompleteLedger(); mutate(value);
  assert.throws(() => stream.litestreamAfterStopOutput(value), /Invalid cloud cost Litestream audit/);
});

test('the smoke captures a still-busy stop before cleanup erases its pending count', () => {
  const result = run({ reply: false });assert.equal(result.error, undefined);assert.equal(result.status, 1);
  const records = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const stop = records.find(row => row.kind === 'litestream-stop');
  assert.equal(stop?.step, 'idle');assert.equal(stop.diagnostic.pending, 1);
  assert.equal(records.findIndex(row => row.kind === 'litestream-stop') < records.findIndex(row => row.stage === 'cleanup-replication-transport'), true);
});

test('empty after-stop output refuses a manufactured evidence gap', () => {
  const input = { ...emptyLedger(), bodiesReconciled: false, status: 'unknown', gaps: ['after-stop:body-bytes-unpaired'] };
  assert.throws(() => stream.litestreamAfterStopOutput(input), /Invalid cloud cost Litestream audit/);
});
test('after-stop output cannot pair different operations under equal request totals', () => {
  const input = incompleteLedger();input.requests[1].operation = 'put';
  assert.throws(() => stream.litestreamAfterStopOutput(input), /Invalid cloud cost Litestream audit/);
});
test('an interrupted list must retain its late-settlement count', () => {
  const input = incompleteLedger();input.lateSettlements = 0;input.lateAdmissions = 1;
  assert.throws(() => stream.litestreamAfterStopOutput(input), /Invalid cloud cost Litestream audit/);
});

// A dead writer cannot leave its separately hosted control request waiting for the stop timeout.
test('writer exit cancels a pending stop request before the next event-loop turn', () => {
  const result = run({ reply: true, ack: 'exit-held-reply' });
  assert.equal(result.error, undefined, 'the smoke must collect the writer and its pending control');
  assert.equal(result.signal, null);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  const records = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.deepEqual(records.filter(row => row.kind === 'held-stop-at-writer-exit'),
    [{ kind: 'held-stop-at-writer-exit', code: 0, signal: null, cancelled: true }]);
  assert.equal(records.find(row => row.kind === 'litestream-stop')?.step, 'control');
  assert.doesNotMatch(result.stderr, /Synthetic Litestream phase: restore/);
});
