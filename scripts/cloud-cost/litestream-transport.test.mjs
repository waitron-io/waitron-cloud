import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import * as stream from './litestream.mjs';
import { createMeter, createMeteringProxy, classifyStorageOperation } from './meter.mjs';

const id = '11111111-2222-4333-8444-555555555555';
const headers = (invocation = id, attempt = 1) => ({ 'amz-sdk-invocation-id': invocation,
  'amz-sdk-request': `attempt=${attempt}; max=3` });
async function server(t, handler) {
  const s = createServer(handler); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  t.after(() => { s.closeAllConnections(); return new Promise(resolve => s.close(resolve)); });
  return `http://127.0.0.1:${s.address().port}`;
}
async function send(url, { method = 'PUT', path = '/bucket/PRIVATE_CANARY', body = '', ...options } = {}) {
  return new Promise((resolve, reject) => {
    const r = request(url, { method, path, ...options }, async response => {
      try { let bytes = 0; for await (const chunk of response) bytes += chunk.length; resolve({ code: response.statusCode, bytes }); }
      catch { reject(Error('Synthetic response interrupted')); }
    });
    r.on('error', () => reject(Error('Synthetic request failed'))); r.end(body);
  });
}
async function transport(t, target, meter, phase = 'workload') {
  assert.equal(typeof stream.createLitestreamTransport, 'function', 'independently measure the binary transport body bytes');
  const front = await stream.createLitestreamTransport({ target, meter, phase });
  t.after(() => front.close().catch(() => {})); return front;
}

// Freezing the initial phase would silently price idle or restore traffic as sales traffic.
test('litestreamTransportChangesPhaseWithoutResettingInvocationRetryOrdinals', async t => {
  const target = await server(t, (req, res) => { req.resume(); req.on('end', () => res.end('ok')); });
  const meter = createMeter({ phase: 'startup', clock: () => 0 });
  const front = await transport(t, target, meter, 'startup');
  assert.equal(typeof front.setPhase, 'function', 'label every admitted attempt with the active measurement phase');
  await send(front.url, { headers: headers() });
  front.setPhase('idle');
  await send(front.url, { headers: headers(id, 2) });
  front.setPhase('restore');
  await send(front.url, { method: 'GET', headers: headers('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') });
  await front.close();
  assert.deepEqual(meter.snapshot().accounting.requests.map(r => [r.phase, r.operation, r.retryOrdinal, r.attempts]),
    [['startup', 'put', 0, 1], ['idle', 'put', 1, 1], ['restore', 'get', 0, 1]]);
  assert.throws(() => front.setPhase('cleanup'), /Invalid cloud cost Litestream audit/);
});

