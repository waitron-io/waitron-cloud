import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import * as storage from './stream-versions.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from './meter.mjs';
import { createLitestreamTransport } from './litestream.mjs';
const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3');
const bad = /Invalid cloud cost storage lifetimes/;
const key = 'PRIVATE_VERSION_CANARY', path = '/synthetic/' + key;
const put = bytes => ({ method: 'PUT', path, headers: { 'content-length': String(bytes) } });
const del = version => ({ method: 'DELETE', path: path + (version ? '?versionId=' + version : ''), headers: {} });
const reply = (version, marker) => ({ 'x-amz-version-id': version, ...(marker === undefined ? {} : { 'x-amz-delete-marker': String(marker) }) });
async function fixture(t) {
  let time = 0;
  const rows = [], state = { received: 0, versioning: 'Enabled', uploads: '', duplicate: false, paged: false };
  const add = (id, bytes, marker = false, Key = key) => {
    for (const row of rows) if (row.key === Key) row.latest = false;
    rows.push({ id, bytes, marker, key: Key, latest: true });
  };
  const remove = id => {
    const i = rows.findIndex(r => r.id === id); if (i < 0) return;
    const [row] = rows.splice(i, 1);
    if (row.latest) { const prior = rows.filter(r => r.key === row.key).at(-1); if (prior) prior.latest = true; }
  };
  const server = createServer((req, res) => {
    state.received++; req.resume(); req.on('end', () => {
      if (req.method === 'PUT') { add('wire-' + state.received, 4); state.onMutation?.(); res.writeHead(200, reply(rows.at(-1).id)); res.end(); return; }
      const url = new URL(req.url, 'http://local');
      if (url.searchParams.has('versioning')) res.end(`<VersioningConfiguration><Status>${state.versioning}</Status></VersioningConfiguration>`);
      else if (url.searchParams.has('uploads')) res.end(`<ListMultipartUploadsResult><IsTruncated>false</IsTruncated>${state.uploads}</ListMultipartUploadsResult>`);
      else {
        const next = url.searchParams.has('key-marker'), page = state.emptyRepeat && next ? [] : state.paged ? rows.slice(next ? 1 : 0, next ? rows.length : 1) : rows;
        const more = state.repeatToken || state.paged && !next;
        const xml = page.map(r => `<${r.marker ? 'DeleteMarker' : 'Version'}><Key>${r.key}</Key><VersionId>${r.id}</VersionId><IsLatest>${r.latest}</IsLatest>${r.marker ? '' : `<Size>${r.bytes}</Size>`}</${r.marker ? 'DeleteMarker' : 'Version'}>`).join('');
        res.end(`<ListVersionsResult><IsTruncated>${more}</IsTruncated>${more ? '<NextKeyMarker>next</NextKeyMarker><NextVersionIdMarker>next</NextVersionIdMarker>' : ''}${xml}${state.duplicate ? xml : ''}</ListVersionsResult>`);
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const target = `http://127.0.0.1:${server.address().port}`, meter = createMeter({ phase: 'observer', clock: () => time });
  const proxy = await createMeteringProxy({ target, meter, classify: correlatedStorageAttempt }); t.after(() => proxy.close());
  const client = new sdk.S3Client({ endpoint: proxy.url, forcePathStyle: true, maxAttempts: 1, region: 'eu-north-1',
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  instrumentStorageClient({ client, meter, phase: 'observer', endpoint: proxy.url }); t.after(() => client.destroy());
  return { args: { client, sdk, meter, bucket: 'synthetic', clock: () => time }, rows, state, add, remove, meter, target, time: n => { time = n; } };
}
async function open(f) {
  assert.equal(typeof storage.openLitestreamVersionHistories, 'function', 'retain native noncurrent versions and markers with independent inventory');
  return storage.openLitestreamVersionHistories(f.args);
}
function success(f, audit, input, start, end, id, marker) {
  f.time(start); const finish = audit.begin(input); f.time(end);
  finish({ statusCode: input.method === 'DELETE' ? 204 : 200, bytesOut: input.method === 'PUT' ? Number(input.headers['content-length']) : 0,
    responseHeaders: reply(id, marker) });
}

// Earlier versions remain billable when a new current version or a marker replaces them.
test('nativeVersionsRetainEveryVersionAndUtf8MarkerAcrossPromotionAndDeletion', async t => {
  const f = await fixture(t), audit = await open(f);
  success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4);
  success(f, audit, put(6), 3, 4, 'second'); f.add('second', 6);
  success(f, audit, del(), 5, 6, 'marker', true); f.add('marker', Buffer.byteLength(key), true);
  f.time(7); await audit.verify();
  assert.deepEqual(audit.snapshot().objects, { class: 'stream', bytes: 10 + Buffer.byteLength(key), currentVersions: 0,
    noncurrentVersions: 2, deleteMarkers: 1, unfinishedMultipart: 0 });
  success(f, audit, del('marker'), 8, 9, 'marker', true); f.remove('marker');
  f.time(10); await audit.verify();
  assert.equal(audit.snapshot().objects.currentVersions, 1); assert.equal(audit.snapshot().objects.noncurrentVersions, 1);
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 68 + 2 * Buffer.byteLength(key), high: 78 + 4 * Buffer.byteLength(key) });
  success(f, audit, del('first'), 11, 12, 'first', false); f.remove('first');
  success(f, audit, del('second'), 13, 14, 'second', false); f.remove('second');
  f.time(20); await audit.verify();
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 90 + 2 * Buffer.byteLength(key), high: 110 + 4 * Buffer.byteLength(key) });
  assert.equal(audit.snapshot().objects.bytes, 0); assert.equal(audit.snapshot().scope, 'versioned-object-history');
  assert.equal(f.meter.snapshot().reconciled, true); assert.equal(JSON.stringify(audit.snapshot()).includes(key), false);
});

for (const kind of ['put', 'marker', 'remove']) for (const committed of [false, true]) {
  test(`nativeVersionsResolveFailed_${kind}_${committed}`, async t => {
    const f = await fixture(t), audit = await open(f);
    if (kind === 'remove') { success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4); }
    f.time(4); const end = audit.begin(kind === 'put' ? put(6) : kind === 'marker' ? del() : del('first'));
    f.time(5); end({ statusCode: 503, bytesOut: kind === 'put' ? 6 : 0, responseHeaders: {} });
    if (committed) { if (kind === 'remove') f.remove('first'); else f.add('unknown', kind === 'put' ? 6 : Buffer.byteLength(key), kind === 'marker'); }
    assert.throws(() => audit.snapshot(), bad);
    f.time(8); await audit.verify(); f.time(10);
    const bytes = kind === 'put' ? 6 : Buffer.byteLength(key);
    assert.deepEqual(audit.snapshot().byteSeconds, kind === 'remove' ? committed ? { low: 8, high: 28 } : { low: 32, high: 36 }
      : committed ? { low: bytes * 2, high: bytes * 6 } : { low: 0, high: 0 });
  });
}

test('nativeVersionRetryCanRetainTwoCommittedVersionsOfTheSameSize', async t => {
  const f = await fixture(t), audit = await open(f);
  f.time(1); const failed = audit.begin(put(4)); f.time(2); failed({ statusCode: 503, bytesOut: 4, responseHeaders: {} }); f.add('lost', 4);
  success(f, audit, put(4), 3, 4, 'returned'); f.add('returned', 4);
  f.time(8); await audit.verify(); f.time(10);
  assert.equal(audit.snapshot().objects.bytes, 8); assert.equal(audit.snapshot().objects.noncurrentVersions, 1);
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 32, high: 64 });
});

