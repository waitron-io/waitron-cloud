import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Run the actual smoke sequencing, after-stop tracker and close reporter with controlled workload, audit, meter and transport boundaries.
// Omitting a result phase or discarding its rejection must lose the diagnostic asserted below.
function run(failure, shape = '', meterFailure = '') {
  const fault = `function check(step) {
    if (process.env.RESULT_FAILURE !== step) return;
    const error = new RangeError('Synthetic result failure: ' + step);
    error.stack = 'RangeError: Synthetic result failure: ' + step + '\\n    at syntheticResultBoundary (synthetic-result.mjs:1:1)';
    if (process.env.RESULT_ERROR === 'stack-getter') Object.defineProperty(error, 'stack', { get() { throw Error('unreadable stack'); } });
    if (process.env.RESULT_ERROR === 'bigint-message') error.message = 10n;
    if (process.env.RESULT_ERROR === 'string') throw 'Synthetic thrown value';
    if (process.env.RESULT_ERROR === 'null') throw null;
    throw error;
  }`;
  const actual = new URL('./litestream.mjs', import.meta.url).href;
  const fixture = new URL('./fixtures/litestream-smoke.mjs', import.meta.url).href;
  const actualMeter = new URL('./meter.mjs', import.meta.url).href;
  const modules = {
    'node:fs': `export const mkdirSync=()=>{},writeFileSync=()=>{},rmSync=()=>{};
      export const readFileSync=()=>JSON.stringify({config:{},initial:{}});`,
    'node:child_process': `import {EventEmitter} from 'node:events';
      export const spawnSync=()=>({stdout:'0.5.17'});
      export function spawn(binary,args){ const child=new EventEmitter(); child.stderr=new EventEmitter();
        child.kill=()=>{child.server?.close(()=>{});setImmediate(()=>child.emit('close',0));return true;};
        if(args[0]==='replicate'){
          const http=process.getBuiltinModule('http');child.server=http.createServer((req,res)=>{req.resume();req.on('end',()=>res.end(JSON.stringify({status:'stopped',path:'/state/synthetic-litestream-proof/venue/venue.db',txid:0})));});
          child.server.listen('/tmp/d141-result-'+process.pid+'.sock');
        }
        if(args[0]==='restore')setImmediate(()=>child.emit('close',0));return child; }`,
    'node:http': `const http=process.getBuiltinModule('http');export const createServer=http.createServer;
      export const request=(options,...args)=>http.request(options?.socketPath?{...options,socketPath:'/tmp/d141-result-'+process.pid+'.sock'}:options,...args);`,
    'node:sqlite': `export class DatabaseSync {prepare(){return {get:()=>({integrity_check:'ok',n:2})};}close(){}}`,
    'node:module': `class Command{}; export const createRequire=()=>()=>({S3Client:class {async send(){return {Contents:[{Key:'stream/one.ltx',Size:1024}]};}destroy(){}},
      CreateBucketCommand:Command,ListObjectsV2Command:Command,DeleteObjectCommand:Command,DeleteBucketCommand:Command});`,
    '/code/cost-waitron-adapter.mjs': `${fault} export const openReplay=async()=>({recordSale:async()=>{},counts:()=>{check('result-counts');return {attempted:2,successful:2,failed:0};},
      verify:async()=>{check('replay-verification');return {ok:true,issues:0};},close:async()=>{}});`,
    '/code/litestream.mjs': `${fault} import {createLitestreamAfterStop as openAfterStop} from ${JSON.stringify(actual)};
      export const createLitestreamAfterStop=options=>{const session=openAfterStop(options);return {...session,snapshot:()=>{check('after-stop-snapshot');return session.snapshot();}};};
      export {litestreamAfterStopOutput,withLitestreamCloseDiagnostics} from ${JSON.stringify(actual)};
      export const createLitestreamRequestAudit=({phase})=>({write(){},end(){},snapshot:()=>{check(phase==='workload'?'replication-audit-snapshot':'restore-audit-snapshot');return {};}});
      export const createLitestreamTransport=async({phase})=>({url:'http://127.0.0.1:1',checkpoint:()=>({pending:0}),snapshot:()=>{check(phase==='workload'?'replication-transport-snapshot':'restore-transport-snapshot');return {};},
        whenIdle:async action=>action(),close:async()=>{}});`,
    '/code/meter.mjs': `${fault} export const createMeter=({phase})=>({phase,snapshot:()=>{if(phase==='workload')check('replication-meter-snapshot');return {};}});
      export const createMeteringProxy=async()=>({url:'http://127.0.0.1:1',snapshot:()=>({}),close:async()=>{}});
      export const classifyStorageOperation=()=>{},instrumentStorageClient=()=>{},correlatedStorageAttempt=()=>{};`,
  };
  if (meterFailure) modules['/code/meter.mjs'] = `import {createMeter as create} from ${JSON.stringify(actualMeter)};
    export const createMeter=({phase})=>{
      let time=0;const meter=create({phase,clock:()=>time});
      if(phase!=='workload')return meter;
      if(process.env.METER_FAILURE==='pending-attempts')meter.beginAttempt('PRIVATE_ATTEMPT');
      if(process.env.METER_FAILURE==='explicit')meter.invalidate('PRIVATE_PAYLOAD');
      if(process.env.METER_FAILURE==='clock')time=-1;
      if(process.env.METER_FAILURE==='observe-attempt')try{meter.observeAttempt({secret:'PRIVATE_PAYLOAD'});}catch{}
      if(process.env.METER_FAILURE==='unreadable'){
        meter.invalidate();return {...meter,diagnostics(){throw Error('PRIVATE_DIAGNOSTIC_FAILURE');}};
      }
      return meter;
    };
    export const createMeteringProxy=async()=>({url:'http://127.0.0.1:1',close:async()=>{}});
    export const classifyStorageOperation=()=>{},instrumentStorageClient=()=>{},correlatedStorageAttempt=()=>{};`;
  const code = `import {registerHooks} from 'node:module';
    const modules=${JSON.stringify(modules)};
    registerHooks({resolve(specifier,context,next){
      if(Object.hasOwn(modules,specifier))return {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true};
      return next(specifier,context);}});
    await import(${JSON.stringify(fixture)});`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    env: { ...process.env, COST_LITESTREAM_TRANSPORT: '1', COST_LITESTREAM_LIFETIMES: '0',
      COST_LITESTREAM_VERSIONS: '0', COST_LITESTREAM_HISTORIES: '0', RESULT_FAILURE: failure, RESULT_ERROR: shape, METER_FAILURE: meterFailure },
    encoding: 'utf8', timeout: 5000,
  });
}

