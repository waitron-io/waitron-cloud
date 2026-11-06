import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { openLitestreamHistories } from './storage-lifetimes.mjs';
import { openLitestreamVersionHistories } from './stream-versions.mjs';
import { createLitestreamTransport } from './litestream.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from './meter.mjs';

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

function begin(f, op, { id = UploadId, n = 1, bytes = 4 } = {}) {
  const req = input(op, bytes);
  req.path = req.path.replace(UploadId, id).replace('partNumber=1', 'partNumber=' + n);
  return f.audit.begin(req);
}
function createAt(f, id, from) {
  f.time(from); const finish = begin(f, 'create'); f.time(from + 1);
  finish({ statusCode: 200, bytesOut: 0, responseBody: Buffer.from(made.toString().replace(UploadId, id)) });
  f.uploads.set(id, new Map());
}
function cutoff(f, op, options) {
  const finish = begin(f, op, options);
  finish({ statusCode: null, bytesOut: op === 'part' ? options?.bytes ?? 4 : 0, interrupted: true });
}
function result(f, bytes, uploads, hidden = false) {
  const snapshot = f.audit.snapshot();
  assert.equal(snapshot.status, 'unknown');
  assert.equal(snapshot.objects.bytes, bytes);
  assert.equal(snapshot.objects.unfinishedMultipart, uploads);
  assert.deepEqual(snapshot.gaps, hidden ? ['accounting:request-cutoff', 'accounting:incomplete-history'] : ['accounting:request-cutoff']);
  if (hidden) assert.deepEqual(snapshot.byteSeconds, { low: null, high: null });
  assert.equal(f.meter.diagnostics().firstInvalidation, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|CANARY|UPLOAD|VersionId/);
}

// Losing one reply cannot prevent an independently owned upload from progressing.
for (const versioned of [false, true]) for (const retained of [0, 1, 2])
  test(`consecutive lost creates retain distinct empty uploads ${versioned}/${retained}`, async t => {
    const f = await fixture(t, versioned);
    f.time(1); cutoff(f, 'create'); f.time(2);
    assert.doesNotThrow(() => cutoff(f, 'create'));
    for (let n = 0; n < retained; n++) f.uploads.set('PRIVATE_' + n, new Map());
    f.time(5); await assert.doesNotReject(f.audit.verify()); result(f, 0, retained);
    assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 0, high: 0 });
  });

for (const versioned of [false, true]) test(`acknowledged create does not consume older lost create ${versioned}`, async t => {
  const f = await fixture(t, versioned); f.time(1); cutoff(f, 'create');
  assert.doesNotThrow(() => createAt(f, 'PRIVATE_SECOND', 2));
  f.uploads.set('PRIVATE_FIRST', new Map());
  f.time(5); await assert.doesNotReject(f.audit.verify()); result(f, 0, 2);
});

for (const versioned of [false, true]) for (const committed of [false, true])
  test(`independent upload proceeds after lost part ${versioned}/${committed}`, async t => {
    const f = await fixture(t, versioned); create(f); createAt(f, 'PRIVATE_SECOND', 3);
    f.time(5); cutoff(f, 'part');
    if (committed) f.uploads.get(UploadId).set(1, { bytes: 4, etag: 'lost' });
    f.time(6); let next;
    assert.doesNotThrow(() => { next = begin(f, 'part', { id: 'PRIVATE_SECOND', bytes: 6 }); });
    f.time(7); next({ statusCode: 200, bytesOut: 6, responseHeaders: { etag: 'six' } });
    f.uploads.get('PRIVATE_SECOND').set(1, { bytes: 6, etag: 'six' });
    f.time(10); await assert.doesNotReject(f.audit.verify()); result(f, committed ? 10 : 6, 2);
    assert.deepEqual(f.audit.snapshot().byteSeconds, committed ? { low: 18, high: 44 } : { low: 18, high: 24 });
  });

for (const versioned of [false, true]) for (const stored of [4, 6, 8])
  test(`repeated lost part replacements retain only admitted sizes ${versioned}/${stored}`, async t => {
    const f = await fixture(t, versioned); create(f); part(f);
    f.time(5); cutoff(f, 'part', { bytes: 6 }); f.time(6);
    assert.doesNotThrow(() => cutoff(f, 'part', { bytes: 8 }));
    f.uploads.get(UploadId).set(1, { bytes: stored, etag: stored === 4 ? 'one' : 'lost' });
    f.time(10); await assert.doesNotReject(f.audit.verify()); result(f, stored, 1, true);
  });

for (const versioned of [false, true]) for (const stale of [false, true])
  test(`acknowledged replacement excludes all earlier uncertain parts ${versioned}/${stale}`, async t => {
    const f = await fixture(t, versioned); create(f); part(f);
    f.time(5); cutoff(f, 'part', { bytes: 6 }); f.time(6); let next;
    assert.doesNotThrow(() => { next = begin(f, 'part', { bytes: 8 }); });
    f.time(7); next({ statusCode: 200, bytesOut: 8, responseHeaders: { etag: 'eight' } });
    f.uploads.get(UploadId).set(1, { bytes: stale ? 6 : 8, etag: stale ? 'lost' : 'eight' });
    f.time(10);
    if (stale) { await assert.rejects(f.audit.verify(), bad); return; }
    await assert.doesNotReject(f.audit.verify()); result(f, 8, 1, true);
  });

