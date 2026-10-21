// Generated objects only; this worker publishes counts, durations and byte totals.
import { createRequire } from 'node:module';
import { openStreamMeasurement } from '/code/stream-measurement.mjs';
import { createMeter, createMeteringProxy, instrumentStorageClient, correlatedStorageAttempt } from '/code/meter.mjs';
const require = createRequire('/app/packages/backups/package.json'), sdk = require('@aws-sdk/client-s3');

async function smoke() {
  const results = [];
  for (const versioned of [false, true]) {
    let time = 0, session, writer;
    const Bucket = 'synthetic-session-' + Number(versioned), Key = 'PRIVATE_SESSION_CANARY';
    const meter = createMeter({ phase: 'setup', clock: () => time });
    const admin = await createMeteringProxy({ target: 'http://127.0.0.1:8334', meter, classify: correlatedStorageAttempt });
    const client = endpoint => new sdk.S3Client({ endpoint, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    const clients = Object.fromEntries(['setup', 'cleanup'].map(phase => {
      const c = client(admin.url); instrumentStorageClient({ client: c, meter, phase, endpoint: admin.url }); return [phase, c];
    }));
    const settled = () => new Promise(setImmediate);
    try {
      await clients.setup.send(new sdk.CreateBucketCommand({ Bucket }));
      if (versioned) await clients.setup.send(new sdk.PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }));
      session = await openStreamMeasurement({ target: 'http://127.0.0.1:8334', sdk, bucket: Bucket, versioned, clock: () => time,
        allowMultipart: true, resolveMultipartReplies: true, allowBulkDeletes: true });
      writer = client(session.url);
      time = 2; await writer.send(new sdk.PutObjectCommand({ Bucket, Key, Body: Buffer.from('four') })); await settled();
      time = 3; session.setPhase('workload');
      time = 5; await writer.send(new sdk.PutObjectCommand({ Bucket, Key, Body: Buffer.from('sixsix') })); await settled();
      time = 7; const intermediate = await session.checkpoint(); session.setPhase('idle');
      time = 8; const read = await writer.send(new sdk.GetObjectCommand({ Bucket, Key })); await read.Body.transformToByteArray(); await settled();
      time = 9; session.setPhase('restore');
      time = 10; await writer.send(new sdk.DeleteObjectCommand({ Bucket, Key })); await settled();
      time = 11; session.setPhase('cleanup'); time = 12;
      const result = await session.finish();
      if (versioned) {
        const inventory = await clients.cleanup.send(new sdk.ListObjectVersionsCommand({ Bucket }));
        if (inventory.IsTruncated) throw Error();
        for (const row of [...(inventory.Versions ?? []), ...(inventory.DeleteMarkers ?? [])])
          await clients.cleanup.send(new sdk.DeleteObjectCommand({ Bucket, Key: row.Key, VersionId: row.VersionId }));
      }
      await clients.cleanup.send(new sdk.DeleteBucketCommand({ Bucket }));
      const administration = meter.snapshot();
      results.push({ versioned, intermediate, result, administration,
        leaked: /PRIVATE|CANARY|synthetic-session|127\.0\.0\.1|VersionId|UploadId|Invocation/.test(JSON.stringify({ intermediate, result, administration })) });
    } finally {
      writer?.destroy(); await session?.close();
      for (const c of Object.values(clients)) c.destroy(); await admin.close();
    }
  }
  return results;
}
smoke().then(result => process.stdout.write(JSON.stringify(result)), () => { process.exitCode = 1; });
