// Generated synthetic venue only. Payloads and signed headers never reach the result.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { openReplay } from '/code/cost-waitron-adapter.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from '/code/meter.mjs';
const require = createRequire('/app/packages/backups/package.json');
const { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand,
  UploadPartCommand, ListPartsCommand, AbortMultipartUploadCommand, DeleteObjectCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');

async function smoke() {
  const stateRoot = '/state/synthetic-archive-proof';
  mkdirSync(stateRoot, { mode: 0o700 });
  const { config, initial } = JSON.parse(readFileSync('/state/replay-config.json', 'utf8'));
  const replay = await openReplay({ codeRoot: '/code', stateRoot, config, initial });
  const meter = createMeter({ phase: 'setup', clock: () => performance.now() / 1000 });
  const proxy = await createMeteringProxy({ target: 'http://127.0.0.1:8333', meter, classify: correlatedStorageAttempt });
  const clients = ['setup', 'workload', 'cleanup'].map(phase => {
    const client = new S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 2,
      credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    instrumentStorageClient({ client, meter, phase, endpoint: proxy.url }); return client;
  });
  try {
    mkdirSync(stateRoot + '/tls', { mode: 0o700 });
    for (const name of ['secrets.env', 'tls/ca.crt', 'tls/ca.key', 'tls/server.crt', 'tls/server.key'])
      writeFileSync(stateRoot + '/' + name, 'SYNTHETIC_PRIVATE_STATE', { mode: 0o600 });
    const instant = new Date('2026-01-01T12:00:00Z');
    await replay.recordSale({ origin: { source: 'operator_script', deviceId: null }, locale: 'es', invoiceLocales: ['es'],
      total: '12.10', lines: [{ lineNo: 1, name: 'Synthetic item', descriptions: { es: 'Synthetic item' },
        quantity: '1', unitPrice: '10.00', vatRate: '21.00', lineTotal: '10.00' }],
      clock: { now: () => ({ instant, offsetMinutes: 60, confident: true, confidence: 'anchored', anchorAgeSeconds: 0 }) },
      settlement: { kind: 'immediate', tenders: [{ method: 'cash', amount: '12.10', tipAmount: '0', settledAt: instant }] } });
    const captured = await replay.capture({ recoveryKey: 'synthetic-recovery-key', at: new Date('2026-01-02T12:00:00Z'), signal: new AbortController().signal });
    const Bucket = 'synthetic-archive', Key = 'PRIVATE_SYNTHETIC_CANARY';
    await clients[0].send(new CreateBucketCommand({ Bucket }));
    await clients[1].send(new PutObjectCommand({ Bucket, Key, Body: captured.bytes }));
    const head = await clients[1].send(new HeadObjectCommand({ Bucket, Key }));
    const range = await clients[1].send(new GetObjectCommand({ Bucket, Key, Range: 'bytes=0-10' }));
    const rangeBytes = await range.Body.transformToByteArray();
    const download = await clients[1].send(new GetObjectCommand({ Bucket, Key }));
    const archive = await download.Body.transformToByteArray();
    const restored = await replay.restore({ artifact: archive, recoveryKey: 'synthetic-recovery-key' });
    const upload = await clients[1].send(new CreateMultipartUploadCommand({ Bucket, Key: 'private-part' }));
    await clients[1].send(new UploadPartCommand({ Bucket, Key: 'private-part', UploadId: upload.UploadId, PartNumber: 1, Body: Buffer.from('part') }));
    const parts = await clients[1].send(new ListPartsCommand({ Bucket, Key: 'private-part', UploadId: upload.UploadId }));
    await clients[2].send(new AbortMultipartUploadCommand({ Bucket, Key: 'private-part', UploadId: upload.UploadId }));
    await clients[2].send(new DeleteObjectCommand({ Bucket, Key }));
    await clients[2].send(new DeleteBucketCommand({ Bucket }));
    const result = meter.snapshot();
    return { accounting: result, capturedBytes: captured.bytes.length, headBytes: head.ContentLength,
      downloadedBytes: archive.length, rangeBytes: rangeBytes.length, parts: parts.Parts.length,
      restored, integrity: await replay.verify(), sales: replay.counts(),
      leaked: /PRIVATE_SYNTHETIC_CANARY|synthetic-archive|private-part|UploadId|SYNTHETIC_PRIVATE_STATE/.test(JSON.stringify(result)) };
  } finally {
    for (const client of clients) client.destroy();
    await proxy.close(); await replay.close(); rmSync(stateRoot, { recursive: true });
  }
}
smoke().then(result => process.stdout.write(JSON.stringify(result)), () => { process.exitCode = 1; });
