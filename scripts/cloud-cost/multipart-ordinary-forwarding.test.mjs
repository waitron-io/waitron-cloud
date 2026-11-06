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
    else if (versioned) res.end('<ListVersionsResult><IsTruncated>false</IsTruncated>' + objects.map(o => o.marker ? `<DeleteMarker><Key>${Key}</Key><VersionId>${o.id}</VersionId><IsLatest>${o.latest}</IsLatest></DeleteMarker>` : `<Version><Key>${Key}</Key><VersionId>${o.id}</VersionId><IsLatest>${o.latest}</IsLatest><Size>${o.bytes}</Size></Version>`).join('') + '</ListVersionsResult>');
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
// A missing multipart reply cannot prevent later owned ordinary requests.
for (const versioned of [false, true]) for (const op of ['create', 'part', 'complete', 'abort'])
  for (const next of ['read', 'put']) test(`ordinary ${next} follows uncertain multipart ${versioned}/${op}`, async t => {
    const f = await fixture(t, versioned);
    if (op !== 'create') create(f);
    if (op === 'complete' || op === 'abort') part(f);
    f.time(6); const req = input(op), finish = f.audit.begin(req);
    finish({ statusCode: null, bytesOut: Number(req.headers['content-length']), interrupted: true });
    if (op === 'create') f.uploads.set(UploadId, new Map());
    if (op === 'part') f.uploads.get(UploadId).set(1, { bytes: 4, etag: 'one' });
    if (op === 'complete' || op === 'abort') f.uploads.clear();
    if (op === 'complete') f.objects.push({ id: 'completed', bytes: 4, latest: true });
    f.time(8); let later;
    assert.doesNotThrow(() => { later = f.audit.begin({ method: next === 'read' ? 'GET' : 'PUT', path,
      headers: { 'content-length': next === 'read' ? '0' : '6' } }); });
    later({ statusCode: 200, bytesOut: next === 'read' ? 0 : 6,
      responseHeaders: versioned ? { 'x-amz-version-id': 'later' } : {} });
    if (next === 'put') {
      if (!versioned) f.objects.length = 0;
      else f.objects.forEach(o => { o.latest = false; });
      f.objects.push({ id: 'later', bytes: 6, latest: true });
    }
    f.time(10); await assert.doesNotReject(f.audit.verify());
    const result = f.audit.snapshot();
    assert.equal(result.status, 'unknown');
    assert.equal(result.objects.bytes, (op === 'part' ? 4 : 0) + (next === 'put' ? 6 + (versioned && op === 'complete' ? 4 : 0) : op === 'complete' ? 4 : 0));
    assert.equal(result.objects.unfinishedMultipart, op === 'create' || op === 'part' ? 1 : 0);
    assert.deepEqual(result.gaps, !versioned && op === 'complete' && next === 'put'
      ? ['accounting:request-cutoff', 'accounting:incomplete-history'] : ['accounting:request-cutoff']);
    if (!versioned && op === 'complete' && next === 'put') assert.deepEqual(result.byteSeconds, { low: null, high: null });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|CANARY|UPLOAD|VersionId/);
    assert.equal(f.meter.diagnostics().firstInvalidation, null);
  });

for (const versioned of [false, true]) for (const earlierCommitted of [false, true]) for (const laterCommitted of [false, true])
  test(`lost completion then uncertain ordinary write preserves candidates ${versioned}/${earlierCommitted}/${laterCommitted}`, async t => {
    const f = await fixture(t, versioned); create(f); part(f);
    f.time(6); f.audit.begin(input('complete'))({ statusCode: null, bytesOut: completion.length, interrupted: true });
    if (earlierCommitted) { f.uploads.clear(); f.objects.push({ id: 'completed', bytes: 4, latest: true }); }
    f.time(8); let later;
    assert.doesNotThrow(() => { later = f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '6' } }); });
    later({ statusCode: null, bytesOut: 6, interrupted: true });
    if (laterCommitted) {
      if (!versioned) f.objects.length = 0;
      else f.objects.forEach(o => { o.latest = false; });
      f.objects.push({ id: 'later', bytes: 6, latest: true });
    }
    f.time(10); await assert.doesNotReject(f.audit.verify());
    const result = f.audit.snapshot();
    assert.equal(result.objects.bytes, (earlierCommitted ? 0 : 4) + (laterCommitted ? 6 : 0) + (earlierCommitted && (versioned || !laterCommitted) ? 4 : 0));
    assert.equal(result.objects.unfinishedMultipart, earlierCommitted ? 0 : 1);
    assert.equal(result.status, 'unknown');
    if (!versioned) assert.deepEqual(result.byteSeconds, { low: null, high: null });
    assert.equal(f.meter.diagnostics().firstInvalidation, null);
  });

