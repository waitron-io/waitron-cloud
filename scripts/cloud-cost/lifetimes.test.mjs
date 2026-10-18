import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeter } from './meter.mjs';

// Losing replacement sizes or a promoted prior version misstates retained byte-time.
test('multipartReplacementAndVersionPromotionPreserveTheLifetimeIntegral', () => {
  let time = 0;
  const meter = createMeter({ phase: 'workload', clock: () => time });
  const object = (token, action, bytes) => meter.observeObject({ token, action, class: 'stream', bytes });
  object('old', 'create', 3);
  time = 1; object('old', 'noncurrent', 0);
  object('upload', 'multipart-create', 0);
  time = 2; object('upload', 'multipart-part', 8);
  time = 4; assert.doesNotThrow(() => object('upload', 'multipart-resize', 2), 'replace the retained size rather than adding an overwritten part');
  time = 5; object('upload', 'multipart-complete', 2);
  time = 6; object('old', 'current', 0);
  time = 7;
  assert.deepEqual(meter.snapshot().accounting.objects, [{ class: 'stream', bytes: 5, byteSeconds: 43,
    currentVersions: 2, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }]);
});

test('lifetimeResizingAndPromotionRefuseInvalidTransitions', () => {
  for (const action of ['multipart-resize', 'current']) {
    const meter = createMeter({ phase: 'workload', clock: () => 0 });
    meter.observeObject({ token: 'current', action: 'create', class: 'stream', bytes: 3 });
    assert.throws(() => meter.observeObject({ token: 'current', action, class: 'stream', bytes: 0 }), /Invalid cloud cost meter/);
    assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  }
});

import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import * as lifetime from './storage-lifetimes.mjs';
import { createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from './meter.mjs';
const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3');
async function fixture(t, respond, { clock = () => 0, maxAttempts = 1 } = {}) {
  const upstream = createServer(respond);
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); return new Promise(resolve => upstream.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock });
  const proxy = await createMeteringProxy({ target: `http://127.0.0.1:${upstream.address().port}`, meter, classify: correlatedStorageAttempt });
  t.after(() => proxy.close());
  const clients = Object.fromEntries(['workload', 'observer', 'cleanup'].map(phase => {
    const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts,
      credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    instrumentStorageClient({ client, meter, phase, endpoint: proxy.url });
    t.after(() => client.destroy()); return [phase, client];
  }));
  return { clients, meter, sdk, endpoint: proxy.url, target: `http://127.0.0.1:${upstream.address().port}`, bucket: 'synthetic', versioned: true, objectClass: 'stream' };
}
const emptyInventory = (req, res) => {
  req.resume(); req.on('end', () => {
    if (req.url.includes('versioning')) res.end('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>');
    else if (req.url.includes('uploads')) res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>');
    else res.end('<ListVersionsResult><IsTruncated>false</IsTruncated></ListVersionsResult>');
  });
};

