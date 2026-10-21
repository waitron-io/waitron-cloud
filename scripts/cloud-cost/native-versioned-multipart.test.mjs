import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { openLitestreamVersionHistories } from './stream-versions.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from './meter.mjs';

const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3'), bad = /Invalid cloud cost storage lifetimes/;
const Key = 'PRIVATE_CANARY', UploadId = 'PRIVATE_UPLOAD', path = '/synthetic/' + Key;
const completion = Buffer.from('<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>one</ETag></Part></CompleteMultipartUpload>');
const made = Buffer.from(`<InitiateMultipartUploadResult><Bucket>synthetic</Bucket><Key>${Key}</Key><UploadId>${UploadId}</UploadId></InitiateMultipartUploadResult>`);
const completed = Buffer.from(`<CompleteMultipartUploadResult><Bucket>synthetic</Bucket><Key>${Key}</Key><ETag>final</ETag></CompleteMultipartUploadResult>`);

async function fixture(t, options = { allowMultipart: true }) {
  let time = 0;
  const versions = [], uploads = new Map(), state = { requests: 0 };
  const add = (id, bytes) => { for (const row of versions) row.latest = false; versions.push({ id, bytes, latest: true }); };
  const server = createServer((req, res) => { state.requests++; req.resume(); req.on('end', () => {
    const q = new URL(req.url, 'http://local').searchParams;
    if (q.has('versioning')) res.end('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>');
    else if (q.has('uploads')) res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated>' + [...uploads].map(([id]) => `<Upload><Key>${Key}</Key><UploadId>${id}</UploadId></Upload>`).join('') + '</ListMultipartUploadsResult>');
    else if (q.has('uploadId')) res.end('<ListPartsResult><IsTruncated>false</IsTruncated>' + [...(uploads.get(q.get('uploadId')) ?? [])].map(([n, part]) => `<Part><PartNumber>${n}</PartNumber><Size>${part.bytes}</Size><ETag>${part.etag}</ETag></Part>`).join('') + '</ListPartsResult>');
    else res.end('<ListVersionsResult><IsTruncated>false</IsTruncated>' + versions.map(row => `<Version><Key>${Key}</Key><VersionId>${row.id}</VersionId><IsLatest>${row.latest}</IsLatest><Size>${row.bytes}</Size></Version>`).join('') + '</ListVersionsResult>');
  }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const meter = createMeter({ phase: 'observer', clock: () => time });
  const proxy = await createMeteringProxy({ target: `http://127.0.0.1:${server.address().port}`, meter, classify: correlatedStorageAttempt }); t.after(() => proxy.close());
  const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  instrumentStorageClient({ client, meter, phase: 'observer', endpoint: proxy.url }); t.after(() => client.destroy());
  const audit = await openLitestreamVersionHistories({ client, sdk, meter, bucket: 'synthetic', clock: () => time, ...options });
  return { versions, uploads, add, state, meter, audit, time: n => { time = n; } };
}
const input = op => ({ method: op === 'part' ? 'PUT' : op === 'abort' ? 'DELETE' : 'POST',
  path: path + (op === 'create' ? '?uploads=' : '?uploadId=' + UploadId + (op === 'part' ? '&partNumber=1' : '')),
  headers: { 'content-length': String(op === 'part' ? 4 : op === 'complete' ? completion.length : 0) },
  ...(op === 'complete' ? { body: completion } : {}) });
function create(f, from = 2, by = 3) {
  f.time(from); let end;
  assert.doesNotThrow(() => { end = f.audit.begin(input('create')); }, 'explicit versioned multipart mode admits creation');
  f.time(by); end({ statusCode: 200, bytesOut: 0, responseBody: made }); f.uploads.set(UploadId, new Map());
}
function part(f, from = 4, by = 5) {
  f.time(from); const end = f.audit.begin(input('part')); f.time(by);
  end({ statusCode: 200, bytesOut: 4, responseHeaders: { etag: 'one' } }); f.uploads.get(UploadId).set(1, { bytes: 4, etag: 'one' });
}
function put(f) {
  f.time(0); const end = f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '2' } });
  f.time(1); end({ statusCode: 200, bytesOut: 2, responseHeaders: { 'x-amz-version-id': 'original' } }); f.add('original', 2);
}
function complete(f, version = 'new', from = 7, by = 9) {
  f.time(from); const end = f.audit.begin(input('complete')); f.time(by);
  end({ statusCode: 200, bytesOut: completion.length, responseBody: completed, responseHeaders: { 'x-amz-version-id': version } });
  f.uploads.clear(); f.add(version, 4);
}

// Losing the old version or discarding part lifetimes breaks this hand-calculated storage integral.
test('versionedMultipartRetainsOldVersionsAndTransfersCompletedParts', async t => {
  const f = await fixture(t); put(f); create(f); part(f);
  f.time(6); await f.audit.verify();
  assert.deepEqual(f.audit.snapshot().objects, { class: 'stream', bytes: 6, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 1 });
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 14, high: 20 });
  complete(f); assert.throws(() => f.audit.snapshot(), bad);
  f.time(12); await f.audit.verify();
  assert.deepEqual(f.audit.snapshot().objects, { class: 'stream', bytes: 6, currentVersions: 1, noncurrentVersions: 1, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 42, high: 64 });
  f.time(13); const remove = f.audit.begin({ method: 'DELETE', path: path + '?versionId=new', headers: {} });
  f.time(14); remove({ statusCode: 204, bytesOut: 0, responseHeaders: { 'x-amz-version-id': 'new' } });
  f.versions.pop(); f.versions[0].latest = true;
  f.time(16); await f.audit.verify();
  assert.deepEqual(f.audit.snapshot().objects, { class: 'stream', bytes: 2, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 54, high: 80 });
  assert.equal(f.meter.snapshot().reconciled, true);
  assert.equal(/PRIVATE|CANARY|original|new/.test(JSON.stringify(f.audit.snapshot())), false);
});

