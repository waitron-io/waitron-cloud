import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeter, createMeteringProxy } from './meter.mjs';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { exportAggregate } from './schema.mjs';

function fixture() {
  let now = 0; const meter = createMeter({ phase: 'workload', clock: () => now });
  return { meter, time: value => { now = value; } };
}
const attempt = (token, overrides = {}) => ({ token, channel: 'producer', phase: 'workload', operation: 'put',
  retryOrdinal: 0, outcome: 'success', statusCode: 200, errorCode: null, sameAccount: true,
  bytesIn: 0, bytesOut: 10, attemptedBytesIn: 0, attemptedBytesOut: 10, ...overrides });
function both(meter, event) { meter.observeAttempt(event); meter.observeAttempt({ ...event, channel: 'observer' }); }

test('allAttemptsIncludingRetryAndObserver', () => {
  const { meter } = fixture();
  both(meter, attempt('try0', { outcome: 'server-error', statusCode: 503 }));
  both(meter, attempt('try1', { retryOrdinal: 1 }));
  both(meter, attempt('observer-head', { phase: 'observer', operation: 'head', bytesOut: 0, attemptedBytesOut: 0 }));
  both(meter, attempt('cleanup-delete', { phase: 'cleanup', operation: 'delete', bytesOut: 0, attemptedBytesOut: 0 }));
  const result = meter.snapshot();
  assert.equal(result.accounting.producer.attempts, 4); assert.equal(result.accounting.observer.attempts, 4);
  assert.deepEqual(result.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  assert.equal(result.accounting.requests.find(r => r.retryOrdinal === 1).retried, 1);
  assert.equal(result.accounting.requests.find(r => r.outcome === 'server-error').failed, 1);
  assert.equal(result.status, 'measured');
});
test('multipartAbortAndVersionsByteSeconds', () => {
  const f = fixture();
  f.meter.observeObject({ token: 'upload', action: 'multipart-create', class: 'stream', bytes: 0 });
  f.time(2); f.meter.observeObject({ token: 'upload', action: 'multipart-part', class: 'stream', bytes: 100 });
  f.time(5); f.meter.observeObject({ token: 'upload', action: 'multipart-abort', class: 'stream', bytes: 0 });
  f.meter.observeObject({ token: 'v1', action: 'create', class: 'stream', bytes: 10 });
  f.time(7); f.meter.observeObject({ token: 'v1', action: 'noncurrent', class: 'stream', bytes: 0 });
  f.meter.observeObject({ token: 'v2', action: 'create', class: 'stream', bytes: 20 });
  f.time(9); f.meter.observeObject({ token: 'marker', action: 'marker', class: 'stream', bytes: 3 });
  f.time(10);
  assert.deepEqual(f.meter.snapshot().accounting.objects, [{ class: 'stream', bytes: 33, byteSeconds: 413,
    currentVersions: 1, noncurrentVersions: 1, deleteMarkers: 1, unfinishedMultipart: 0 }]);
});
test('rangeReadAndPartialFailureBytes', () => {
  const { meter } = fixture();
  both(meter, attempt('range', { operation: 'get', statusCode: 206, bytesIn: 4, bytesOut: 0, attemptedBytesIn: 4, attemptedBytesOut: 0 }));
  both(meter, attempt('partial', { operation: 'get', outcome: 'transport-error', statusCode: null,
    bytesIn: 3, bytesOut: 0, attemptedBytesIn: 10, attemptedBytesOut: 0 }));
  const result = meter.snapshot();
  assert.equal(result.accounting.producer.bytesIn, 7);
  assert.equal(result.accounting.requests.reduce((n, r) => n + r.attemptedBytesIn, 0), 14);
  assert.equal(result.billing.find(r => r.requestClass === 's3-read').quantity, null);
  assert.ok(result.gaps.includes('request-billing:unknown'));
});
test('requestClassAndFailureBilling', () => {
  const { meter } = fixture();
  const events = [attempt('put'), attempt('retry', { outcome: 'server-error', statusCode: 503 }),
    attempt('own-denied', { outcome: 'client-error', statusCode: 403, errorCode: 'AccessDenied' }),
    attempt('foreign-denied', { outcome: 'client-error', statusCode: 403, errorCode: 'AccessDenied', sameAccount: false }),
    attempt('exempt', { outcome: 'client-error', statusCode: 403, errorCode: 'SignatureDoesNotMatch' }),
    attempt('conflict', { outcome: 'client-error', statusCode: 412, errorCode: 'PreconditionFailed' }),
    attempt('list', { operation: 'list' }), attempt('head', { operation: 'head' }),
    attempt('part', { operation: 'multipart-upload' }), attempt('abort', { operation: 'multipart-abort' }),
    attempt('delete', { operation: 'delete' })];
  for (const event of events) both(meter, event);
  const billing = meter.snapshot().billing;
  assert.equal(billing.find(r => r.requestClass === 's3-write').quantity, 3);
  assert.equal(billing.find(r => r.requestClass === 's3-list').quantity, 1);
  assert.equal(billing.find(r => r.requestClass === 's3-read').quantity, 1);
  assert.equal(billing.find(r => r.requestClass === 's3-multipart').quantity, 1);
  assert.equal(billing.find(r => r.requestClass === 's3-delete').quantity, 0);
});
test('startupIdleAndBurstRemainSeparate', () => {
  const { meter } = fixture();
  for (const phase of ['startup', 'idle', 'workload']) both(meter, attempt(phase, { phase }));
  assert.deepEqual(meter.snapshot().accounting.requests.map(r => r.phase), ['startup', 'idle', 'workload']);
});
test('unreconciledMeterRefusesMeasured', () => {
  const { meter } = fixture(); meter.observeAttempt(attempt('unobserved'));
  const result = meter.snapshot(); assert.equal(result.status, 'unknown');
  assert.ok(result.gaps.includes('accounting:unreconciled'));
  meter.observeAttempt(attempt('unobserved', { channel: 'observer', operation: 'get' }));
  assert.equal(meter.snapshot().status, 'unknown');
  assert.deepEqual(meter.snapshot().accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
});
test('unknownOperationsRawFieldsDuplicateAttemptsAndTimeReversalRefused', () => {
  const f = fixture();
  for (const event of [attempt('raw', { path: 'PRIVATE_SYNTHETIC_CANARY' }), attempt('unknown', { operation: 'copy-all' }),
    attempt('negative', { bytesOut: -1 }), attempt('excess', { bytesOut: 11 }),
    attempt('contradiction', { outcome: 'success', statusCode: 503 })]) {
    assert.throws(() => f.meter.observeAttempt(event), { message: 'Invalid cloud cost meter' });
  }
  f.meter.observeAttempt(attempt('once')); assert.throws(() => f.meter.observeAttempt(attempt('once')), { message: 'Invalid cloud cost meter' });
  const clean = fixture(); clean.time(1); clean.meter.snapshot(); clean.time(0);
  assert.throws(() => clean.meter.snapshot(), { message: 'Invalid cloud cost meter' });
});
test('unfinishedMultipartAndSnapshotsDoNotResetStorageIntegral', () => {
  const f = fixture(); f.meter.observeObject({ token: 'upload', action: 'multipart-create', class: 'snapshot', bytes: 0 });
  f.time(1); f.meter.observeObject({ token: 'upload', action: 'multipart-part', class: 'snapshot', bytes: 10 });
  f.time(3); assert.equal(f.meter.snapshot().accounting.objects[0].byteSeconds, 20);
  f.time(4); const result = f.meter.snapshot();
  assert.equal(result.accounting.objects[0].byteSeconds, 30); assert.equal(result.accounting.objects[0].unfinishedMultipart, 1);
  f.meter.observeObject({ token: 'upload', action: 'multipart-complete', class: 'snapshot', bytes: 10 });
  f.time(5); assert.equal(f.meter.snapshot().accounting.objects[0].byteSeconds, 40);
});

const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
const close = server => new Promise(resolve => server.close(resolve));
function call(url, method, path, body = '') {
  return new Promise((resolve, reject) => {
    const req = request(url + path, { method, headers: { 'content-length': Buffer.byteLength(body) } }, res => {
      let bytes = 0; res.on('data', chunk => { bytes += chunk.length; });
      res.on('end', () => resolve({ statusCode: res.statusCode, bytes })); res.on('error', reject);
    }); req.on('error', reject); req.end(body);
  });
}
test('streamingProxyReconcilesRetryDeniedAndInterruptedMultipart', async t => {
  const f = fixture(); let puts = 0; let ordinal = 0;
  const upstream = createServer((req, res) => {
    req.resume(); req.on('end', () => {
      if (req.method === 'PUT' && ++puts === 1) { res.writeHead(503); res.end(); }
      else if (req.url === '/denied') { res.writeHead(403); res.end(); }
      else if (req.url === '/partial') { res.writeHead(200, { 'content-length': 10 }); res.flushHeaders(); res.write('abc'); setImmediate(() => res.destroy()); }
      else { res.writeHead(200); res.end(); }
    });
  });
  const target = await listen(upstream); t.after(() => close(upstream));
  const proxy = await createMeteringProxy({ target, meter: f.meter, classify: ({ method, path }) => ({
    token: `request-${ordinal++}`, retryOrdinal: method === 'PUT' ? puts : 0, phase: 'workload',
    operation: path === '/abort' ? 'multipart-abort' : method === 'PUT' ? 'multipart-upload' : 'get',
    errorCode: path === '/denied' ? 'AccessDenied' : null, sameAccount: true }) });
  t.after(() => proxy.close());
  for (const [method, path, body] of [['PUT', '/part', 'abcd'], ['PUT', '/part', 'abcd'], ['GET', '/denied', ''], ['DELETE', '/abort', '']]) {
    const result = await call(proxy.url, method, path, body);
    f.meter.observeAttempt(attempt(`request-${ordinal - 1}`, { operation: path === '/abort' ? 'multipart-abort' : method === 'PUT' ? 'multipart-upload' : 'get',
      retryOrdinal: method === 'PUT' ? puts - 1 : 0, statusCode: result.statusCode,
      outcome: result.statusCode === 503 ? 'server-error' : result.statusCode === 403 ? 'client-error' : 'success',
      errorCode: path === '/denied' ? 'AccessDenied' : null,
      bytesIn: result.bytes, bytesOut: Buffer.byteLength(body), attemptedBytesIn: result.bytes, attemptedBytesOut: Buffer.byteLength(body) }));
  }
  await assert.rejects(call(proxy.url, 'GET', '/partial'));
  f.meter.observeAttempt(attempt(`request-${ordinal - 1}`, { operation: 'get', outcome: 'transport-error', statusCode: 200,
    bytesIn: 3, bytesOut: 0, attemptedBytesIn: 10, attemptedBytesOut: 0 }));
  const result = f.meter.snapshot();
  assert.equal(result.accounting.producer.attempts, 5); assert.equal(result.accounting.producer.bytesOut, 8);
  assert.equal(result.accounting.producer.bytesIn, 3); assert.equal(result.status, 'measured');
  assert.equal(result.billing.find(r => r.requestClass === 's3-multipart').quantity, 1);
  assert.equal(result.billing.find(r => r.requestClass === 's3-read').quantity, 2);
  assert.ok(!JSON.stringify(result).includes('/partial'));
});
test('proxyRejectsExternalTargetsBeforeListening', async () => {
  const f = fixture();
  for (const target of ['https://example.com', 'http://localhost:1', 'http://127.0.0.1:1/path', 'http://user:secret@127.0.0.1:1']) {
    await assert.rejects(async () => {
      const proxy = await createMeteringProxy({ target, meter: f.meter, classify: () => ({}) }); await proxy.close();
    }, { message: 'Invalid cloud cost meter' });
  }
});

test('rejectedEventsCannotYieldAnEmptyMeasuredReceipt', () => {
  const f = fixture();
  assert.throws(() => f.meter.observeAttempt(attempt('bad', { operation: 'unclassified' })), { message: 'Invalid cloud cost meter' });
  assert.throws(() => f.meter.snapshot(), { message: 'Invalid cloud cost meter' });
});
test('invalidObjectTransitionsAndRawObjectFieldsRefused', () => {
  for (const event of [{ token: 'part', action: 'multipart-part', class: 'stream', bytes: 1 },
    { token: 'raw', action: 'create', class: 'stream', bytes: 1, payload: 'PRIVATE_SYNTHETIC_CANARY' }]) {
    assert.throws(() => fixture().meter.observeObject(event), { message: 'Invalid cloud cost meter' });
  }
  const f = fixture(); f.meter.observeObject({ token: 'upload', action: 'multipart-create', class: 'stream', bytes: 0 });
  assert.throws(() => f.meter.observeObject({ token: 'upload', action: 'multipart-complete', class: 'stream', bytes: 1 }), { message: 'Invalid cloud cost meter' });
});

test('streamingProxyCountsAnInterruptedMultipartUpload', { timeout: 5000 }, async t => {
  const f = fixture(); let received; let aborted;
  const sawBytes = new Promise(resolve => { received = resolve; });
  const sawAbort = new Promise(resolve => { aborted = resolve; });
  const upstream = createServer(req => { req.on('data', () => received()); req.on('aborted', () => aborted()); });
  const target = await listen(upstream); t.after(() => close(upstream));
  const proxy = await createMeteringProxy({ target, meter: f.meter, classify: () => ({ token: 'partial-part',
    retryOrdinal: 0, phase: 'workload', operation: 'multipart-upload', errorCode: null, sameAccount: true }) });
  t.after(() => proxy.close());
  const req = request(proxy.url + '/part?uploadId=PRIVATE_SYNTHETIC_CANARY&partNumber=1', { method: 'PUT', headers: { 'content-length': 8 } });
  req.on('error', () => {}); req.write('abcd');
  await sawBytes; req.destroy(); await sawAbort;
  f.meter.observeAttempt(attempt('partial-part', { operation: 'multipart-upload', outcome: 'transport-error',
    statusCode: null, bytesOut: 4, attemptedBytesOut: 8 }));
  const result = f.meter.snapshot();
  assert.equal(result.status, 'measured'); assert.equal(result.accounting.observer.bytesOut, 4);
  assert.equal(result.accounting.requests[0].attemptedBytesOut, 8); assert.equal(result.accounting.requests[0].failed, 1);
  assert.equal(result.billing[0].quantity, null); assert.ok(!JSON.stringify(result).includes('PRIVATE_SYNTHETIC_CANARY'));
});
test('unclassifiedProxyRequestsPreventSuccessfulCleanupReceipt', async t => {
  const f = fixture(); const upstream = createServer((req, res) => res.end());
  const target = await listen(upstream); t.after(() => close(upstream));
  const proxy = await createMeteringProxy({ target, meter: f.meter, classify: () => { throw new Error('PRIVATE_SYNTHETIC_CANARY'); } });
  assert.equal((await call(proxy.url, 'GET', '/unknown')).statusCode, 400);
  await assert.rejects(proxy.close(), { message: 'Invalid cloud cost meter' });
});
test('unknownErrorAndAccountAttributionKeepBillingIncomplete', () => {
  const { meter } = fixture();
  both(meter, attempt('unknown-code', { outcome: 'client-error', statusCode: 400, errorCode: 'unknown' }));
  both(meter, attempt('unknown-account', { outcome: 'client-error', statusCode: 403, errorCode: 'AccessDenied', sameAccount: null }));
  assert.equal(meter.snapshot().billing[0].quantity, null);
  assert.ok(meter.snapshot().gaps.includes('request-billing:unknown'));
});
test('unknownErrorAloneKeepsBillingIncomplete', () => {
  const { meter } = fixture();
  both(meter, attempt('unknown-code', { outcome: 'client-error', statusCode: 400, errorCode: 'unknown' }));
  assert.equal(meter.snapshot().billing[0].quantity, null);
});
test('attemptedByteDisagreementRefusesMeasuredAccounting', () => {
  const { meter } = fixture();
  meter.observeAttempt(attempt('declared', { attemptedBytesOut: 20 }));
  meter.observeAttempt(attempt('declared', { channel: 'observer' }));
  assert.equal(meter.snapshot().status, 'unknown');
  assert.ok(meter.snapshot().gaps.includes('accounting:unreconciled'));
  assert.equal(meter.snapshot().billing[0].quantity, null);
  assert.equal(meter.snapshot().billing[0].status, 'unknown');
});
test('meterAccountingExportsThroughTheClosedAnonymousSchema', () => {
  const f = fixture(); both(f.meter, attempt('PRIVATE_SYNTHETIC_CANARY'));
  f.meter.observeObject({ token: 'PRIVATE_SYNTHETIC_CANARY', action: 'create', class: 'stream', bytes: 10 });
  f.time(2); const result = f.meter.snapshot();
  const receipt = exportAggregate({ schemaVersion: 1, runId: '12345678-1234-4234-8234-123456789012',
    cloudRevision: 'a'.repeat(40), waitronRevision: 'b'.repeat(40), kind: 'local-aggregate',
    dataBoundary: { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 },
    window: { startedAt: '2026-10-14T12:00:00.000Z', endedAt: '2026-10-14T12:00:02.000Z', elapsedSeconds: 2 },
    cadence: { mode: 'original', factor: 1, coveredSeconds: 2, configuredSchedule: null, observedSchedule: null },
    inputs: [], accounting: result.accounting, checks: [{ code: 'accounting-reconciled', passed: result.reconciled, count: 1 }],
    cleanup: { ownedProcesses: 0, ownedContainers: 0, ownedNetworks: 0, ownedVolumes: 0, ownedObjects: 0, residualKinds: [] } });
  assert.equal(receipt.accounting.objects[0].byteSeconds, 20); assert.equal(receipt.accounting.producer.bytesOut, 10);
  assert.ok(!JSON.stringify(receipt).includes('PRIVATE_SYNTHETIC_CANARY'));
});