for (const versioned of [false, true]) for (const failure of ['extra-create', 'create-with-parts', 'part-size', 'part-etag', 'missing-known-part', 'foreign-part', 'active', 'duplicate'])
  test(`multipart chain preserves safety ${versioned}/${failure}`, async t => {
    const f = await fixture(t, versioned);
    if (failure.includes('create')) {
      f.time(1); cutoff(f, 'create'); f.time(2);
      assert.doesNotThrow(() => cutoff(f, 'create'));
      if (failure === 'extra-create') for (let n = 0; n < 3; n++) f.uploads.set('PRIVATE_' + n, new Map());
      else f.uploads.set(UploadId, new Map([[1, { bytes: 4, etag: 'foreign' }]]));
    } else {
      create(f); part(f); f.time(5); cutoff(f, 'part', { bytes: 6 }); f.time(6);
      if (failure === 'active' || failure === 'duplicate') {
        let finish; assert.doesNotThrow(() => { finish = begin(f, 'part', { bytes: 8 }); });
        if (failure === 'active') assert.throws(() => begin(f, 'create'), bad);
        else { finish({ statusCode: 200, bytesOut: 8, responseHeaders: { etag: 'eight' } }); assert.throws(() => finish({ statusCode: 200, bytesOut: 8, responseHeaders: { etag: 'eight' } }), bad); }
        assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/); return;
      }
      assert.doesNotThrow(() => cutoff(f, 'part', { bytes: 8 }));
      if (failure === 'part-etag') f.uploads.get(UploadId).set(1, { bytes: 4, etag: 'foreign' });
      if (failure === 'part-size') f.uploads.get(UploadId).set(1, { bytes: 5, etag: 'foreign' });
      if (failure === 'missing-known-part') f.uploads.get(UploadId).clear();
      if (failure === 'foreign-part') f.uploads.get(UploadId).set(2, { bytes: 8, etag: 'foreign' });
    }
    f.time(10); await assert.rejects(f.audit.verify(), bad);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });

for (const versioned of [false, true]) for (const committed of [false, true])
  test(`uncertain part does not hide a later different part ${versioned}/${committed}`, async t => {
    const f = await fixture(t, versioned); create(f); part(f); f.time(5); cutoff(f, 'part', { bytes: 6 });
    if (committed) f.uploads.get(UploadId).set(1, { bytes: 6, etag: 'lost' });
    f.time(6); let end; assert.doesNotThrow(() => { end = begin(f, 'part', { n: 2, bytes: 8 }); }); f.time(7);
    end({ statusCode: 200, bytesOut: 8, responseHeaders: { etag: 'eight' } });
    f.uploads.get(UploadId).set(2, { bytes: 8, etag: 'eight' });
    f.time(10); await assert.doesNotReject(f.audit.verify()); result(f, committed ? 14 : 12, 1, true);
    f.time(11); const abort = begin(f, 'abort'); f.time(12); abort({ statusCode: 204, bytesOut: 0 }); f.uploads.clear();
    f.time(13); await assert.doesNotReject(f.audit.verify()); result(f, 0, 0, true);
  });

for (const versioned of [false, true]) for (const stored of [null, 4, 6])
  test(`uncertain first part replacements retain possible absence ${versioned}/${stored}`, async t => {
    const f = await fixture(t, versioned); create(f); f.time(3); cutoff(f, 'part'); f.time(5);
    assert.doesNotThrow(() => cutoff(f, 'part', { bytes: 6 }));
    if (stored !== null) f.uploads.get(UploadId).set(1, { bytes: stored, etag: 'lost' });
    f.time(10); await assert.doesNotReject(f.audit.verify()); result(f, stored ?? 0, 1, true);
  });

for (const versioned of [false, true]) for (const op of ['complete', 'abort']) for (const committed of [false, true])
  test(`new create preserves preceding uncertain terminal operation ${versioned}/${op}/${committed}`, async t => {
    const f = await fixture(t, versioned); create(f); part(f); f.time(5);
    f.audit.begin(input(op))({ statusCode: null, bytesOut: op === 'complete' ? completion.length : 0, interrupted: true });
    if (committed) {
      f.uploads.clear();
      if (op === 'complete') f.objects.push({ id: 'completed', bytes: 4, latest: true });
    }
    assert.doesNotThrow(() => createAt(f, 'PRIVATE_SECOND', 6));
    f.time(10); await assert.doesNotReject(f.audit.verify());
    result(f, committed && op === 'abort' ? 0 : 4, committed ? 1 : 2);
  });

for (const versioned of [false, true]) for (const abort of ['success', 'lost-retained', 'lost-removed'])
  test(`abort after lost part collects all possible owned parts ${versioned}/${abort}`, async t => {
    const f = await fixture(t, versioned); create(f); part(f); f.time(5); cutoff(f, 'part', { bytes: 6 });
    f.uploads.get(UploadId).set(1, { bytes: 6, etag: 'lost' }); f.time(6); let finish;
    assert.doesNotThrow(() => { finish = begin(f, 'abort'); }); f.time(7);
    finish({ statusCode: abort === 'success' ? 204 : null, bytesOut: 0, interrupted: abort !== 'success' });
    if (abort !== 'lost-retained') f.uploads.clear();
    f.time(10); await assert.doesNotReject(f.audit.verify());
    result(f, abort === 'lost-retained' ? 6 : 0, abort === 'lost-retained' ? 1 : 0, true);
  });

