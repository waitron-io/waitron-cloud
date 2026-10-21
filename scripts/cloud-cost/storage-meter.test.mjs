import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import * as metering from './meter.mjs';
import { exportAggregate } from './schema.mjs';

// A wrong method/subresource branch can price a multipart or bucket operation as an ordinary write.
test('storageOperationsDistinguishObjectsMultipartAndBucketControlWithoutRetainingPaths', () => {
  assert.equal(typeof metering.classifyStorageOperation, 'function', 'classify real S3 HTTP attempts');
  const cases = [
    ['GET', '/', 'list'], ['PUT', '/bucket', 'bucket-create'], ['DELETE', '/bucket/', 'bucket-delete'],
    ['HEAD', '/bucket', 'bucket-inspect'], ['GET', '/bucket?location', 'bucket-inspect'],
    ['PUT', '/bucket?versioning', 'bucket-configure'], ['GET', '/bucket?versioning', 'bucket-inspect'],
    ['GET', '/bucket?list-type=2&prefix=PRIVATE_SYNTHETIC_CANARY&max-keys=10', 'list'],
    ['GET', '/bucket?versions&key-marker=opaque', 'list'], ['GET', '/bucket?uploads&max-uploads=10', 'list'],
    ['PUT', '/bucket/private/key', 'put'], ['HEAD', '/bucket/private/key?versionId=opaque', 'head'],
    ['GET', '/bucket/private/key?versionId=opaque', 'get'], ['DELETE', '/bucket/private/key?versionId=opaque', 'delete'],
    ['POST', '/bucket/private/key?uploads', 'multipart-create'],
    ['PUT', '/bucket/private/key?uploadId=opaque&partNumber=1', 'multipart-upload'],
    ['POST', '/bucket/private/key?uploadId=opaque', 'multipart-complete'],
    ['DELETE', '/bucket/private/key?uploadId=opaque', 'multipart-abort'],
    ['GET', '/bucket/private/key?uploadId=opaque&max-parts=10', 'list'],
  ];
  for (const [method, path, expected] of cases)
    assert.equal(metering.classifyStorageOperation({ method, path }), expected);
});

test('unrecognisedOrAmbiguousStorageOperationsAreRefused', () => {
  assert.equal(typeof metering.classifyStorageOperation, 'function');
  for (const [method, path] of [
    ['PATCH', '/bucket/key'], ['toString', '/bucket/key'], ['GET', 'http://example.test/bucket/key'], ['GET', '//example.test/key'],
    ['GET', '/bucket/key?unknown=PRIVATE_SYNTHETIC_CANARY'], ['POST', '/bucket?delete'],
    ['PUT', '/bucket/key?uploadId=opaque'], ['PUT', '/bucket/key?partNumber=1'],
    ['PUT', '/bucket/key?uploadId=opaque&partNumber=0'], ['PUT', '/bucket/key?uploadId=opaque&partNumber=10001'],
    ['GET', '/bucket/key?uploadId=one&uploadId=two'], ['GET', '/bucket/key?uploads&uploadId=opaque'],
    ['GET', '/bucket/key?versioning'], ['GET', '/bucket?uploadId=opaque'],
    ['GET', '/bucket?max-parts=10'], ['GET', '/bucket?versions&continuation-token=opaque'],
    ['GET', '/bucket?uploads&version-id-marker=opaque'],
  ]) assert.throws(() => metering.classifyStorageOperation({ method, path }), { message: 'Invalid cloud cost meter' });
  assert.equal(metering.classifyStorageOperation({ method: 'GET', path: '/bucket/private/../../' }), 'get', 'classify the forwarded raw path without URL normalisation');
  assert.throws(() => metering.classifyStorageOperation({ method: 'PUT', path: '/bucket/key', copySource: true }), { message: 'Invalid cloud cost meter' });
});

test('sdkOperationHintsAreAcceptedOnlyWhenTheyMatchTheHttpOperation', () => {
  assert.equal(metering.classifyStorageOperation({ method: 'PUT', path: '/bucket/key?x-id=PutObject' }), 'put');
  assert.equal(metering.classifyStorageOperation({ method: 'GET', path: '/bucket?list-type=2&x-id=ListObjectsV2' }), 'list');
  assert.equal(metering.classifyStorageOperation({ method: 'PUT', path: '/bucket/key?partNumber=1&uploadId=opaque&x-id=UploadPart' }), 'multipart-upload');
  for (const path of ['/bucket/key?x-id=DeleteObject', '/bucket/key?x-id=UnknownOperation', '/bucket/key?x-id=PutObject&x-id=PutObject'])
    assert.throws(() => metering.classifyStorageOperation({ method: 'PUT', path }), { message: 'Invalid cloud cost meter' });
});

