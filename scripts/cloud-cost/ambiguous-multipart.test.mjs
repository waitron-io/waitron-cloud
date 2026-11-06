import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { openLitestreamHistories } from './storage-lifetimes.mjs';
import { openLitestreamVersionHistories } from './stream-versions.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from './meter.mjs';
import { createLitestreamTransport } from './litestream.mjs';

const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3'), bad = /Invalid cloud cost storage lifetimes/;
const Key = 'PRIVATE_CANARY', UploadId = 'PRIVATE_UPLOAD', path = '/synthetic/' + Key;
const completion = Buffer.from('<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>one</ETag></Part></CompleteMultipartUpload>');
const made = Buffer.from(`<InitiateMultipartUploadResult><Bucket>synthetic</Bucket><Key>${Key}</Key><UploadId>${UploadId}</UploadId></InitiateMultipartUploadResult>`);
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

async function fixture(t, versioned, options = {}) {
  let time = 0;
  const uploads = new Map(), objects = [], state = { duplicate: false, foreignKey: false };
  const server = createServer((req, res) => { req.resume(); req.on('end', () => {
    const q = new URL(req.url, 'http://local').searchParams;
    if (q.has('versioning')) res.end('<VersioningConfiguration>' + (versioned ? '<Status>Enabled</Status>' : '') + '</VersioningConfiguration>');
    else if (q.has('uploads')) {
      const entries = [...uploads]; if (state.duplicate && entries.length) entries.push(entries[0]);
      res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated>' + entries.map(([id]) => `<Upload><Key>${state.foreignKey ? 'OTHER' : Key}</Key><UploadId>${escape(id)}</UploadId></Upload>`).join('') + '</ListMultipartUploadsResult>');
    } else if (q.has('uploadId')) res.end('<ListPartsResult><IsTruncated>false</IsTruncated>' + [...(uploads.get(q.get('uploadId')) ?? [])].map(([n, p]) => `<Part><PartNumber>${n}</PartNumber><Size>${p.bytes}</Size><ETag>${escape(p.etag)}</ETag></Part>`).join('') + '</ListPartsResult>');
    else if (versioned) res.end('<ListVersionsResult><IsTruncated>false</IsTruncated>' + objects.map(o => `<Version><Key>${Key}</Key><VersionId>${o.id}</VersionId><IsLatest>${o.latest}</IsLatest><Size>${o.bytes}</Size></Version>`).join('') + '</ListVersionsResult>');
    else res.end('<ListBucketResult><IsTruncated>false</IsTruncated>' + objects.map(o => `<Contents><Key>${Key}</Key><Size>${o.bytes}</Size></Contents>`).join('') + '</ListBucketResult>');
  }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const meter = createMeter({ phase: 'observer', clock: () => time });
  const proxy = await createMeteringProxy({ target: `http://127.0.0.1:${server.address().port}`, meter, classify: correlatedStorageAttempt }); t.after(() => proxy.close());
  const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  instrumentStorageClient({ client, meter, phase: 'observer', endpoint: proxy.url }); t.after(() => client.destroy());
  const open = versioned ? openLitestreamVersionHistories : openLitestreamHistories;
  const audit = await open({ client, sdk, meter, bucket: 'synthetic', clock: () => time, allowMultipart: true, resolveMultipartReplies: true, ...options });
  return { uploads, objects, state, meter, audit, time: n => { time = n; } };
}
function input(op, bytes = 4) {
  return { method: op === 'part' ? 'PUT' : op === 'abort' ? 'DELETE' : 'POST',
    path: path + (op === 'create' ? '?uploads=' : '?uploadId=' + UploadId + (op === 'part' ? '&partNumber=1' : '')),
    headers: { 'content-length': String(op === 'part' ? bytes : op === 'complete' ? completion.length : 0) },
    ...(op === 'complete' ? { body: completion } : {}) };
}
function create(f) {
  f.time(1); const end = f.audit.begin(input('create')); f.time(2);
  end({ statusCode: 200, bytesOut: 0, responseBody: made }); f.uploads.set(UploadId, new Map());
}
function part(f) {
  f.time(3); const end = f.audit.begin(input('part')); f.time(4);
  end({ statusCode: 200, bytesOut: 4, responseHeaders: { etag: 'one' } }); f.uploads.get(UploadId).set(1, { bytes: 4, etag: 'one' });
}
function lost(f, op, bytes = 4) {
  f.time(6); const req = input(op, bytes), end = f.audit.begin(req); f.time(7);
  assert.doesNotThrow(() => end({ statusCode: 503, bytesOut: Number(req.headers['content-length']) }), 'full-body failed reply must wait for an independent inventory');
  assert.throws(() => f.audit.snapshot(), bad, 'unresolved storage cannot be reported as measured');
}
function anonymous(f) {
  assert.equal(/PRIVATE|CANARY|UPLOAD|UploadId|VersionId/.test(JSON.stringify(f.audit.snapshot())), false);
  assert.equal(f.meter.snapshot().reconciled, true);
}

// Inventory, rather than a truncated reply, proves whether each mutation was retained.
for (const versioned of [false, true]) for (const resolveMultipartReplies of [false, true]) {
  for (const op of ['create', 'part', 'complete', 'abort']) for (const committed of [false, true]) {
    test(`multipart cutoff stays unknown ${versioned}/${resolveMultipartReplies}/${op}/${committed}`, async t => {
      const f = await fixture(t, versioned, { resolveMultipartReplies });
      if (op !== 'create') create(f);
      if (op === 'complete' || op === 'abort') part(f);
      f.time(6); const req = input(op), end = f.audit.begin(req); f.time(7);
      assert.doesNotThrow(() => end({ statusCode: null, bytesOut: Math.max(0, Number(req.headers['content-length']) - 1),
        interrupted: true, responseBody: Buffer.from('<PRIVATE_PARTIAL'), responseHeaders: {} }));
      if (committed) {
        if (op === 'create') f.uploads.set(UploadId, new Map());
        if (op === 'part') f.uploads.get(UploadId).set(1, { bytes: 4, etag: 'one' });
        if (op === 'complete' || op === 'abort') f.uploads.clear();
        if (op === 'complete') f.objects.push({ id: 'new', bytes: 4, latest: true });
      }
      f.time(10); await f.audit.verify(); f.time(12);
      const result = f.audit.snapshot();
      assert.equal(result.status, 'unknown'); assert.deepEqual(result.gaps, ['accounting:request-cutoff']);
      assert.equal(result.objects.bytes, op === 'create' ? 0 : op === 'part' ? committed ? 4 : 0
        : op === 'abort' && committed ? 0 : 4);
      assert.equal(result.objects.unfinishedMultipart, op === 'create' ? committed ? 1 : 0
        : (op === 'complete' || op === 'abort') && committed ? 0 : 1);
      const bounds = op === 'create' ? { low: 0, high: 0 } : op === 'part'
        ? committed ? { low: 8, high: 24 } : { low: 0, high: 0 }
        : committed ? op === 'complete' ? { low: 16, high: 52 } : { low: 8, high: 28 }
          : { low: 32, high: 36 };
      assert.deepEqual(result.byteSeconds, bounds);
      assert.ok(f.meter.snapshot().gaps.includes('accounting:request-cutoff'));
      await f.audit.verify(); assert.deepEqual(f.audit.snapshot().gaps, ['accounting:request-cutoff']);
      assert.doesNotMatch(JSON.stringify(f.audit.snapshot()), /PRIVATE|CANARY|UPLOAD|UploadId|VersionId/);
      assert.equal(f.meter.diagnostics().firstInvalidation, null);
    });
  }
}

for (const versioned of [false, true]) for (const event of [
  { statusCode: null, bytesOut: 0, interrupted: false },
  { statusCode: 600, bytesOut: 0, interrupted: true },
  { statusCode: 200, bytesOut: -1, interrupted: true },
  { statusCode: 200, bytesOut: 5, interrupted: true },
  { statusCode: 200, bytesOut: 0, interrupted: 'true' },
]) test(`multipart malformed cutoff still refuses ${versioned}/${JSON.stringify(event)}`, async t => {
  const f = await fixture(t, versioned); create(f);
  assert.throws(() => f.audit.begin(input('part'))(event), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const versioned of [false, true]) for (const op of ['create', 'part', 'complete', 'abort']) {
  test(`real multipart lost reply collects and preserves inventory ${versioned}/${op}`, async t => {
    const f = await fixture(t, versioned, { resolveMultipartReplies: false });
    if (op !== 'create') create(f);
    if (op === 'complete' || op === 'abort') part(f);
    let received = 0;
    const backend = createServer((req, res) => { req.resume(); req.once('end', () => {
      received++;
      if (op === 'create') f.uploads.set(UploadId, new Map());
      if (op === 'part') f.uploads.get(UploadId).set(1, { bytes: 4, etag: 'one' });
      if (op === 'complete' || op === 'abort') f.uploads.clear();
      if (op === 'complete') f.objects.push({ id: 'new', bytes: 4, latest: true });
      res.destroy();
    }); });
    backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
    t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
    const meter = createMeter({ phase: 'workload', clock: () => 0 });
    const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`,
      meter, phase: 'workload', lifetimes: f.audit });
    t.after(() => front.close().catch(() => {}));
    f.time(6); const req = input(op);
    await assert.rejects(new Promise((resolve, reject) => {
      const caller = request(front.url + req.path, { method: req.method, headers: { ...req.headers,
        'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=1',
      } }, async res => {
        try { for await (const chunk of res) void chunk; resolve(res.statusCode); }
        catch { reject(Error('Synthetic reply cutoff')); }
      });
      caller.once('error', () => reject(Error('Synthetic request cutoff')));
      caller.end(op === 'part' ? Buffer.from('four') : req.body);
    }), /Synthetic (request|reply) cutoff/);
    await front.whenIdle(() => {}); await front.close();
    f.time(10); await f.audit.verify();
    assert.equal(received, 1);
    assert.equal(f.audit.snapshot().objects.bytes, op === 'part' || op === 'complete' ? 4 : 0);
    assert.equal(f.audit.snapshot().objects.unfinishedMultipart, op === 'part' || op === 'create' ? 1 : 0);
    assert.equal(f.audit.snapshot().status, 'unknown');
    assert.deepEqual(f.audit.snapshot().gaps, ['accounting:request-cutoff']);
    assert.equal(meter.snapshot().accounting.requests[0].outcome, 'transport-error');
    assert.equal(meter.snapshot().status, 'unknown');
    assert.equal(meter.diagnostics().firstInvalidation, null);
    assert.equal(front.checkpoint().pending, 0); assert.equal(front.checkpoint().connections, 0);
  });
}

// Each case fails if a failed create is dropped or admitted without identifying its owned empty upload.
for (const versioned of [false, true]) for (const committed of [false, true]) test(`lostCreateInventory_${versioned}_${committed}`, async t => {
  const f = await fixture(t, versioned); lost(f, 'create');
  if (committed) f.uploads.set(UploadId, new Map());
  f.time(10); await f.audit.verify(); const result = f.audit.snapshot();
  assert.equal(result.objects.unfinishedMultipart, committed ? 1 : 0); assert.equal(result.objects.bytes, 0);
  if (committed) { f.time(11); const end = f.audit.begin(input('part')); f.time(12); end({ statusCode: 200, bytesOut: 4, responseHeaders: { etag: 'one' } }); f.uploads.get(UploadId).set(1, { bytes: 4, etag: 'one' }); }
  f.time(15); await f.audit.verify(); assert.deepEqual(f.audit.snapshot().byteSeconds, committed ? { low: 12, high: 16 } : { low: 0, high: 0 }); anonymous(f);
});

// The low bound cannot assume the failed replacement committed at its request or reply time.
for (const versioned of [false, true]) for (const committed of [false, true]) test(`lostPartReplacementInventory_${versioned}_${committed}`, async t => {
  const f = await fixture(t, versioned); create(f); part(f); lost(f, 'part', 6);
  if (committed) f.uploads.get(UploadId).set(1, { bytes: 6, etag: 'two' });
  f.time(10); await f.audit.verify(); assert.equal(f.audit.snapshot().objects.bytes, committed ? 6 : 4);
  f.time(12); assert.deepEqual(f.audit.snapshot().byteSeconds, committed ? { low: 20, high: 64 } : { low: 32, high: 36 }); anonymous(f);
});

for (const versioned of [false, true]) for (const committed of [false, true]) test(`lostFirstPartInventory_${versioned}_${committed}`, async t => {
  const f = await fixture(t, versioned); create(f); lost(f, 'part');
  if (committed) f.uploads.get(UploadId).set(1, { bytes: 4, etag: 'one' });
  f.time(10); await f.audit.verify(); f.time(12);
  assert.equal(f.audit.snapshot().objects.bytes, committed ? 4 : 0);
  assert.deepEqual(f.audit.snapshot().byteSeconds, committed ? { low: 8, high: 24 } : { low: 0, high: 0 }); anonymous(f);
});

for (const versioned of [false, true]) for (const committed of [false, true]) test(`lostAbortInventory_${versioned}_${committed}`, async t => {
  const f = await fixture(t, versioned); create(f); part(f); lost(f, 'abort');
  if (committed) f.uploads.clear();
  f.time(10); await f.audit.verify(); f.time(12);
  assert.equal(f.audit.snapshot().objects.unfinishedMultipart, committed ? 0 : 1);
  assert.equal(f.audit.snapshot().objects.bytes, committed ? 0 : 4);
  assert.deepEqual(f.audit.snapshot().byteSeconds, committed ? { low: 8, high: 28 } : { low: 32, high: 36 }); anonymous(f);
});

for (const versioned of [false, true]) for (const committed of [false, true]) test(`lostCompletionInventory_${versioned}_${committed}`, async t => {
  const f = await fixture(t, versioned); create(f); part(f); lost(f, 'complete');
  if (committed) { f.uploads.clear(); f.objects.push({ id: 'new', bytes: 4, latest: true }); }
  f.time(10); await f.audit.verify(); f.time(12);
  assert.deepEqual(f.audit.snapshot().objects, { class: 'stream', bytes: 4, currentVersions: committed ? 1 : 0,
    noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: committed ? 0 : 1 });
  assert.deepEqual(f.audit.snapshot().byteSeconds, committed ? { low: 16, high: 52 } : { low: 32, high: 36 }); anonymous(f);
});

// Resolving a lost multipart completion must keep the earlier version, even with equal-sized data.
test('lostVersionedCompletionRetainsPriorVersion', async t => {
  const f = await fixture(t, true); f.time(0); const put = f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '4' } });
  f.time(1); put({ statusCode: 200, bytesOut: 4, responseHeaders: { 'x-amz-version-id': 'old' } }); f.objects.push({ id: 'old', bytes: 4, latest: true });
  create(f); part(f); lost(f, 'complete'); f.uploads.clear(); f.objects[0].latest = false; f.objects.push({ id: 'new', bytes: 4, latest: true });
  f.time(10); await f.audit.verify(); f.time(12);
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 60, high: 100 });
  assert.equal(f.audit.snapshot().objects.noncurrentVersions, 1); anonymous(f);
});

for (const versioned of [false, true]) for (const mode of ['foreign-create', 'create-parts', 'duplicate-create', 'part-size', 'part-missing', 'part-foreign', 'abort-part-change', 'completion-missing', 'completion-size', 'completion-still-upload', 'overlap', 'repeat-finish']) test(mode === 'overlap' ? `settledMultipartAllowsIndependentCreate_${versioned}` : `ambiguousMultipartRefuses_${versioned}_${mode}`, async t => {
  const f = await fixture(t, versioned), op = mode.includes('create') ? 'create' : mode.startsWith('completion') ? 'complete' : mode.startsWith('abort') ? 'abort' : 'part';
  if (op !== 'create') { create(f); part(f); }
  lost(f, op, 6);
  if (mode.includes('create')) f.uploads.set(UploadId, new Map());
  if (mode === 'foreign-create') f.uploads.set('FOREIGN', new Map());
  if (mode === 'duplicate-create') f.state.duplicate = true;
  if (mode === 'create-parts') f.uploads.get(UploadId).set(1, { bytes: 4, etag: 'foreign' });
  if (mode === 'part-size') f.uploads.get(UploadId).set(1, { bytes: 5, etag: 'two' });
  if (mode === 'part-missing') f.uploads.get(UploadId).clear();
  if (mode === 'part-foreign') f.uploads.get(UploadId).set(2, { bytes: 6, etag: 'two' });
  if (mode === 'abort-part-change') f.uploads.get(UploadId).get(1).bytes++;
  if (mode.startsWith('completion') && mode !== 'completion-still-upload') f.uploads.clear();
  if (mode === 'completion-size' || mode === 'completion-still-upload') f.objects.push({ id: 'new', bytes: mode === 'completion-size' ? 5 : 4, latest: true });
  f.time(10);
  if (mode === 'overlap') {
    let finish; assert.doesNotThrow(() => { finish = f.audit.begin(input('create')); });
    finish({ statusCode: null, bytesOut: 0, interrupted: true });
    await assert.doesNotReject(f.audit.verify());
    assert.equal(f.audit.snapshot().objects.bytes, 4);
    assert.equal(f.audit.snapshot().objects.unfinishedMultipart, 1);
    assert.equal(f.audit.snapshot().status, 'unknown');
    assert.deepEqual(f.audit.snapshot().gaps, ['accounting:request-cutoff']);
    assert.equal(f.meter.diagnostics().firstInvalidation, null);
  }
  else if (mode === 'repeat-finish') {
    // A failed callback has settled its request; it cannot be applied twice.
    const g = await fixture(t, versioned); create(g); const end = g.audit.begin(input('part')); end({ statusCode: 503, bytesOut: 4 });
    assert.throws(() => end({ statusCode: 503, bytesOut: 4 }), bad);
  } else await assert.rejects(f.audit.verify(), bad);
});

for (const versioned of [false, true]) for (const options of [{ resolveMultipartReplies: 'true' }, { resolveMultipartReplies: null }, { allowMultipart: false }]) test(`ambiguousMultipartRequiresExplicitMode_${versioned}_${JSON.stringify(options)}`, async t => {
  await assert.rejects(fixture(t, versioned, options), bad);
});

// Malformed complete replies remain fatal; interrupted replies retain an accounting gap.
for (const versioned of [false, true]) for (const mode of ['short', 'interrupted', 'status', 'malformed-success', 'empty-etag']) test(mode === 'interrupted'
  ? `ambiguousMultipartRetainsUnknownInterruptedTransfer_${versioned}` : `ambiguousMultipartKeepsUnprovedTransfersRefused_${versioned}_${mode}`, async t => {
  const f = await fixture(t, versioned); create(f);
  const end = f.audit.begin(input('part'));
  const event = { statusCode: mode === 'status' ? 600 : mode === 'malformed-success' || mode === 'empty-etag' ? 200 : 503,
    bytesOut: mode === 'short' ? 3 : 4, interrupted: mode === 'interrupted', responseHeaders: {} };
  if (mode === 'empty-etag') event.responseHeaders.etag = '';
  if (mode === 'interrupted') {
    end(event); await f.audit.verify();
    assert.equal(f.audit.snapshot().status, 'unknown');
    assert.deepEqual(f.audit.snapshot().gaps, ['accounting:request-cutoff']);
    assert.equal(f.audit.snapshot().objects.bytes, 0);
    assert.equal(f.audit.snapshot().objects.unfinishedMultipart, 1);
    assert.ok(f.meter.snapshot().gaps.includes('accounting:request-cutoff')); return;
  }
  assert.throws(() => end(event), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// An old version, or two possible new versions, cannot identify one failed completion.
for (const mode of ['old-only', 'two-new']) test(`ambiguousCompletionRequiresOneFreshVersion_${mode}`, async t => {
  const f = await fixture(t, true); f.time(0); const put = f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '4' } });
  put({ statusCode: 200, bytesOut: 4, responseHeaders: { 'x-amz-version-id': 'old' } }); f.objects.push({ id: 'old', bytes: 4, latest: true });
  create(f); part(f); lost(f, 'complete'); f.uploads.clear();
  if (mode === 'two-new') { f.objects[0].latest = false; f.objects.push({ id: 'one', bytes: 4, latest: false }, { id: 'two', bytes: 4, latest: true }); }
  f.time(10); await assert.rejects(f.audit.verify(), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// Reusing the old same-sized part preserves its original interval; a new ETag needs a bounded replacement.
for (const versioned of [false, true]) for (const changed of [false, true]) test(`sameSizeAmbiguousPartKeepsIdentityAndBounds_${versioned}_${changed}`, async t => {
  const f = await fixture(t, versioned); create(f); part(f); lost(f, 'part');
  if (changed) f.uploads.get(UploadId).get(1).etag = 'different';
  f.time(10); await f.audit.verify(); f.time(12);
  assert.deepEqual(f.audit.snapshot().byteSeconds, changed ? { low: 16, high: 52 } : { low: 32, high: 36 }); anonymous(f);
});

for (const versioned of [false, true]) test(`lostCreateMustMatchRequestedKey_${versioned}`, async t => {
  const f = await fixture(t, versioned); lost(f, 'create'); f.uploads.set(UploadId, new Map()); f.state.foreignKey = true;
  f.time(10); await assert.rejects(f.audit.verify(), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const versioned of [false, true]) for (const method of ['GET', 'PUT', 'DELETE']) test(`lostReplyAllowsSettledOrdinaryRequestsBeforeInventory_${versioned}_${method}`, async t => {
  const f = await fixture(t, versioned); lost(f, 'create'); let finish;
  assert.doesNotThrow(() => { finish = f.audit.begin({ method, path, headers: { 'content-length': '0' } }); });
  finish({ statusCode: method === 'DELETE' ? 204 : 200, bytesOut: 0,
    responseHeaders: { 'x-amz-version-id': 'ordinary', ...(method === 'DELETE' ? { 'x-amz-delete-marker': 'true' } : {}) } });
  // Settle the request before checking that the unresolved upload still prevents a snapshot.
  assert.throws(() => f.audit.snapshot(), bad);
  assert.equal(f.meter.diagnostics().firstInvalidation, null);
});
