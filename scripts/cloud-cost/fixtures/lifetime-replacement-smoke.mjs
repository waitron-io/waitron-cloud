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
  const Bucket = 'synthetic-lifetime-replacement', Key = 'é', PartsKey = 'PRIVATE_SYNTHETIC_CANARY';
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
    time = 11; await send('UploadPartCommand', part(1, 'abcd'));
    time = 13; const replacement = await send('UploadPartCommand', part(1, 'xy'));
    time = 14; await send('UploadPartCommand', part(2, '123'));
    let refused = false;
    try { await ledger.verify(); } catch { refused = true; }
    let invalid = false;
    try { meter.snapshot(); } catch { invalid = true; }
    return { ready: true, refused, invalid };
  } finally { for (const client of Object.values(clients)) client.destroy(); await proxy.close(); }
}
smoke().then(result => process.stdout.write(JSON.stringify(result)), () => { process.exitCode = 1; });