// Equal-size completions still create separate billable versions.
test('versionedMultipartCountsRepeatedSameSizeCompletionsAsSeparateVersions', async t => {
  const f = await fixture(t); create(f); part(f); complete(f);
  create(f, 10, 11); part(f, 12, 13); complete(f, 'another', 14, 15);
  f.time(20); await f.audit.verify();
  assert.deepEqual(f.audit.snapshot().objects, { class: 'stream', bytes: 8, currentVersions: 1, noncurrentVersions: 1, deleteMarkers: 0, unfinishedMultipart: 0 });
  // Lower bound: 8 + 44 + 4 + 20. Upper bound: 20 + 52 + 12 + 24.
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 76, high: 108 });
});

for (const mode of ['missing', 'null', 'empty', 'control', 'duplicate', 'marker', 'array']) test(`versionedMultipartRequiresFreshNonmarkerVersion_${mode}`, async t => {
  const f = await fixture(t); put(f); create(f); part(f);
  f.time(7); const end = f.audit.begin(input('complete')); f.time(9);
  const headers = { 'x-amz-version-id': mode === 'null' ? 'null' : mode === 'empty' ? '' : mode === 'control' ? 'bad\n' : mode === 'duplicate' ? 'original' : mode === 'array' ? ['new'] : 'new' };
  if (mode === 'missing') delete headers['x-amz-version-id'];
  if (mode === 'marker') headers['x-amz-delete-marker'] = 'true';
  assert.throws(() => end({ statusCode: 200, bytesOut: completion.length, responseBody: completed, responseHeaders: headers }), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const mode of ['default', 'false']) test(`versionedMultipartRequiresExplicitMode_${mode}`, async t => {
  const f = await fixture(t, mode === 'default' ? {} : { allowMultipart: false }), before = f.state.requests;
  assert.throws(() => f.audit.begin(input('create')), bad); assert.equal(f.state.requests, before);
});

for (const mode of ['string', 'null', 'missing-parts-api']) test(`versionedMultipartRefusesInvalidConfiguration_${mode}`, async t => {
  await assert.rejects(fixture(t, mode === 'missing-parts-api' ? { allowMultipart: true, sdk: { ...sdk, ListPartsCommand: undefined } }
    : { allowMultipart: mode === 'string' ? 'true' : null }), bad);
});

for (const mode of ['missing-version', 'size', 'foreign-upload', 'foreign-part', 'missing-part', 'missing-upload', 'latest']) test(`versionedMultipartChecksIndependentInventories_${mode}`, async t => {
  const f = await fixture(t); put(f); create(f); part(f);
  if (mode === 'missing-version') f.versions.length = 0;
  if (mode === 'size') f.uploads.get(UploadId).get(1).bytes++;
  if (mode === 'foreign-upload') f.uploads.set('FOREIGN', new Map());
  if (mode === 'foreign-part') f.uploads.get(UploadId).set(2, { bytes: 2, etag: 'foreign' });
  if (mode === 'missing-part') f.uploads.get(UploadId).clear();
  if (mode === 'missing-upload') f.uploads.clear();
  if (mode === 'latest') { complete(f); f.versions[0].latest = true; }
  f.time(12); await assert.rejects(f.audit.verify(), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const op of ['create', 'part', 'complete', 'abort']) test(`versionedMultipartRefusesAmbiguousReply_${op}`, async t => {
  const f = await fixture(t);
  if (op !== 'create') create(f);
  if (op === 'complete' || op === 'abort') part(f);
  f.time(7); const end = f.audit.begin(input(op)); f.time(9);
  assert.throws(() => end({ statusCode: 503, bytesOut: Number(input(op).headers['content-length']) }), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const mode of ['active-multipart', 'active-put', 'batch', 'read', 'verify', 'version-query']) test(`versionedMultipartRefusesOverlappingOrVersionSpecificMutation_${mode}`, async t => {
  const f = await fixture(t, { allowMultipart: true, allowBulkDeletes: true });
  if (mode === 'active-put') f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '2' } });
  else if (mode !== 'version-query') f.audit.begin(input('create'));
  if (mode === 'verify') await assert.rejects(f.audit.verify(), bad);
  else {
    const body = Buffer.from(`<Delete><Object><Key>${Key}</Key></Object></Delete>`);
    const request = mode === 'batch' ? { method: 'POST', path: '/synthetic/?delete=', headers: { 'content-length': String(body.length) }, body }
      : mode === 'read' ? { method: 'GET', path, headers: {} } : input('create');
    if (mode === 'version-query') request.path += '&versionId=foreign';
    assert.throws(() => f.audit.begin(request), bad);
  }
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});
