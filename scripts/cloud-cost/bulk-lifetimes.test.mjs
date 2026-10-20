import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient, classifyStorageOperation } from './meter.mjs';
import { openStorageLifetimes } from './storage-lifetimes.mjs';
const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3');
const bad = { message: 'Invalid cloud cost storage lifetimes' };
const xml = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const tag = (k, v) => v === undefined ? '' : `<${k}>${xml(v)}</${k}>`;

async function fixture(t, { versioned = false, enabled = true, maxAttempts = 1,
  producerEnabled = enabled, observerEnabled = enabled, ledgerEnabled = enabled } = {}) {
  let time = 0, next = 0;
  const rows = new Map(), state = { batches: 0, writes: 0, failKeys: new Set() };
  const server = createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://local');
      const key = decodeURIComponent(url.pathname.slice('/synthetic/'.length));
      if (req.method === 'PUT') {
        state.writes++;
        const id = versioned ? 'v' + ++next : undefined;
        rows.set(JSON.stringify([key, id]), { Key: key, VersionId: id, Size: Buffer.concat(chunks).length, marker: false });
        if (id) res.setHeader('x-amz-version-id', id);
        return res.end();
      }
      if (req.method === 'POST') {
        state.batches++; const raw = Buffer.concat(chunks).toString();
        const items = [...raw.matchAll(/<Object>(.*?)<\/Object>/gs)].map(m => ({
          Key: /<Key>(.*?)<\/Key>/s.exec(m[1])[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'),
          VersionId: /<VersionId>(.*?)<\/VersionId>/.exec(m[1])?.[1],
        }));
        state.items = items;
        if (state.retry && state.batches === 1) { res.writeHead(503); return res.end('<Error><Code>ServiceUnavailable</Code></Error>'); }
        const results = items.map(item => {
          if (state.failKeys.has(item.Key)) return { ...item, error: true };
          if (versioned && item.VersionId === undefined) {
            const id = 'm' + ++next;
            rows.set(JSON.stringify([item.Key, id]), { Key: item.Key, VersionId: id, marker: true });
            return { ...item, DeleteMarker: true, DeleteMarkerVersionId: id };
          }
          rows.delete(JSON.stringify([item.Key, item.VersionId])); return item;
        });
        const response = state.response?.(results) ?? results;
        return res.end('<DeleteResult>' + response.map(r => `<${r.error ? 'Error' : 'Deleted'}>`
          + ['Key', 'VersionId', 'DeleteMarker', 'DeleteMarkerVersionId'].map(k => tag(k, r[k])).join('')
          + (r.error ? (state.omitErrorCode ? '' : '<Code>AccessDenied</Code>') + '<Message>PRIVATE_PROVIDER_CANARY</Message>' : '')
          + `</${r.error ? 'Error' : 'Deleted'}>`).join('') + '</DeleteResult>');
      }
      if (url.searchParams.has('versioning')) return res.end('<VersioningConfiguration>' + (versioned ? '<Status>Enabled</Status>' : '') + '</VersioningConfiguration>');
      if (url.searchParams.has('uploads')) return res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>');
      const values = [...rows.values()];
      const entries = values.map((row, i) => {
        if (!versioned) return '<Contents>' + tag('Key', row.Key) + tag('Size', row.Size) + '</Contents>';
        const kind = row.marker ? 'DeleteMarker' : 'Version';
        const latest = !values.slice(i + 1).some(v => v.Key === row.Key);
        return `<${kind}>` + tag('Key', row.Key) + tag('VersionId', row.VersionId) + tag('IsLatest', latest)
          + (row.marker ? '' : tag('Size', row.Size)) + `</${kind}>`;
      }).join('');
      res.end(`<${versioned ? 'ListVersionsResult' : 'ListBucketResult'}><IsTruncated>false</IsTruncated>${entries}</${versioned ? 'ListVersionsResult' : 'ListBucketResult'}>`);
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const meter = createMeter({ phase: 'workload', clock: () => time });
  const proxy = await createMeteringProxy({ target: `http://127.0.0.1:${server.address().port}`, meter,
    classify: input => correlatedStorageAttempt(input, { allowBulkDeletes: observerEnabled }) });
  t.after(() => proxy.close().catch(error => {
    assert.equal(error.message, 'Invalid cloud cost meter');
    assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  }));
  const clients = Object.fromEntries(['workload', 'observer', 'cleanup'].map(phase => {
    const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts,
      credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    instrumentStorageClient({ client, meter, phase, endpoint: proxy.url, allowBulkDeletes: producerEnabled });
    t.after(() => client.destroy()); return [phase, client];
  }));
  const ledger = await openStorageLifetimes({ clients, sdk, meter, bucket: 'synthetic', versioned, objectClass: 'stream', allowBulkDeletes: ledgerEnabled });
  return { ledger, meter, state, rows, clients, time: n => { time = n; },
    put: (Key, Body) => ledger.send(new sdk.PutObjectCommand({ Bucket: 'synthetic', Key, Body })),
    batch: (Objects, { phase = 'workload', ...extra } = {}) => ledger.send(new sdk.DeleteObjectsCommand({ Bucket: 'synthetic', Delete: { Objects, ...extra } }), { phase }) };
}

// Conflating a batch with one object loses failed entries and the storage before deletion.
test('bulkDeleteMixedResultsPreserveFailedStorageAndAnonymousRetiredByteTime', async t => {
  const f = await fixture(t);
  f.time(1); await f.put('PRIVATE_A', 'abcd'); f.time(2); await f.put('PRIVATE_B', '123456');
  f.state.failKeys.add('PRIVATE_B'); f.time(5);
  const result = await f.batch([{ Key: 'PRIVATE_A' }, { Key: 'PRIVATE_B' }, { Key: 'ABSENT' }]);
  assert.equal(result.Deleted.length, 2); assert.equal(result.Errors.length, 1);
  assert.throws(() => f.ledger.snapshot(), bad);
  await f.ledger.verify(); f.time(10);
  const proof = f.ledger.snapshot();
  assert.deepEqual(proof.accounting.objects, [{ class: 'stream', bytes: 6, byteSeconds: 64,
    currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }]);
  assert.equal(proof.reconciled, true);
  assert.deepEqual(proof.accounting.producer, proof.accounting.observer);
  const batch = proof.accounting.requests.find(r => r.operation === 'delete-many');
  assert.equal(batch.attempts, 1); assert.equal(batch.requestClass, 's3-delete');
  assert.ok(batch.bytesOut > 0); assert.ok(batch.bytesIn > 0);
  assert.equal(JSON.stringify(proof).includes('PRIVATE_'), false);
  assert.equal(proof.billing.find(r => r.requestClass === 's3-delete').quantity, 0);
  f.state.failKeys.clear(); await f.batch([{ Key: 'PRIVATE_B' }], { phase: 'cleanup' });
  await f.ledger.verify(); f.time(12);
  assert.equal(f.ledger.snapshot().accounting.objects[0].byteSeconds, 64);
});

// Losing the marker or promoting a version that is also deleted misstates current/noncurrent bytes.
test('bulkDeleteVersionMarkersAndExplicitVersionsMatchIndependentInventory', async t => {
  const f = await fixture(t, { versioned: true });
  f.time(1); const old = await f.put('é', 'abc'); f.time(3); const current = await f.put('é', '12345');
  f.time(5); const deletion = await f.batch([{ Key: 'é' }]); await f.ledger.verify();
  assert.deepEqual(f.ledger.snapshot().accounting.objects.map(r => [r.bytes, r.currentVersions, r.noncurrentVersions, r.deleteMarkers]), [[10, 0, 2, 1]]);
  f.time(7); await f.batch([{ Key: 'é', VersionId: deletion.Deleted[0].DeleteMarkerVersionId }]); await f.ledger.verify();
  assert.deepEqual(f.ledger.snapshot().accounting.objects.map(r => [r.bytes, r.currentVersions, r.noncurrentVersions, r.deleteMarkers]), [[8, 1, 1, 0]]);
  f.time(9); await f.batch([{ Key: 'é', VersionId: current.VersionId }, { Key: 'é', VersionId: old.VersionId }], { phase: 'cleanup' });
  await f.ledger.verify(); f.time(12);
  assert.deepEqual(f.ledger.snapshot().accounting.objects, [{ class: 'stream', bytes: 0, byteSeconds: 58,
    currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }]);
  assert.equal(f.ledger.snapshot().reconciled, true);
});

// A partial or contradictory success reply cannot stand in for a complete per-object result.
for (const mode of ['missing', 'duplicate', 'foreign', 'version', 'marker', 'error-duplicate']) {
  test(`bulkDeleteRefusesAmbiguousResponse_${mode}`, async t => {
    const f = await fixture(t); await f.put('PRIVATE_A', 'abc');
    f.state.response = rows => mode === 'missing' ? [] : mode === 'duplicate' ? [...rows, ...rows]
      : mode === 'foreign' ? [{ Key: 'FOREIGN' }] : mode === 'version' ? [{ ...rows[0], VersionId: 'FOREIGN' }]
      : mode === 'marker' ? [{ ...rows[0], DeleteMarker: true, DeleteMarkerVersionId: 'FOREIGN' }]
      : [...rows, { ...rows[0], error: true }];
    await assert.rejects(f.batch([{ Key: 'PRIVATE_A' }]), bad);
    assert.throws(() => f.ledger.snapshot(), bad); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

// Malformed/ambiguous request selections must stop before the provider can mutate anything.
for (const mode of ['disabled', 'empty', 'duplicate', 'duplicate-version', 'oversized', 'quiet', 'unknown-version', 'mixed-version', 'long-key', 'empty-key', 'foreign-field']) {
  test(`bulkDeleteAdmissionStopsBeforeProvider_${mode}`, async t => {
    const f = await fixture(t, { enabled: mode !== 'disabled', versioned: ['unknown-version', 'mixed-version', 'duplicate-version'].includes(mode) });
    const first = await f.put('PRIVATE_A', 'abc');
    const items = mode === 'empty' ? [] : mode === 'duplicate' ? [{ Key: 'PRIVATE_A' }, { Key: 'PRIVATE_A' }]
      : mode === 'duplicate-version' ? [{ Key: 'PRIVATE_A', VersionId: first.VersionId }, { Key: 'PRIVATE_A', VersionId: first.VersionId }]
      : mode === 'oversized' ? Array.from({ length: 1001 }, (_, n) => ({ Key: String(n) }))
      : mode === 'unknown-version' ? [{ Key: 'PRIVATE_A', VersionId: 'UNKNOWN' }]
      : mode === 'mixed-version' ? [{ Key: 'PRIVATE_A' }, { Key: 'PRIVATE_A', VersionId: first.VersionId }]
      : [{ Key: mode === 'long-key' ? 'é'.repeat(513) : mode === 'empty-key' ? '' : 'PRIVATE_A', ...(mode === 'foreign-field' ? { Private: 'CANARY' } : {}) }];
    await assert.rejects(f.batch(items, { Quiet: mode === 'quiet' }), bad);
    assert.equal(f.state.batches, 0); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

test('bulkDeleteRetriedResponsesAndMismatchedInventoryCannotQualifyEvidence', async t => {
  for (const mode of ['retry', 'inventory']) {
    const f = await fixture(t, { maxAttempts: mode === 'retry' ? 2 : 1 });
    await f.put('PRIVATE_A', 'abc');
    if (mode === 'retry') {
      f.state.retry = true;
      await assert.rejects(f.batch([{ Key: 'PRIVATE_A' }]), bad); assert.equal(f.state.batches, 2);
    } else {
      await f.batch([{ Key: 'PRIVATE_A' }]);
      f.rows.set(JSON.stringify(['FOREIGN', undefined]), { Key: 'FOREIGN', Size: 3 });
      await assert.rejects(f.ledger.verify(), bad);
    }
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

// Default paths keep refusing batches; opted-in classification must still reject mismatched shapes.
test('bulkDeleteClassificationRequiresExplicitAgreementOnMethodQueryAndSdkHint', () => {
  for (const path of ['/synthetic?delete', '/synthetic/?delete=&x-id=DeleteObjects']) {
    assert.throws(() => classifyStorageOperation({ method: 'POST', path }), /Invalid cloud cost meter/);
    assert.equal(classifyStorageOperation({ method: 'POST', path, allowBulkDeletes: true }), 'delete-many');
  }
  for (const [method, path] of [['GET', '/synthetic?delete'], ['POST', '/synthetic/key?delete'],
    ['POST', '/synthetic?delete=other'], ['POST', '/synthetic?delete&versionId=x'],
    ['POST', '/synthetic?delete&delete'], ['POST', '/synthetic?delete&x-id=DeleteObject']])
    assert.throws(() => classifyStorageOperation({ method, path, allowBulkDeletes: true }), /Invalid cloud cost meter/);
});

// Enabling one layer must not grant permission to the other independent counting layers.
for (const layer of ['producer', 'observer', 'ledger']) {
  test(`bulkDeleteRequiresIndependentOptIn_${layer}`, async t => {
    const f = await fixture(t, { [layer + 'Enabled']: false });
    await f.put('PRIVATE_A', 'abc');
    await assert.rejects(f.batch([{ Key: 'PRIVATE_A' }]), bad);
    assert.equal(f.state.batches, 0); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

// A claimed marker needs its actual new identity, rather than a missing or reused version.
for (const mode of ['missing-id', 'missing-flag', 'null-id', 'reused-id', 'error-code']) {
  test(`bulkDeleteVersionedReplyNeedsCompleteOutcome_${mode}`, async t => {
    const f = await fixture(t, { versioned: true });
    const stored = await f.put('PRIVATE_A', 'abc');
    f.state.response = rows => mode === 'missing-id' ? [{ ...rows[0], DeleteMarkerVersionId: undefined }]
      : mode === 'missing-flag' ? [{ ...rows[0], DeleteMarker: undefined }]
      : mode === 'null-id' ? [{ ...rows[0], DeleteMarkerVersionId: 'null' }]
      : mode === 'reused-id' ? [{ ...rows[0], DeleteMarkerVersionId: stored.VersionId }]
      : [{ Key: 'PRIVATE_A', error: true }];
    if (mode === 'error-code') {
      // Keep the real SDK and HTTP deserializer; remove only the provider's error code.
      f.state.omitErrorCode = true;
    }
    await assert.rejects(f.batch([{ Key: 'PRIVATE_A' }]), bad);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

test('bulkDeleteAcceptsTheThousandObjectBoundaryAsOneCountedRequest', async t => {
  const f = await fixture(t);
  await f.batch(Array.from({ length: 1000 }, (_, n) => ({ Key: 'ABSENT_' + n })));
  await f.ledger.verify();
  const proof = f.ledger.snapshot();
  assert.equal(f.state.items.length, 1000); assert.equal(f.state.batches, 1);
  assert.equal(proof.accounting.requests.find(r => r.operation === 'delete-many').attempts, 1);
  assert.deepEqual(proof.accounting.objects, []); assert.equal(proof.reconciled, true);
});

for (const mode of ['bucket', 'top-key', 'top-version', 'selection-field', 'item-version']) {
  test(`bulkDeleteRejectsUntrackedSelectionBeforeSending_${mode}`, async t => {
    const f = await fixture(t);
    const input = { Bucket: 'synthetic', Delete: { Objects: [{ Key: 'PRIVATE_A' }] } };
    if (mode === 'bucket') input.Bucket = 'FOREIGN';
    if (mode === 'top-key') input.Key = 'PRIVATE_A';
    if (mode === 'top-version') input.VersionId = 'PRIVATE_A';
    if (mode === 'selection-field') input.Delete.Private = 'CANARY';
    if (mode === 'item-version') input.Delete.Objects[0].VersionId = 'null';
    await assert.rejects(f.ledger.send(new sdk.DeleteObjectsCommand(input)), bad);
    assert.equal(f.state.batches, 0); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

test('bulkDeleteFailedEntryStillNeedsIndependentInventoryAgreement', async t => {
  const f = await fixture(t); await f.put('PRIVATE_A', 'abc');
  f.state.response = rows => rows.map(row => ({ ...row, error: true }));
  await f.batch([{ Key: 'PRIVATE_A' }]);
  await assert.rejects(f.ledger.verify(), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// S3 can identify an explicitly removed marker through DeleteMarkerVersionId alone.
test('bulkDeleteExplicitMarkerIdentityCanComeFromItsDedicatedResponseField', async t => {
  const f = await fixture(t, { versioned: true });
  f.time(1); await f.put('PRIVATE_A', 'abc');
  f.time(3); const created = await f.batch([{ Key: 'PRIVATE_A' }]);
  const VersionId = created.Deleted[0].DeleteMarkerVersionId;
  f.state.response = rows => rows.map(row => ({ Key: row.Key, DeleteMarker: true, DeleteMarkerVersionId: row.VersionId }));
  f.time(5); await f.batch([{ Key: 'PRIVATE_A', VersionId }]);
  await f.ledger.verify(); f.time(7);
  assert.deepEqual(f.ledger.snapshot().accounting.objects, [{ class: 'stream', bytes: 3, byteSeconds: 36,
    currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }]);
  assert.equal(f.ledger.snapshot().reconciled, true);
});

// A local S3-compatible backend must never receive a key that could escape its owned bucket.
for (const Key of ['../FOREIGN', 'a/../FOREIGN', 'a/./PRIVATE', '/PRIVATE', 'a\\..\\FOREIGN', 'PRIVATE\0']) {
  test(`bulkDeleteRefusesPathEscapeBeforeProvider_${JSON.stringify(Key)}`, async t => {
    const f = await fixture(t);
    await assert.rejects(f.batch([{ Key }]), bad);
    assert.equal(f.state.batches, 0); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
  test(`singleSdkMutationRefusesPathEscapeBeforeProvider_${JSON.stringify(Key)}`, async t => {
    const f = await fixture(t);
    await assert.rejects(f.put(Key, 'abc'), bad);
    assert.equal(f.state.writes, 0); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

for (const mode of ['foreign', 'conflict', 'missing-flag', 'data-version', 'wrong-kind']) {
  test(`bulkDeleteDedicatedMarkerIdentityCannotSelectAnotherVersion_${mode}`, async t => {
    const f = await fixture(t, { versioned: true });
    const object = await f.put('PRIVATE_A', 'abc');
    const created = await f.batch([{ Key: 'PRIVATE_A' }]);
    const VersionId = ['data-version', 'wrong-kind'].includes(mode) ? object.VersionId : created.Deleted[0].DeleteMarkerVersionId;
    f.state.response = rows => rows.map(row => ({ Key: row.Key,
      ...(['conflict', 'wrong-kind'].includes(mode) ? { VersionId: row.VersionId } : {}),
      ...(mode === 'missing-flag' ? {} : { DeleteMarker: true }),
      DeleteMarkerVersionId: ['foreign', 'conflict'].includes(mode) ? 'FOREIGN' : row.VersionId }));
    await assert.rejects(f.batch([{ Key: 'PRIVATE_A', VersionId }]), bad);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}