for (const priorCommitted of [false, true]) test(`unversioned multipart completion follows uncertain ordinary put ${priorCommitted}`, async t => {
  const f = await fixture(t, false); create(f); part(f);
  f.time(5); f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '2' } })({ statusCode: null, bytesOut: 2, interrupted: true });
  if (priorCommitted) f.objects.push({ id: 'prior', bytes: 2, latest: true });
  f.time(6); let finish;
  assert.doesNotThrow(() => { finish = f.audit.begin(input('complete')); });
  finish({ statusCode: 200, bytesOut: completion.length, responseBody: Buffer.from(`<CompleteMultipartUploadResult><Bucket>synthetic</Bucket><Key>${Key}</Key><ETag>final</ETag></CompleteMultipartUploadResult>`) });
  f.uploads.clear(); f.objects.length = 0; f.objects.push({ id: 'completed', bytes: 4, latest: true });
  f.time(10); await assert.doesNotReject(f.audit.verify());
  assert.equal(f.audit.snapshot().objects.bytes, 4);
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: null, high: null });
  assert.deepEqual(f.audit.snapshot().gaps, ['accounting:request-cutoff', 'accounting:incomplete-history']);
});

for (const versioned of [false, true]) test(`multipart active callback still fences ordinary work ${versioned}`, async t => {
  const f = await fixture(t, versioned); f.audit.begin(input('create'));
  assert.throws(() => f.audit.begin({ method: 'GET', path, headers: {} }), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const versioned of [false, true]) test(`delayed multipart completion cannot reverse witnessed ordinary order ${versioned}`, async t => {
  const f = await fixture(t, versioned); create(f); part(f);
  f.time(6); f.audit.begin(input('complete'))({ statusCode: null, bytesOut: completion.length, interrupted: true }); f.uploads.clear();
  f.time(8); let later;
  assert.doesNotThrow(() => { later = f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '6' } }); });
  later({ statusCode: 200, bytesOut: 6, responseHeaders: { 'x-amz-version-id': 'later' } });
  f.objects.push({ id: 'completed', bytes: 4, latest: true });
  if (versioned) f.objects.push({ id: 'later', bytes: 6, latest: false });
  f.time(10); await assert.rejects(f.audit.verify(), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const latest of ['later', 'completed']) test(`equal sized unknown versions preserve admission order ${latest}`, async t => {
  const f = await fixture(t, true); create(f); part(f);
  f.time(6); f.audit.begin(input('complete'))({ statusCode: null, bytesOut: completion.length, interrupted: true }); f.uploads.clear();
  f.time(8); let later;
  assert.doesNotThrow(() => { later = f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '4' } }); });
  later({ statusCode: null, bytesOut: 4, interrupted: true });
  f.objects.push({ id: 'completed', bytes: 4, latest: latest === 'completed' }, { id: 'later', bytes: 4, latest: latest === 'later' });
  // Equal-sized versions with both replies lost have two possible assignments.
  // Either identifier may be newer; both still require two distinct requests.
  f.time(10); await assert.doesNotReject(f.audit.verify());
  assert.equal(f.audit.snapshot().objects.bytes, 8);
  assert.equal(f.audit.snapshot().objects.currentVersions, 1);
  assert.equal(f.audit.snapshot().objects.noncurrentVersions, 1);
  // Parts: 4*(6-4)..4*(10-3) = 8..28. Two object versions: 0..2*4*(10-6) = 0..32.
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 8, high: 60 });
});

