import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createLitestreamTransport } from './litestream.mjs';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import * as storage from './storage-lifetimes.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from './meter.mjs';
const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3');
const key = 'PRIVATE_CANARY.ltx', path = '/synthetic/' + key;
const put = (bytes = 4) => ({ method: 'PUT', path, headers: { 'content-length': String(bytes) } });
const bad = /Invalid cloud cost storage lifetimes/;
async function fixture(t, options = {}) {
  let time = 0;
  const rows = new Map(options.rows), state = { versioning: '', uploads: '', duplicate: false, truncated: false, paged: false, received: 0 };
  const provider = createServer((req, res) => {
    state.received++; req.resume(); req.on('end', () => {
      if (req.method === 'PUT') { rows.set(decodeURIComponent(req.url.split('?')[0].slice('/synthetic/'.length)), 4); state.onPut?.(); res.end(); }
      else if (req.url.includes('versioning')) res.end(`<VersioningConfiguration>${state.versioning}</VersioningConfiguration>`);
      else if (req.url.includes('uploads')) res.end(`<ListMultipartUploadsResult><IsTruncated>false</IsTruncated>${state.uploads}</ListMultipartUploadsResult>`);
      else {
        const page = state.paged ? [...rows].slice(req.url.includes('continuation-token=next') ? 1 : 0, req.url.includes('continuation-token=next') ? 2 : 1) : [...rows];
        const more = state.paged && !req.url.includes('continuation-token=next');
        const contents = page.map(([Key, Size]) => `<Contents><Key>${Key}</Key><Size>${Size}</Size></Contents>`).join('');
        res.end(`<ListBucketResult><IsTruncated>${state.truncated || more}</IsTruncated>${more ? '<NextContinuationToken>next</NextContinuationToken>' : ''}${contents}${state.duplicate ? contents : ''}</ListBucketResult>`);
      }
    });
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  t.after(() => { provider.closeAllConnections(); return new Promise(resolve => provider.close(resolve)); });
  const meter = createMeter({ phase: 'observer', clock: () => time });
  const proxy = await createMeteringProxy({ target: `http://127.0.0.1:${provider.address().port}`, meter, classify: correlatedStorageAttempt });
  t.after(() => proxy.close());
  const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  instrumentStorageClient({ client, meter, phase: 'observer', endpoint: proxy.url });
  t.after(() => client.destroy());
  const args = { client, sdk, meter, bucket: 'synthetic', clock: () => time };
  return { args, rows, state, meter, target: `http://127.0.0.1:${provider.address().port}`, time: n => { time = n; } };
}
async function open(f) {
  assert.equal(typeof storage.openLitestreamLifetimes, 'function', 'bound retained stream bytes using independent inventories');
  return storage.openLitestreamLifetimes(f.args);
}

// Counting retry bodies as extra objects or pretending success time is commit time changes these literal bounds.
test('streamStorageBoundsIncludeFailedFirstAttemptAndSameSizeRetryWithoutInventingVersions', async t => {
  const f = await fixture(t), audit = await open(f);
  f.time(2); const failed = audit.begin(put());
  f.time(3); failed({ statusCode: 503, bytesOut: 4 });
  f.time(4); const retry = audit.begin(put());
  f.time(5); retry({ statusCode: 200, bytesOut: 4 }); f.rows.set(key, 4);
  f.time(6); const repeat = audit.begin(put());
  f.time(7); repeat({ statusCode: 200, bytesOut: 4 });
  assert.throws(() => audit.snapshot(), bad, 'a mutation needs a fresh independent inventory');
  f.time(10); await audit.verify();
  assert.deepEqual(audit.snapshot(), { status: 'measured', scope: 'unversioned-put-only', windowSeconds: 10,
    objects: { class: 'stream', bytes: 4, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
    byteSeconds: { low: 20, high: 32 } });
  assert.equal(JSON.stringify(audit.snapshot()).includes('PRIVATE_CANARY'), false);
  assert.equal(f.meter.snapshot().reconciled, true, 'inventory requests have independent producer/observer counters');
});

// A failed upload must not silently become no storage if the provider committed before its failure reply.
test('streamFailedUploadPresenceIsBoundedByIndependentInventoryAndAbsenceResetsItsWindow', async t => {
  const f = await fixture(t), audit = await open(f);
  f.time(1); const failed = audit.begin(put());
  f.time(2); failed({ statusCode: 503, bytesOut: 4 });
  f.time(3); await audit.verify(); assert.equal(audit.snapshot().objects.bytes, 0);
  f.time(4); const committed = audit.begin(put());
  f.time(5); committed({ statusCode: 503, bytesOut: 4 }); f.rows.set(key, 4);
  f.time(7); await audit.verify();
  f.time(10); assert.deepEqual(audit.snapshot().byteSeconds, { low: 12, high: 24 });
});

// Unpaired mutations, unsupported histories and ambiguous transfer completion cannot earn a storage receipt.
test('streamStorageRefusesUnsupportedMutationsAndPoisonsEvidence', async t => {
  for (const input of [
    { ...put(), method: 'DELETE' }, { ...put(), method: 'POST', path: path + '?uploads' },
    { ...put(), path: path + '?uploadId=private&partNumber=1' },
    { ...put(), path: '/foreign/' + key }, { ...put(), path: '/synthetic/a%2Fb' },
    { ...put(), headers: {} }, { ...put(), headers: { 'content-length': '-1' } },
    { ...put(), headers: { 'content-length': '4', 'content-encoding': 'gzip' } },
    { ...put(), headers: { 'content-length': '4', 'x-amz-copy-source': '/secret' } },
  ]) {
    const f = await fixture(t), audit = await open(f);
    assert.throws(() => audit.begin(input), bad);
    assert.throws(() => audit.snapshot(), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
  for (const completion of [{ statusCode: 200, bytesOut: 3 }, { statusCode: null, bytesOut: 4, interrupted: true }, { statusCode: 200, bytesOut: 4, interrupted: true },
    { statusCode: 99, bytesOut: 4 }]) {
    const f = await fixture(t), audit = await open(f), finish = audit.begin(put());
    assert.throws(() => finish(completion), bad); assert.throws(() => audit.snapshot(), bad);
  }
});

// A baseline containing foreign data or version history invalidates the put-only model before any write.
test('streamStorageRequiresAnEmptyUnversionedBucketAndMeterBoundObserver', async t => {
  for (const mode of ['rows', 'versioning', 'uploads', 'unbound']) {
    const f = await fixture(t, mode === 'rows' ? { rows: [[key, 4]] } : {});
    if (mode === 'versioning') f.state.versioning = '<Status>Suspended</Status>';
    if (mode === 'uploads') f.state.uploads = '<Upload><Key>private</Key><UploadId>private</UploadId></Upload>';
    if (mode === 'unbound') f.args.client = new sdk.S3Client({ region: 'eu-north-1' });
    await assert.rejects(open(f), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

// A missing/extra/duplicated object, wrong size or incomplete page must not validate a checkpoint.
test('streamInventoryRejectsEveryMismatchWithoutLeakingObjectNames', async t => {
  for (const mode of ['missing', 'extra', 'size', 'duplicate', 'truncated', 'uploads', 'versioning']) {
    const f = await fixture(t), audit = await open(f), finish = audit.begin(put());
    finish({ statusCode: 200, bytesOut: 4 }); f.rows.set(key, 4);
    if (mode === 'missing') f.rows.clear();
    if (mode === 'extra') f.rows.set('OTHER_PRIVATE_CANARY', 1);
    if (mode === 'size') f.rows.set(key, 3);
    if (mode === 'duplicate') f.state.duplicate = true;
    if (mode === 'truncated') f.state.truncated = true;
    if (mode === 'uploads') f.state.uploads = '<Upload><Key>private</Key><UploadId>private</UploadId></Upload>';
    if (mode === 'versioning') f.state.versioning = '<Status>Enabled</Status>';
    await assert.rejects(audit.verify(), bad); assert.throws(() => audit.snapshot(), bad);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

// Active and overlapping writes or a changing size invalidate the immutable-size lifetime envelope.
test('streamStorageRejectsPendingOverlapSizeChangesDuplicateCompletionAndReversedClock', async t => {
  for (const mode of ['pending', 'overlap', 'size', 'twice', 'clock']) {
    const f = await fixture(t), audit = await open(f);
    f.time(2); const finish = audit.begin(put());
    if (mode === 'pending') { assert.throws(() => audit.snapshot(), bad); await assert.rejects(audit.verify(), bad); }
    else if (mode === 'overlap') assert.throws(() => audit.begin(put()), bad);
    else if (mode === 'clock') { f.time(1); assert.throws(() => finish({ statusCode: 200, bytesOut: 4 }), bad); }
    else {
      finish({ statusCode: 200, bytesOut: 4 });
      if (mode === 'twice') assert.throws(() => finish({ statusCode: 200, bytesOut: 4 }), bad);
      else assert.throws(() => audit.begin(put(5)), bad);
    }
    assert.throws(() => audit.snapshot(), bad);
  }
});

const headers = { 'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=3', 'content-length': '4' };
function send(target, method = 'PUT') {
  return new Promise((resolve, reject) => {
    const req = request(target + path, { method, headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end('four');
  });
}
// Omitting the transport-to-lifetime binding leaves real provider objects absent from the private ledger.
test('firstHopTransportBindsRealPutCompletionToIndependentStorageBounds', async t => {
  const f = await fixture(t), lifetimes = await open(f);
  const producer = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: f.target, meter: producer, phase: 'workload', lifetimes });
  t.after(() => front.close().catch(() => {}));
  f.time(2); f.state.onPut = () => f.time(5);
  assert.equal(await send(front.url), 200); await front.close();
  f.time(10); await lifetimes.verify();
  assert.deepEqual(lifetimes.snapshot().objects, { class: 'stream', bytes: 4, currentVersions: 1,
    noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(lifetimes.snapshot().byteSeconds, { low: 20, high: 32 });
  assert.equal(producer.snapshot().accounting.producer.bytesOut, 4);
});
// Refusing after forwarding would let an unmodelled deletion reach the backend.
test('firstHopRefusesUnsupportedStorageHistoryBeforeForwarding', async t => {
  const f = await fixture(t), lifetimes = await open(f);
  const producer = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: f.target, meter: producer, phase: 'workload', lifetimes });
  t.after(() => front.close().catch(() => {}));
  const before = f.state.received;
  assert.equal(await send(front.url, 'DELETE'), 400);
  assert.equal(f.state.received, before, 'no unsupported request reaches the independent provider');
  await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
  assert.throws(() => lifetimes.snapshot(), bad); assert.throws(() => producer.snapshot(), /Invalid cloud cost meter/);
});

// Collapsing all objects onto one duration or skipping a later inventory page changes these hand-calculated totals.
test('streamStorageIntegratesEachObjectWindowAndReadsEveryInventoryPage', async t => {
  const f = await fixture(t), audit = await open(f);
  f.time(2); const first = audit.begin(put());
  f.time(3); first({ statusCode: 200, bytesOut: 4 }); f.rows.set(key, 4);
  f.time(4); const second = audit.begin({ ...put(2), path: '/synthetic/SECOND_PRIVATE_CANARY' });
  f.time(6); second({ statusCode: 200, bytesOut: 2 }); f.rows.set('SECOND_PRIVATE_CANARY', 2);
  f.state.paged = true; f.time(10); await audit.verify();
  assert.equal(audit.snapshot().objects.bytes, 6); assert.equal(audit.snapshot().objects.currentVersions, 2);
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 36, high: 44 });
});

// A known interrupted list can retire its pending token only after the validated runtime boundary.
import { lifetimeExchange, assertIncompleteList } from './litestream-lifetime-test-utils.mjs';
for (const stopped of [false, true]) test(`put-only lifetimes retain narrow interrupted-list settlement: stopped=${stopped}`, async t => {
  const f = await fixture(t);
  const e = await lifetimeExchange(t, { open: afterStop => storage.openLitestreamLifetimes({ ...f.args, afterStop }),
    input: { method: 'GET', path: '/synthetic?list-type=2', headers: {} }, stopped });
  if (stopped) {
    await assertIncompleteList(f, e);
    f.rows.set('UNPAIRED_PRIVATE_CANARY', 1);
    await assert.rejects(e.lifetimes.verify(), bad);
    assert.throws(() => e.afterStop.snapshot(), /Invalid cloud cost Litestream audit/);
  }
  else {
    await assert.rejects(e.transport.close(), /Invalid cloud cost Litestream audit/);
    await assert.rejects(e.lifetimes.verify(), bad); assert.throws(() => e.meter.snapshot());
  }
});
for (const interrupted of [false, true]) test(`put-only lifetimes require a real committed prior PUT after stop: interrupted=${interrupted}`, async t => {
  const f = await fixture(t);
  const e = await lifetimeExchange(t, { open: afterStop => storage.openLitestreamLifetimes({ ...f.args, afterStop }),
    input: put(), interrupted, commit: () => f.rows.set(key, 4) });
  await e.transport.close(); f.time(10); await e.lifetimes.verify();
  assert.equal(e.lifetimes.snapshot().objects.bytes, 4); assert.equal(e.afterStop.snapshot().used, 1);
  assert.deepEqual(e.lifetimes.snapshot().byteSeconds, { low: 40, high: 40 });
  assert.equal(e.afterStop.snapshot().gaps.includes('after-stop:put-response-interrupted'), interrupted);
  assert.equal(e.afterStop.snapshot().lateSettlements, 1);
  assert.equal(e.meter.snapshot().accounting.requests[0].outcome, interrupted ? 'transport-error' : 'success');
  assert.equal(e.meter.snapshot().status, interrupted ? 'unknown' : 'measured');
});

// An inventory containing the bytes must never substitute for an independently witnessed commit.
for (const mode of ['missing-witness', 'incomplete-body', 'partial-body', 'failed-backend', 'unknown-token', 'unknown-field']) {
  test(`put-only after-stop refuses uncertain commit evidence: ${mode}`, async t => {
    const f = await fixture(t);
    const run = () => lifetimeExchange(t, { open: afterStop => storage.openLitestreamLifetimes({ ...f.args, afterStop }),
      input: put(), commit: () => f.rows.set(key, 4), witness: mode !== 'missing-witness', statusCode: mode === 'failed-backend' ? 503 : 200,
      witnessChange: event => mode === 'incomplete-body' ? { ...event, requestComplete: false }
        : mode === 'partial-body' ? { ...event, bytesOut: 3 }
        : mode === 'unknown-token' ? { ...event, token: event.token.replace('11111111', '22222222') }
        : mode === 'unknown-field' ? { ...event, privateCanary: 'PRIVATE_CANARY' } : event });
    if (mode === 'missing-witness') {
      const e = await run(); await assert.rejects(e.transport.close(), /Invalid cloud cost Litestream audit/);
      await assert.rejects(e.lifetimes.verify(), bad); assert.throws(() => e.afterStop.snapshot());
    } else await assert.rejects(run(), /Invalid cloud cost Litestream audit/);
  });
}

test('transport refuses a lifetime reader from another stop-accounting session before accepting traffic', async t => {
  const { createLitestreamAfterStop } = await import('./litestream.mjs');
  const f = await fixture(t), afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const lifetimes = await storage.openLitestreamLifetimes({ ...f.args, afterStop: createLitestreamAfterStop({ clock: () => 0 }) });
  let created;
  t.after(() => created?.close().catch(() => {}));
  await assert.rejects(async () => { created = await createLitestreamTransport({ target: f.target, lifetimes, afterStop,
    phase: 'workload', meter: createMeter({ phase: 'workload', clock: () => 0, afterStop }) }); }, /Invalid cloud cost Litestream audit/);
});

test('put-only reader cannot settle a bound lifetime before its producer counter', async t => {
  const { createLitestreamAfterStop } = await import('./litestream.mjs');
  const f = await fixture(t), afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const invocation = headers['amz-sdk-invocation-id'];
  afterStop.admit({ invocation, ordinal: 0, operation: 'list', hop: 'producer', phase: 'workload' });
  const reader = await storage.openLitestreamLifetimes({ ...f.args, afterStop });
  const finish = reader.begin({ method: 'GET', path: '/synthetic?list-type=2', headers });
  assert.throws(() => finish({ statusCode: 200, bytesOut: 0 }), bad);
});

// Final restore uses the same history, with ordinary strict read completion after replication stops.
test('the shared history keeps final restore reads strict after runtime stop', async t => {
  const { createLitestreamAfterStop } = await import('./litestream.mjs');
  const f = await fixture(t), afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const reader = await storage.openLitestreamLifetimes({ ...f.args, afterStop });
  afterStop.acknowledgeStop({statusCode:200,ownedPath:'/owned.db',body:Buffer.from('{"status":"stopped","path":"/owned.db","txid":0}')});
  const finish = reader.strictReads.begin({ method: 'GET', path, headers: {} });
  finish({ statusCode: 200, bytesOut: 0, interrupted: false, responseHeaders: {} });
  await reader.verify();assert.equal(reader.snapshot().objects.bytes, 0);assert.equal(afterStop.snapshot().used, 0);
});
for (const method of ['PUT', 'DELETE', 'POST']) test(`the strict restore view refuses ${method} before storage`, async t => {
  const { createLitestreamAfterStop } = await import('./litestream.mjs');
  const f = await fixture(t), afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const reader = await storage.openLitestreamLifetimes({ ...f.args, afterStop });
  assert.throws(() => reader.strictReads.begin({ method, path, headers: {'content-length':'4'} }), bad);
  await assert.rejects(reader.verify(), bad);assert.throws(() => afterStop.snapshot());
});
test('an interrupted final restore read still poisons the shared history', async t => {
  const { createLitestreamAfterStop } = await import('./litestream.mjs');
  const f = await fixture(t), afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const reader = await storage.openLitestreamLifetimes({ ...f.args, afterStop });
  const finish = reader.strictReads.begin({ method: 'GET', path, headers: {} });
  assert.throws(() => finish({ statusCode: 200, bytesOut: 0, interrupted: true, responseHeaders: {} }), bad);
  await assert.rejects(reader.verify(), bad);assert.throws(() => afterStop.snapshot());
});
