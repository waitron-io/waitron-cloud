import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { openLitestreamHistories } from './storage-lifetimes.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from './meter.mjs';
import { createLitestreamTransport } from './litestream.mjs';

const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3'), bad = /Invalid cloud cost storage lifetimes/;
const key = 'PRIVATE_é&CANARY', other = 'PRIVATE_OTHER_CANARY';
const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const bodyFor = keys => Buffer.from('<Delete>' + keys.map(k => `<Object><Key>${xml(k)}</Key></Object>`).join('') + '<Quiet>false</Quiet></Delete>');
const inputFor = body => ({ method: 'POST', path: '/synthetic/?delete=', headers: { 'content-length': String(body.length) }, body });
const resultFor = entries => Buffer.from('<DeleteResult>' + entries.join('') + '</DeleteResult>');
const deleted = k => `<Deleted><Key>${xml(k)}</Key></Deleted>`;
const denied = k => `<Error><Key>${xml(k)}</Key><Code>AccessDenied</Code><Message>PRIVATE</Message></Error>`;

async function fixture(t, enabled = true) {
  let time = 0;
  const rows = new Map(), state = { requests: 0 };
  const backend = createServer((req, res) => {
    state.requests++; req.resume(); req.on('end', () => {
      const url = new URL(req.url, 'http://local');
      if (url.searchParams.has('versioning')) res.end('<VersioningConfiguration/>');
      else if (url.searchParams.has('uploads')) res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>');
      else res.end('<ListBucketResult><IsTruncated>false</IsTruncated>' + [...rows].map(([k, n]) => `<Contents><Key>${xml(k)}</Key><Size>${n}</Size></Contents>`).join('') + '</ListBucketResult>');
    });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'observer', clock: () => time });
  const target = `http://127.0.0.1:${backend.address().port}`;
  const proxy = await createMeteringProxy({ target, meter, classify: correlatedStorageAttempt }); t.after(() => proxy.close());
  const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  instrumentStorageClient({ client, meter, phase: 'observer', endpoint: proxy.url }); t.after(() => client.destroy());
  const audit = await openLitestreamHistories({ client, sdk, meter, bucket: 'synthetic', clock: () => time,
    ...(enabled ? { allowBulkDeletes: true } : {}) });
  return { rows, state, meter, audit, target, time: n => { time = n; } };
}
function put(f, k, bytes, from, by) {
  f.time(from); const finish = f.audit.begin({ method: 'PUT', path: '/synthetic/' + encodeURIComponent(k), headers: { 'content-length': String(bytes) } });
  f.time(by); finish({ statusCode: 200, bytesOut: bytes }); f.rows.set(k, bytes);
}
function finishBatch(f, body, results, from, by, statusCode = 200) {
  f.time(from); let finish;
  assert.doesNotThrow(() => { finish = f.audit.begin(inputFor(body)); }, 'explicitly enabled unversioned deletion batches must be admitted');
  f.time(by);
  finish({ statusCode, bytesOut: body.length, responseBody: resultFor(results) });
}

// Losing retired intervals, treating all entries alike, or retaining locks breaks these hand-calculated bounds.
test('unversionedNativeBatchesRetainMixedResultHistoryAndReleaseEveryKey', async t => {
  const f = await fixture(t); put(f, key, 4, 1, 2); put(f, other, 6, 3, 4);
  finishBatch(f, bodyFor([key, other]), [denied(other), deleted(key)], 5, 7); f.rows.delete(key);
  assert.throws(() => f.audit.snapshot(), bad);
  f.time(10); await f.audit.verify();
  assert.deepEqual(f.audit.snapshot(), { status: 'measured', scope: 'unversioned-object-history', windowSeconds: 10,
    objects: { class: 'stream', bytes: 6, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }, byteSeconds: { low: 48, high: 66 } });
  finishBatch(f, bodyFor([other, key]), [deleted(key), deleted(other)], 11, 12); f.rows.clear();
  f.time(15); await f.audit.verify();
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 54, high: 78 });
  assert.equal(f.audit.snapshot().objects.bytes, 0); assert.equal(f.meter.snapshot().reconciled, true);
  assert.equal(/PRIVATE|CANARY/.test(JSON.stringify(f.audit.snapshot())), false);
});