for (const versioned of [false, true]) test(`actual lost part reply permits the next HTTP part ${versioned}`, async t => {
  const f = await fixture(t, versioned); create(f); const received = [];
  const backend = createServer((req, res) => { const chunks = []; req.on('data', b => chunks.push(b)); req.once('end', () => {
    const body = Buffer.concat(chunks); received.push(body.toString());
    const etag = body.length === 4 ? 'four' : 'six';
    f.uploads.get(UploadId).set(1, { bytes: body.length, etag });
    if (body.length === 4) res.destroy(); else { res.setHeader('etag', etag); res.end(); }
  }); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload', lifetimes: f.audit });
  t.after(() => front.close().catch(() => {}));
  const send = (body, id) => new Promise((resolve, reject) => {
    const req = input('part', body.length);
    const caller = request(front.url + req.path, { method: req.method, headers: { ...req.headers,
      'amz-sdk-invocation-id': `${id}-2222-4333-8444-555555555555`, 'amz-sdk-request': 'attempt=1; max=1',
    } }, async res => {
      try { for await (const chunk of res) void chunk; resolve(res.statusCode); }
      catch { reject(Error('Synthetic reply cutoff')); }
    });
    caller.once('error', () => reject(Error('Synthetic request cutoff'))); caller.end(body);
  });
  f.time(3); await assert.rejects(send(Buffer.from('four'), '11111111'), /Synthetic (request|reply) cutoff/);
  await front.whenIdle(() => {}); f.time(5);
  await assert.doesNotReject(async () => { assert.equal(await send(Buffer.from('six666'), '22222222'), 200); });
  await front.whenIdle(() => {}); await assert.doesNotReject(front.close());
  f.time(10); await assert.doesNotReject(f.audit.verify()); result(f, 6, 1, true);
  assert.deepEqual(received, ['four', 'six666']);
  assert.equal(meter.snapshot().accounting.producer.attempts, 2);
  assert.equal(meter.snapshot().accounting.requests.filter(r => r.outcome === 'transport-error').reduce((n, r) => n + r.attempts, 0), 1);
  assert.equal(meter.diagnostics().firstInvalidation, null);
  assert.equal(front.checkpoint().pending, 0); assert.equal(front.checkpoint().connections, 0);
});

test('unresolved create journal stays bounded', async t => {
  const f = await fixture(t, false); f.time(1);
  assert.doesNotThrow(() => { for (let n = 0; n < 100000; n++) cutoff(f, 'create'); });
  assert.throws(() => begin(f, 'create'), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

test('part candidate budget refuses overflowing inventory', async t => {
  const f = await fixture(t, false); create(f); part(f); f.time(5);
  assert.doesNotThrow(() => { for (let n = 0; n < 100000; n++) cutoff(f, 'part', { bytes: n }); });
  // Resolving the last lost request would exceed the same candidate budget.
  f.uploads.get(UploadId).set(1, { bytes: 99999, etag: 'last' });
  f.time(6); await assert.rejects(f.audit.verify(), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

test('successful replacements release obsolete part candidate budget', async t => {
  const f = await fixture(t, false); create(f); part(f); f.time(5);
  for (let cycle = 0; cycle < 2; cycle++) {
    assert.doesNotThrow(() => { for (let n = 0; n < 99998; n++) cutoff(f, 'part', { bytes: n }); });
    let finish; assert.doesNotThrow(() => { finish = begin(f, 'part', { bytes: 8 }); });
    finish({ statusCode: 200, bytesOut: 8, responseHeaders: { etag: 'eight' } });
    f.uploads.get(UploadId).set(1, { bytes: 8, etag: 'eight' });
  }
  f.time(10); await assert.doesNotReject(f.audit.verify()); result(f, 8, 1, true);
});

function completionInput(parts) {
  const body = Buffer.from('<CompleteMultipartUpload>' + parts.map(([n, etag]) => `<Part><PartNumber>${n}</PartNumber><ETag>${etag}</ETag></Part>`).join('') + '</CompleteMultipartUpload>');
  return { method: 'POST', path: path + '?uploadId=' + UploadId,
    headers: { 'content-length': String(body.length) }, body };
}
function completedReply() {
  return Buffer.from(`<CompleteMultipartUploadResult><Bucket>synthetic</Bucket><Key>${Key}</Key><ETag>final</ETag></CompleteMultipartUploadResult>`);
}
async function missingPart(f, shape) {
  create(f);
  if (shape !== 'first') part(f);
  f.time(5); cutoff(f, 'part', { bytes: shape === 'larger' ? 6 : 4 });
  if (shape === 'repeated') { f.time(6); cutoff(f, 'part'); }
  f.uploads.get(UploadId).set(1, { bytes: shape === 'larger' ? 6 : 4, etag: 'lost' });
  if (shape === 'two-parts') {
    f.time(7); const finish = begin(f, 'part', { n: 2, bytes: 6 });
    finish({ statusCode: 200, bytesOut: 6, responseHeaders: { etag: 'six' } });
    f.uploads.get(UploadId).set(2, { bytes: 6, etag: 'six' });
  }
  return completionInput(shape === 'two-parts' ? [[1, 'lost'], [2, 'six']] : [[1, 'lost']]);
}

// The completion request can name a part whose successful reply was never observed.
// Its size must still be uniquely supported by compatible owned part admissions.
for (const versioned of [false, true]) for (const shape of ['first', 'same', 'larger', 'repeated', 'two-parts'])
  for (const outcome of ['acknowledged', 'lost-committed', 'lost-retained'])
    test(`missing part identity permits uniquely sized completion ${versioned}/${shape}/${outcome}`, async t => {
      const f = await fixture(t, versioned), req = await missingPart(f, shape);
      f.time(8); let finish;
      assert.doesNotThrow(() => { finish = f.audit.begin(req); }); f.time(9);
      assert.doesNotThrow(() => finish(outcome === 'acknowledged'
        ? { statusCode: 200, bytesOut: req.body.length, responseBody: completedReply(), responseHeaders: { 'x-amz-version-id': 'completed' } }
        : { statusCode: null, bytesOut: req.body.length, interrupted: true }));
      const bytes = shape === 'two-parts' ? 10 : shape === 'larger' ? 6 : 4;
      if (outcome !== 'lost-retained') { f.uploads.clear(); f.objects.push({ id: 'completed', bytes, latest: true }); }
      f.time(12); await assert.doesNotReject(f.audit.verify());
      result(f, bytes, outcome === 'lost-retained' ? 1 : 0, true);
      const again = f.audit.begin({ method: 'GET', path, headers: {} });
      again({ statusCode: 200, bytesOut: 0 });
      f.time(13); await assert.doesNotReject(f.audit.verify()); result(f, bytes, outcome === 'lost-retained' ? 1 : 0, true);
    });

for (const versioned of [false, true]) for (const failure of ['wrong-object-size', 'missing-object', 'extra-object', 'missing-retained-part', 'wrong-retained-etag', 'active', 'duplicate'])
  test(`missing part completion preserves owned evidence ${versioned}/${failure}`, async t => {
    const f = await fixture(t, versioned), req = await missingPart(f, 'larger'); f.time(8); let finish;
    assert.doesNotThrow(() => { finish = f.audit.begin(req); }); f.time(9);
    if (failure === 'active') { assert.throws(() => begin(f, 'create'), bad); return; }
    const event = { statusCode: null, bytesOut: req.body.length, interrupted: true };
    finish(event);
    if (failure === 'duplicate') { assert.throws(() => finish(event), bad); return; }
    if (failure === 'missing-retained-part') f.uploads.get(UploadId).clear();
    else if (failure === 'wrong-retained-etag') f.uploads.get(UploadId).set(1, { bytes: 4, etag: 'foreign' });
    else {
      f.uploads.clear();
      if (failure !== 'missing-object') f.objects.push({ id: 'completed', bytes: failure === 'wrong-object-size' ? 4 : 6, latest: true });
      if (failure === 'extra-object') {
        if (versioned) f.objects.push({ id: 'foreign', bytes: 6, latest: false });
        else f.objects.push({ id: 'duplicate', bytes: 6, latest: true });
      }
    }
    f.time(12); await assert.rejects(f.audit.verify(), bad);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });

for (const versioned of [false, true]) for (const failure of ['unknown-part', 'wrong-known-etag', 'duplicate-part', 'reverse-parts', 'empty-etag'])
  test(`completion still rejects unsafe selected parts ${versioned}/${failure}`, async t => {
    const f = await fixture(t, versioned); create(f); part(f);
    if (failure === 'reverse-parts') {
      f.time(5); const finish = begin(f, 'part', { n: 2, bytes: 6 });
      finish({ statusCode: 200, bytesOut: 6, responseHeaders: { etag: 'six' } });
    }
    const parts = failure === 'unknown-part' ? [[2, 'one']] : failure === 'wrong-known-etag' ? [[1, 'wrong']]
      : failure === 'duplicate-part' ? [[1, 'one'], [1, 'one']] : failure === 'reverse-parts' ? [[2, 'six'], [1, 'one']] : [[1, '']];
    f.time(8); assert.throws(() => f.audit.begin(completionInput(parts)), bad);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });

for (const versioned of [false, true]) test(`lost part reply still forwards actual HTTP completion ${versioned}`, async t => {
  const f = await fixture(t, versioned); create(f); const received = [];
  const backend = createServer((req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.once('end', () => {
      const body = Buffer.concat(chunks); received.push({ method: req.method, body: body.toString() });
      if (req.method === 'PUT') {
        f.uploads.get(UploadId).set(1, { bytes: body.length, etag: 'lost' }); res.destroy();
      } else {
        f.uploads.clear(); f.objects.push({ id: 'completed', bytes: 4, latest: true });
        res.setHeader('x-amz-version-id', 'completed'); res.end(completedReply());
      }
    });
  });
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
  f.time(3); await assert.rejects(send(input('part'), Buffer.from('four'), '11111111'), /Synthetic (request|reply) cutoff/);
  await front.whenIdle(() => {}); f.time(5);
  const req = completionInput([[1, 'lost']]);
  await assert.doesNotReject(async () => { assert.equal(await send(req, req.body, '22222222'), 200); });
  await front.whenIdle(() => {}); await assert.doesNotReject(front.close());
  f.time(10); await assert.doesNotReject(f.audit.verify()); result(f, 4, 0, true);
  assert.deepEqual(received, [{ method: 'PUT', body: 'four' }, { method: 'POST', body: '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>lost</ETag></Part></CompleteMultipartUpload>' }]);
  assert.equal(meter.snapshot().accounting.producer.attempts, 2);
  assert.equal(meter.snapshot().accounting.requests.filter(r => r.outcome === 'transport-error').reduce((n, r) => n + r.attempts, 0), 1);
  assert.equal(meter.diagnostics().firstInvalidation, null);
  assert.equal(front.checkpoint().pending, 0); assert.equal(front.checkpoint().connections, 0);
});

for (const versioned of [false, true]) test(`missing part identity cannot accept an empty selected ETag ${versioned}`, async t => {
  const f = await fixture(t, versioned); await missingPart(f, 'first'); f.time(8);
  assert.throws(() => f.audit.begin(completionInput([[1, '']])), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

for (const versioned of [false, true]) test(`missing part completion rejects an unsafe total from safe individual sizes ${versioned}`, async t => {
  const f = await fixture(t, versioned); create(f); f.time(3);
  cutoff(f, 'part', { bytes: Number.MAX_SAFE_INTEGER }); f.time(4);
  begin(f, 'part', { n: 2, bytes: 1 })({ statusCode: 200, bytesOut: 1, responseHeaders: { etag: 'one-byte' } });
  f.time(5); assert.throws(() => f.audit.begin(completionInput([[1, 'lost'], [2, 'one-byte']])), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});


async function ambiguousCompletion(f, { secondPart = false, id = UploadId, from = 1 } = {}) {
  createAt(f, id, from);
  f.time(from + 2); cutoff(f, 'part', { id, bytes: 4 });
  f.time(from + 3); cutoff(f, 'part', { id, bytes: 8 });
  f.uploads.get(id).set(1, { bytes: 8, etag: 'lost' });
  if (secondPart) {
    f.time(from + 4); cutoff(f, 'part', { id, n: 2, bytes: 6 });
    f.time(from + 5); cutoff(f, 'part', { id, n: 2, bytes: 10 });
    f.uploads.get(id).set(2, { bytes: 10, etag: 'second' });
  }
  const req = completionInput(secondPart ? [[1, 'lost'], [2, 'second']] : [[1, 'lost']]);
  req.path = req.path.replace(UploadId, id);
  return req;
}
function finishCompletion(f, req, outcome, version = 'completed') {
  const finish = f.audit.begin(req);
  finish(outcome === 'acknowledged'
    ? { statusCode: 200, bytesOut: req.body.length, responseBody: completedReply(), responseHeaders: { 'x-amz-version-id': version } }
    : { statusCode: null, bytesOut: req.body.length, interrupted: true });
}

// Choosing the first candidate rejects another admitted size; choosing a range admits unowned sizes.
for (const versioned of [false, true]) for (const outcome of ['acknowledged', 'lost-committed', 'lost-retained'])
  for (const bytes of [4, 8]) test(`ambiguous completion preserves exact owned sizes ${versioned}/${outcome}/${bytes}`, async t => {
    const f = await fixture(t, versioned), req = await ambiguousCompletion(f);
    f.time(8); assert.doesNotThrow(() => finishCompletion(f, req, outcome));
    if (outcome === 'lost-retained') f.uploads.get(UploadId).set(1, { bytes, etag: 'lost' });
    else { f.uploads.clear(); f.objects.push({ id: 'completed', bytes, latest: true }); }
    f.time(12); await assert.doesNotReject(f.audit.verify()); result(f, bytes, outcome === 'lost-retained' ? 1 : 0, true);
    f.time(13); await assert.doesNotReject(f.audit.verify()); result(f, bytes, outcome === 'lost-retained' ? 1 : 0, true);
  });

for (const versioned of [false, true]) for (const bytes of [10, 14, 18])
  test(`ambiguous selected parts retain exact sums ${versioned}/${bytes}`, async t => {
    const f = await fixture(t, versioned), req = await ambiguousCompletion(f, { secondPart: true });
    f.time(8); assert.doesNotThrow(() => finishCompletion(f, req, 'lost-committed'));
    f.uploads.clear(); f.objects.push({ id: 'completed', bytes, latest: true });
    f.time(12); await assert.doesNotReject(f.audit.verify()); result(f, bytes, 0, true);
  });

for (const versioned of [false, true]) for (const outcome of ['acknowledged', 'lost-committed'])
  for (const failure of ['intermediate-size', 'missing-object', 'extra-object'])
    test(`ambiguous completion refuses unowned object evidence ${versioned}/${outcome}/${failure}`, async t => {
      const f = await fixture(t, versioned), req = await ambiguousCompletion(f);
      f.time(8); assert.doesNotThrow(() => finishCompletion(f, req, outcome)); f.uploads.clear();
      if (failure !== 'missing-object') f.objects.push({ id: 'completed', bytes: failure === 'intermediate-size' ? 6 : 4, latest: true });
      if (failure === 'extra-object') f.objects.push({ id: 'extra', bytes: 8, latest: false });
      f.time(12); await assert.rejects(f.audit.verify(), bad);
      assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
    });

for (const versioned of [false, true]) for (const bytes of [11, 12, 13, 15, 16, 17])
  test(`ambiguous part sums reject unsupported totals ${versioned}/${bytes}`, async t => {
    const f = await fixture(t, versioned), req = await ambiguousCompletion(f, { secondPart: true });
    f.time(8); assert.doesNotThrow(() => finishCompletion(f, req, 'lost-committed'));
    f.uploads.clear(); f.objects.push({ id: 'completed', bytes, latest: true });
    f.time(12); await assert.rejects(f.audit.verify(), bad);
  });

// An uncertain completion has to consume one distinct version-producing request.
for (const latest of ['completed', 'ordinary']) for (const bytes of [4, 8])
  test(`ambiguous completion retains admission order beside acknowledged writes ${latest}/${bytes}`, async t => {
    const f = await fixture(t, true), req = await ambiguousCompletion(f);
    f.time(8); assert.doesNotThrow(() => finishCompletion(f, req, 'lost-committed'));
    f.uploads.clear(); f.time(9);
    f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '4' } })({ statusCode: 200, bytesOut: 4, responseHeaders: { 'x-amz-version-id': 'ordinary' } });
    f.objects.push({ id: 'completed', bytes, latest: latest === 'completed' }, { id: 'ordinary', bytes: 4, latest: latest === 'ordinary' });
    f.time(12);
    if (latest === 'completed') await assert.rejects(f.audit.verify(), bad);
    else { await assert.doesNotReject(f.audit.verify()); result(f, bytes + 4, 0, true); }
  });

for (const excess of [false, true]) for (const reverse of [false, true])
  test(`ambiguous completion cannot borrow an ordinary request twice ${excess}/${reverse}`, async t => {
    const f = await fixture(t, true), req = await ambiguousCompletion(f);
    f.time(8); assert.doesNotThrow(() => finishCompletion(f, req, 'lost-committed'));
    f.uploads.clear(); f.time(9);
    f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '4' } })({ statusCode: null, bytesOut: 4, interrupted: true });
    f.objects.push({ id: 'completed', bytes: 8, latest: false }, { id: 'ordinary', bytes: 4, latest: true });
    if (excess) f.objects.push({ id: 'extra', bytes: 4, latest: false });
    if (reverse) f.objects.reverse();
    f.time(12);
    if (excess) await assert.rejects(f.audit.verify(), bad);
    else { await assert.doesNotReject(f.audit.verify()); result(f, 12, 0, true); }
  });

for (const missing of [false, true]) for (const reverse of [false, true])
  test(`each vanished ambiguous upload requires its own version ${missing}/${reverse}`, async t => {
    const f = await fixture(t, true), first = await ambiguousCompletion(f);
    f.time(6); assert.doesNotThrow(() => finishCompletion(f, first, 'lost-committed')); f.uploads.clear();
    const second = await ambiguousCompletion(f, { id: 'PRIVATE_SECOND', from: 7 });
    f.time(12); assert.doesNotThrow(() => finishCompletion(f, second, 'lost-committed')); f.uploads.clear();
    f.objects.push({ id: 'second', bytes: 4, latest: true });
    if (!missing) f.objects.push({ id: 'first', bytes: 8, latest: false });
    if (reverse) f.objects.reverse();
    f.time(15);
    if (missing) await assert.rejects(f.audit.verify(), bad);
    else { await assert.doesNotReject(f.audit.verify()); result(f, 12, 0, true); }
  });


for (const reverse of [false, true]) test(`ambiguous version assignment preserves a narrower ordinary witness ${reverse}`, async t => {
  const f = await fixture(t, true), req = await ambiguousCompletion(f);
  f.time(6); assert.doesNotThrow(() => finishCompletion(f, req, 'lost-committed')); f.uploads.clear();
  f.time(7); f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '4' } })({ statusCode: null, bytesOut: 4, interrupted: true });
  f.time(8); f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '2' } })({ statusCode: 200, bytesOut: 2, responseHeaders: { 'x-amz-version-id': 'latest' } });
  f.objects.push({ id: 'ordinary', bytes: 4, latest: false }, { id: 'completed', bytes: 8, latest: false }, { id: 'latest', bytes: 2, latest: true });
  if (reverse) f.objects.reverse();
  f.time(12); await assert.doesNotReject(f.audit.verify()); result(f, 14, 0, true);
});


