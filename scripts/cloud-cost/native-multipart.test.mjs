import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { openLitestreamHistories } from './storage-lifetimes.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient, classifyStorageOperation } from './meter.mjs';
import { createLitestreamTransport } from './litestream.mjs';

const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3'), bad = /Invalid cloud cost storage lifetimes/;
const Key = 'PRIVATE_CANARY', UploadId = 'PRIVATE_UPLOAD';
const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const createReply = () => Buffer.from(`<InitiateMultipartUploadResult><Bucket>synthetic</Bucket><Key>${Key}</Key><UploadId>${UploadId}</UploadId></InitiateMultipartUploadResult>`);
const completion = (parts = [[1, 'one']]) => Buffer.from('<CompleteMultipartUpload>' + parts.map(([n, tag]) => `<Part><PartNumber>${n}</PartNumber><ETag>${xml(tag)}</ETag></Part>`).join('') + '</CompleteMultipartUpload>');
const completeReply = () => Buffer.from(`<CompleteMultipartUploadResult><Bucket>synthetic</Bucket><Key>${Key}</Key><ETag>final</ETag></CompleteMultipartUploadResult>`);

async function fixture(t, enabled = true) {
  let time = 0;
  const objects = new Map(), uploads = new Map(), state = { requests: 0, duplicate: false, foreign: false, truncated: false };
  const backend = createServer((req, res) => {
    state.requests++; req.resume(); req.on('end', () => {
      const q = new URL(req.url, 'http://local').searchParams;
      if (q.has('versioning')) res.end('<VersioningConfiguration/>');
      else if (q.has('uploads')) res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated>' + [...uploads].map(([id]) => `<Upload><Key>${Key}</Key><UploadId>${id}</UploadId></Upload>`).join('') + '</ListMultipartUploadsResult>');
      else if (q.has('uploadId')) {
        const parts = [...(uploads.get(q.get('uploadId')) ?? [])];
        if (state.duplicate && parts.length) parts.push(parts[0]);
        if (state.foreign) parts.push([10, { bytes: 2, etag: 'foreign' }]);
        res.end(`<ListPartsResult><IsTruncated>${state.truncated}</IsTruncated>` + parts.map(([n, p]) => `<Part><PartNumber>${n}</PartNumber><Size>${p.bytes}</Size><ETag>${xml(p.etag)}</ETag></Part>`).join('') + '</ListPartsResult>');
      } else res.end('<ListBucketResult><IsTruncated>false</IsTruncated>' + [...objects].map(([k, n]) => `<Contents><Key>${k}</Key><Size>${n}</Size></Contents>`).join('') + '</ListBucketResult>');
    });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'observer', clock: () => time });
  const proxy = await createMeteringProxy({ target: `http://127.0.0.1:${backend.address().port}`, meter, classify: correlatedStorageAttempt }); t.after(() => proxy.close());
  const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  instrumentStorageClient({ client, meter, phase: 'observer', endpoint: proxy.url }); t.after(() => client.destroy());
  const audit = await openLitestreamHistories({ client, sdk, meter, bucket: 'synthetic', clock: () => time, ...(enabled ? { allowMultipart: true } : {}) });
  return { objects, uploads, state, meter, audit, time: n => { time = n; } };
}
function input(op, bytes = 0, body) {
  return { method: { create: 'POST', part: 'PUT', complete: 'POST', abort: 'DELETE' }[op],
    path: '/synthetic/' + Key + (op === 'create' ? '?uploads=' : '?uploadId=' + UploadId + (op === 'part' ? '&partNumber=1' : '')),
    headers: { 'content-length': String(body?.length ?? bytes) }, body };
}
function create(f, from = 1, by = 2) {
  f.time(from); let finish;
  assert.doesNotThrow(() => { finish = f.audit.begin(input('create')); }, 'explicit multipart mode must admit upload creation');
  f.time(by); finish({ statusCode: 200, bytesOut: 0, responseBody: createReply() }); f.uploads.set(UploadId, new Map());
}
function part(f, bytes = 4, from = 3, by = 4, etag = 'one') {
  f.time(from); const finish = f.audit.begin(input('part', bytes)); f.time(by);
  finish({ statusCode: 200, bytesOut: bytes, responseHeaders: { etag } }); f.uploads.get(UploadId).set(1, { bytes, etag });
}