const event = (token, operation, channel = 'observer') => ({ token, operation, channel, phase: 'workload',
  retryOrdinal: 0, outcome: 'success', statusCode: 200, errorCode: null, sameAccount: null,
  bytesIn: 7, bytesOut: 11, attemptedBytesIn: 7, attemptedBytesOut: 11 });

// Omitting observer grouping would hide uninstrumented requests behind an empty workload table.
test('passiveStorageCountsStayVisibleAndUnreconciledUntilIndependentProducerCountsAgree', () => {
  const meter = metering.createMeter({ phase: 'workload', clock: () => 0 });
  meter.observeAttempt(event('PRIVATE_SYNTHETIC_CANARY', 'put'));
  let result = meter.snapshot();
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.observedRequests, [{ phase: 'workload', operation: 'put', requestClass: 's3-write',
    outcome: 'success', retryOrdinal: 0, attempts: 1, successful: 1, failed: 0, retried: 0,
    bytesIn: 7, bytesOut: 11, attemptedBytesIn: 7, attemptedBytesOut: 11 }]);
  assert.equal(result.accounting.requests.length, 0);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SYNTHETIC_CANARY'), false);
  meter.observeAttempt(event('PRIVATE_SYNTHETIC_CANARY', 'put', 'producer'));
  result = meter.snapshot();
  assert.equal(result.status, 'measured');
  assert.equal(result.billing[0].quantity, 1);
});

test('bucketControlAttemptsDoNotInventPerRequestBilling', () => {
  const meter = metering.createMeter({ phase: 'setup', clock: () => 0 });
  for (const operation of ['bucket-create', 'bucket-delete', 'bucket-configure', 'bucket-inspect'])
    for (const channel of ['producer', 'observer']) meter.observeAttempt({ ...event(operation, operation, channel), phase: 'setup' });
  const result = meter.snapshot();
  assert.equal(result.reconciled, true);
  assert.deepEqual(result.billing, [{ phase: 'setup', requestClass: 's3-control', quantity: null, status: 'unknown' }]);
  assert.ok(result.gaps.includes('request-billing:unknown'));
});

test('bucketControlAccountingUsesTheClosedAnonymousExport', () => {
  const meter = metering.createMeter({ phase: 'setup', clock: () => 0 });
  for (const operation of ['bucket-create', 'bucket-delete', 'bucket-configure', 'bucket-inspect'])
    for (const channel of ['producer', 'observer']) meter.observeAttempt({ ...event('PRIVATE_SYNTHETIC_CANARY-' + operation, operation, channel), phase: 'setup' });
  const result = meter.snapshot();
  const receipt = { schemaVersion: 1, runId: '12345678-1234-4234-8234-123456789012',
    cloudRevision: 'a'.repeat(40), waitronRevision: 'b'.repeat(40), kind: 'local-aggregate',
    dataBoundary: { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 },
    window: { startedAt: '2026-10-14T12:00:00.000Z', endedAt: '2026-10-14T12:00:02.000Z', elapsedSeconds: 2 },
    cadence: { mode: 'original', factor: 1, coveredSeconds: 2, configuredSchedule: null, observedSchedule: null },
    inputs: [], accounting: result.accounting, checks: [{ code: 'accounting-reconciled', passed: true, count: 4 }],
    cleanup: { ownedProcesses: 0, ownedContainers: 0, ownedNetworks: 0, ownedVolumes: 0, ownedObjects: 0, residualKinds: [] } };
  let exported;
  assert.doesNotThrow(() => { exported = exportAggregate(receipt); }, 'include bucket controls without publishing private metadata');
  assert.equal(exported.accounting.producer.attempts, 4);
  assert.equal(JSON.stringify(exported).includes('PRIVATE_SYNTHETIC_CANARY'), false);
  receipt.accounting.requests[0].path = 'PRIVATE_SYNTHETIC_CANARY';
  assert.throws(() => exportAggregate(receipt), { message: 'Invalid cloud cost evidence' });
});