for (const versioned of [false, true]) test(`two actual lost part replies still forward HTTP completion ${versioned}`, async t => {
  const f = await fixture(t, versioned); create(f); const received = [];
  const backend = createServer((req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.once('end', () => {
      const body = Buffer.concat(chunks); received.push({ method: req.method, body: body.toString() });
      if (req.method === 'PUT') {
        f.uploads.get(UploadId).set(1, { bytes: body.length, etag: 'lost' }); res.destroy();
      } else {
        assert.equal(body.toString(), completionInput([[1, 'lost']]).body.toString());
        const bytes = f.uploads.get(UploadId).get(1).bytes;
        f.uploads.clear(); f.objects.push({ id: 'completed', bytes, latest: true });
        res.setHeader('x-amz-version-id', 'completed'); res.end(completedReply());
      }
    });
  });
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
  for (const [time, body, id] of [[3, 'four', '11111111'], [5, 'eight888', '22222222']]) {
    f.time(time); await assert.rejects(send(input('part', body.length), Buffer.from(body), id), /Synthetic (request|reply) cutoff/);
    await front.whenIdle(() => {});
  }
  f.time(7); const req = completionInput([[1, 'lost']]);
  await assert.doesNotReject(async () => { assert.equal(await send(req, req.body, '33333333'), 200); });
  await front.whenIdle(() => {}); await assert.doesNotReject(front.close());
  f.time(10); await assert.doesNotReject(f.audit.verify()); result(f, 8, 0, true);
  assert.deepEqual(received, [{ method: 'PUT', body: 'four' }, { method: 'PUT', body: 'eight888' }, { method: 'POST', body: req.body.toString() }]);
  assert.equal(meter.snapshot().accounting.producer.attempts, 3);
  assert.equal(meter.snapshot().accounting.requests.filter(r => r.outcome === 'transport-error').reduce((n, r) => n + r.attempts, 0), 2);
  assert.equal(meter.diagnostics().firstInvalidation, null);
  assert.equal(front.checkpoint().pending, 0); assert.equal(front.checkpoint().connections, 0);
});