// Relabelling a live request would make the independently observed phase disagree.
test('litestreamTransportRefusesPhaseChangesUntilEveryTransferSettles', async t => {
  let arrived, release;
  const pending = new Promise(resolve => { arrived = resolve; });
  const target = await server(t, (req, res) => {
    req.resume(); req.on('end', () => { release = () => res.end('ok'); arrived(); });
  });
  const meter = createMeter({ phase: 'startup', clock: () => 0 });
  const front = await transport(t, target, meter, 'startup');
  assert.equal(typeof front.setPhase, 'function');
  const sent = send(front.url, { headers: headers() });
  await pending;
  assert.throws(() => front.setPhase('idle'), /Invalid cloud cost Litestream audit/);
  release(); await sent;
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

test('litestreamTransportRefusesUnknownMeasurementPhases', async t => {
  const target = await server(t, (req, res) => { req.resume(); res.end(); });
  const meter = createMeter({ phase: 'startup', clock: () => 0 });
  const front = await transport(t, target, meter, 'startup');
  assert.equal(typeof front.setPhase, 'function');
  assert.throws(() => front.setPhase('PRIVATE_CANARY'), /Invalid cloud cost Litestream audit/);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

// Skipping failed/retried bodies or reading HEAD's object size as body bytes changes these literal totals.
test('litestreamTransportIndependentlyReconcilesBodiesRetriesHeadAndRangeReads', async t => {
  const target = await server(t, (req, res) => {
    req.resume(); req.on('end', () => {
      if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': 98765 }); res.end(); }
      else if (req.method === 'GET') { res.writeHead(206, { 'content-length': 3 }); res.end('xyz'); }
      else if (req.headers['amz-sdk-request'].startsWith('attempt=1;')) { res.writeHead(503); res.end('retry'); }
      else { res.writeHead(200, { 'content-length': 2 }); res.end('ok'); }
    });
  });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const audit = stream.createLitestreamRequestAudit({ phase: 'workload' });
  const observer = await createMeteringProxy({ target, meter,
    classify: input => audit.observe({ headers: input.headers, operation: classifyStorageOperation(input) }) });
  t.after(() => observer.close());
  const front = await transport(t, observer.url, meter);
  assert.deepEqual(await send(front.url, { headers: headers(), body: 'hello' }), { code: 503, bytes: 5 });
  assert.deepEqual(await send(front.url, { headers: headers(id, 2), body: 'hello' }), { code: 200, bytes: 2 });
  const headId = '22222222-2222-4333-8444-555555555555', getId = '33333333-2222-4333-8444-555555555555';
  assert.deepEqual(await send(front.url, { method: 'HEAD', headers: headers(headId) }), { code: 200, bytes: 0 });
  assert.deepEqual(await send(front.url, { method: 'GET', headers: { ...headers(getId), range: 'bytes=1-3' } }), { code: 206, bytes: 3 });
  await front.close();
  const result = meter.snapshot();
  assert.equal(result.reconciled, true);
  assert.deepEqual(result.accounting.producer, { attempts: 4, bytesIn: 10, bytesOut: 10 });
  assert.deepEqual(result.accounting.observer, { attempts: 4, bytesIn: 10, bytesOut: 10 });
  assert.deepEqual(result.accounting.requests.map(r => [r.operation, r.outcome, r.retryOrdinal, r.bytesOut, r.bytesIn, r.attemptedBytesIn]),
    [['put', 'server-error', 0, 5, 5, 5], ['put', 'success', 1, 5, 2, 2],
      ['head', 'success', 0, 0, 0, 0], ['get', 'success', 0, 0, 3, 3]]);
  assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false);
});

// A producer-only transfer cannot manufacture the independent storage observer.
test('litestreamTransportNeverCreatesObserverEvidence', async t => {
  const target = await server(t, (req, res) => { req.resume(); req.on('end', () => res.end('ok')); });
  const meter = createMeter({ phase: 'restore', clock: () => 0 });
  const front = await transport(t, target, meter, 'restore');
  await send(front.url, { method: 'GET', headers: headers() }); await front.close();
  const result = meter.snapshot();
  assert.equal(result.reconciled, false); assert.deepEqual(result.accounting.observer, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  assert.deepEqual(result.accounting.producer, { attempts: 1, bytesIn: 2, bytesOut: 0 });
  assert.equal(result.accounting.requests[0].phase, 'restore');
});

// The transport's destination must be a private loopback service before any listener or request exists.
test('litestreamTransportRefusesExternalTargetsAndInvalidPhases', async () => {
  assert.equal(typeof stream.createLitestreamTransport, 'function');
  const refuse = async options => {
    let unexpected;
    try { await assert.rejects(async () => { unexpected = await stream.createLitestreamTransport(options); }, /Invalid cloud cost Litestream audit/); }
    finally { await unexpected?.close(); }
  };
  for (const target of ['https://127.0.0.1:8333', 'http://localhost:8333', 'http://s3:8333', 'http://example.com:8333',
    'http://127.0.0.1:8333/path', 'http://user:pass@127.0.0.1:8333', 'http://127.0.0.1:8333/?x=1', 'http://127.0.0.1:8333/#private']) {
    await refuse({ target, phase: 'workload', meter: createMeter({ phase: 'workload', clock: () => 0 }) });
  }
  await refuse({ target: 'http://127.0.0.1:8333', phase: 'private', meter: createMeter({ phase: 'workload', clock: () => 0 }) });
  await refuse({ target: 'http://127.0.0.1:8333', phase: 'workload', meter: {} });
});

// Snapshots must not qualify an empty or unfinished producer stream, even before the observer sees it.
test('litestreamTransportSnapshotsRequireNonemptyCompletedTransfers', async t => {
  let arrived;
  const waiting = new Promise(resolve => { arrived = resolve; });
  const target = await server(t, (req, res) => { req.resume(); req.on('end', () => arrived(res)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await transport(t, target, meter);
  assert.equal(typeof front.snapshot, 'function', 'bind snapshots to completed first-hop transfers');
  assert.throws(() => front.snapshot(), /Invalid cloud cost Litestream audit/);
  const pending = send(front.url, { headers: headers(), body: 'hello' });
  const response = await waiting;
  assert.throws(() => front.snapshot(), /Invalid cloud cost Litestream audit/);
  response.end('ok'); await pending;
  assert.deepEqual(front.snapshot().accounting.producer, { attempts: 1, bytesIn: 2, bytesOut: 5 });
  await front.close(); await front.close();
  assert.deepEqual(front.snapshot().accounting.producer, { attempts: 1, bytesIn: 2, bytesOut: 5 });
});

// An omitted failure guard would allow a truncated download or refused connection to qualify an empty run.
test('litestreamTransportInterruptedResponsesAndConnectionFailuresPoisonEvidence', async t => {
  const truncated = await server(t, (req, res) => { req.resume(); req.on('end', () => {
    res.writeHead(200, { 'content-length': 50 }); res.write('short'); setImmediate(() => res.destroy());
  }); });
  for (const target of [truncated, 'http://127.0.0.1:1']) {
    const meter = createMeter({ phase: 'workload', clock: () => 0 });
    const front = await transport(t, target, meter);
    await assert.rejects(send(front.url, { headers: headers(), body: 'hello' }), /Synthetic (response interrupted|request failed)/);
    await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
    assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  }
});

// Refused requests must not touch storage or leave previously successful evidence usable.
test('litestreamTransportRejectsUnidentifiedDuplicateAndConflictingRetriesBeforeForwarding', async t => {
  let forwarded = 0;
  const target = await server(t, (req, res) => { forwarded++; req.resume(); req.on('end', () => res.end()); });
  for (const input of [
    { headers: {} }, { headers: headers(id, 3) },
    { headers: headers(), method: 'POST' },
    { headers: { ...headers(), 'x-amz-copy-source': '/bucket/PRIVATE_CANARY' } },
    { headers: headers(), path: '/bucket/PRIVATE_CANARY?x-id=GetObject' },
    { headers: { ...headers(), 'amz-sdk-invocation-id': 'PRIVATE_CANARY' } },
  ]) {
    const meter = createMeter({ phase: 'workload', clock: () => 0 });
    const front = await transport(t, target, meter);
    const before = forwarded;
    assert.equal((await send(front.url, input)).code, 400);
    assert.equal(forwarded, before, 'invalid request must be rejected before provider access');
    await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
    assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  }
  for (const input of [{ headers: headers() }, { headers: headers(id, 2), method: 'GET' },
    { headers: headers(id, 2), path: '/bucket/different' }]) {
    const meter = createMeter({ phase: 'workload', clock: () => 0 });
    const front = await transport(t, target, meter);
    assert.equal((await send(front.url, { headers: headers() })).code, 200);
    const before = forwarded;
    assert.equal((await send(front.url, input)).code, 400); assert.equal(forwarded, before);
    await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
    assert.throws(() => front.snapshot(), /Invalid cloud cost Litestream audit/);
  }
});

// An early close must settle its body counters before reporting successful cleanup.
test('litestreamTransportCloseDuringPendingTransferCannotLeaveValidMeter', async t => {
  let arrived; const waiting = new Promise(resolve => { arrived = resolve; });
  const target = await server(t, req => { req.resume(); req.on('end', arrived); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await transport(t, target, meter);
  const response = assert.rejects(send(front.url, { headers: headers(), body: 'hello' }), /Synthetic (request failed|response interrupted)/);
  await waiting;
  await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
  await response;
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

// A completed earlier transfer must not let a later unfinished transfer disappear from a snapshot.
test('litestreamTransportPendingSecondRequestCannotHideBehindAnEarlierSuccess', async t => {
  let arrived, seen = 0; const waiting = new Promise(resolve => { arrived = resolve; });
  const target = await server(t, (req, res) => { req.resume(); req.on('end', () => {
    if (++seen === 1) res.end('ok'); else arrived(res);
  }); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await transport(t, target, meter);
  await send(front.url, { headers: headers(), body: 'hello' });
  const pending = send(front.url, { headers: headers('44444444-2222-4333-8444-555555555555'), body: 'x' });
  pending.catch(() => {});
  const response = await waiting;
  assert.throws(() => front.snapshot(), /Invalid cloud cost Litestream audit/);
  response.end('three'); await pending; await front.close();
  assert.deepEqual(front.snapshot().accounting.producer, { attempts: 2, bytesIn: 7, bytesOut: 6 });
});

// A late provider response after client cancellation must refuse evidence without crashing its worker.
test('litestreamTransportLateResponseAfterClientCloseRefusesWithoutAnUncaughtException', async () => {
  const { spawn } = await import('node:child_process');
  const code = `
    import {createServer,request} from 'node:http';import {once} from 'node:events';
    import {createLitestreamTransport} from ${JSON.stringify(new URL('./litestream.mjs', import.meta.url).href)};
    import {createMeter} from ${JSON.stringify(new URL('./meter.mjs', import.meta.url).href)};
    let caller;
    const provider=createServer((req,res)=>{req.resume();req.on('end',()=>{
      caller.destroy();setTimeout(()=>res.end('late'),30);
    });});
    provider.listen(0,'127.0.0.1');await once(provider,'listening');
    const meter=createMeter({phase:'workload',clock:()=>0});
    const front=await createLitestreamTransport({target:'http://127.0.0.1:'+provider.address().port,meter,phase:'workload'});
    caller=request(front.url+'/bucket/late',{method:'GET',headers:{
      'amz-sdk-invocation-id':'11111111-2222-4333-8444-555555555555','amz-sdk-request':'attempt=1; max=1'
    }});caller.on('error',()=>{});caller.end();
    await new Promise(resolve=>setTimeout(resolve,150));
    let refused=false;try{await front.close();}catch{refused=true;}
    provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));
    if(!refused)process.exitCode=7;
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  const output = []; child.stdout.on('data', b => output.push(b)); child.stderr.on('data', b => output.push(b));
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { const [exit] = await once(child, 'close'); assert.equal(exit, 0, Buffer.concat(output).toString()); }
  finally { clearTimeout(timer); }
});

const afterStopPath = '/owned/PRIVATE_CANARY.db';
const stopAcknowledgement = () => ({ statusCode: 200, ownedPath: afterStopPath,
  body: Buffer.from(JSON.stringify({ status: 'stopped', path: afterStopPath, txid: 0 })) });
const invocationFor = n => `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555`;
function issueList(audit, invocation, attempt = 1) {
  audit.write(Buffer.from(`SDK 2026/10/25 03:00:00 DEBUG Request\nGET /bucket?list-type=2 HTTP/1.1\r\nAmz-Sdk-Invocation-Id: ${invocation}\r\nAmz-Sdk-Request: attempt=${attempt}; max=3\r\n\r\n`));
}
async function afterStopTransport(t, { target, gate } = {}) {
  assert.equal(typeof stream.createLitestreamAfterStop, 'function', 'bound after-stop work to distinct SDK attempts');
  const afterStop = stream.createLitestreamAfterStop({ clock: () => 0 });
  const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop });
  const audit = stream.createLitestreamRequestAudit({ phase: 'workload', afterStop });
  target ??= await server(t, (req, res) => { req.resume(); req.on('end', () => res.end('list')); });
  const observer = await createMeteringProxy({ target, meter,
    classify: input => audit.observe({ headers: input.headers, operation: classifyStorageOperation(input) }) });
  t.after(() => observer.close().catch(() => {}));
  const endpoint = gate ? await gate(observer.url) : observer.url;
  const front = await stream.createLitestreamTransport({ target: endpoint, meter, phase: 'workload', afterStop });
  t.after(() => front.close().catch(() => {}));
  return { afterStop, audit, meter, front };
}

// Counting each hop separately rejects three legitimate attempts; a reset permits the fourth.
for (const count of [3, 4]) test(`after-stop lists share one cap across both independent hops: ${count}`, async t => {
  const { afterStop, audit, meter, front } = await afterStopTransport(t);
  afterStop.acknowledgeStop(stopAcknowledgement());
  for (let n = 1; n <= count; n++) {
    const invocation = invocationFor(n); issueList(audit, invocation);
    const result = await send(front.url, { method: 'GET', path: '/bucket?list-type=2', headers: headers(invocation) });
    assert.equal(result.code, n <= 3 ? 200 : 400);
  }
  if (count === 4) {
    assert.throws(() => audit.end(), /Invalid cloud cost Litestream audit/);
    await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
    assert.throws(() => afterStop.snapshot(), /Invalid cloud cost Litestream audit/);
    assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  } else {
    audit.end(); await front.close(); assert.equal(audit.snapshot().requestsReconciled, true);
    const result = afterStop.snapshot();
    assert.equal(result.used, 3); assert.equal(result.cap, 3);
    assert.equal(result.lateAdmissions, 3); assert.equal(result.lateSettlements, 0);
    assert.deepEqual(result.producer, { attempts: 3, bytesIn: 12, bytesOut: 0 });
    assert.deepEqual(result.observer, { attempts: 3, bytesIn: 12, bytesOut: 0 });
    assert.equal(result.requestsReconciled, true); assert.equal(result.bodiesReconciled, true);
    assert.equal(meter.snapshot().accounting.producer.attempts, 3, 'subset never doubles all-attempt totals');
    assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false);
    assert.equal(JSON.stringify(result).includes(invocationFor(1)), false);
  }
});

// The storage admission boundary, rather than issuance or response completion, determines the subset.
for (const heldAt of ['before-storage', 'after-storage']) test(`a pre-issued list held ${heldAt} is classified at admission`, async t => {
  let arrived, release; const active = new Promise(resolve => { arrived = resolve; });
  const target = heldAt === 'after-storage' ? await server(t, (req, res) => {
    req.resume(); req.on('end', () => { release = () => res.end('list'); arrived(); });
  }) : undefined;
  const gate = heldAt === 'before-storage' ? async endpoint => server(t, (req, res) => {
    release = () => {
      const upstream = request(endpoint, { method: req.method, path: req.url, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => res.destroy()); req.pipe(upstream);
    }; arrived();
  }) : undefined;
  const { afterStop, audit, meter, front } = await afterStopTransport(t, { target, gate });
  issueList(audit, id);
  const pending = send(front.url, { method: 'GET', path: '/bucket?list-type=2', headers: headers() });
  await active; afterStop.acknowledgeStop(stopAcknowledgement()); release(); await pending;
  audit.end(); await front.close();
  const result = afterStop.snapshot();
  assert.equal(result.used, heldAt === 'before-storage' ? 1 : 0);
  assert.equal(result.lateAdmissions, heldAt === 'before-storage' ? 1 : 0);
  assert.equal(result.lateSettlements, 0);
  assert.equal(meter.snapshot().reconciled, true);
});

// A lifetime error must not erase body evidence which the independent counter already observed.
test('counter settlement survives a lifetime-completion refusal', async t => {
  const target = await server(t, (req, res) => { req.resume(); req.on('end', () => res.end('saved')); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 }), recorded = [];
  const front = await stream.createLitestreamTransport({ target, phase: 'workload',
    meter: { ...meter, observeAttempt: e => { meter.observeAttempt(e); recorded.push(e); } },
    lifetimes: { begin: () => () => { throw Error('lifetime evidence refused'); } } });
  t.after(() => front.close().catch(() => {}));
  await send(front.url, { method: 'GET', headers: headers() });
  await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].bytesIn, 5); assert.equal(recorded[0].outcome, 'success');
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

// An old SDK issue is never permission for a new mutation or read admitted after acknowledgement.
for (const [method, path, operation] of [['PUT', '/bucket/key', 'put'], ['GET', '/bucket/key', 'get'],
  ['HEAD', '/bucket/key', 'head'], ['DELETE', '/bucket/key', 'delete'],
  ['POST', '/bucket?delete=', 'delete-many'], ['POST', '/bucket/key?uploads=', 'multipart-create'],
  ['PUT', '/bucket/key?uploadId=x&partNumber=1', 'multipart-upload'],
  ['POST', '/bucket/key?uploadId=x', 'multipart-complete'], ['DELETE', '/bucket/key?uploadId=x', 'multipart-abort']])
  test(`after-stop ${operation} is refused before forwarding even with a pre-stop issue`, async t => {
    let forwarded = 0;
    const target = await server(t, (req, res) => { forwarded++; req.resume(); res.end(); });
    const afterStop = stream.createLitestreamAfterStop({ clock: () => 0 });
    const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop });
    const audit = stream.createLitestreamRequestAudit({ phase: 'workload', allowBulkDeletes: true, afterStop });
    const front = await stream.createLitestreamTransport({ target, phase: 'workload', allowBulkDeletes: true, meter, afterStop });
    t.after(() => front.close().catch(() => {}));
    audit.write(Buffer.from(`SDK 2026/10/25 03:00:00 DEBUG Request\n${method} ${path} HTTP/1.1\r\nAmz-Sdk-Invocation-Id: ${id}\r\nAmz-Sdk-Request: attempt=1; max=3\r\n\r\n`));
    afterStop.acknowledgeStop(stopAcknowledgement());
    assert.equal((await send(front.url, { method, path, headers: headers() })).code, 400);
    assert.equal(forwarded, 0);
    await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
    assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
    assert.throws(() => afterStop.snapshot(), /Invalid cloud cost Litestream audit/);
  });

test('an after-stop retry cannot reset the same invocation or consume a new allowance', async t => {
  let forwarded = 0;
  const target = await server(t, (req, res) => { forwarded++; req.resume(); req.on('end', () => res.end('ok')); });
  const { afterStop, audit, meter, front } = await afterStopTransport(t, { target });
  issueList(audit, id); await send(front.url, { method: 'GET', path: '/bucket?list-type=2', headers: headers() });
  afterStop.acknowledgeStop(stopAcknowledgement()); issueList(audit, id, 2);
  assert.equal((await send(front.url, { method: 'GET', path: '/bucket?list-type=2', headers: headers(id, 2) })).code, 400);
  assert.equal(forwarded, 1);
  await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

test('after-stop accounting never reconciles missing SDK issuance from equal byte counts', async t => {
  const { afterStop, audit, meter, front } = await afterStopTransport(t);
  afterStop.acknowledgeStop(stopAcknowledgement());
  await send(front.url, { method: 'GET', path: '/bucket?list-type=2', headers: headers() });
  audit.end(); await front.close();
  assert.equal(audit.snapshot().requestsReconciled, false);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  assert.throws(() => afterStop.snapshot(), /Invalid cloud cost Litestream audit/);
});

// A phase change during active I/O must poison both the optional ledger and ordinary evidence.
test('a separate after-stop dimension cannot authorize a phase change during a live request', async t => {
  let arrived, release; const active = new Promise(resolve => { arrived = resolve; });
  const target = await server(t, (req, res) => { req.resume(); req.on('end', () => { release = () => res.end('list'); arrived(); }); });
  const { afterStop, audit, meter, front } = await afterStopTransport(t, { target });
  issueList(audit, id);
  const pending = send(front.url, { method: 'GET', path: '/bucket?list-type=2', headers: headers() });
  await active;
  assert.throws(() => front.setPhase('idle'), /Invalid cloud cost Litestream audit/);
  release(); await pending;
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  assert.throws(() => afterStop.snapshot(), /Invalid cloud cost Litestream audit/);
  await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
});

for (const source of ['audit', 'meter']) test(`a later ${source} validation failure poisons the shared session`, async t => {
  const { afterStop, audit, meter, front } = await afterStopTransport(t);
  afterStop.acknowledgeStop(stopAcknowledgement()); issueList(audit, id);
  await send(front.url, { method: 'GET', path: '/bucket?list-type=2', headers: headers() }); await front.close();
  assert.equal(afterStop.snapshot().used, 1);
  if (source === 'audit') assert.throws(() => audit.write(Buffer.from('x'.repeat(65537))), /Invalid cloud cost Litestream audit/);
  else assert.throws(() => meter.observeAttempt({ private: 'PRIVATE_CANARY' }), /Invalid cloud cost meter/);
  assert.throws(() => afterStop.snapshot(), /Invalid cloud cost Litestream audit/);
});

test('a PUT admitted at the first hop before stop cannot reach storage for the first time after stop', async t => {
  let arrived, release, forwarded = 0; const active = new Promise(resolve => { arrived = resolve; });
  const target = await server(t, (req, res) => { forwarded++; req.resume(); res.end(); });
  const gate = async endpoint => server(t, (req, res) => {
    release = () => {
      const upstream = request(endpoint, { method: req.method, path: req.url, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      }); upstream.on('error', () => res.destroy()); req.pipe(upstream);
    }; arrived();
  });
  const { afterStop, audit, meter, front } = await afterStopTransport(t, { target, gate });
  audit.write(Buffer.from(`SDK 2026/10/25 03:00:00 DEBUG Request\nPUT /bucket/PRIVATE_CANARY HTTP/1.1\r\nAmz-Sdk-Invocation-Id: ${id}\r\nAmz-Sdk-Request: attempt=1; max=3\r\n\r\n`));
  const pending = send(front.url, { method: 'PUT', headers: headers(), body: 'upload' });
  await active; afterStop.acknowledgeStop(stopAcknowledgement()); release();
  assert.equal((await pending).code, 400); assert.equal(forwarded, 0);
  await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});
