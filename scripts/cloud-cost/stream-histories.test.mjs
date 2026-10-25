import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import * as storage from './storage-lifetimes.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from './meter.mjs';
import { createLitestreamTransport } from './litestream.mjs';

const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3');
const key = 'PRIVATE_HISTORY_CANARY', path = '/synthetic/' + key;
const bad = /Invalid cloud cost storage lifetimes/;
const put = bytes => ({ method: 'PUT', path, headers: { 'content-length': String(bytes) } });
const del = () => ({ method: 'DELETE', path, headers: {} });

async function fixture(t) {
  let time = 0;
  const rows = new Map(), state = { requests: 0, versioning: '', uploads: '', duplicate: false, truncated: false, paged: false };
  const provider = createServer((req, res) => {
    state.requests++;
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://local');
      if (req.method === 'PUT') { rows.set(decodeURIComponent(url.pathname.slice('/synthetic/'.length)), Buffer.concat(chunks).length); state.onMutation?.(); res.end(); }
      else if (req.method === 'DELETE') { rows.delete(decodeURIComponent(url.pathname.slice('/synthetic/'.length))); state.onMutation?.(); res.writeHead(204); res.end(); }
      else if (url.searchParams.has('versioning')) res.end(`<VersioningConfiguration>${state.versioning}</VersioningConfiguration>`);
      else if (url.searchParams.has('uploads')) res.end(`<ListMultipartUploadsResult><IsTruncated>false</IsTruncated>${state.uploads}</ListMultipartUploadsResult>`);
      else {
        const second = url.searchParams.get('continuation-token') === 'next';
        const page = state.paged ? [...rows].slice(second ? 1 : 0, second ? 2 : 1) : [...rows];
        const more = state.paged && !second || state.repeatToken;
        const contents = page.map(([Key, Size]) => `<Contents><Key>${Key}</Key><Size>${Size}</Size></Contents>`).join('');
        res.end(`<ListBucketResult><IsTruncated>${state.truncated || more}</IsTruncated>${more ? '<NextContinuationToken>next</NextContinuationToken>' : ''}${contents}${state.duplicate ? contents : ''}</ListBucketResult>`);
      }
    });
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  t.after(() => { provider.closeAllConnections(); return new Promise(resolve => provider.close(resolve)); });
  const meter = createMeter({ phase: 'observer', clock: () => time });
  const target = `http://127.0.0.1:${provider.address().port}`;
  const proxy = await createMeteringProxy({ target, meter, classify: correlatedStorageAttempt });
  t.after(() => proxy.close());
  const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  instrumentStorageClient({ client, meter, phase: 'observer', endpoint: proxy.url });
  t.after(() => client.destroy());
  return { rows, state, meter, target, args: { client, sdk, meter, bucket: 'synthetic', clock: () => time }, time: n => { time = n; } };
}
async function open(f) {
  assert.equal(typeof storage.openLitestreamHistories, 'function', 'account for native replacements and deletions without discarding their earlier storage');
  return storage.openLitestreamHistories(f.args);
}
function success(f, audit, input, start, end, bytes) {
  f.time(start); const finish = audit.begin(input);
  f.time(end); finish({ statusCode: input.method === 'DELETE' ? 204 : 200, bytesOut: bytes ?? 0 });
  if (input.method === 'DELETE') f.rows.delete(key); else f.rows.set(key, bytes);
}