for (const distinct of [false, true]) test(`completion candidate budget counts distinct sums ${distinct}`, async t => {
  const f = await fixture(t, false); create(f);
  for (let n = 1; n <= 17; n++) {
    f.time(n + 2); cutoff(f, 'part', { n, bytes: 0 });
    cutoff(f, 'part', { n, bytes: distinct ? 2 ** (n - 1) : 1 });
  }
  const req = completionInput(Array.from({ length: 17 }, (_, n) => [n + 1, 'lost']));
  f.time(20);
  if (distinct) { assert.throws(() => f.audit.begin(req), bad); return; }
  assert.doesNotThrow(() => finishCompletion(f, req, 'lost-committed'));
  f.uploads.clear(); f.objects.push({ id: 'completed', bytes: 9, latest: true });
  f.time(22); await assert.doesNotReject(f.audit.verify()); result(f, 9, 0, true);
});

// Each missing completion reply owns its own deferred transition. A later
// completion must neither discard the first callback nor borrow its inventory.
async function twoDeferredCompletions(f, { first = true, second = true, acknowledged = false } = {}) {
  for (const [id, bytes, from, committed] of [[UploadId, 4, 1, first], ['PRIVATE_SECOND', 8, 7, second]]) {
    createAt(f, id, from); f.time(from + 2);
    begin(f, 'part', { id, bytes })({ statusCode: 200, bytesOut: bytes, responseHeaders: { etag: 'one' } });
    f.uploads.get(id).set(1, { bytes, etag: 'one' });
    f.time(from + 4); const end = begin(f, 'complete', { id });
    if (acknowledged && id === 'PRIVATE_SECOND') end({ statusCode: 200, bytesOut: completion.length,
      responseBody: completedReply() });
    else end({ statusCode: null, bytesOut: completion.length, interrupted: true });
    if (committed) { f.uploads.delete(id); f.objects.splice(0, f.objects.length, { bytes, latest: true }); }
  }
}

