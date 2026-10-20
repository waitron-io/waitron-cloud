// Generated objects only; identifiers and per-entry provider replies stay inside the fixture.
import { createRequire } from 'node:module';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from '/code/meter.mjs';
import { openStorageLifetimes } from '/code/storage-lifetimes.mjs';
const require = createRequire('/app/packages/backups/package.json');
const sdk = require('@aws-sdk/client-s3');

async function scenario(versioned) {
  let time = 0;
  const meter = createMeter({ phase: 'setup', clock: () => time });
  // Both counters surround the private provider; the stack's default listener refuses batches.
  const proxy = await createMeteringProxy({ target: 'http://127.0.0.1:8334', meter,
    classify: input => correlatedStorageAttempt(input, { allowBulkDeletes: true }) });
  const clients = Object.fromEntries(['setup', 'workload', 'observer', 'cleanup'].map(phase => {
    const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    instrumentStorageClient({ client, meter, phase, endpoint: proxy.url, allowBulkDeletes: true }); return [phase, client];
  }));
  const Bucket = versioned ? 'synthetic-versioned-bulk' : 'synthetic-plain-bulk', Key = 'é';
  try {
    await clients.setup.send(new sdk.CreateBucketCommand({ Bucket }));
    if (versioned) await clients.setup.send(new sdk.PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    const ledger = await openStorageLifetimes({ clients, sdk, meter, bucket: Bucket, versioned, objectClass: 'stream', allowBulkDeletes: true });
    const put = Body => ledger.send(new sdk.PutObjectCommand({ Bucket, Key, Body }));
    const batch = (Objects, phase = 'workload') => ledger.send(new sdk.DeleteObjectsCommand({ Bucket, Delete: { Objects, Quiet: false } }), { phase });
    time = 1; const old = await put('abc'); time = 3; const current = await put('12345');
    time = 5; const deletion = await batch([{ Key }]); await ledger.verify();
    const afterDelete = ledger.snapshot().accounting.objects;
    if (versioned) {
      time = 7; await batch([{ Key, VersionId: deletion.Deleted[0].DeleteMarkerVersionId }]); await ledger.verify();
      time = 9; await batch([{ Key, VersionId: current.VersionId }, { Key, VersionId: old.VersionId }], 'cleanup');
    }
    await ledger.verify(); time = 12;
    const final = ledger.snapshot();
    await clients.cleanup.send(new sdk.DeleteBucketCommand({ Bucket }));
    return { afterDelete, final, complete: meter.snapshot(), leaked: /synthetic-|VersionId|PRIVATE_/.test(JSON.stringify(final)) };
  } finally {
    for (const client of Object.values(clients)) client.destroy();
    await proxy.close();
  }
}
Promise.resolve().then(async () => ({ plain: await scenario(false), versioned: await scenario(true) }))
  .then(result => process.stdout.write(JSON.stringify(result)), () => { process.exitCode = 1; });
