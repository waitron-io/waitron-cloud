import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createMeter, createMeteringProxy, classifyStorageOperation } from './meter.mjs';
const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

test('theInstalledStorageSdkCanSendSignedRequestsThroughThePassiveProxy', async t => {
  const upstream = createServer((req, res) => { req.resume(); req.on('end', () => res.end()); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const proxy = await createMeteringProxy({ target: `http://127.0.0.1:${upstream.address().port}`, meter,
    classify: input => ({ token: 'sdk', phase: 'workload', operation: classifyStorageOperation(input), retryOrdinal: 0, errorCode: null, sameAccount: null }) });
  t.after(() => proxy.close());
  const client = new S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  t.after(() => client.destroy());
  await assert.doesNotReject(client.send(new PutObjectCommand({ Bucket: 'synthetic-sdk', Key: 'PRIVATE_SYNTHETIC_CANARY', Body: 'synthetic' })));
  const result = meter.snapshot();
  assert.equal(result.accounting.observer.attempts, 1);
  assert.equal(result.accounting.observer.bytesOut, 9);
  assert.equal(result.observedRequests[0].operation, 'put');
  assert.equal(result.status, 'unknown');
  assert.equal(JSON.stringify(result).includes('PRIVATE_SYNTHETIC_CANARY'), false);
});