for (const first of [false, true]) for (const second of [false, true])
  test(`deferred same-key completions retain independent outcomes ${first}/${second}`, async t => {
    const f = await fixture(t, false); await twoDeferredCompletions(f, { first, second });
    f.time(14); await assert.doesNotReject(f.audit.verify());
    // Both retained uploads: 4+8; only first complete: 4+8;
    // only second complete: 4+8; both complete: only the later 8-byte object.
    result(f, first && second ? 8 : 12, Number(!first) + Number(!second), true);
    f.time(16); await assert.doesNotReject(f.audit.verify());
    result(f, first && second ? 8 : 12, Number(!first) + Number(!second), true);
  });

for (const first of [false, true]) test(`deferred same-key earlier completion cannot replace an acknowledged later one ${first}`, async t => {
  const f = await fixture(t, false); await twoDeferredCompletions(f, { first, acknowledged: true });
  f.time(14); await assert.doesNotReject(f.audit.verify()); result(f, first ? 8 : 12, Number(!first), true);
});

for (const failure of ['older-current', 'unowned-size', 'missing-current', 'duplicate-current', 'foreign-retained-part'])
  test(`deferred same-key completions reject unsupported inventory ${failure}`, async t => {
    const f = await fixture(t, false); await twoDeferredCompletions(f, { second: failure !== 'foreign-retained-part' });
    if (failure === 'older-current') f.objects[0].bytes = 4;
    if (failure === 'unowned-size') f.objects[0].bytes = 6;
    if (failure === 'missing-current') f.objects.length = 0;
    if (failure === 'duplicate-current') f.objects.push({ bytes: 8, latest: true });
    if (failure === 'foreign-retained-part') f.uploads.get('PRIVATE_SECOND').set(1, { bytes: 6, etag: 'one' });
    f.time(14); await assert.rejects(f.audit.verify(), bad);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });

for (const status of ['acknowledged', 'lost-committed', 'lost-uncommitted']) for (const method of ['PUT', 'DELETE'])
  test(`deferred same-key completions preserve later ordinary outcomes ${method}/${status}`, async t => {
    const f = await fixture(t, false); await twoDeferredCompletions(f);
    f.time(13); const end = f.audit.begin({ method, path, headers: { 'content-length': method === 'PUT' ? '2' : '0' } });
    const bytes = method === 'PUT' ? 2 : 0;
    end(status === 'acknowledged' ? { statusCode: method === 'PUT' ? 200 : 204, bytesOut: bytes }
      : { statusCode: null, interrupted: true, bytesOut: bytes });
    if (status !== 'lost-uncommitted') f.objects.splice(0, f.objects.length, ...(method === 'PUT' ? [{ bytes: 2, latest: true }] : []));
    f.time(16); await assert.doesNotReject(f.audit.verify());
    result(f, status === 'lost-uncommitted' ? 8 : bytes, 0, true);
  });

for (const acknowledged of [false, true]) test(`deferred same-key third completion keeps original order ${acknowledged}`, async t => {
  const f = await fixture(t, false); await twoDeferredCompletions(f);
  createAt(f, 'PRIVATE_THIRD', 13); f.time(15);
  begin(f, 'part', { id: 'PRIVATE_THIRD', bytes: 2 })({ statusCode: 200, bytesOut: 2, responseHeaders: { etag: 'one' } });
  f.uploads.get('PRIVATE_THIRD').set(1, { bytes: 2, etag: 'one' }); f.time(16);
  const end = begin(f, 'complete', { id: 'PRIVATE_THIRD' });
  end(acknowledged ? { statusCode: 200, bytesOut: completion.length, responseBody: completedReply() }
    : { statusCode: null, interrupted: true, bytesOut: completion.length });
  f.uploads.clear(); f.objects.splice(0, f.objects.length, { bytes: 2, latest: true });
  f.time(18); await assert.doesNotReject(f.audit.verify()); result(f, 2, 0, true);
});