// Discarding replaced/aborted parts loses these hand-calculated retained byte-seconds.
test('nativeMultipartRetainsReplacedAndAbortedParts', async t => {
  const f = await fixture(t); create(f); part(f); f.time(5); await f.audit.verify();
  assert.deepEqual(f.audit.snapshot().objects, { class: 'stream', bytes: 4, currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 1 });
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 4, high: 8 });
  part(f, 6, 6, 8, 'two'); assert.throws(() => f.audit.snapshot(), bad);
  f.time(10); await f.audit.verify(); assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 20, high: 44 });
  f.time(11); const end = f.audit.begin(input('abort')); f.time(12); end({ statusCode: 204, bytesOut: 0 }); f.uploads.clear();
  f.time(15); await f.audit.verify(); assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 26, high: 56 });
  assert.equal(f.audit.snapshot().objects.bytes, 0); assert.equal(f.audit.snapshot().objects.unfinishedMultipart, 0);
  assert.equal(f.meter.snapshot().reconciled, true); assert.equal(/PRIVATE|CANARY/.test(JSON.stringify(f.audit.snapshot())), false);
});

// Completing parts must transfer them into object history and preserve any previous object.
test('nativeMultipartCompletionRetainsPartsAndEarlierObject', async t => {
  const f = await fixture(t); f.time(0); const put = f.audit.begin({ method: 'PUT', path: '/synthetic/' + Key, headers: { 'content-length': '2' } });
  f.time(1); put({ statusCode: 200, bytesOut: 2 }); f.objects.set(Key, 2); create(f, 2, 3); part(f, 4, 4, 5);
  const body = completion(); f.time(7); const finish = f.audit.begin(input('complete', 0, body)); f.time(9);
  finish({ statusCode: 200, bytesOut: body.length, responseBody: completeReply() }); f.uploads.clear(); f.objects.set(Key, 4);
  f.time(12); await f.audit.verify();
  assert.deepEqual(f.audit.snapshot().objects, { class: 'stream', bytes: 4, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 32, high: 58 });
});

