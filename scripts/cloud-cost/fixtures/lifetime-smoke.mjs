// Generated synthetic bytes only; all object names and provider identifiers remain private.
import { createRequire } from 'node:module';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from '/code/meter.mjs';
import * as lifecycle from '/code/storage-lifetimes.mjs';
const require = createRequire('/app/packages/backups/package.json');
const sdk = require('@aws-sdk/client-s3');

async function smoke() {
  if (typeof lifecycle.openStorageLifetimes !== 'function') return { ready: false };
  let time = 0;
  const meter = createMeter({ phase: 'setup', clock: () => time });
  const proxy = await createMeteringProxy({ target: 'http://127.0.0.1:8333', meter, classify: correlatedStorageAttempt });
  const clients = Object.fromEntries(['setup', 'workload', 'observer', 'cleanup'].map(phase => {
    const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    instrumentStorageClient({ client, meter, phase, endpoint: proxy.url }); return [phase, client];
  }));
  const Bucket = 'synthetic-lifetimes', Key = 'é', PartsKey = 'PRIVATE_SYNTHETIC_CANARY';
  try {
    await clients.setup.send(new sdk.CreateBucketCommand({ Bucket }));
    await clients.setup.send(new sdk.PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    const ledger = await lifecycle.openStorageLifetimes({ clients, sdk, meter, bucket: Bucket, versioned: true, objectClass: 'stream' });
    const send = (name, input, phase = 'workload') => ledger.send(new sdk[name]({ Bucket, ...input }), { phase });
    const checks = [];
    time = 1; const first = await send('PutObjectCommand', { Key, Body: Buffer.from('abc') });
    time = 3; const second = await send('PutObjectCommand', { Key, Body: Buffer.from('abcde') });
    await ledger.verify(); checks.push(ledger.snapshot().accounting.objects);
    time = 5; const marker = await send('DeleteObjectCommand', { Key });
    await ledger.verify(); checks.push(ledger.snapshot().accounting.objects);
    time = 7; await send('DeleteObjectCommand', { Key, VersionId: marker.VersionId }, 'cleanup');
    await ledger.verify(); checks.push(ledger.snapshot().accounting.objects);
    time = 9; await send('DeleteObjectCommand', { Key, VersionId: first.VersionId }, 'cleanup');
    time = 10; const upload = await send('CreateMultipartUploadCommand', { Key: PartsKey });
    const part = (PartNumber, Body) => ({ Key: PartsKey, UploadId: upload.UploadId, PartNumber, Body: Buffer.from(Body) });
    time = 11; const replacement = await send('UploadPartCommand', part(1, 'abcd'));
    time = 14; await send('UploadPartCommand', part(2, '123'));
    await ledger.verify(); checks.push(ledger.snapshot().accounting.objects);
    time = 15; const completed = await send('CompleteMultipartUploadCommand', { Key: PartsKey, UploadId: upload.UploadId,
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: replacement.ETag }] } });
    await ledger.verify(); checks.push(ledger.snapshot().accounting.objects);
    time = 18; await send('DeleteObjectCommand', { Key, VersionId: second.VersionId }, 'cleanup');
    await send('DeleteObjectCommand', { Key: PartsKey, VersionId: completed.VersionId }, 'cleanup');
    await ledger.verify();
    time = 20; const result = ledger.snapshot();
    await clients.cleanup.send(new sdk.DeleteBucketCommand({ Bucket }));
    const plainBucket = 'synthetic-plain-lifetimes';
    time = 21; await clients.setup.send(new sdk.CreateBucketCommand({ Bucket: plainBucket }));
    const plain = await lifecycle.openStorageLifetimes({ clients, sdk, meter, bucket: plainBucket, versioned: false, objectClass: 'scratch' });
    const plainSend = (name, input, phase = 'workload') => plain.send(new sdk[name]({ Bucket: plainBucket, ...input }), { phase });
    time = 22; await plainSend('PutObjectCommand', { Key: 'private', Body: Buffer.from('abc') });
    time = 24; await plainSend('PutObjectCommand', { Key: 'private', Body: Buffer.from('abcde') });
    await plain.verify(); const plainRetained = plain.snapshot().accounting.objects;
    time = 25; await plainSend('DeleteObjectCommand', { Key: 'private' }, 'cleanup');
    time = 26; const abandoned = await plainSend('CreateMultipartUploadCommand', { Key: 'private-part' });
    time = 27; await plainSend('UploadPartCommand', { Key: 'private-part', UploadId: abandoned.UploadId, PartNumber: 1, Body: Buffer.from('abcd') });
    await plain.verify();
    time = 29; await plainSend('AbortMultipartUploadCommand', { Key: 'private-part', UploadId: abandoned.UploadId }, 'cleanup');
    await plain.verify(); time = 30; const plainResult = plain.snapshot();
    await clients.cleanup.send(new sdk.DeleteBucketCommand({ Bucket: plainBucket }));
    return { ready: true, checks, result, plainRetained, plainResult, leaked: /PRIVATE_SYNTHETIC_CANARY|synthetic-lifetimes|UploadId|VersionId/.test(JSON.stringify(result)) };
  } finally { for (const client of Object.values(clients)) client.destroy(); await proxy.close(); }
}
smoke().then(result => process.stdout.write(JSON.stringify(result)), () => { process.exitCode = 1; });