for (const mode of ['extra', 'missing', 'size', 'marker', 'latest', 'duplicate', 'versioning', 'uploads', 'repeat-token']) {
  test(`nativeVersionsRefuseUnpairedInventory_${mode}`, async t => {
    const f = await fixture(t), audit = await open(f);
    success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4);
    if (mode === 'extra') f.add('foreign', 4);
    if (mode === 'missing') f.rows.length = 0;
    if (mode === 'size') f.rows[0].bytes = 3;
    if (mode === 'marker') f.rows[0].marker = true;
    if (mode === 'latest') f.rows[0].latest = false;
    if (mode === 'duplicate') f.state.duplicate = true;
    if (mode === 'versioning') f.state.versioning = 'Suspended';
    if (mode === 'uploads') f.state.uploads = '<Upload><Key>private</Key><UploadId>private</UploadId></Upload>';
    if (mode === 'repeat-token') f.state.repeatToken = true;
    await assert.rejects(audit.verify(), bad); assert.throws(() => audit.snapshot(), bad);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

test('nativeVersionsReadEveryPageAndRequireExactlyThePossibleLatestVersion', async t => {
  const f = await fixture(t), audit = await open(f);
  success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4);
  success(f, audit, put(6), 3, 4, 'second'); f.add('second', 6);
  f.state.paged = true; f.time(10); await audit.verify();
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 68, high: 78 });
  f.rows[0].latest = true; f.rows[1].latest = false;
  await assert.rejects(audit.verify(), bad);
});