for (const retained of [false, true]) for (const bytes of [4, 6, 8, 10, 12, 14, 18])
  test(`deferred same-key alternatives keep exact later selection ${retained}/${bytes}`, async t => {
    const f = await fixture(t, false), first = await ambiguousCompletion(f);
    f.time(8); finishCompletion(f, first, 'lost-committed'); f.uploads.clear();
    const second = await ambiguousCompletion(f, { id: 'PRIVATE_SECOND', from: 9, secondPart: true });
    f.time(15); finishCompletion(f, second, 'lost-committed');
    if (!retained) f.uploads.clear();
    f.objects.push({ bytes, latest: true }); f.time(18);
    const supported = retained ? bytes === 4 || bytes === 8 : [10, 14, 18].includes(bytes);
    if (!supported) { await assert.rejects(f.audit.verify(), bad); return; }
    await assert.doesNotReject(f.audit.verify()); result(f, retained ? bytes + 18 : bytes, Number(retained), true);
  });

for (const first of [false, true]) test(`deferred same-key settlement cannot reuse a completed callback ${first}`, async t => {
  const f = await fixture(t, false); await twoDeferredCompletions(f, { first }); f.time(13);
  const finish = f.audit.begin({ method: 'PUT', path, headers: { 'content-length': '2' } });
  const event = { statusCode: 200, bytesOut: 2 };
  finish(event); assert.throws(() => finish(event), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

test('deferred same-key actual HTTP completions collect both lost replies', async t => {
  const f = await fixture(t, false), received = [];
  const backend = createServer((req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
      const body = Buffer.concat(chunks), id = new URL(req.url, 'http://local').searchParams.get('uploadId');
      received.push({ id, body: body.toString() });
      const bytes = f.uploads.get(id).get(1).bytes;
      f.uploads.delete(id); f.objects.splice(0, f.objects.length, { bytes, latest: true }); res.destroy();
    });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload', lifetimes: f.audit });
  t.after(() => front.close().catch(() => {}));
  for (const [id, bytes, from, invocation] of [[UploadId, 4, 1, '11111111'], ['PRIVATE_SECOND', 8, 7, '22222222']]) {
    createAt(f, id, from); f.time(from + 2);
    begin(f, 'part', { id, bytes })({ statusCode: 200, bytesOut: bytes, responseHeaders: { etag: 'one' } });
    f.uploads.get(id).set(1, { bytes, etag: 'one' }); f.time(from + 4);
    const req = input('complete'); req.path = req.path.replace(UploadId, id);
    await assert.rejects(new Promise((resolve, reject) => {
      const caller = request(front.url + req.path, { method: req.method, headers: { ...req.headers,
        'amz-sdk-invocation-id': invocation + '-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=1',
      } }, async res => {
        try { for await (const chunk of res) void chunk; resolve(res.statusCode); }
        catch { reject(Error('Synthetic reply cutoff')); }
      });
      caller.once('error', () => reject(Error('Synthetic request cutoff'))); caller.end(req.body);
    }), /Synthetic (request|reply) cutoff/);
    await front.whenIdle(() => {});
  }
  await assert.doesNotReject(front.close()); f.time(14);
  await assert.doesNotReject(f.audit.verify()); result(f, 8, 0, true);
  assert.deepEqual(received, [{ id: UploadId, body: completion.toString() }, { id: 'PRIVATE_SECOND', body: completion.toString() }]);
  assert.equal(meter.snapshot().accounting.producer.attempts, 2);
  assert.equal(meter.snapshot().accounting.requests.filter(r => r.outcome === 'transport-error').reduce((n, r) => n + r.attempts, 0), 2);
  assert.equal(meter.diagnostics().firstInvalidation, null);
  assert.equal(front.checkpoint().pending, 0); assert.equal(front.checkpoint().connections, 0);
});

for (const bytes of [4, 6, 8, null]) test(`deferred same-key retained later upload cannot supply current object ${bytes}`, async t => {
  const f = await fixture(t, false); await twoDeferredCompletions(f, { second: false });
  f.objects.splice(0, f.objects.length, ...(bytes === null ? [] : [{ bytes, latest: true }])); f.time(14);
  if (bytes !== 4) { await assert.rejects(f.audit.verify(), bad); return; }
  await assert.doesNotReject(f.audit.verify()); result(f, 12, 1, true);
});