for (const observed of [2, null, 5]) test(`completed upload excludes preceding unversioned candidate ${observed}`, async t => {
  const f = await fixture(t, false);
  f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '2' } })({ statusCode: 200, bytesOut: 2 });
  f.objects.push({ id: 'old', bytes: 2, latest: true }); create(f); part(f);
  f.time(6); f.audit.begin(input('complete'))({ statusCode: null, bytesOut: completion.length, interrupted: true }); f.uploads.clear();
  f.time(8); let later;
  assert.doesNotThrow(() => { later = f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '6' } }); });
  later({ statusCode: null, bytesOut: 6, interrupted: true });
  f.objects.length = 0; if (observed !== null) f.objects.push({ id: 'observed', bytes: observed, latest: true });
  f.time(10); await assert.rejects(f.audit.verify(), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const next of ['delete', 'batch']) for (const committed of [false, true]) test(`unversioned ${next} follows uncertain completion ${committed}`, async t => {
  const f = await fixture(t, false, { allowBulkDeletes: true }); create(f); part(f);
  f.time(6); f.audit.begin(input('complete'))({ statusCode: null, bytesOut: completion.length, interrupted: true });
  f.uploads.clear(); f.objects.push({ id: 'completed', bytes: 4, latest: true });
  const body = Buffer.from(`<Delete><Object><Key>${Key}</Key></Object></Delete>`);
  const req = next === 'batch' ? { method: 'POST', path: '/synthetic?delete=', body, headers: { 'content-length': String(body.length) } }
    : { method: 'DELETE', path, headers: { 'content-length': '0' } };
  f.time(8); let later;
  assert.doesNotThrow(() => { later = f.audit.begin(req); });
  later({ statusCode: null, bytesOut: next === 'batch' ? body.length : 0, interrupted: true });
  if (committed) f.objects.length = 0;
  f.time(10); await assert.doesNotReject(f.audit.verify());
  assert.equal(f.audit.snapshot().objects.bytes, committed ? 0 : 4);
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: null, high: null });
});

for (const versioned of [false, true]) test(`failed completion retains the owned upload after later ordinary work ${versioned}`, async t => {
  const f = await fixture(t, versioned); create(f); part(f);
  f.time(6); f.audit.begin(input('complete'))({ statusCode: null, bytesOut: completion.length, interrupted: true });
  f.time(8); let later;
  assert.doesNotThrow(() => { later = f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '6' } }); });
  later({ statusCode: 200, bytesOut: 6, responseHeaders: { 'x-amz-version-id': 'later' } });
  f.objects.push({ id: 'later', bytes: 6, latest: true });
  f.time(10); await assert.doesNotReject(f.audit.verify());
  assert.equal(f.audit.snapshot().objects.bytes, 10);
  assert.equal(f.audit.snapshot().objects.unfinishedMultipart, 1);
  f.time(11); const again = f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '7' } });
  again({ statusCode: 200, bytesOut: 7, responseHeaders: { 'x-amz-version-id': 'again' } });
  if (!versioned) f.objects.length = 0; else f.objects[0].latest = false;
  f.objects.push({ id: 'again', bytes: 7, latest: true });
  f.time(12); await assert.doesNotReject(f.audit.verify());
  assert.equal(f.audit.snapshot().objects.bytes, versioned ? 17 : 11);
});