// An HTTP error or per-entry refusal cannot prove that a deletion did not commit.
for (const reply of ['lost', 'entry-error']) for (const committed of [false, true]) test(`unversionedNativeBatchesResolveAmbiguous_${reply}_${committed}`, async t => {
  const f = await fixture(t); put(f, key, 4, 1, 2);
  finishBatch(f, bodyFor([key]), [denied(key)], 4, 5, reply === 'lost' ? 503 : 200);
  if (committed) f.rows.clear();
  f.time(8); await f.audit.verify(); f.time(10);
  assert.deepEqual(f.audit.snapshot().byteSeconds, committed ? { low: 8, high: 28 } : { low: 32, high: 36 });
  assert.equal(f.audit.snapshot().objects.bytes, committed ? 0 : 4);
});

test('unversionedNativeBatchRetryKeepsFirstPossibleDeletionTime', async t => {
  const f = await fixture(t); put(f, key, 4, 1, 2); const body = bodyFor([key]);
  finishBatch(f, body, [], 4, 5, 503); finishBatch(f, body, [deleted(key)], 6, 7); f.rows.clear();
  f.time(10); await f.audit.verify(); assert.deepEqual(f.audit.snapshot().byteSeconds, { low: 8, high: 24 });
});

test('unversionedNativeBatchRequiresNewInventoryAfterAPreviouslyVerifiedCheckpoint', async t => {
  const f = await fixture(t); put(f, key, 4, 1, 2); f.time(3); await f.audit.verify();
  assert.equal(f.audit.snapshot().objects.bytes, 4);
  finishBatch(f, bodyFor([key]), [deleted(key)], 4, 5); f.rows.clear();
  assert.throws(() => f.audit.snapshot(), bad);
  f.time(6); await f.audit.verify(); assert.equal(f.audit.snapshot().objects.bytes, 0);
});