const steps = ['result-counts', 'replay-verification', 'replication-audit-snapshot', 'restore-audit-snapshot',
  'replication-meter-snapshot', 'after-stop-snapshot', 'replication-transport-snapshot', 'restore-transport-snapshot'];

for (const step of steps) test(`the smoke identifies ${step} after successful closes and keeps the original error`, () => {
  const result = run(step);
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 1, result.stderr); assert.equal(result.stdout, '');
  const records = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const diagnostic = records.find(row => row.kind === 'litestream-result');
  assert.deepEqual(diagnostic, { kind: 'litestream-result', stage: step, error: {
    name: 'RangeError', message: 'Synthetic result failure: ' + step,
    stack: 'RangeError: Synthetic result failure: ' + step + '\n    at syntheticResultBoundary (synthetic-result.mjs:1:1)',
  } }, result.stderr);
  assert.match(result.stderr, new RegExp('Synthetic Litestream phase: ' + step));
  for (const stage of ['replication-transport', 'restore-transport', 'cleanup-replication-transport',
    'cleanup-restore-transport', 'cleanup-replication-proxy', 'cleanup-restore-proxy', 'cleanup-admin-proxy']) {
    assert.equal(records.filter(row => row.stage === stage && row.status === 'fulfilled').length, 1, stage);
  }
});

// Dropping meter diagnostics from the actual result catch must hide these independently triggered guards.
for (const [failure, expected] of [
  ['pending-attempts', { firstInvalidation: null, snapshotRefusal: 'pending-attempts', pendingAttempts: 1 }],
  ['explicit', { firstInvalidation: 'explicit', snapshotRefusal: 'invalidated', pendingAttempts: 0 }],
  ['observe-attempt', { firstInvalidation: 'observe-attempt', snapshotRefusal: 'invalidated', pendingAttempts: 0 }],
  ['clock', { firstInvalidation: null, snapshotRefusal: 'clock', pendingAttempts: 0 }],
  ['unreadable', undefined],
]) test(`the actual smoke retains the meter refusal and cleanup for ${failure}`, () => {
  const result = run('', '', failure);
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  const records = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const diagnostic = records.find(row => row.kind === 'litestream-result');
  assert.equal(diagnostic.stage, 'replication-meter-snapshot');
  assert.equal(diagnostic.error.message, 'Invalid cloud cost meter');
  assert.deepEqual(diagnostic.meter, expected, result.stderr);
  assert.doesNotMatch(result.stderr, /PRIVATE/);
  for (const stage of ['cleanup-replication-transport', 'cleanup-restore-transport', 'cleanup-replication-proxy',
    'cleanup-restore-proxy', 'cleanup-admin-proxy'])
    assert.equal(records.filter(row => row.stage === stage && row.status === 'fulfilled').length, 1, stage);
});

test('successful smoke results keep their counts and snapshots without an error diagnostic', () => {
  const result = run('');
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /litestream-result|Synthetic Litestream phase/);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.sales, { attempted: 2, successful: 2, failed: 0 });
  assert.deepEqual(output.fiscal, { ok: true, issues: 0 });
  assert.equal(output.restoredSales, 2); assert.equal(output.integrity, 'ok');
  assert.deepEqual(output.replication, {}); assert.deepEqual(output.restore, {});
  assert.deepEqual(output.observed, {}); assert.deepEqual(output.transport, { replication: {}, restore: {} });
});

for (const [shape, expected] of [
  ['stack-getter', { name: 'RangeError', message: 'Synthetic result failure: replay-verification' }],
  ['bigint-message', { name: 'RangeError', message: '10',
    stack: 'RangeError: Synthetic result failure: replay-verification\n    at syntheticResultBoundary (synthetic-result.mjs:1:1)' }],
  ['string', { name: 'string', message: 'Synthetic thrown value' }],
  ['null', { name: 'null', message: 'null' }],
]) test(`the smoke keeps readable result error fields for ${shape}`, () => {
  const result = run('replay-verification', shape);
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 1, result.stderr); assert.equal(result.stdout, '');
  const records = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.deepEqual(records.find(row => row.kind === 'litestream-result'), {
    kind: 'litestream-result', stage: 'replay-verification', error: expected,
  }, result.stderr);
  assert.equal(records.filter(row => row.stage === 'cleanup-admin-proxy' && row.status === 'fulfilled').length, 1);
  assert.match(result.stderr, /Synthetic Litestream phase: replay-verification/);
});