for (const versioned of [false, true]) test(`lost completion still requires its own object after ordinary reply ${versioned}`, async t => {
  const f = await fixture(t, versioned); create(f); part(f);
  f.time(6); f.audit.begin(input('complete'))({ statusCode: null, bytesOut: completion.length, interrupted: true }); f.uploads.clear();
  f.time(8); let later;
  assert.doesNotThrow(() => { later = f.audit.begin({ method: 'GET', path, headers: {} }); });
  later({ statusCode: 200, bytesOut: 0 });
  f.time(10); await assert.rejects(f.audit.verify(), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const versioned of [false, true]) test(`real lost multipart completion forwards the later HTTP write ${versioned}`, async t => {
  const f = await fixture(t, versioned); create(f); part(f); const received = [];
  const backend = createServer((req, res) => { const chunks = []; req.on('data', b => chunks.push(b)); req.once('end', () => {
    received.push({ method: req.method, bytes: Buffer.concat(chunks).length });
    if (req.method === 'POST') {
      f.uploads.clear(); f.objects.push({ id: 'completed', bytes: 4, latest: true }); res.destroy();
    } else {
      if (!versioned) f.objects.length = 0; else f.objects.forEach(o => { o.latest = false; });
      f.objects.push({ id: 'later', bytes: 6, latest: true }); res.setHeader('x-amz-version-id', 'later'); res.end();
    }
  }); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload', lifetimes: f.audit });
  t.after(() => front.close().catch(() => {}));
  const send = (req, body, id) => new Promise((resolve, reject) => {
    const caller = request(front.url + req.path, { method: req.method, headers: { ...req.headers,
      'amz-sdk-invocation-id': `${id}-2222-4333-8444-555555555555`, 'amz-sdk-request': 'attempt=1; max=1',
    } }, async res => {
      try { for await (const chunk of res) void chunk; resolve(res.statusCode); }
      catch { reject(Error('Synthetic reply cutoff')); }
    });
    caller.once('error', () => reject(Error('Synthetic request cutoff'))); caller.end(body);
  });
  f.time(6); await assert.rejects(send(input('complete'), completion, '11111111'), /Synthetic (request|reply) cutoff/);
  await front.whenIdle(() => {});
  f.time(8); assert.equal(await send({ method: 'PUT', path, headers: { 'content-length': '6' } }, Buffer.from('six666'), '22222222'), 200);
  await front.whenIdle(() => {}); await assert.doesNotReject(front.close());
  f.time(10); await assert.doesNotReject(f.audit.verify());
  assert.deepEqual(received, [{ method: 'POST', bytes: completion.length }, { method: 'PUT', bytes: 6 }]);
  assert.equal(f.audit.snapshot().objects.bytes, versioned ? 10 : 6);
  assert.equal(f.audit.snapshot().status, 'unknown');
  assert.equal(f.audit.snapshot().objects.unfinishedMultipart, 0);
  assert.equal(meter.snapshot().accounting.producer.attempts, 2);
  assert.equal(meter.snapshot().accounting.requests.filter(r => r.outcome === 'transport-error').reduce((n, r) => n + r.attempts, 0), 1);
  assert.equal(meter.diagnostics().firstInvalidation, null);
  assert.equal(front.checkpoint().pending, 0); assert.equal(front.checkpoint().connections, 0);
});

test('witnessed ordinary replacements release obsolete completion candidates', async t => {
  const f = await fixture(t, false); create(f); part(f);
  f.time(6); f.audit.begin(input('complete'))({ statusCode: null, bytesOut: completion.length, interrupted: true }); f.uploads.clear();
  f.time(8);
  for (let bytes = 6; bytes <= 100006; bytes++) {
    let finish;
    assert.doesNotThrow(() => { finish = f.audit.begin({ method: 'PUT', path, headers: { 'content-length': String(bytes) } }); });
    finish({ statusCode: 200, bytesOut: bytes });
  }
  f.objects.push({ id: 'latest', bytes: 100006, latest: true });
  f.time(10); await assert.doesNotReject(f.audit.verify());
  assert.equal(f.audit.snapshot().objects.bytes, 100006);
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: null, high: null });
});

for (const versioned of [false, true]) test(`acknowledged delete follows lost multipart completion ${versioned}`, async t => {
  const f = await fixture(t, versioned); create(f); part(f);
  f.time(6); f.audit.begin(input('complete'))({ statusCode: null, bytesOut: completion.length, interrupted: true }); f.uploads.clear();
  f.time(8); let finish;
  assert.doesNotThrow(() => { finish = f.audit.begin({ method: 'DELETE', path, headers: { 'content-length': '0' } }); });
  finish({ statusCode: 204, bytesOut: 0, responseHeaders: { 'x-amz-version-id': 'later', 'x-amz-delete-marker': 'true' } });
  if (versioned) f.objects.push({ id: 'completed', bytes: 4, latest: false }, { id: 'later', latest: true, marker: true });
  f.time(10); await assert.doesNotReject(f.audit.verify());
  assert.equal(f.audit.snapshot().objects.bytes, versioned ? 4 + Buffer.byteLength(Key) : 0);
  assert.equal(f.audit.snapshot().objects.deleteMarkers, versioned ? 1 : 0);
  assert.equal(f.audit.snapshot().objects.unfinishedMultipart, 0);
  assert.equal(f.audit.snapshot().status, 'unknown');
});

test('acknowledged batch delete excludes an earlier lost completion object', async t => {
  const f = await fixture(t, false, { allowBulkDeletes: true }); create(f); part(f);
  f.time(6); f.audit.begin(input('complete'))({ statusCode: null, bytesOut: completion.length, interrupted: true }); f.uploads.clear();
  const body = Buffer.from(`<Delete><Object><Key>${Key}</Key></Object></Delete>`);
  f.time(8); let finish;
  assert.doesNotThrow(() => { finish = f.audit.begin({ method: 'POST', path: '/synthetic?delete=', body, headers: { 'content-length': String(body.length) } }); });
  finish({ statusCode: 200, bytesOut: body.length, responseBody: Buffer.from(`<DeleteResult><Deleted><Key>${Key}</Key></Deleted></DeleteResult>`) });
  f.time(10); await assert.doesNotReject(f.audit.verify());
  assert.equal(f.audit.snapshot().objects.bytes, 0);
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: null, high: null });
});
