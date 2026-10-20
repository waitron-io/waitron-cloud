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