for (const mode of ['overlap', 'pending', 'twice', 'clock', 'short', 'interrupt', 'status', 'missing-id', 'null-id', 'reused-id', 'wrong-marker', 'wrong-removal']) {
  test(`nativeVersionsRefuseUnprovableCompletion_${mode}`, async t => {
    const f = await fixture(t), audit = await open(f);
    success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4);
    f.time(4); const finish = audit.begin(mode === 'wrong-removal' ? del('first') : put(6));
    if (mode === 'overlap') assert.throws(() => audit.begin(put(6)), bad);
    else if (mode === 'pending') await assert.rejects(audit.verify(), bad);
    else if (mode === 'twice') { finish({ statusCode: 200, bytesOut: 6, responseHeaders: reply('second') }); assert.throws(() => finish({ statusCode: 200, bytesOut: 6, responseHeaders: reply('second') }), bad); }
    else {
      if (mode === 'clock') f.time(3);
      const responseHeaders = mode === 'missing-id' ? {} : reply(mode === 'null-id' ? 'null' : mode === 'reused-id' ? 'first' : 'second', mode === 'wrong-marker' ? true : undefined);
      assert.throws(() => finish({ statusCode: mode === 'status' ? 99 : 200, bytesOut: mode === 'short' ? 5 : mode === 'wrong-removal' ? 0 : 6,
        interrupted: mode === 'interrupt', responseHeaders }), bad);
    }
    assert.throws(() => audit.snapshot(), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

test('nativeVersionsRefuseForeignPathsUnknownVersionsAndUnsupportedMutationsBeforeForwarding', async t => {
  for (const input of [{ ...put(4), path: '/foreign/key' }, { ...put(4), path: '/synthetic/a%2Fb' },
    { ...put(4), path: '/synthetic/%2e%2e/private' }, { ...put(4), path: path + '?versionId=unknown' }, del('unknown'),
    { ...put(4), method: 'POST', path: path + '?uploads' }, { ...put(4), headers: {} },
    { ...put(4), headers: { 'content-length': '4', 'x-amz-copy-source': '/private' } },
    { ...put(4), headers: { 'content-length': '4', 'content-encoding': 'gzip' } }]) {
    const f = await fixture(t), audit = await open(f), before = f.state.received;
    assert.throws(() => audit.begin(input), bad); assert.equal(f.state.received, before);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

test('nativeVersionsRequireEmptyVersionedBucketAndBoundObserver', async t => {
  for (const mode of ['rows', 'versioning', 'uploads', 'binding']) {
    const f = await fixture(t);
    if (mode === 'rows') f.add('foreign', 4);
    if (mode === 'versioning') f.state.versioning = '';
    if (mode === 'uploads') f.state.uploads = '<Upload><Key>private</Key><UploadId>private</UploadId></Upload>';
    if (mode === 'binding') f.args.client = { send() {} };
    await assert.rejects(open(f), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

test('nativeVersionTransportCarriesActualResponseIdentityIntoIndependentHistory', async t => {
  const f = await fixture(t), lifetimes = await open(f), producer = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: f.target, meter: producer, phase: 'workload', lifetimes }); t.after(() => front.close().catch(() => {}));
  f.time(2); f.state.onMutation = () => f.time(5);
  assert.equal(await new Promise((resolve, reject) => {
    const req = request(front.url + path, { method: 'PUT', headers: { 'content-length': '4',
      'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=1' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.on('error', reject); req.end('four');
  }), 200);
  await front.close(); f.time(10); await lifetimes.verify();
  assert.deepEqual(lifetimes.snapshot().byteSeconds, { low: 20, high: 32 });
  assert.equal(lifetimes.snapshot().objects.bytes, 4); assert.equal(producer.snapshot().accounting.producer.bytesOut, 4);
});

// Distinct failed requests cannot all claim the same earlier slot to justify an impossible current version.
test('nativeVersionsRequireEnoughEarlierFailedRequestsForEveryNoncurrentVersion', async t => {
  const f = await fixture(t), audit = await open(f);
  f.time(1); const first = audit.begin(del()); f.time(2); first({ statusCode: 503, bytesOut: 0 }); f.add('lost-first', Buffer.byteLength(key), true);
  success(f, audit, put(4), 3, 4, 'returned'); f.add('returned', 4);
  f.time(5); const last = audit.begin(del()); f.time(6); last({ statusCode: 503, bytesOut: 0 }); f.add('lost-last', Buffer.byteLength(key), true);
  f.rows.forEach(row => { row.latest = row.id === 'returned'; });
  f.time(10); await assert.rejects(audit.verify(), bad);
});

test('nativeVersionsChargeUtf8MarkerBytesAndRetainEmptyDataVersions', async t => {
  const f = await fixture(t), audit = await open(f), path = '/synthetic/%C3%A9';
  success(f, audit, { method: 'PUT', path, headers: { 'content-length': '0' } }, 1, 2, 'empty'); f.add('empty', 0, false, 'é');
  success(f, audit, { method: 'DELETE', path, headers: {} }, 3, 4, 'marker', true); f.add('marker', 2, true, 'é');
  f.time(10); await audit.verify();
  assert.deepEqual(audit.snapshot().objects, { class: 'stream', bytes: 2, currentVersions: 0, noncurrentVersions: 1, deleteMarkers: 1, unfinishedMultipart: 0 });
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 12, high: 14 });
});

test('nativeVersionsBoundSeveralLostCommitsWithoutAssigningAnInventedOrder', async t => {
  const f = await fixture(t), audit = await open(f);
  for (const [from, by, id] of [[1, 2, 'lost-first'], [3, 4, 'lost-second']]) {
    f.time(from); const finish = audit.begin(put(4)); f.time(by); finish({ statusCode: 503, bytesOut: 4 }); f.add(id, 4);
  }
  success(f, audit, put(4), 5, 6, 'returned'); f.add('returned', 4);
  f.time(10); await audit.verify(); f.time(12);
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 40, high: 116 });
  assert.equal(audit.snapshot().objects.noncurrentVersions, 2);
  await audit.verify(); assert.deepEqual(audit.snapshot().byteSeconds, { low: 40, high: 116 }, 'a repeated inventory preserves its earlier bounds');
});

for (const mode of ['extra-failed-version', 'wrong-failed-size', 'wrong-failed-marker', 'resurrected', 'missing-marker-flag', 'conflicting-removal-marker']) {
  test(`nativeVersionsRefuseAmbiguousIdentity_${mode}`, async t => {
    const f = await fixture(t), audit = await open(f);
    if (mode.startsWith('extra') || mode.startsWith('wrong')) {
      f.time(1); const finish = audit.begin(put(4)); f.time(2); finish({ statusCode: 503, bytesOut: 4 }); f.add('lost', mode === 'wrong-failed-size' ? 5 : 4);
      if (mode === 'extra-failed-version') f.add('extra', 4);
      if (mode === 'wrong-failed-marker') f.rows[0].marker = true;
      await assert.rejects(audit.verify(), bad);
    } else if (mode === 'missing-marker-flag') {
      const finish = audit.begin(del()); assert.throws(() => finish({ statusCode: 204, bytesOut: 0, responseHeaders: reply('marker') }), bad);
    } else {
      success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4);
      if (mode === 'conflicting-removal-marker') {
        const finish = audit.begin(del('first')); assert.throws(() => finish({ statusCode: 204, bytesOut: 0, responseHeaders: reply('first', true) }), bad);
      } else { success(f, audit, del('first'), 3, 4, 'first'); await assert.rejects(audit.verify(), bad); }
    }
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

test('nativeVersionsSanitizeMalformedAdmissionAndObserverFailures', async t => {
  for (const change of [{ bucket: 'bad/path' }, { clock: () => NaN }, { clock: null }, { meter: {} },
    { meter: { invalidate() { throw Error('PRIVATE_ERROR_CANARY'); } } }, { sdk: {} }]) {
    const f = await fixture(t);
    await assert.rejects(storage.openLitestreamVersionHistories({ ...f.args, ...change }), error => bad.test(error.message) && !error.message.includes('PRIVATE_ERROR_CANARY'));
  }
  for (const mode of ['status', 'retry']) {
    const f = await fixture(t), send = f.args.client.send.bind(f.args.client);
    f.args.client.send = async command => { const result = await send(command); result.$metadata[mode === 'status' ? 'httpStatusCode' : 'attempts'] = mode === 'status' ? 206 : 2; return result; };
    await assert.rejects(open(f), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

test('nativeVersionsRequireFreshInventoryAfterEverySuccessfulMutation', async t => {
  const f = await fixture(t), audit = await open(f);
  success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4);
  assert.throws(() => audit.snapshot(), bad);
  f.time(3); await audit.verify(); assert.equal(audit.snapshot().objects.bytes, 4);
  success(f, audit, del('first'), 4, 5, 'first'); f.remove('first');
  assert.throws(() => audit.snapshot(), bad);
  f.time(6); await audit.verify(); assert.deepEqual(audit.snapshot().byteSeconds, { low: 8, high: 16 });
});

test('nativeVersionsRefuseDuplicateDeletionCompletionAndStopRepeatedEmptyPagesPromptly', async t => {
  const f = await fixture(t), audit = await open(f);
  success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4);
  f.time(3); const finish = audit.begin(del('first'));
  f.time(4); finish({ statusCode: 204, bytesOut: 0, responseHeaders: reply('first') }); f.remove('first');
  assert.throws(() => finish({ statusCode: 204, bytesOut: 0, responseHeaders: reply('first') }), bad);
  const other = await fixture(t), history = await open(other);
  other.state.repeatToken = true; other.state.emptyRepeat = true;
  const before = other.state.received;
  await assert.rejects(history.verify(), bad);
  assert.ok(other.state.received - before <= 4, 'a repeated empty continuation must stop without consuming the page ceiling');
});

test('nativeVersionsRefuseSeveralCurrentVersionsForOneKey', async t => {
  const f = await fixture(t), audit = await open(f);
  success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4);
  success(f, audit, put(6), 3, 4, 'second'); f.add('second', 6);
  f.rows[0].latest = true;
  await assert.rejects(audit.verify(), bad);
});

test('nativeVersionsAllowParallelReadsAndMutationsOfIndependentKeys', async t => {
  const f = await fixture(t), audit = await open(f);
  const read = audit.begin({ method: 'GET', path, headers: {} }), head = audit.begin({ method: 'HEAD', path, headers: {} });
  head({ statusCode: 404, bytesOut: 0 }); read({ statusCode: 404, bytesOut: 0 });
  f.time(1); const first = audit.begin(put(4));
  f.time(2); const second = audit.begin({ ...put(2), path: '/synthetic/SECOND_PRIVATE_CANARY' });
  f.time(3); second({ statusCode: 200, bytesOut: 2, responseHeaders: reply('second') }); f.add('second', 2, false, 'SECOND_PRIVATE_CANARY');
  f.time(5); first({ statusCode: 200, bytesOut: 4, responseHeaders: reply('first') }); f.add('first', 4);
  f.time(10); await audit.verify();
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 34, high: 52 }); assert.equal(audit.snapshot().objects.currentVersions, 2);
});

const batchBody = items => Buffer.from('<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' + items
  .map(([k, v]) => `<Object><Key>${k}</Key>${v === undefined ? '' : `<VersionId>${v}</VersionId>`}</Object>`).join('') + '</Delete>');
const batchInput = body => ({ method: 'POST', path: '/synthetic/?delete=&x-id=DeleteObjects',
  headers: { 'content-length': String(body.length) }, body });
const batchResult = entries => Buffer.from('<DeleteResult>' + entries.join('') + '</DeleteResult>');
const deleted = (k, v, marker) => `<Deleted><Key>${k}</Key>${v === undefined ? '' : `<VersionId>${v}</VersionId>`}`
  + (marker === undefined ? '' : `<DeleteMarker>true</DeleteMarker><DeleteMarkerVersionId>${marker}</DeleteMarkerVersionId>`) + '</Deleted>';
const failedDelete = k => `<Error><Key>${k}</Key><Code>AccessDenied</Code><Message>PRIVATE_ERROR_CANARY</Message></Error>`;
const openBulk = f => storage.openLitestreamVersionHistories({ ...f.args, allowBulkDeletes: true });

// Counting one batch must preserve failed entries and the storage retained before each deletion.
test('nativeVersionBatchesRetainMixedResultsAndDeletedVersionByteTime', async t => {
  const f = await fixture(t), audit = await openBulk(f);
  success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4);
  success(f, audit, { ...put(6), path: '/synthetic/SECOND' }, 3, 4, 'second'); f.add('second', 6, false, 'SECOND');
  const body = batchBody([[key, 'first'], ['SECOND', 'second']]);
  f.time(5); const finish = audit.begin(batchInput(body)); f.time(7);
  finish({ statusCode: 200, bytesOut: body.length, responseBody: batchResult([deleted(key, 'first'),
    '<Error><Key>SECOND</Key><VersionId>second</VersionId><Code>AccessDenied</Code></Error>']) }); f.remove('first');
  assert.throws(() => audit.snapshot(), bad); f.time(10); await audit.verify();
  assert.deepEqual(audit.snapshot().objects, { class: 'stream', bytes: 6, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 48, high: 66 });
  assert.equal(/PRIVATE_|SECOND|first|second/.test(JSON.stringify(audit.snapshot())), false);
});

test('nativeVersionBatchesCreateUtf8MarkersAndPromoteTheirSelectedPriorVersion', async t => {
  const f = await fixture(t), audit = await openBulk(f);
  success(f, audit, { ...put(4), path: '/synthetic/%C3%A9%26' }, 1, 2, 'first'); f.add('first', 4, false, 'é&');
  const body = batchBody([['é&amp;']]); f.time(3); const finish = audit.begin(batchInput(body)); f.time(4);
  finish({ statusCode: 200, bytesOut: body.length, responseBody: batchResult([deleted('é&#38;', undefined, 'marker')]) }); f.add('marker', 3, true, 'é&');
  f.time(6); await audit.verify(); assert.equal(audit.snapshot().objects.deleteMarkers, 1);
  const remove = batchBody([['é&amp;', 'marker']]); f.time(7); const end = audit.begin(batchInput(remove)); f.time(8);
  end({ statusCode: 200, bytesOut: remove.length, responseBody: batchResult([deleted('é&amp;', undefined, 'marker')]) }); f.remove('marker');
  f.time(10); await audit.verify();
  assert.deepEqual(audit.snapshot().objects, { class: 'stream', bytes: 4, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(audit.snapshot().byteSeconds, { low: 41, high: 51 });
});

for (const committed of [false, true]) test(`nativeVersionBatchesResolveLostMarkerReplies_${committed}`, async t => {
  const f = await fixture(t), audit = await openBulk(f), body = batchBody([[key]]);
  f.time(1); const finish = audit.begin(batchInput(body)); f.time(2);
  finish({ statusCode: 503, bytesOut: body.length, responseBody: Buffer.from('PRIVATE_UNPARSEABLE_ERROR') });
  if (committed) f.add('lost', Buffer.byteLength(key), true);
  f.time(5); await audit.verify(); f.time(10);
  const size = Buffer.byteLength(key);
  assert.deepEqual(audit.snapshot().byteSeconds, committed ? { low: size * 5, high: size * 9 } : { low: 0, high: 0 });
});

for (const mode of ['missing', 'duplicate', 'foreign', 'wrong-version', 'missing-marker', 'conflicting-marker', 'error-without-code', 'unknown-field', 'malformed', 'large', 'short-body']) {
  test(`nativeVersionBatchesRefuseUnprovedResponse_${mode}`, async t => {
    const f = await fixture(t), audit = await openBulk(f), body = batchBody([[key]]);
    const finish = audit.begin(batchInput(body));
    const result = mode === 'missing' ? [] : mode === 'duplicate' ? [deleted(key, undefined, 'marker'), deleted(key, undefined, 'marker')]
      : mode === 'foreign' ? [deleted('FOREIGN', undefined, 'marker')] : mode === 'wrong-version' ? [deleted(key, 'foreign', 'marker')]
      : mode === 'missing-marker' ? [deleted(key)] : mode === 'conflicting-marker' ? [deleted(key, undefined, 'marker').replace('<DeleteMarker>true', '<DeleteMarker>false')]
      : mode === 'error-without-code' ? [failedDelete(key).replace('<Code>AccessDenied</Code>', '')]
      : mode === 'unknown-field' ? [deleted(key, undefined, 'marker').replace('</Deleted>', '<PRIVATE>CANARY</PRIVATE></Deleted>')]
      : [deleted(key, undefined, 'marker')];
    const responseBody = mode === 'large' ? Buffer.from('<DeleteResult>' + ' '.repeat(1048576) + '</DeleteResult>') : mode === 'malformed' ? Buffer.from('<DeleteResult><Deleted></DeleteResult>') : batchResult(result);
    assert.throws(() => finish({ statusCode: 200, bytesOut: body.length - (mode === 'short-body' ? 1 : 0), responseBody }), bad);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

for (const mode of ['disabled', 'foreign', 'empty', 'many', 'quiet', 'duplicate-quiet', 'duplicate-key', 'duplicate-field', 'unknown-version', 'traversal', 'unknown-field', 'entity', 'codepoint', 'doctype', 'wrong-root', 'invalid-utf8', 'large', 'encoded', 'length']) {
  test(`nativeVersionBatchAdmissionRefusesBeforeForwarding_${mode}`, async t => {
    const f = await fixture(t), audit = mode === 'disabled' ? await open(f) : await openBulk(f);
    let body = batchBody(mode === 'duplicate-key' ? [[key], [key]] : mode === 'unknown-version' ? [[key, 'unknown']] : mode === 'traversal' ? [['../private']] : [[key]]);
    if (mode === 'quiet') body = Buffer.from(body.toString().replace('</Delete>', '<Quiet>true</Quiet></Delete>'));
    if (mode === 'duplicate-quiet') body = Buffer.from(body.toString().replace('</Delete>', '<Quiet>false</Quiet><Quiet>false</Quiet></Delete>'));
    if (mode === 'empty') body = batchBody([]);
    if (mode === 'many') body = batchBody(Array.from({ length: 1001 }, (_, i) => [String(i)]));
    if (mode === 'unknown-field') body = Buffer.from(body.toString().replace('</Object>', '<Unknown>private</Unknown></Object>'));
    if (mode === 'entity') body = batchBody([['&unknown;']]);
    if (mode === 'codepoint') body = batchBody([['&#0;']]);
    if (mode === 'wrong-root') body = Buffer.from(body.toString().replaceAll('Delete', 'Wrong'));
    if (mode === 'duplicate-field') body = Buffer.from(body.toString().replace('</Key>', '</Key><Key>SECOND</Key>'));
    if (mode === 'doctype') body = Buffer.from('<!DOCTYPE Delete [<!ENTITY x SYSTEM "file:///private">]>' + body);
    if (mode === 'invalid-utf8') body = Buffer.concat([Buffer.from('<Delete><Object><Key>'), Buffer.from([0xff]), Buffer.from('</Key></Object></Delete>')]);
    if (mode === 'large') body = Buffer.from(body.toString().replace('</Delete>', ' '.repeat(1048576) + '</Delete>'));
    const input = batchInput(body);
    if (mode === 'foreign') input.path = '/foreign/?delete=';
    if (mode === 'encoded') input.headers['content-encoding'] = 'gzip';
    if (mode === 'length') input.headers['content-length'] = String(body.length + 1);
    const received = f.state.received;
    assert.throws(() => audit.begin(input), bad); assert.equal(f.state.received, received);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

test('nativeVersionBatchLocksEverySelectedKeyUntilCompletion', async t => {
  const f = await fixture(t), audit = await openBulk(f), body = batchBody([[key]]);
  audit.begin(batchInput(body)); assert.throws(() => audit.begin(put(4)), bad);
});

for (const kind of ['put', 'batch']) test(`nativeVersionBatchRefusesOverlapWithAnActive_${kind}`, async t => {
  const f = await fixture(t), audit = await openBulk(f), input = batchInput(batchBody([[key]]));
  audit.begin(kind === 'put' ? put(4) : input);
  assert.throws(() => audit.begin(input), bad);
});

for (const mode of ['missing-version', 'wrong-version', 'wrong-marker', 'wrong-marker-id', 'error-version']) test(`nativeVersionBatchRequiresSelectedExplicitVersionResponse_${mode}`, async t => {
  const f = await fixture(t), audit = await openBulk(f);
  success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4);
  const body = batchBody([[key, 'first']]), finish = audit.begin(batchInput(body));
  const response = mode === 'missing-version' ? deleted(key) : mode === 'wrong-version' ? deleted(key, 'second')
    : mode === 'wrong-marker' ? deleted(key, 'first').replace('</Deleted>', '<DeleteMarker>true</DeleteMarker></Deleted>') : mode === 'wrong-marker-id' ? deleted(key, 'first').replace('</Deleted>', '<DeleteMarkerVersionId>second</DeleteMarkerVersionId></Deleted>')
    : `<Error><Key>${key}</Key><VersionId>second</VersionId><Code>AccessDenied</Code></Error>`;
  assert.throws(() => finish({ statusCode: 200, bytesOut: body.length, responseBody: batchResult([response]) }), bad);
});

test('nativeVersionBatchFailedRemovalAndMarkerRetriesReleaseKeysAndRetainBounds', async t => {
  const f = await fixture(t), audit = await openBulk(f);
  success(f, audit, put(4), 1, 2, 'first'); f.add('first', 4);
  const body = batchBody([[key, 'first']]); f.time(3); const finish = audit.begin(batchInput(body)); f.time(4);
  finish({ statusCode: 503, bytesOut: body.length }); f.remove('first');
  f.time(6); await audit.verify(); assert.deepEqual(audit.snapshot().byteSeconds, { low: 4, high: 20 });
  const create = batchBody([[key]]); f.time(7); const pending = audit.begin(batchInput(create)); f.time(8);
  pending({ statusCode: 200, bytesOut: create.length, responseBody: batchResult([failedDelete(key)]) });
  f.time(9); await audit.verify();
  const retry = audit.begin(batchInput(create)); retry({ statusCode: 200, bytesOut: create.length, responseBody: batchResult([deleted(key, undefined, 'marker')]) }); f.add('marker', Buffer.byteLength(key), true);
  f.time(10); await audit.verify(); assert.equal(audit.snapshot().objects.deleteMarkers, 1);
});

for (const mode of ['default', 'history-default', 'oversized', 'malformed', 'encoded']) test(`nativeBatchTransportRefusesBeforeBackend_${mode}`, async t => {
  const f = await fixture(t), history = mode === 'history-default' ? await open(f) : await openBulk(f);
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: f.target, meter, phase: 'workload', lifetimes: history,
    allowBulkDeletes: mode !== 'default' }); t.after(() => front.close().catch(() => {}));
  const body = mode === 'malformed' ? Buffer.from('<Delete/>') : batchBody([[key]]), before = f.state.received;
  const status = await new Promise((resolve, reject) => {
    const req = request(front.url + '/synthetic/?delete=', { method: 'POST', headers: {
      'content-length': mode === 'oversized' ? '1048577' : String(body.length),
      ...(mode === 'encoded' ? { 'content-encoding': 'gzip' } : {}),
      'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=1' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.on('error', reject); req.end(body);
  });
  assert.equal(status, 400); assert.equal(f.state.received, before);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

test('nativeVersionBatchTransportPairsControlBodiesWithIndependentStorageCounters', async t => {
  const f = await fixture(t), history = await openBulk(f), meter = createMeter({ phase: 'workload', clock: () => 0 });
  const body = batchBody([[key]]), result = batchResult([failedDelete(key)]);
  const backend = createServer((req, res) => { req.resume(); req.on('end', () => res.end(result)); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const observer = await createMeteringProxy({ target: `http://127.0.0.1:${backend.address().port}`, meter,
    classify: input => ({ token: input.headers['amz-sdk-invocation-id'] + ':1', phase: 'workload', retryOrdinal: 0,
      operation: 'delete-many', errorCode: null, sameAccount: null }) });
  t.after(() => observer.close());
  const front = await createLitestreamTransport({ target: observer.url, meter, phase: 'workload', lifetimes: history, allowBulkDeletes: true });
  t.after(() => front.close().catch(() => {}));
  const status = await new Promise((resolve, reject) => {
    const req = request(front.url + '/synthetic/?delete=', { method: 'POST', headers: { 'content-length': String(body.length),
      'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=1' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.on('error', reject); req.end(body);
  });
  assert.equal(status, 200); await front.close(); f.time(10); await history.verify();
  assert.equal(history.snapshot().objects.bytes, 0);
  const proof = meter.snapshot(); assert.equal(proof.reconciled, true);
  assert.deepEqual(proof.accounting.producer, { attempts: 1, bytesOut: body.length, bytesIn: result.length });
  assert.deepEqual(proof.accounting.observer, proof.accounting.producer);
});

test('nativeVersionBatchTransportAcceptsActualSignedSdkControlRequests', async t => {
  const f = await fixture(t), history = await openBulk(f), meter = createMeter({ phase: 'workload', clock: () => 0 });
  const result = batchResult([failedDelete(key)]);
  const backend = createServer((req, res) => { req.resume(); req.on('end', () => res.end(result)); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload', lifetimes: history, allowBulkDeletes: true });
  t.after(() => front.close().catch(() => {}));
  const writer = new sdk.S3Client({ endpoint: front.url, forcePathStyle: true, maxAttempts: 1, region: 'eu-north-1',
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } }); t.after(() => writer.destroy());
  const reply = await writer.send(new sdk.DeleteObjectsCommand({ Bucket: 'synthetic', Delete: { Objects: [{ Key: key }] } }));
  assert.equal(reply.Errors.length, 1); await front.close(); f.time(10); await history.verify();
  assert.equal(history.snapshot().objects.bytes, 0);
});

for (const mode of ['twice', 'pending', 'clock', 'interrupt', 'status', 'wrong-success-status']) test(`nativeVersionBatchCompletionRemainsBoundedAndSingleUse_${mode}`, async t => {
  const f = await fixture(t), audit = await openBulk(f), body = batchBody([[key]]);
  f.time(2); const finish = audit.begin(batchInput(body));
  const event = { statusCode: 200, bytesOut: body.length, responseBody: batchResult([failedDelete(key)]) };
  if (mode === 'pending') await assert.rejects(audit.verify(), bad);
  else if (mode === 'twice') { finish(event); assert.throws(() => finish(event), bad); }
  else {
    if (mode === 'clock') f.time(1);
    if (mode === 'interrupt') event.interrupted = true;
    if (mode === 'status') event.statusCode = 99;
    if (mode === 'wrong-success-status') event.statusCode = 204;
    assert.throws(() => finish(event), bad);
  }
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

test('nativeBatchTransportCapsTheActualControlBodyWithoutAHistoricalAuditor', async t => {
  const f = await fixture(t), meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: f.target, meter, phase: 'workload', allowBulkDeletes: true }); t.after(() => front.close().catch(() => {}));
  const body = Buffer.from('<Delete>' + ' '.repeat(1048576) + '<Object><Key>PRIVATE</Key></Object></Delete>'), before = f.state.received;
  const status = await new Promise((resolve, reject) => {
    const req = request(front.url + '/synthetic/?delete=', { method: 'POST', headers: { 'content-length': String(body.length),
      'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=1' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.on('error', reject); req.end(body);
  });
  assert.equal(status, 400); assert.equal(f.state.received, before); assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

test('nativeBatchTransportRefusesOversizedSuccessfulReplyBeforeQualifyingItsHistory', async t => {
  const f = await fixture(t), history = await openBulk(f), meter = createMeter({ phase: 'workload', clock: () => 0 });
  const result = Buffer.from('<DeleteResult>' + ' '.repeat(1048576) + failedDelete(key) + '</DeleteResult>');
  const backend = createServer((req, res) => { req.resume(); req.on('end', () => res.end(result)); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload', lifetimes: history, allowBulkDeletes: true });
  t.after(() => front.close().catch(() => {}));
  const body = batchBody([[key]]);
  const completed = await new Promise((resolve, reject) => {
    const req = request(front.url + '/synthetic/?delete=', { method: 'POST', headers: { 'content-length': String(body.length),
      'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=1' } }, res => {
      res.resume(); res.on('end', () => resolve(true)); res.on('error', () => resolve(false));
    }); req.on('error', () => resolve(false)); req.end(body);
  });
  assert.equal(completed, false); await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

for (const encoded of [false, true]) test(`nativeVersionBatchRefusesNoncharacterControlText_${encoded}`, async t => {
  const f = await fixture(t), audit = await openBulk(f), body = batchBody([[encoded ? '&#65534;' : '\ufffe']]);
  assert.throws(() => audit.begin(batchInput(body)), bad);
});