async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
const close = server => new Promise(resolve => server.close(resolve));
const call = url => new Promise((resolve, reject) => {
  const req = request(url, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
  req.once('error', reject); req.end();
});

// A refused request must poison the evidence immediately, even before the proxy is closed.
test('unclassifiedStorageTrafficInvalidatesSnapshotsBeforeCleanup', async t => {
  const meter = metering.createMeter({ phase: 'workload', clock: () => 0 });
  const server = createServer((req, res) => res.end());
  const target = await listen(server); t.after(() => close(server));
  const proxy = await metering.createMeteringProxy({ target, meter, classify: () => { throw Error('PRIVATE_SYNTHETIC_CANARY'); } });
  t.after(async () => { await assert.rejects(proxy.close(), { message: 'Invalid cloud cost meter' }); });
  assert.equal(await call(proxy.url + '/unknown'), 400);
  assert.throws(() => meter.snapshot(), { message: 'Invalid cloud cost meter' });
});

test('proxyUsesTheExplicitInternalListenerAndRefusesOtherBindAddresses', async t => {
  const meter = metering.createMeter({ phase: 'workload', clock: () => 0 });
  const server = createServer((req, res) => res.end());
  const target = await listen(server); t.after(() => close(server));
  for (const listenHost of ['example.test', '192.0.2.1', '::', '127.1.2.3'])
    await assert.rejects(async () => {
      const proxy = await metering.createMeteringProxy({ target, meter, classify: () => ({}), listenHost });
      await proxy.close();
    }, { message: 'Invalid cloud cost meter' });
  const proxy = await metering.createMeteringProxy({ target, meter, listenHost: '0.0.0.0', listenPort: 0,
    classify: ({ copySource }) => { assert.equal(copySource, false); return { token: 'listener', phase: 'workload', operation: 'get', retryOrdinal: 0, errorCode: null, sameAccount: null }; } });
  t.after(() => proxy.close());
  assert.equal(await call(proxy.url), 200);
});

test('headResponseObjectSizeIsNotCountedAsAttemptedBodyBytes', async t => {
  const meter = metering.createMeter({ phase: 'observer', clock: () => 0 });
  const server = createServer((req, res) => { res.writeHead(200, { 'content-length': 987654 }); res.end(); });
  const target = await listen(server); t.after(() => close(server));
  const proxy = await metering.createMeteringProxy({ target, meter, classify: () => ({ token: 'head', phase: 'observer',
    operation: 'head', retryOrdinal: 0, errorCode: null, sameAccount: null }) });
  t.after(() => proxy.close());
  await new Promise((resolve, reject) => {
    const req = request(proxy.url, { method: 'HEAD' }, res => { res.resume(); res.once('end', resolve); });
    req.once('error', reject); req.end();
  });
  assert.equal(meter.snapshot().observedRequests[0].attemptedBytesIn, 0);
});

test('inFlightStorageRequestsPreventAnEarlyMeasuredSnapshot', async t => {
  const meter = metering.createMeter({ phase: 'workload', clock: () => 0 });
  let arrived;
  const received = new Promise(resolve => { arrived = resolve; });
  const server = createServer((req, res) => { req.resume(); req.on('end', () => arrived(res)); });
  const target = await listen(server); t.after(() => close(server));
  const proxy = await metering.createMeteringProxy({ target, meter, classify: () => ({ token: 'pending', phase: 'workload',
    operation: 'get', retryOrdinal: 0, errorCode: null, sameAccount: null }) });
  t.after(() => proxy.close());
  const pending = call(proxy.url);
  const response = await received;
  try { assert.throws(() => meter.snapshot(), { message: 'Invalid cloud cost meter' }); }
  finally { response.end(); await pending; }
  assert.equal(meter.snapshot().accounting.observer.attempts, 1);
});

test('pendingAttemptIdentityCannotBeMalformedReusedOrCountedTwice', () => {
  const create = () => metering.createMeter({ phase: 'workload', clock: () => 0 });
  for (const id of [null, '', 'x'.repeat(201)]) {
    const meter = create();
    assert.throws(() => meter.beginAttempt(id), { message: 'Invalid cloud cost meter' });
    assert.throws(() => meter.snapshot(), { message: 'Invalid cloud cost meter' });
  }
  const pending = create(); pending.beginAttempt('once');
  assert.throws(() => pending.beginAttempt('once'), { message: 'Invalid cloud cost meter' });
  const completed = create(); completed.observeAttempt(event('done', 'get'));
  assert.throws(() => completed.beginAttempt('done'), { message: 'Invalid cloud cost meter' });
});

test('copyHeadersCannotPassThroughAsOrdinaryObjectUploads', async t => {
  let forwarded = 0;
  const meter = metering.createMeter({ phase: 'workload', clock: () => 0 });
  const server = createServer((req, res) => { forwarded++; req.resume(); req.on('end', () => res.end()); });
  const target = await listen(server); t.after(() => close(server));
  const proxy = await metering.createMeteringProxy({ target, meter,
    classify: input => ({ token: 'copy', phase: 'workload', operation: metering.classifyStorageOperation(input),
      retryOrdinal: 0, errorCode: null, sameAccount: null }) });
  t.after(async () => { try { await proxy.close(); } catch (e) { assert.equal(e.message, 'Invalid cloud cost meter'); } });
  const status = await new Promise((resolve, reject) => {
    const req = request(proxy.url + '/bucket/key', { method: 'PUT', headers: { 'x-amz-copy-source': '/bucket/PRIVATE_SYNTHETIC_CANARY', 'content-length': 0 } }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject); req.end();
  });
  assert.equal(status, 400); assert.equal(forwarded, 0);
  assert.throws(() => meter.snapshot(), { message: 'Invalid cloud cost meter' });
});
