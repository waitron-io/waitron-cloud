import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as checks from './litestream-smoke-test-utils.mjs';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { once } from 'node:events';

test('delayed PUT evidence distinguishes the readiness upload from a later upload', () => {
  assert.equal(typeof checks.createDelayedPutEvidence, 'function');
  let now = 100;
  const evidence = checks.createDelayedPutEvidence({ clock: () => now });
  const earlier = evidence.admit({ method: 'PUT', url: '/private/0001/0000000000000001-0000000000000001.ltx?PRIVATE_CANARY' }, false);
  now = 120;
  const ready = evidence.admit({ method: 'PUT', url: '/private/0000/0000000000000002-0000000000000002.ltx' }, true);
  now = 125; evidence.response(ready); evidence.ready(ready);
  now = 1625; evidence.forward(ready);
  now = 1630;
  const later = evidence.admit({ method: 'PUT', url: '/private/0001/0000000000000002-0000000000000002.ltx' }, true);
  now = 1635; evidence.response(later); evidence.ready(later);
  now = 2125;
  const result = evidence.snapshot(125);
  assert.deepEqual(result, { truncated: false, readinessRecorded: true, puts: [
    { number: 1, level: 1, postSale: false, readiness: false, admittedMs: -25 },
    { number: 2, level: 0, postSale: true, readiness: true, admittedMs: -5, responseMs: 0, forwardedMs: 1500 },
    { number: 3, level: 1, postSale: true, readiness: false, admittedMs: 1505, responseMs: 1510 },
  ] });
  assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false);
  evidence.forward(later); evidence.response(earlier);
  assert.equal(result.puts[2].forwardedMs, undefined, 'a captured failure cannot change during cleanup');
  result.puts[0].number = 999;
  assert.equal(evidence.snapshot(125).puts[0].number, 1);
});

test('delayed PUT evidence bounds storage and reports when readiness falls outside the retained records', () => {
  assert.equal(typeof checks.createDelayedPutEvidence, 'function');
  const evidence = checks.createDelayedPutEvidence({ clock: () => 0 });
  assert.equal(evidence.admit({ method: 'GET', url: '/private' }, true), undefined);
  for (let n = 0; n < 18; n++) {
    const row = evidence.admit({ method: 'PUT', url: '/private/INVALID/PRIVATE_CANARY' }, true);
    evidence.response(row); evidence.forward(row);
    if (n === 17) evidence.ready(row);
  }
  const result = evidence.snapshot(0);
  assert.equal(result.puts.length, 16);
  assert.equal(result.truncated, true);
  assert.equal(result.readinessRecorded, false);
  assert.deepEqual(result.puts.map(row => row.number), [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
  assert.ok(result.puts.every(row => row.level === 'other' && row.readiness === false));
  assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false);
});

const httpSmoke = `let finalPutCommit, finalSaleWritten = false;
  const finalPutCommitted = new Promise(resolve => finalPutCommit = resolve);
  let delayedPutReplies = 0;
  const backend = createServer((req,res) => { req.resume(); req.on('end', () => res.end()); });
  backend.listen(0,'127.0.0.1'); await once(backend,'listening');
  const fault = createServer((req,res) => {
    const postSaleRequest = finalSaleWritten; let requestBytes = 0;
    const upstream = request('http://127.0.0.1:'+backend.address().port, {method:req.method,path:req.url}, incoming => {
      const forward = () => { res.writeHead(incoming.statusCode, incoming.headers); incoming.on('error', () => res.destroy()); incoming.pipe(res); };
      if (req.method === 'PUT' && incoming.statusCode < 300) { delayedPutReplies++; if (postSaleRequest) finalPutCommit(); setTimeout(forward, 1500); } else forward();
    }); upstream.on('error', () => res.destroy()); req.pipe(upstream);
  });
  fault.listen(0,'127.0.0.1'); await once(fault,'listening');
  const endpoint = 'http://127.0.0.1:'+fault.address().port;
  try {
    await fetch(endpoint+'/private/0009/0000000000000001-0000000000000001.ltx', {method:'PUT',body:'one'});
    finalSaleWritten = true;
    const pending = fetch(endpoint+'/private/0000/0000000000000002-0000000000000002.ltx', {method:'PUT',body:'two'});
    await finalPutCommitted;
    const stopStarted = performance.now(), stopElapsed = () => performance.now()-stopStarted;
    let controlMs, exitMs;
    try { if (rejectStop) throw Error('Controlled stop failure'); }
    catch (error) { publish({ timing: { elapsedMs: stopElapsed(), controlMs, exitMs }, }); }
    await pending;
    return delayedPutReplies;
  } finally {
    fault.closeAllConnections(); backend.closeAllConnections();
    await Promise.all([new Promise(resolve=>fault.close(resolve)),new Promise(resolve=>backend.close(resolve))]);
  }`;
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
for (const rejectStop of [true, false]) test(`generated delayed-reply HTTP fixture records only a failed stop: ${rejectStop}`, async () => {
  assert.equal(typeof checks.prepareDelayedLitestreamDiagnostics, 'function');
  const records = [];
  const result = await new AsyncFunction('createServer','request','once','publish','rejectStop',
    checks.prepareDelayedLitestreamDiagnostics(httpSmoke))(createServer,request,once,row=>records.push(row),rejectStop);
  assert.equal(result, 2);
  assert.equal(records.length, rejectStop ? 1 : 0);
  if (!rejectStop) return;
  const evidence = records[0].delayedPutEvidence;
  assert.ok(evidence, 'the failure must include the upload record before cleanup');
  const [earlier, ready] = evidence.puts;
  assert.equal(earlier.level,9); assert.equal(earlier.postSale,false); assert.equal(earlier.readiness,false);
  assert.ok(earlier.admittedMs<earlier.responseMs && earlier.responseMs<earlier.forwardedMs && earlier.forwardedMs<0);
  assert.equal(ready.level,0); assert.equal(ready.postSale,true); assert.equal(ready.readiness,true);
  assert.ok(ready.admittedMs<=ready.responseMs && ready.responseMs<=0);
  assert.equal(ready.forwardedMs, undefined, 'the snapshot precedes release of the held reply');
  assert.equal(JSON.stringify(evidence).includes('private'), false);
});

test('delayed PUT diagnostic preparation refuses changed or repeated integration anchors', () => {
  assert.equal(typeof checks.prepareDelayedLitestreamDiagnostics, 'function');
  const original = readFileSync(new URL('./fixtures/litestream-smoke.mjs', import.meta.url), 'utf8');
  const source = checks.prepareDelayedLitestreamStop(original);
  assert.doesNotThrow(() => checks.prepareDelayedLitestreamDiagnostics(source));
  for (const anchor of ['let finalPutCommit, finalSaleWritten = false;', 'const postSaleRequest = finalSaleWritten;',
    'const forward = () => {', 'if (postSaleRequest) finalPutCommit();', 'timing: { elapsedMs: stopElapsed(), controlMs, exitMs },']) {
    assert.throws(() => checks.prepareDelayedLitestreamDiagnostics(source.replace(anchor, '')));
    assert.throws(() => checks.prepareDelayedLitestreamDiagnostics(source+'\n'+anchor));
  }
});