// Unsafe selection must fail before any provider mutation; every error also poisons future evidence.
for (const mode of ['default', 'foreign', 'empty', 'many', 'duplicate', 'version', 'quiet', 'quiet-twice', 'escape', 'backslash', 'encoding', 'length', 'copy', 'unknown', 'malformed', 'entity', 'utf8', 'large']) {
  test(`unversionedNativeBatchRefusesSelection_${mode}`, async t => {
    const f = await fixture(t, mode !== 'default'); let body = bodyFor([key]);
    if (mode === 'empty') body = bodyFor([]);
    if (mode === 'many') body = bodyFor(Array.from({ length: 1001 }, (_, i) => String(i)));
    if (mode === 'duplicate') body = bodyFor([key, key]);
    if (mode === 'escape') body = bodyFor(['../private']);
    if (mode === 'backslash') body = bodyFor(['private\\key']);
    if (mode === 'version') body = Buffer.from(body.toString().replace('</Object>', '<VersionId>private</VersionId></Object>'));
    if (mode === 'quiet') body = Buffer.from(body.toString().replace('<Quiet>false', '<Quiet>true'));
    if (mode === 'quiet-twice') body = Buffer.from(body.toString().replace('</Delete>', '<Quiet>false</Quiet></Delete>'));
    if (mode === 'unknown') body = Buffer.from(body.toString().replace('</Object>', '<Unknown>private</Unknown></Object>'));
    if (mode === 'malformed') body = Buffer.from('<Delete><Object></Delete>');
    if (mode === 'entity') body = Buffer.from('<Delete><Object><Key>&unknown;</Key></Object></Delete>');
    if (mode === 'utf8') body = Buffer.concat([Buffer.from('<Delete>'), Buffer.from([0xff]), Buffer.from('</Delete>')]);
    if (mode === 'large') body = Buffer.from('<Delete>' + ' '.repeat(1048576) + '</Delete>');
    const input = inputFor(body);
    if (mode === 'foreign') input.path = '/foreign/?delete=';
    if (mode === 'encoding') input.headers['content-encoding'] = 'gzip';
    if (mode === 'copy') input.headers['x-amz-copy-source'] = 'private';
    if (mode === 'length') input.headers['content-length'] = String(body.length + 1);
    const before = f.state.requests; assert.throws(() => f.audit.begin(input), bad);
    assert.equal(f.state.requests, before); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

// Missing, repeated or version-bearing replies must never qualify an unversioned deletion.
for (const mode of ['missing', 'duplicate', 'foreign', 'version', 'marker', 'code', 'unknown', 'malformed', 'status', 'short', 'interrupt', 'twice', 'clock', 'pending']) {
  test(`unversionedNativeBatchRefusesCompletion_${mode}`, async t => {
    const f = await fixture(t); const body = bodyFor([key]); f.time(2); const finish = f.audit.begin(inputFor(body));
    let entries = [deleted(key)];
    if (mode === 'missing') entries = [];
    if (mode === 'duplicate') entries.push(deleted(key));
    if (mode === 'foreign') entries = [deleted(other)];
    if (mode === 'version') entries = [deleted(key).replace('</Deleted>', '<VersionId>private</VersionId></Deleted>')];
    if (mode === 'marker') entries = [deleted(key).replace('</Deleted>', '<DeleteMarker>true</DeleteMarker></Deleted>')];
    if (mode === 'code') entries = [denied(key).replace('<Code>AccessDenied</Code>', '')];
    if (mode === 'unknown') entries = [deleted(key).replace('</Deleted>', '<Unknown>private</Unknown></Deleted>')];
    const event = { statusCode: mode === 'status' ? 204 : 200, bytesOut: body.length - (mode === 'short' ? 1 : 0),
      interrupted: mode === 'interrupt', responseBody: mode === 'malformed' ? Buffer.from('<DeleteResult>') : resultFor(entries) };
    if (mode === 'pending') await assert.rejects(f.audit.verify(), bad);
    else if (mode === 'twice') { finish(event); assert.throws(() => finish(event), bad); }
    else { if (mode === 'clock') f.time(1); assert.throws(() => finish(event), bad); }
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

// Batches and single mutations share key admission; an unobserved PUT cannot be replaced by a delete.
for (const mode of ['batch-put', 'put-batch', 'batch-batch', 'ambiguous-put']) test(`unversionedNativeBatchRejectsOverlappingMutation_${mode}`, async t => {
  const f = await fixture(t); const batch = inputFor(bodyFor([key])), single = { method: 'PUT', path: '/synthetic/' + encodeURIComponent(key), headers: { 'content-length': '4' } };
  const finish = f.audit.begin(mode === 'put-batch' || mode === 'ambiguous-put' ? single : batch);
  if (mode === 'ambiguous-put') finish({ statusCode: 503, bytesOut: 4 });
  assert.throws(() => f.audit.begin(mode === 'batch-put' ? single : batch), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// Count the signed request/control bytes independently at both sides of the forwarding listener.
test('unversionedNativeBatchTransportPairsActualSdkControlBodies', async t => {
  const f = await fixture(t), meter = createMeter({ phase: 'workload', clock: () => 0 });
  const response = resultFor([deleted(key)]), backend = createServer((req, res) => { req.resume(); req.on('end', () => res.end(response)); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const observer = await createMeteringProxy({ target: `http://127.0.0.1:${backend.address().port}`, meter,
    classify: input => ({ token: input.headers['amz-sdk-invocation-id'] + ':1', phase: 'workload', operation: 'delete-many', retryOrdinal: 0, errorCode: null, sameAccount: null }) });
  t.after(() => observer.close());
  const front = await createLitestreamTransport({ target: observer.url, meter, phase: 'workload', lifetimes: f.audit, allowBulkDeletes: true });
  t.after(() => front.close().catch(() => {}));
  const writer = new sdk.S3Client({ endpoint: front.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } }); t.after(() => writer.destroy());
  const result = await writer.send(new sdk.DeleteObjectsCommand({ Bucket: 'synthetic', Delete: { Objects: [{ Key: key }] } }));
  assert.equal(result.Deleted.length, 1); await front.close(); await f.audit.verify();
  const proof = meter.snapshot(); assert.equal(proof.reconciled, true);
  assert.deepEqual(proof.accounting.producer, proof.accounting.observer);
  assert.equal(proof.accounting.producer.attempts, 1); assert.equal(proof.accounting.producer.bytesIn, response.length);
  assert.ok(proof.accounting.producer.bytesOut > 0); assert.equal(f.audit.snapshot().objects.bytes, 0);
});

for (const mode of ['default', 'foreign', 'version', 'malformed']) test(`unversionedNativeBatchTransportRejectsBeforeMutation_${mode}`, async t => {
  const f = await fixture(t, mode !== 'default'), meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: f.target, meter, phase: 'workload', lifetimes: f.audit, allowBulkDeletes: true });
  t.after(() => front.close().catch(() => {}));
  let body = bodyFor([key]);
  if (mode === 'version') body = Buffer.from(body.toString().replace('</Object>', '<VersionId>private</VersionId></Object>'));
  if (mode === 'malformed') body = Buffer.from('<Delete/>');
  const before = f.state.requests;
  const status = await new Promise((resolve, reject) => {
    const req = request(front.url + (mode === 'foreign' ? '/foreign' : '/synthetic') + '/?delete=', { method: 'POST', headers: {
      'content-length': String(body.length), 'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=1' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.on('error', reject); req.end(body);
  });
  assert.equal(status, 400); assert.equal(f.state.requests, before); assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});