for (const mode of ['default', 'foreign', 'escape', 'copy', 'encoding', 'body', 'unknown-upload', 'unknown-part', 'etag', 'order', 'duplicate', 'length', 'overlap']) test(`nativeMultipartRefusesUnsafeAdmission_${mode}`, async t => {
  const f = await fixture(t, mode !== 'default'); let request = input('create');
  if (['unknown-upload', 'unknown-part', 'etag', 'order', 'duplicate', 'length'].includes(mode)) {
    create(f); part(f); let parts = [[1, 'one']];
    if (mode === 'unknown-part') parts = [[2, 'one']];
    if (mode === 'etag') parts = [[1, 'wrong']];
    if (mode === 'order') parts = [[2, 'one'], [1, 'one']];
    if (mode === 'duplicate') parts.push([1, 'one']);
    request = input('complete', 0, completion(parts));
    if (mode === 'unknown-upload') request.path = request.path.replace(UploadId, 'unknown');
    if (mode === 'length') request.headers['content-length'] = '1';
  }
  if (mode === 'foreign') request.path = request.path.replace('synthetic', 'foreign');
  if (mode === 'escape') request.path = '/synthetic/%2e%2e/private?uploads=';
  if (mode === 'copy') request.headers['x-amz-copy-source'] = 'private';
  if (mode === 'encoding') request.headers['content-encoding'] = 'gzip';
  if (mode === 'body') request.headers['content-length'] = '1';
  if (mode === 'overlap') f.audit.begin(request);
  const before = f.state.requests; assert.throws(() => f.audit.begin(request), bad); assert.equal(f.state.requests, before);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const mode of ['lost-create', 'lost-part', 'lost-complete', 'lost-abort', 'embedded-error', 'wrong-key', 'wrong-bucket', 'create-key', 'create-bucket', 'duplicate-upload', 'empty-upload', 'missing-etag', 'short', 'interrupted', 'twice', 'backward-clock']) test(`nativeMultipartRefusesUnprovedCompletion_${mode}`, async t => {
  const f = await fixture(t); let op = 'create';
  if (['lost-part', 'missing-etag'].includes(mode)) { create(f); op = 'part'; }
  if (['lost-complete', 'lost-abort', 'embedded-error', 'wrong-key', 'wrong-bucket'].includes(mode)) { create(f); part(f); op = mode === 'lost-abort' ? 'abort' : 'complete'; }
  if (mode === 'duplicate-upload') create(f);
  const body = op === 'complete' ? completion() : undefined, req = input(op, op === 'part' ? 4 : 0, body);
  f.time(6); const finish = f.audit.begin(req); f.time(mode === 'backward-clock' ? 5 : 7);
  const event = { statusCode: mode.startsWith('lost-') ? 503 : op === 'abort' ? 204 : 200,
    bytesOut: Number(req.headers['content-length']) - (mode === 'short' ? 1 : 0), interrupted: mode === 'interrupted',
    responseBody: op === 'complete' ? completeReply() : createReply(), responseHeaders: {} };
  if (mode === 'embedded-error') event.responseBody = Buffer.from('<Error><Code>InternalError</Code></Error>');
  if (mode === 'wrong-key') event.responseBody = Buffer.from(completeReply().toString().replace(Key, 'foreign'));
  if (mode === 'wrong-bucket') event.responseBody = Buffer.from(completeReply().toString().replace('synthetic', 'foreign'));
  if (mode === 'empty-upload') event.responseBody = Buffer.from(createReply().toString().replace(UploadId, ''));
  if (mode === 'create-key') event.responseBody = Buffer.from(createReply().toString().replace(Key, 'foreign'));
  if (mode === 'create-bucket') event.responseBody = Buffer.from(createReply().toString().replace('synthetic', 'foreign'));
  if (mode === 'twice') finish(event);
  assert.throws(() => finish(event), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const mode of ['missing-upload', 'foreign-upload', 'missing-part', 'size', 'etag', 'duplicate', 'foreign', 'truncated', 'pending']) test(`nativeMultipartRequiresIndependentInventory_${mode}`, async t => {
  const f = await fixture(t); create(f); part(f);
  if (mode === 'missing-upload') f.uploads.clear();
  if (mode === 'foreign-upload') f.uploads.set('FOREIGN', new Map());
  if (mode === 'missing-part') f.uploads.get(UploadId).clear();
  if (mode === 'size') f.uploads.get(UploadId).get(1).bytes++;
  if (mode === 'etag') f.uploads.get(UploadId).get(1).etag = 'wrong';
  if (['duplicate', 'foreign', 'truncated'].includes(mode)) f.state[mode] = true;
  if (mode === 'pending') f.audit.begin(input('part', 4));
  await assert.rejects(f.audit.verify(), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// Real SDK control bytes must reach the lifetime listener independently of the byte meter.
test('nativeMultipartTransportSuppliesActualSdkControlResponses', async t => {
  const f = await fixture(t), meter = createMeter({ phase: 'workload', clock: () => 0 });
  const backend = createServer((req, res) => { req.resume(); req.on('end', () => {
    const q = new URL(req.url, 'http://local').searchParams;
    if (q.has('uploads')) res.end(createReply());
    else if (req.method === 'PUT') { res.setHeader('etag', 'one'); res.end(); }
    else res.end(completeReply());
  }); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const observer = await createMeteringProxy({ target: `http://127.0.0.1:${backend.address().port}`, meter, classify: input => ({
    token: input.headers['amz-sdk-invocation-id'] + ':1', phase: 'workload', operation: classifyStorageOperation(input),
    retryOrdinal: 0, errorCode: null, sameAccount: null,
  }) }); t.after(() => observer.close());
  const front = await createLitestreamTransport({ target: observer.url, meter, phase: 'workload', lifetimes: f.audit }); t.after(() => front.close().catch(() => {}));
  const writer = new sdk.S3Client({ endpoint: front.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  t.after(() => writer.destroy());
  f.time(1); const made = await writer.send(new sdk.CreateMultipartUploadCommand({ Bucket: 'synthetic', Key }));
  f.uploads.set(UploadId, new Map()); assert.equal(made.UploadId, UploadId);
  f.time(3); const uploaded = await writer.send(new sdk.UploadPartCommand({ Bucket: 'synthetic', Key, UploadId, PartNumber: 1, Body: Buffer.from('four') }));
  f.uploads.get(UploadId).set(1, { bytes: 4, etag: uploaded.ETag });
  f.time(6); await writer.send(new sdk.CompleteMultipartUploadCommand({ Bucket: 'synthetic', Key, UploadId, MultipartUpload: { Parts: [{ PartNumber: 1, ETag: uploaded.ETag }] } }));
  f.uploads.clear(); f.objects.set(Key, 4); await front.close(); f.time(10); await f.audit.verify();
  assert.equal(f.audit.snapshot().objects.bytes, 4); assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 28, high: 28 });
  const proof = meter.snapshot(); assert.equal(proof.reconciled, true, JSON.stringify(proof.accounting)); assert.equal(proof.accounting.producer.attempts, 3);
  assert.deepEqual(proof.accounting.producer, proof.accounting.observer); assert.ok(proof.accounting.producer.bytesOut > 4); assert.ok(proof.accounting.producer.bytesIn > 0);
});