// Dropping retired intervals or resetting an unchanged upload's start undercounts these literal totals.
test('streamHistoryRetainsStorageAcrossReplacementDeletionAndRecreation', async t => {
  const f = await fixture(t), audit = await open(f);
  success(f, audit, put(4), 2, 3, 4);
  success(f, audit, put(6), 5, 7, 6);
  success(f, audit, put(6), 8, 9, 6);
  success(f, audit, del(), 10, 12);
  success(f, audit, put(2), 14, 15, 2);
  assert.throws(() => audit.snapshot(), bad);
  f.time(20); await audit.verify();
  assert.deepEqual(audit.snapshot(), { status: 'measured', scope: 'unversioned-object-history', windowSeconds: 20,
    objects: { class: 'stream', bytes: 2, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
    byteSeconds: { low: 36, high: 74 } });
  assert.equal(f.meter.snapshot().reconciled, true);
  assert.equal(JSON.stringify(audit.snapshot()).includes(key), false);
});

// Treating an error reply as proof that no write committed loses storage before the independent observation.
for (const mutation of ['create', 'replace', 'delete']) for (const committed of [false, true]) {
  test(`streamHistoryResolvesFailed${mutation}FromInventory_${committed}`, async t => {
    const f = await fixture(t), audit = await open(f);
    if (mutation !== 'create') success(f, audit, put(4), 1, 2, 4);
    f.time(4); const finish = audit.begin(mutation === 'delete' ? del() : put(6));
    f.time(5); finish({ statusCode: 503, bytesOut: mutation === 'delete' ? 0 : 6 });
    if (committed) { if (mutation === 'delete') f.rows.delete(key); else f.rows.set(key, 6); }
    assert.throws(() => audit.snapshot(), bad);
    f.time(8); await audit.verify(); f.time(10);
    const want = {
      create: committed ? { low: 12, high: 36 } : { low: 0, high: 0 },
      replace: committed ? { low: 20, high: 64 } : { low: 32, high: 36 },
      delete: committed ? { low: 8, high: 28 } : { low: 32, high: 36 },
    }[mutation];
    assert.deepEqual(audit.snapshot().byteSeconds, want);
    assert.equal(audit.snapshot().objects.bytes, mutation === 'create' ? committed ? 6 : 0 : mutation === 'replace' && committed ? 6 : mutation === 'delete' && committed ? 0 : 4);
  });
}

// A retry's later start must not replace the first possible commit time, even after a failed reply.
for (const mutation of ['create', 'replace', 'delete']) {
  test(`streamHistorySameMutationRetryPreservesFirstPossibleCommit_${mutation}`, async t => {
    const f = await fixture(t), audit = await open(f);
    if (mutation !== 'create') success(f, audit, put(4), 1, 2, 4);
    const input = mutation === 'delete' ? del() : put(6), bytes = mutation === 'delete' ? 0 : 6;
    f.time(4); const failed = audit.begin(input); f.time(5); failed({ statusCode: 503, bytesOut: bytes });
    success(f, audit, input, 6, 7, bytes);
    f.time(10); await audit.verify();
    assert.deepEqual(audit.snapshot().byteSeconds, {
      create: { low: 18, high: 36 }, replace: { low: 26, high: 60 }, delete: { low: 8, high: 24 },
    }[mutation]);
  });
}

// Resolving a failed mutation by an unrelated next mutation would hide which size existed in between.
for (const mode of ['overlap', 'ambiguous', 'twice', 'clock', 'short', 'interrupt', 'null', 'status']) {
  test(`streamHistoryPoisonsUnprovableTransition_${mode}`, async t => {
    const f = await fixture(t), audit = await open(f);
    success(f, audit, put(4), 1, 2, 4);
    f.time(4); const finish = audit.begin(del());
    if (mode === 'overlap') assert.throws(() => audit.begin(put(6)), bad);
    else if (mode === 'clock') { f.time(3); assert.throws(() => finish({ statusCode: 204, bytesOut: 0 }), bad); }
    else if (mode === 'short') assert.throws(() => finish({ statusCode: 204, bytesOut: 1 }), bad);
    else if (mode === 'interrupt') assert.throws(() => finish({ statusCode: 204, bytesOut: 0, interrupted: true }), bad);
    else if (mode === 'null') assert.throws(() => finish({ statusCode: null, bytesOut: 0 }), bad);
    else if (mode === 'status') assert.throws(() => finish({ statusCode: 99, bytesOut: 0 }), bad);
    else {
      finish({ statusCode: mode === 'ambiguous' ? 503 : 204, bytesOut: 0 });
      if (mode === 'ambiguous') assert.throws(() => audit.begin(put(6)), bad);
      else assert.throws(() => finish({ statusCode: 204, bytesOut: 0 }), bad);
    }
    assert.throws(() => audit.snapshot(), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

// A changed backend, hidden object or unsupported multipart cannot validate an anonymous receipt.
for (const mode of ['extra', 'missing', 'size', 'duplicate', 'truncated', 'uploads', 'versioning']) {
  test(`streamHistoryRequiresExactIndependentInventory_${mode}`, async t => {
    const f = await fixture(t), audit = await open(f);
    success(f, audit, put(4), 1, 2, 4);
    if (mode === 'extra') f.rows.set('OTHER_PRIVATE_CANARY', 1);
    if (mode === 'missing') f.rows.clear();
    if (mode === 'size') f.rows.set(key, 3);
    if (mode === 'duplicate') f.state.duplicate = true;
    if (mode === 'truncated') f.state.truncated = true;
    if (mode === 'uploads') f.state.uploads = '<Upload><Key>private</Key><UploadId>private</UploadId></Upload>';
    if (mode === 'versioning') f.state.versioning = '<Status>Enabled</Status>';
    await assert.rejects(audit.verify(), bad);
    assert.throws(() => audit.snapshot(), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

test('streamHistoryReadsAllPagesAndKeepsIndependentObjectIntervals', async t => {
  const f = await fixture(t), audit = await open(f);
  success(f, audit, put(4), 2, 3, 4);
  f.time(4); const finish = audit.begin({ ...put(2), path: '/synthetic/SECOND_PRIVATE_CANARY' });
  f.time(6); finish({ statusCode: 200, bytesOut: 2 }); f.rows.set('SECOND_PRIVATE_CANARY', 2);
  f.state.paged = true; f.time(10); await audit.verify();
  assert.equal(audit.snapshot().objects.bytes, 6);
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 36, high: 44 });
});

test('streamHistoryRequiresEmptyUnversionedBoundBaseline', async t => {
  for (const mode of ['rows', 'versioning', 'uploads', 'unbound']) {
    const f = await fixture(t);
    if (mode === 'rows') f.rows.set(key, 4);
    if (mode === 'versioning') f.state.versioning = '<Status>Suspended</Status>';
    if (mode === 'uploads') f.state.uploads = '<Upload><Key>private</Key><UploadId>private</UploadId></Upload>';
    if (mode === 'unbound') {
      f.args.client = new sdk.S3Client({ endpoint: f.target, forcePathStyle: true, maxAttempts: 1, region: 'eu-north-1',
        credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
      t.after(() => f.args.client.destroy());
    }
    await assert.rejects(open(f), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

function send(target, method, bytes, ordinal) {
  return new Promise((resolve, reject) => {
    const req = request(target + path, { method, headers: { 'content-length': String(bytes),
      'amz-sdk-invocation-id': `11111111-2222-4333-8444-${String(ordinal).padStart(12, '0')}`, 'amz-sdk-request': 'attempt=1; max=1' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end(Buffer.alloc(bytes));
  });
}
// Unbinding the first hop leaves the final empty bucket unable to explain earlier retained storage.
test('streamHistoryPairsRealTransportReplacementAndDeletionWithRetiredBytes', async t => {
  const f = await fixture(t), lifetimes = await open(f), producer = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: f.target, meter: producer, phase: 'workload', lifetimes });
  t.after(() => front.close().catch(() => {}));
  for (const [n, method, bytes, start, end] of [[1, 'PUT', 4, 2, 3], [2, 'PUT', 6, 5, 7], [3, 'DELETE', 0, 10, 12]]) {
    f.time(start); f.state.onMutation = () => f.time(end);
    assert.equal(await send(front.url, method, bytes, n), method === 'DELETE' ? 204 : 200);
  }
  await front.close(); f.time(20); await lifetimes.verify();
  assert.equal(lifetimes.snapshot().objects.bytes, 0);
  assert.deepEqual(lifetimes.snapshot().byteSeconds, { low: 26, high: 62 });
  assert.equal(producer.snapshot().accounting.producer.bytesOut, 10);
});

test('streamHistoryRefusesUnsupportedMutationsBeforeTheyReachBackend', async t => {
  for (const input of [
    { ...put(4), path: path + '?x-id=DeleteObject' }, { ...put(4), path: path + '?x-id=PutObject&private=1' },
    { ...put(4), path: path + '?versionId=private' }, { ...put(4), method: 'GET', path: path + '?versionId=private' },
    { ...put(4), method: 'POST', path: path + '?uploads' },
    { ...put(4), path: '/foreign/' + key }, { ...put(4), path: '/synthetic/a%2Fb' },
    { ...put(4), path: '/synthetic/%2e%2e/secret' }, { ...put(4), headers: {} },
    { ...put(4), headers: { 'content-length': '4', 'content-encoding': 'gzip' } },
    { ...put(4), headers: { 'content-length': '4', 'x-amz-copy-source': '/private' } },
  ]) {
    const f = await fixture(t), audit = await open(f), before = f.state.requests;
    assert.throws(() => audit.begin(input), bad); assert.equal(f.state.requests, before);
    assert.throws(() => audit.snapshot(), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

// The validated SDK operation hint must not make a native single-object mutation unsupported.
test('streamHistoryAcceptsValidatedSdkOperationHintsForPutAndDelete', async t => {
  const f = await fixture(t), audit = await open(f);
  success(f, audit, { ...put(4), path: path + '?x-id=PutObject' }, 1, 2, 4);
  success(f, audit, { ...del(), path: path + '?x-id=DeleteObject' }, 4, 5);
  f.time(6); await audit.verify();
  assert.equal(audit.snapshot().objects.bytes, 0);
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 8, high: 16 });
});

// Discarding an unchanged failed overwrite or an empty object must not reset the surviving interval.
test('streamHistoryKeepsSameSizeFailedWritesZeroByteObjectsAndAbsentDeletes', async t => {
  const f = await fixture(t), audit = await open(f);
  success(f, audit, del(), 1, 2);
  success(f, audit, put(4), 3, 4, 4);
  f.time(6); const failed = audit.begin(put(4)); f.time(7); failed({ statusCode: 503, bytesOut: 4 });
  f.time(10); await audit.verify();
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 24, high: 28 });
  success(f, audit, put(0), 12, 13, 0);
  f.time(15); await audit.verify();
  assert.equal(audit.snapshot().objects.currentVersions, 1); assert.equal(audit.snapshot().objects.bytes, 0);
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 32, high: 40 });
});

// Freezing the inventory while a request can still commit could validate an incomplete history.
test('streamHistoryRefusesInventoryDuringPendingTransfers', async t => {
  const f = await fixture(t), audit = await open(f);
  audit.begin(put(4));
  assert.throws(() => audit.snapshot(), bad);
  await assert.rejects(audit.verify(), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// A provider reusing a continuation token must not turn partial inventory into measured totals.
test('streamHistoryRefusesRepeatedInventoryContinuation', async t => {
  const f = await fixture(t), audit = await open(f);
  f.state.repeatToken = true;
  const before = f.state.requests;
  await assert.rejects(audit.verify(), bad);
  assert.ok(f.state.requests - before <= 4, 'a repeated token must stop without consuming the page budget');
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// Counting at the client instead of binding at the first hop must not admit an unsupported mutation.
test('streamHistoryTransportBlocksMultipartBeforeForwarding', async t => {
  const f = await fixture(t), lifetimes = await open(f), producer = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: f.target, meter: producer, phase: 'workload', lifetimes });
  t.after(() => front.close().catch(() => {}));
  const before = f.state.requests;
  const status = await new Promise((resolve, reject) => {
    const req = request(front.url + path + '?uploads', { method: 'POST', headers: {
      'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=1',
    } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(status, 400); assert.equal(f.state.requests, before);
  await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
  assert.throws(() => lifetimes.snapshot(), bad); assert.throws(() => producer.snapshot(), /Invalid cloud cost meter/);
});

import { lifetimeExchange, assertIncompleteList } from './litestream-lifetime-test-utils.mjs';
test('unversioned histories settle only a ledger-accepted interrupted list without creating an object', async t => {
  const f = await fixture(t);
  const e = await lifetimeExchange(t, { open: afterStop => storage.openLitestreamHistories({ ...f.args, afterStop }),
    input: { method: 'GET', path: '/synthetic?list-type=2', headers: {} } });
  await assertIncompleteList(f, e);
  f.rows.set('UNPAIRED_PRIVATE_CANARY', 1);
  await assert.rejects(e.lifetimes.verify(), bad);
  assert.throws(() => e.afterStop.snapshot(), /Invalid cloud cost Litestream audit/);
});
for (const interrupted of [false, true]) test(`unversioned histories retain a witnessed committed prior PUT: interrupted=${interrupted}`, async t => {
  const f = await fixture(t);
  const e = await lifetimeExchange(t, { open: afterStop => storage.openLitestreamHistories({ ...f.args, afterStop }),
    input: put(4), interrupted, commit: () => f.rows.set(key, 4) });
  await e.transport.close(); f.time(10); await e.lifetimes.verify();
  assert.equal(e.lifetimes.snapshot().objects.bytes, 4); assert.equal(e.afterStop.snapshot().used, 1);
  assert.deepEqual(e.lifetimes.snapshot().byteSeconds, { low: 40, high: 40 });
});

test('unversioned history reader requires its own producer settlement', async t => {
  const { createLitestreamAfterStop } = await import('./litestream.mjs');
  const f = await fixture(t), afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const invocation = '11111111-2222-4333-8444-555555555555';
  afterStop.admit({ invocation, ordinal: 0, operation: 'list', hop: 'producer', phase: 'workload' });
  const reader = await storage.openLitestreamHistories({ ...f.args, afterStop });
  const finish = reader.begin({ method: 'GET', path: '/synthetic?list-type=2',
    headers: { 'amz-sdk-invocation-id': invocation, 'amz-sdk-request': 'attempt=1; max=3' } });
  assert.throws(() => finish({ statusCode: 200, bytesOut: 0 }), bad);
});

// Final restore uses the same history, with ordinary strict read completion after replication stops.
test('the shared history keeps final restore reads strict after runtime stop', async t => {
  const { createLitestreamAfterStop } = await import('./litestream.mjs');
  const f = await fixture(t), afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const reader = await storage.openLitestreamHistories({ ...f.args, afterStop });
  afterStop.acknowledgeStop({statusCode:200,ownedPath:'/owned.db',body:Buffer.from('{"status":"stopped","path":"/owned.db","txid":0}')});
  const finish = reader.strictReads.begin({ method: 'GET', path, headers: {} });
  finish({ statusCode: 200, bytesOut: 0, interrupted: false, responseHeaders: {} });
  await reader.verify();assert.equal(reader.snapshot().objects.bytes, 0);assert.equal(afterStop.snapshot().used, 0);
});
for (const method of ['PUT', 'DELETE', 'POST']) test(`the strict restore view refuses ${method} before storage`, async t => {
  const { createLitestreamAfterStop } = await import('./litestream.mjs');
  const f = await fixture(t), afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const reader = await storage.openLitestreamHistories({ ...f.args, afterStop });
  assert.throws(() => reader.strictReads.begin({ method, path, headers: {'content-length':'4'} }), bad);
  await assert.rejects(reader.verify(), bad);assert.throws(() => afterStop.snapshot());
});
test('an interrupted final restore read still poisons the shared history', async t => {
  const { createLitestreamAfterStop } = await import('./litestream.mjs');
  const f = await fixture(t), afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const reader = await storage.openLitestreamHistories({ ...f.args, afterStop });
  const finish = reader.strictReads.begin({ method: 'GET', path, headers: {} });
  assert.throws(() => finish({ statusCode: 200, bytesOut: 0, interrupted: true, responseHeaders: {} }), bad);
  await assert.rejects(reader.verify(), bad);assert.throws(() => afterStop.snapshot());
});