// A missing initial inventory check would treat pre-existing versions as zero retained bytes.
test('preexistingOrMismatchedVersioningRefusesLifetimeEvidence', async t => {
  assert.equal(typeof lifetime.openStorageLifetimes, 'function', 'admit only empty verified storage');
  for (const body of ['<VersioningConfiguration/>', '<VersioningConfiguration><Status>Suspended</Status></VersioningConfiguration>']) {
    const f = await fixture(t, (req, res) => {
      if (!req.url.includes('versioning')) return emptyInventory(req, res);
      req.resume(); req.on('end', () => res.end(body));
    });
    await assert.rejects(lifetime.openStorageLifetimes(f), /Invalid cloud cost storage lifetimes/);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
  const f = await fixture(t, (req, res) => {
    if (!req.url.includes('versions')) return emptyInventory(req, res);
    req.resume(); req.on('end', () => res.end('<ListVersionsResult><IsTruncated>false</IsTruncated><Version><Key>PRIVATE_SYNTHETIC_CANARY</Key><VersionId>v1</VersionId><Size>3</Size><IsLatest>true</IsLatest></Version></ListVersionsResult>'));
  });
  await assert.rejects(lifetime.openStorageLifetimes(f), /Invalid cloud cost storage lifetimes/);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// Missing version IDs, provider failures and ambiguous retries cannot establish a unique mutation.
test('ambiguousOrFailedWritesInvalidateLifetimeEvidenceWithoutRawErrors', async t => {
  assert.equal(typeof lifetime.openStorageLifetimes, 'function');
  for (const response of ['missing-version', 'failure']) {
    const f = await fixture(t, (req, res) => {
      if (req.method !== 'PUT') return emptyInventory(req, res);
      req.resume(); req.on('end', () => {
        if (response === 'failure') { res.writeHead(503); res.end('<Error><Code>ServiceUnavailable</Code><Message>PRIVATE_SYNTHETIC_CANARY</Message></Error>'); }
        else res.end();
      });
    });
    const ledger = await lifetime.openStorageLifetimes(f);
    await assert.rejects(ledger.send(new sdk.PutObjectCommand({ Bucket: f.bucket, Key: 'private', Body: Buffer.from('abc') })),
      { message: 'Invalid cloud cost storage lifetimes' });
    assert.throws(() => ledger.snapshot(), /Invalid cloud cost storage lifetimes/);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

// The listing is independent evidence: a successful PUT alone cannot prove retained state.
test('unverifiedOrMissingInventoryCannotProduceLifetimeSnapshot', async t => {
  assert.equal(typeof lifetime.openStorageLifetimes, 'function');
  const f = await fixture(t, (req, res) => {
    if (req.method !== 'PUT') return emptyInventory(req, res);
    req.resume(); req.on('end', () => { res.writeHead(200, { 'x-amz-version-id': 'v1', etag: '"synthetic"' }); res.end(); });
  });
  const ledger = await lifetime.openStorageLifetimes(f);
  await ledger.send(new sdk.PutObjectCommand({ Bucket: f.bucket, Key: 'PRIVATE_SYNTHETIC_CANARY', Body: Buffer.from('abc') }));
  assert.throws(() => ledger.snapshot(), /Invalid cloud cost storage lifetimes/);
  await assert.rejects(ledger.verify(), /Invalid cloud cost storage lifetimes/);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// Admission before client.send prevents an untracked mutation, cross-bucket call or unknown body size.
test('unsupportedOrForeignMutationsAreRefusedBeforeStorageCall', async t => {
  assert.equal(typeof lifetime.openStorageLifetimes, 'function');
  for (const make of [
    f => new sdk.PutObjectCommand({ Bucket: 'foreign', Key: 'private', Body: Buffer.from('abc') }),
    f => new sdk.PutBucketVersioningCommand({ Bucket: f.bucket, VersioningConfiguration: { Status: 'Suspended' } }),
    f => new sdk.CopyObjectCommand({ Bucket: f.bucket, Key: 'private', CopySource: 'private/secret' }),
    f => new sdk.PutObjectCommand({ Bucket: f.bucket, Key: 'private', Body: (async function* () { yield Buffer.from('abc'); })() }),
    f => new sdk.UploadPartCommand({ Bucket: f.bucket, Key: 'private', UploadId: 'unknown', PartNumber: 1, Body: Buffer.from('abc') }),
    f => new sdk.DeleteObjectCommand({ Bucket: f.bucket, Key: 'private', VersionId: 'unknown' }),
  ]) {
    let mutations = 0;
    const f = await fixture(t, (req, res) => { if (req.method !== 'GET') mutations++; emptyInventory(req, res); });
    const ledger = await lifetime.openStorageLifetimes(f);
    await assert.rejects(ledger.send(make(f)), { message: 'Invalid cloud cost storage lifetimes' });
    assert.equal(mutations, 0);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

// An uninstrumented or wrong-phase client must not produce an empty, apparently reconciled meter.
test('lifetimeClientsMustUseTheSameMeterAndTheirNamedPhase', async t => {
  for (const change of ['uninstrumented', 'wrong-meter', 'wrong-phase', 'wrong-endpoint']) {
    const f = await fixture(t, emptyInventory);
    const extra = new sdk.S3Client({ endpoint: ['uninstrumented', 'wrong-endpoint'].includes(change) ? f.target : f.endpoint, region: 'eu-north-1', maxAttempts: 1,
      credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    t.after(() => extra.destroy());
    if (change !== 'uninstrumented') instrumentStorageClient({ client: extra,
      meter: change === 'wrong-meter' ? createMeter({ phase: 'observer', clock: () => 0 }) : f.meter,
      phase: change === 'wrong-phase' ? 'workload' : 'observer', endpoint: change === 'wrong-endpoint' ? f.target : f.endpoint });
    f.clients.observer = extra;
    await assert.rejects(lifetime.openStorageLifetimes(f), { message: 'Invalid cloud cost storage lifetimes' });
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

// A replacement that adds bytes or a completion that retains unselected parts changes this hand-derived 124.
test('signedSdkVersionMarkersAndReplacementPartsIntegrate124ByteSeconds', async t => {
  let puts = 0, partCalls = 0, time = 0;
  const f = await fixture(t, (req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET') return emptyInventory(req, res);
    req.resume(); req.on('end', () => {
      if (req.method === 'PUT' && !path.searchParams.has('uploadId')) res.writeHead(200, { 'x-amz-version-id': 'v' + ++puts });
      else if (req.method === 'PUT') res.writeHead(200, { etag: '"part' + ++partCalls + '"' });
      else if (req.method === 'DELETE' && !path.searchParams.has('versionId')) res.writeHead(204, { 'x-amz-version-id': 'marker', 'x-amz-delete-marker': 'true' });
      else if (req.method === 'POST') {
        res.setHeader('content-type', 'application/xml');
        if (path.searchParams.has('uploads')) return res.end('<InitiateMultipartUploadResult><UploadId>upload</UploadId></InitiateMultipartUploadResult>');
        res.setHeader('x-amz-version-id', 'completed');
        return res.end('<CompleteMultipartUploadResult><ETag>"complete"</ETag></CompleteMultipartUploadResult>');
      } else res.writeHead(204);
      res.end();
    });
  }, { clock: () => time });
  const ledger = await lifetime.openStorageLifetimes(f), Bucket = f.bucket, Key = 'é';
  const send = (name, input) => ledger.send(new sdk[name]({ Bucket, ...input }));
  time = 1; await send('PutObjectCommand', { Key, Body: Buffer.from('abc') });
  time = 3; await send('PutObjectCommand', { Key, Body: Buffer.from('abcde') });
  time = 5; await send('DeleteObjectCommand', { Key });
  time = 7; await send('DeleteObjectCommand', { Key, VersionId: 'marker' });
  assert.deepEqual(f.meter.snapshot().accounting.objects.map(row => [row.bytes, row.currentVersions, row.noncurrentVersions, row.deleteMarkers]), [[8, 1, 1, 0]]);
  time = 9; await send('DeleteObjectCommand', { Key, VersionId: 'v1' });
  time = 10; await send('CreateMultipartUploadCommand', { Key: 'private' });
  time = 11; await send('UploadPartCommand', { Key: 'private', UploadId: 'upload', PartNumber: 1, Body: Buffer.from('abcd') });
  time = 13; const part = await send('UploadPartCommand', { Key: 'private', UploadId: 'upload', PartNumber: 1, Body: Buffer.from('xy') });
  time = 14; await send('UploadPartCommand', { Key: 'private', UploadId: 'upload', PartNumber: 2, Body: Buffer.from('123') });
  time = 15; await send('CompleteMultipartUploadCommand', { Key: 'private', UploadId: 'upload', MultipartUpload: { Parts: [{ PartNumber: 1, ETag: part.ETag }] } });
  time = 18; await send('DeleteObjectCommand', { Key, VersionId: 'v2' });
  await send('DeleteObjectCommand', { Key: 'private', VersionId: 'completed' });
  await ledger.verify(); time = 20;
  assert.deepEqual(ledger.snapshot().accounting.objects, [{ class: 'stream', bytes: 0, byteSeconds: 124,
    currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }]);
  assert.equal(ledger.snapshot().reconciled, true);
});

// Taking only the first listing page misses retained versions; a repeated token must not loop.
test('initialInventoryRequiresAllPagesAndRejectsRepeatedPagination', async t => {
  for (const mode of ['second-page', 'repeated-marker']) {
    let lists = 0;
    const f = await fixture(t, (req, res) => {
      if (!req.url.includes('versions')) return emptyInventory(req, res);
      req.resume(); req.on('end', () => {
        lists++;
        if (mode === 'second-page' && lists === 2)
          res.end('<ListVersionsResult><IsTruncated>false</IsTruncated><Version><Key>private</Key><VersionId>v1</VersionId><Size>3</Size><IsLatest>true</IsLatest></Version></ListVersionsResult>');
        else res.end('<ListVersionsResult><IsTruncated>true</IsTruncated><NextKeyMarker>private</NextKeyMarker><NextVersionIdMarker>v1</NextVersionIdMarker></ListVersionsResult>');
      });
    });
    await assert.rejects(lifetime.openStorageLifetimes(f), /Invalid cloud cost storage lifetimes/);
    assert.equal(lists, 2);
  }
});

// Even a successful retry may hide an extra committed version; it cannot receive a unique lifetime.
test('retriedMutationCannotClaimUniqueStoredVersion', async t => {
  let writes = 0;
  const f = await fixture(t, (req, res) => {
    if (req.method !== 'PUT') return emptyInventory(req, res);
    req.resume(); req.on('end', () => {
      if (++writes === 1) { res.writeHead(503); res.end('<Error><Code>ServiceUnavailable</Code></Error>'); }
      else { res.writeHead(200, { 'x-amz-version-id': 'v1' }); res.end(); }
    });
  }, { maxAttempts: 2 });
  const ledger = await lifetime.openStorageLifetimes(f);
  await assert.rejects(ledger.send(new sdk.PutObjectCommand({ Bucket: f.bucket, Key: 'private', Body: 'abc' })), /Invalid cloud cost storage lifetimes/);
  assert.equal(writes, 2);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// A second write cannot race the private version history while the first reply is outstanding.
test('concurrentMutationsAreRefusedBeforeASecondProviderWrite', async t => {
  let writes = 0, release, arrived;
  const started = new Promise(resolve => { arrived = resolve; });
  const f = await fixture(t, (req, res) => {
    if (req.method !== 'PUT') return emptyInventory(req, res);
    req.resume(); req.on('end', () => {
      if (++writes > 1) { res.writeHead(200, { 'x-amz-version-id': 'v2' }); res.end(); return; }
      release = () => { res.writeHead(200, { 'x-amz-version-id': 'v1' }); res.end(); }; arrived();
    });
  });
  const ledger = await lifetime.openStorageLifetimes(f);
  const first = ledger.send(new sdk.PutObjectCommand({ Bucket: f.bucket, Key: 'private', Body: 'abc' }));
  await started;
  assert.throws(() => ledger.snapshot(), /Invalid cloud cost storage lifetimes/);
  try { await assert.rejects(ledger.send(new sdk.PutObjectCommand({ Bucket: f.bucket, Key: 'other', Body: 'abc' })), /Invalid cloud cost storage lifetimes/); }
  finally { release(); await first; }
  assert.equal(writes, 1);
  assert.throws(() => ledger.snapshot(), /Invalid cloud cost storage lifetimes/);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// Replacing a client after admission cannot turn later requests into unmetered writes or inventory reads.
test('clientReplacementAfterAdmissionIsRefusedBeforeNetwork', async t => {
  for (const phase of ['workload', 'observer']) {
    let writes = 0;
    const f = await fixture(t, (req, res) => {
      if (req.method === 'PUT') { writes++; req.resume(); req.on('end', () => { res.writeHead(200, { 'x-amz-version-id': 'v1' }); res.end(); }); }
      else emptyInventory(req, res);
    });
    const ledger = await lifetime.openStorageLifetimes(f);
    const replacement = new sdk.S3Client({ endpoint: f.target, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    t.after(() => replacement.destroy());
    f.clients[phase] = replacement;
    await assert.rejects(phase === 'observer' ? ledger.verify() : ledger.send(new sdk.PutObjectCommand({ Bucket: f.bucket, Key: 'private', Body: 'abc' })),
      { message: 'Invalid cloud cost storage lifetimes' });
    assert.equal(writes, 0); assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

// A repeated version ID cannot replace the history of two distinct versioned writes.
test('repeatedProviderVersionIdInvalidatesTheLifetimeLedger', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.method !== 'PUT') return emptyInventory(req, res);
    req.resume(); req.on('end', () => { res.writeHead(200, { 'x-amz-version-id': 'repeated' }); res.end(); });
  });
  const ledger = await lifetime.openStorageLifetimes(f);
  const command = () => new sdk.PutObjectCommand({ Bucket: f.bucket, Key: 'private', Body: 'abc' });
  await ledger.send(command());
  await assert.rejects(ledger.send(command()), /Invalid cloud cost storage lifetimes/);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// Stale or duplicate multipart parts must not become a valid storage estimate.
test('multipartInventoryMustMatchEveryRetainedPartOnce', async t => {
  let uploaded = false;
  const f = await fixture(t, (req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && !path.searchParams.has('uploads') && !path.searchParams.has('uploadId')) return emptyInventory(req, res);
    req.resume(); req.on('end', () => {
      if (req.method === 'POST') return res.end('<InitiateMultipartUploadResult><UploadId>upload</UploadId></InitiateMultipartUploadResult>');
      if (req.method === 'PUT') { uploaded = true; res.setHeader('etag', '"new"'); return res.end(); }
      if (path.searchParams.has('uploadId')) return res.end('<ListPartsResult><IsTruncated>false</IsTruncated><Part><PartNumber>1</PartNumber><Size>4</Size><ETag>"old"</ETag></Part><Part><PartNumber>1</PartNumber><Size>2</Size><ETag>"new"</ETag></Part></ListPartsResult>');
      res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated>' + (uploaded ? '<Upload><Key>private</Key><UploadId>upload</UploadId></Upload>' : '') + '</ListMultipartUploadsResult>');
    });
  });
  const ledger = await lifetime.openStorageLifetimes(f);
  await ledger.send(new sdk.CreateMultipartUploadCommand({ Bucket: f.bucket, Key: 'private' }));
  await ledger.send(new sdk.UploadPartCommand({ Bucket: f.bucket, Key: 'private', UploadId: 'upload', PartNumber: 1, Body: 'xy' }));
  await assert.rejects(ledger.verify(), /Invalid cloud cost storage lifetimes/);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// Matching totals alone cannot conceal the wrong version size, current status, marker kind or duplicate.
test('versionInventoryMustMatchIdentitySizeKindAndCurrentStatus', async t => {
  for (const mode of ['size', 'latest', 'marker', 'duplicate']) {
    let written = false;
    const f = await fixture(t, (req, res) => {
      if (req.method === 'PUT') { req.resume(); req.on('end', () => { written = true; res.writeHead(200, { 'x-amz-version-id': 'v1' }); res.end(); }); return; }
      if (!req.url.includes('versions') || !written) return emptyInventory(req, res);
      req.resume(); req.on('end', () => {
        const kind = mode === 'marker' ? 'DeleteMarker' : 'Version';
        const row = `<${kind}><Key>private</Key><VersionId>v1</VersionId><Size>${mode === 'size' ? 4 : 3}</Size><IsLatest>${mode === 'latest' ? 'false' : 'true'}</IsLatest></${kind}>`;
        res.end('<ListVersionsResult><IsTruncated>false</IsTruncated>' + row + (mode === 'duplicate' ? row : '') + '</ListVersionsResult>');
      });
    });
    const ledger = await lifetime.openStorageLifetimes(f);
    await ledger.send(new sdk.PutObjectCommand({ Bucket: f.bucket, Key: 'private', Body: 'abc' }));
    await assert.rejects(ledger.verify(), /Invalid cloud cost storage lifetimes/);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  }
});

// A same-sized ordinary version cannot stand in for a delete marker in the independent listing.
test('markerInventoryCannotSubstituteAnOrdinaryVersion', async t => {
  let marked = false;
  const f = await fixture(t, (req, res) => {
    if (req.method === 'PUT') { req.resume(); req.on('end', () => { res.writeHead(200, { 'x-amz-version-id': 'v1' }); res.end(); }); return; }
    if (req.method === 'DELETE') { req.resume(); req.on('end', () => { marked = true; res.writeHead(204, { 'x-amz-version-id': 'marker', 'x-amz-delete-marker': 'true' }); res.end(); }); return; }
    if (!req.url.includes('versions') || !marked) return emptyInventory(req, res);
    req.resume(); req.on('end', () => res.end('<ListVersionsResult><IsTruncated>false</IsTruncated><Version><Key>private</Key><VersionId>v1</VersionId><Size>3</Size><IsLatest>false</IsLatest></Version><Version><Key>private</Key><VersionId>marker</VersionId><Size>7</Size><IsLatest>true</IsLatest></Version></ListVersionsResult>'));
  });
  const ledger = await lifetime.openStorageLifetimes(f);
  await ledger.send(new sdk.PutObjectCommand({ Bucket: f.bucket, Key: 'private', Body: 'abc' }));
  await ledger.send(new sdk.DeleteObjectCommand({ Bucket: f.bucket, Key: 'private' }));
  await assert.rejects(ledger.verify(), /Invalid cloud cost storage lifetimes/);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});
