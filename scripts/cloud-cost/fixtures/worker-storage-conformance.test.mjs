// Run inside the pinned isolated local image; all objects and failures are generated here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { openWorkerStorage } from '../worker-storage.mjs';
const sdk = createRequire('/app/packages/backups/package.json')('@aws-sdk/client-s3');
const bad = { message: 'Invalid cloud cost worker storage' };

function fixture(t, hooks = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'worker-storage-')));
  const source = join(parent, 'source'), root = join(parent, 'owned');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'), journal = { token, path: join(root, 'journal.json') };
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  const calls = [], clients = [];
  class Client extends sdk.S3Client {
    constructor(options) { super(options); clients.push(this); }
    async send(command, options) {
      calls.push(command.constructor.name);
      const intercepted = await hooks.before?.(command);
      if (intercepted !== undefined) return intercepted;
      const result = await super.send(command, options);
      return hooks.after ? await hooks.after(command, result) : result;
    }
  }
  t.after(() => { for (const client of clients) client.destroy(); rmSync(parent, { recursive: true }); });
  return { source, root, journal, sdk: { ...sdk, S3Client: Client }, calls,
    entries: () => JSON.parse(readFileSync(journal.path, 'utf8')).localResources ?? [] };
}

async function writeGeneratedObjects(t, storage) {
  const client = new sdk.S3Client({ endpoint: storage.target, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  t.after(() => client.destroy());
  const Bucket = storage.bucket;
  await client.send(new sdk.PutObjectCommand({ Bucket, Key: 'stream/PRIVATE_OBJECT_CANARY', Body: Buffer.from('four') }));
  const upload = await client.send(new sdk.CreateMultipartUploadCommand({ Bucket, Key: 'stream/PRIVATE_UPLOAD_CANARY' }));
  await client.send(new sdk.UploadPartCommand({ Bucket, Key: 'stream/PRIVATE_UPLOAD_CANARY', UploadId: upload.UploadId,
    PartNumber: 1, Body: Buffer.from('sixsix') }));
}

// Requests made to collect objects and unfinished parts remain part of administration accounting.
test('workerStorageCollectsRealObjectsAndUnfinishedPartsWithReconciledCounters', async t => {
  const f = fixture(t), storage = await open(t, f);
  await writeGeneratedObjects(t, storage);
  const evidence = await storage.finish();
  assert.deepEqual(await storage.finish(), evidence, 'finishing again must not repeat storage mutations');
  assert.equal(evidence.reconciled, true);
  assert.deepEqual(evidence.accounting.producer, evidence.accounting.observer);
  const rows = evidence.accounting.requests;
  for (const operation of ['bucket-create', 'multipart-abort', 'delete', 'bucket-delete']) {
    assert.equal(rows.filter(r => r.operation === operation).reduce((n, r) => n + r.successful, 0), 1, operation);
  }
  assert.equal(rows.every(r => ['setup', 'cleanup'].includes(r.phase)), true);
  assert.equal(existsSync(join(f.root, 'local-storage')), false);
  assert.equal(/PRIVATE|CANARY|127\.0\.0\.1|cost-/.test(JSON.stringify(evidence)), false);
});

// Omitting an inventory completeness/ownership check would turn an unsafe deletion into success.
for (const mode of ['truncated-uploads', 'foreign-upload', 'missing-upload-id', 'truncated-empty-objects',
  'foreign-object', 'duplicate-object', 'delete-refused', 'bucket-head-forbidden', 'bucket-head-invalid-success', 'false-delete-success']) {
  test('workerStoragePreservesFailureEvidence_' + mode, async t => {
    let cleanup = false, changed = false;
    const f = fixture(t, {
      before: command => {
        if (!cleanup) return;
        if (mode === 'delete-refused' && command instanceof sdk.DeleteObjectCommand) {
          changed = true; throw Error('PRIVATE_DELETE_CANARY');
        }
        if (mode === 'bucket-head-forbidden' && command instanceof sdk.HeadBucketCommand) {
          changed = true; throw Object.assign(Error('PRIVATE_PERMISSION_CANARY'), { $metadata: { httpStatusCode: 403 } });
        }
        if (mode === 'false-delete-success' && command instanceof sdk.DeleteBucketCommand) {
          changed = true; return { $metadata: { httpStatusCode: 204 } };
        }
      },
      after: (command, result) => {
        if (!cleanup) return result;
        if (command instanceof sdk.HeadBucketCommand && mode === 'bucket-head-invalid-success') {
          changed = true; return { ...result, $metadata: { ...result.$metadata, httpStatusCode: 206 } };
        }
        if (command instanceof sdk.ListMultipartUploadsCommand && mode.endsWith('uploads')) {
          changed = true; return { ...result, IsTruncated: true };
        }
        if (command instanceof sdk.ListMultipartUploadsCommand && ['foreign-upload', 'missing-upload-id'].includes(mode)) {
          changed = true;
          return { ...result, Uploads: result.Uploads.map(row => ({ ...row,
            ...(mode === 'foreign-upload' ? { Key: 'PRIVATE_FOREIGN_CANARY' } : { UploadId: undefined }) })) };
        }
        if (command instanceof sdk.ListObjectsV2Command && ['truncated-empty-objects', 'foreign-object', 'duplicate-object'].includes(mode)) {
          changed = true;
          if (mode === 'truncated-empty-objects') return { ...result, Contents: [], IsTruncated: true, NextContinuationToken: 'PRIVATE_PAGE_CANARY' };
          if (mode === 'foreign-object') return { ...result, Contents: result.Contents.map(row => ({ ...row, Key: 'PRIVATE_FOREIGN_CANARY' })) };
          return { ...result, Contents: [...result.Contents, ...result.Contents] };
        }
        return result;
      },
    });
    const storage = await open(t, f); await writeGeneratedObjects(t, storage); cleanup = true;
    await assert.rejects(storage.finish(), bad);
    assert.equal(changed, true, 'reach the chosen failure boundary');
    if (['truncated-empty-objects', 'foreign-object', 'duplicate-object'].includes(mode)) {
      assert.equal(f.calls.includes('DeleteObjectCommand'), false, 'validate the entire object inventory before deleting any object');
    }
    if (['truncated-uploads', 'foreign-upload', 'missing-upload-id'].includes(mode)) {
      assert.equal(f.calls.includes('AbortMultipartUploadCommand'), false, 'validate an upload selection before aborting it');
    }
    assert.equal(existsSync(join(f.root, 'local-storage')), true, 'retain private evidence rather than claiming clean success');
    assert.equal(f.entries().some(e => e.kind === 'storage-process' && e.state === 'collected'), true);
    assert.equal(f.entries().some(e => e.kind === 'storage-root' && e.state === 'removed'), false);
  });
}

test('workerStorageFinishesOwnedCleanupWithAnIndependentSignalAfterCancellation', async t => {
  const abort = new AbortController(); let committed = false, removed = false;
  const f = fixture(t, { after: (command, result) => {
    if (command instanceof sdk.CreateBucketCommand) { committed = true; abort.abort(); }
    if (command instanceof sdk.DeleteBucketCommand) removed = true;
    return result;
  } });
  await assert.rejects(openWorkerStorage({ ...f, signal: abort.signal }), bad);
  assert.equal(committed, true); assert.equal(removed, true, 'caller cancellation must not cancel cleanup');
  assert.equal(existsSync(join(f.root, 'local-storage')), false);
});

for (const commandType of [sdk.ListObjectsV2Command, sdk.ListMultipartUploadsCommand]) {
  test('workerStorageRefusesCancellationAtTheSetupResponse_' + commandType.name, async t => {
    const abort = new AbortController(); let created = false, cancelled = false;
    const f = fixture(t, { after: (command, result) => {
      if (command instanceof sdk.CreateBucketCommand) created = true;
      if (created && !cancelled && command instanceof commandType) { cancelled = true; abort.abort(); }
      return result;
    } });
    await assert.rejects(openWorkerStorage({ ...f, signal: abort.signal }).then(async value => {
      await value.close(); return value;
    }), bad);
    assert.equal(cancelled, true, 'reach the final setup response before cancelling');
    assert.equal(existsSync(join(f.root, 'local-storage')), false);
    assert.equal(f.entries().some(e => e.kind === 'storage-bucket' && e.state === 'ready'), false,
      'cancelled setup cannot publish a ready resource');
  });
}

// Treating create intent as proof of existence leaves private storage behind after a refused create.
test('workerStorageCollectsItsDirectoryWhenBucketCreationNeverReachedStorage', async t => {
  let reached = false;
  const f = fixture(t, { before: command => {
    if (command instanceof sdk.CreateBucketCommand) { reached = true; throw Error('PRIVATE_CREATE_CANARY'); }
  } });
  await assert.rejects(openWorkerStorage(f), bad);
  assert.equal(reached, true, 'reach creation after real backend readiness');
  assert.equal(existsSync(join(f.root, 'local-storage')), false, 'collect owned state after independently proving the bucket absent');
  assert.equal(f.entries().some(e => e.kind === 'storage-process' && e.state === 'collected'), true);
  assert.equal(f.entries().some(e => e.kind === 'storage-root' && e.state === 'removed'), true);
});

// A failed reply must not erase the creation intent before the committed bucket is recovered.
test('workerStorageRemovesAnActuallyCreatedBucketAfterItsReplyIsLost', async t => {
  let committed = false, removed = false;
  const f = fixture(t, { after: (command, result) => {
    if (command instanceof sdk.CreateBucketCommand) { committed = true; throw Error('PRIVATE_REPLY_CANARY'); }
    if (command instanceof sdk.DeleteBucketCommand) removed = true;
    return result;
  } });
  await assert.rejects(openWorkerStorage(f), bad);
  assert.equal(committed, true); assert.equal(removed, true, 'delete the real bucket even without a successful create response');
  assert.equal(existsSync(join(f.root, 'local-storage')), false);
  assert.equal(f.entries().some(e => e.kind === 'storage-bucket' && e.state === 'removed'), true);
});

async function open(t, f) {
  const storage = await openWorkerStorage(f);
  t.after(() => storage.close().catch(error => assert.equal(error.message, bad.message)));
  return storage;
}

// A partial bucket inventory cannot establish absence, even after a successful deletion response.
for (const mode of ['continuation', 'missing-name', 'wrong-type']) {
  test('workerStorageRefusesIncompleteBucketAbsenceEvidence_' + mode, async t => {
    let cleanup = false, changed = false;
    const f = fixture(t, { after: (command, result) => {
      if (cleanup && command instanceof sdk.ListBucketsCommand) {
        changed = true;
        if (mode === 'continuation') return { ...result, Buckets: [], ContinuationToken: 'PRIVATE_PAGE_CANARY' };
        if (mode === 'missing-name') return { ...result, Buckets: [{}] };
        return { ...result, Buckets: {} };
      }
      return result;
    } });
    const storage = await open(t, f); cleanup = true;
    await assert.rejects(storage.finish(), bad);
    assert.equal(changed, true, 'reach the cleanup bucket inventory');
    assert.equal(existsSync(join(f.root, 'local-storage')), true, 'retain evidence when cleanup cannot be verified');
    assert.equal(f.entries().some(e => e.kind === 'storage-process' && e.state === 'collected'), true);
    assert.equal(f.entries().some(e => e.kind === 'storage-root' && e.state === 'removed'), false);
  });
}


// Omitting the retained interval, using final zero bytes, or treating delete replies as instant
// loses storage that remains after native measurement. The literal totals include inventory time.
test('workerStorageCountsRetainedBytesUntilEachRealDeletionCompletes', async t => {
  let time = 10;
  const f = fixture(t, { before: command => {
    if (command instanceof sdk.DeleteObjectCommand) time = 13;
  }, after: (command, result) => {
    if (command instanceof sdk.DeleteObjectCommand) time = 15;
    return result;
  } });
  const storage = await open(t, { ...f, clock: () => time });
  const client = new sdk.S3Client({ endpoint: storage.target, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  t.after(() => client.destroy());
  await client.send(new sdk.PutObjectCommand({ Bucket: storage.bucket, Key: 'stream/PRIVATE_TAIL_CANARY', Body: Buffer.from('four') }));
  time = 12;
  const retained = { since: 10, bytes: 4, objects: 1 };
  const result = await storage.finish({ retained });
  // Delete call starts at12, the provider commits between13 and15: [4*(12-10),4*(15-10)].
  assert.deepEqual(result.retainedStorage, { status: 'measured', scope: 'unversioned-cleanup-tail',
    windowSeconds: 5, initialBytes: 4, deletedObjects: 1, remainingBytes: 0, remainingObjects: 0,
    byteSeconds: { low: 8, high: 20 } });
  assert.equal(result.accounting.requests.some(r => r.phase === 'cleanup' && r.operation === 'delete'), true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|CANARY|127\.0\.0\.1|cost-/);
  retained.bytes = 99;
  assert.deepEqual((await storage.finish({ retained: { since: 10, bytes: 4, objects: 1 } })).retainedStorage, result.retainedStorage);
  await assert.rejects(storage.finish({ retained }), bad);
});

// A final native inventory is not permission to silently price a different cleanup inventory.
for (const mode of ['bytes', 'objects', 'future', 'extra', 'fractional', 'untracked-multipart']) {
  test('workerStorageRefusesUnreconciledRetainedStorage_' + mode, async t => {
    const f = fixture(t), storage = await open(t, { ...f, clock: () => 12 });
    if (mode === 'untracked-multipart') await writeGeneratedObjects(t, storage);
    else {
      const client = new sdk.S3Client({ endpoint: storage.target, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
        credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
      try { await client.send(new sdk.PutObjectCommand({ Bucket: storage.bucket, Key: 'stream/PRIVATE_TAIL_CANARY', Body: Buffer.from('four') })); }
      finally { client.destroy(); }
    }
    const retained = { since: 10, bytes: 4, objects: 1 };
    if (mode === 'bytes') retained.bytes = 5;
    if (mode === 'objects') retained.objects = 2;
    if (mode === 'future') retained.since = 13;
    if (mode === 'extra') retained.path = 'PRIVATE_CANARY';
    if (mode === 'fractional') retained.bytes = 4.5;
    // The generated unfinished upload is deliberately absent from the final native inventory.
    await assert.rejects(storage.finish({ retained }), bad);
    assert.equal(f.entries().some(e => e.kind === 'storage-process' && e.state === 'collected'), true);
  });
}
