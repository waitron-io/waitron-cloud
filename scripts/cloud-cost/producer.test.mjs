import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as metering from './meter.mjs';
const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, GetObjectTaggingCommand, ListBucketsCommand } = require('@aws-sdk/client-s3');

async function fixture(t, respond) {
  const upstream = createServer(respond);
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); return new Promise(resolve => upstream.close(resolve)); });
  const meter = metering.createMeter({ phase: 'workload', clock: () => 0 });
  const proxy = await metering.createMeteringProxy({ target: `http://127.0.0.1:${upstream.address().port}`, meter,
    classify: input => metering.correlatedStorageAttempt(input) });
  t.after(() => proxy.close());
  const client = new S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 2,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  t.after(() => client.destroy());
  metering.instrumentStorageClient({ client, meter, phase: 'workload', endpoint: proxy.url });
  return { client, meter };
}

// Removing physical-attempt instrumentation loses the failed upload or confuses retry ordinals.
test('signedSdkRetriesReconcileIndependentPhysicalAttemptsAndBodyBytes', async t => {
  assert.equal(typeof metering.instrumentStorageClient, 'function', 'instrument actual client transport attempts');
  let puts = 0, uploaded = 0, signed = 0;
  const { client, meter } = await fixture(t, (req, res) => {
    if (req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) signed++;
    req.on('data', b => { uploaded += b.length; });
    req.on('end', () => {
      puts++;
      if (puts === 1) { res.writeHead(503, { 'content-length': '0' }); res.end(); }
      else { res.writeHead(200, { etag: '"synthetic"', 'content-length': '0' }); res.end(); }
    });
  });
  await client.send(new PutObjectCommand({ Bucket: 'synthetic', Key: 'PRIVATE_SYNTHETIC_CANARY', Body: Buffer.from('abcdef') }));
  assert.equal(puts, 2); assert.equal(signed, 2); assert.equal(uploaded, 12);
  const result = meter.snapshot();
  assert.equal(result.reconciled, true);
  assert.deepEqual(result.accounting.producer, { attempts: 2, bytesIn: 0, bytesOut: 12 });
  assert.deepEqual(result.accounting.observer, result.accounting.producer);
  assert.deepEqual(result.accounting.requests.map(r => [r.operation, r.outcome, r.retryOrdinal, r.retried, r.bytesOut]),
    [['put', 'server-error', 0, 0, 6], ['put', 'success', 1, 1, 6]]);
  assert.equal(result.billing.find(r => r.requestClass === 's3-write').quantity, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SYNTHETIC_CANARY'), false);
});

// Counting GET metadata instead of its consumed stream or HEAD's advertised size misprices transfers.
test('signedSdkStreamsAndHeadReconcileWithoutDownloadingHeadObjectSize', async t => {
  assert.equal(typeof metering.instrumentStorageClient, 'function');
  const { client, meter } = await fixture(t, (req, res) => {
    req.resume(); req.on('end', () => {
      res.writeHead(200, { 'content-length': '6' });
      res.end(req.method === 'HEAD' ? undefined : 'abcdef');
    });
  });
  const get = await client.send(new GetObjectCommand({ Bucket: 'synthetic', Key: 'private' }));
  const pending = meter.snapshot(); assert.equal(pending.reconciled, false, 'unconsumed client body is not complete accounting');
  assert.equal(await get.Body.transformToString(), 'abcdef');
  await client.send(new HeadObjectCommand({ Bucket: 'synthetic', Key: 'private' }));
  const result = meter.snapshot(); assert.equal(result.reconciled, true);
  assert.deepEqual(result.accounting.producer, { attempts: 2, bytesIn: 6, bytesOut: 0 });
  assert.equal(result.accounting.requests.find(r => r.operation === 'head').attemptedBytesIn, 0);
});

// Replacing transport errors with an ordinary Error silently disables the SDK's normal retry.
test('signedSdkTransportFailureKeepsRetryAndItsUnknownBillingEvidence', async t => {
  let calls = 0;
  const { client, meter } = await fixture(t, (req, res) => {
    req.resume(); req.on('end', () => {
      if (++calls === 1) req.socket.destroy();
      else { res.writeHead(200, { 'content-length': '0' }); res.end(); }
    });
  });
  await client.send(new PutObjectCommand({ Bucket: 'synthetic', Key: 'private', Body: Buffer.from('abcdef') }));
  const result = meter.snapshot();
  assert.equal(calls, 2); assert.equal(result.reconciled, true);
  assert.deepEqual(result.accounting.requests.map(r => [r.outcome, r.retryOrdinal, r.bytesOut]),
    [['transport-error', 0, 6], ['success', 1, 6]]);
  assert.equal(result.billing[0].status, 'unknown'); assert.equal(result.billing[0].quantity, null);
});

// A skipped unsupported command must not leave an apparently valid empty measured run.
test('unsupportedSdkOperationInvalidatesAccountingBeforeAnyProviderCall', async t => {
  let calls = 0;
  const { client, meter } = await fixture(t, (req, res) => { calls++; req.resume(); res.end(); });
  await assert.rejects(client.send(new GetObjectTaggingCommand({ Bucket: 'synthetic', Key: 'private' })), /Invalid cloud cost meter/);
  assert.equal(calls, 0);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

// A response discarded before its first read must still close and record the client attempt.
test('abandonedSdkDownloadRecordsIncompleteConsumerAndReleasesItsBody', async t => {
  const { client, meter } = await fixture(t, (req, res) => {
    req.resume(); req.on('end', () => { res.writeHead(200, { 'content-length': '6' }); res.end('abcdef'); });
  });
  const get = await client.send(new GetObjectCommand({ Bucket: 'synthetic', Key: 'private' }));
  get.Body.destroy(); await once(get.Body, 'close');
  const result = meter.snapshot();
  assert.equal(result.accounting.producer.attempts, 1, 'discarded downloads cannot disappear from producer totals');
  assert.equal(result.accounting.requests[0].outcome, 'transport-error');
  assert.equal(result.accounting.requests[0].attemptedBytesIn, 6);
  assert.equal(result.accounting.requests[0].bytesIn, 0);
  assert.equal(result.reconciled, false); assert.equal(result.status, 'unknown');
});

// A global retry counter would mislabel parallel commands or a second send of the same command.
test('concurrentAndRepeatedSdkCommandsKeepIndependentRetryOrdinals', async t => {
  const seen = new Map();
  const { client, meter } = await fixture(t, (req, res) => {
    req.resume(); req.on('end', () => {
      const n = (seen.get(req.url) ?? 0) + 1; seen.set(req.url, n);
      res.writeHead(n === 1 ? 503 : 200, { 'content-length': '0' }); res.end();
    });
  });
  const command = new PutObjectCommand({ Bucket: 'synthetic', Key: 'one', Body: Buffer.from('abc') });
  await Promise.all([client.send(command), client.send(new PutObjectCommand({ Bucket: 'synthetic', Key: 'two', Body: Buffer.from('abc') }))]);
  await client.send(command);
  const result = meter.snapshot(); assert.equal(result.reconciled, true);
  assert.deepEqual(result.accounting.producer, { attempts: 5, bytesIn: 0, bytesOut: 15 });
  assert.deepEqual(result.accounting.requests.map(r => [r.outcome, r.retryOrdinal, r.attempts]),
    [['server-error', 0, 2], ['success', 1, 2], ['success', 0, 1]]);
});

// Setup health/list requests must have producer evidence too, rather than becoming unmatched traffic.
test('signedSdkBucketListingIsCountedAsSetupTraffic', async t => {
  const { client, meter } = await fixture(t, (req, res) => {
    req.resume(); req.on('end', () => res.end('<ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult>'));
  });
  await client.send(new ListBucketsCommand({}));
  const result = meter.snapshot(); assert.equal(result.reconciled, true);
  assert.equal(result.accounting.requests[0].operation, 'list'); assert.equal(result.accounting.requests[0].attempts, 1);
});

test('storageProducerRefusesOutsideEndpointsAndRepeatedInstallation', async t => {
  for (const endpoint of ['https://127.0.0.1:9000/', 'http://localhost:9000/', 'http://169.254.169.254:80/',
    'http://example.com:9000/', 'http://127.0.0.1:9000/prefix', 'http://127.0.0.1:9000/?raw=secret', 'http://user:secret@127.0.0.1:9000/']) {
    const client = new S3Client({ region: 'eu-north-1' });
    try { assert.throws(() => metering.instrumentStorageClient({ client, meter: metering.createMeter({ phase: 'setup', clock: () => 0 }),
      phase: 'setup', endpoint }), /Invalid cloud cost meter/); } finally { client.destroy(); }
  }
  const { client, meter } = await fixture(t, (req, res) => { req.resume(); res.end(); });
  assert.throws(() => metering.instrumentStorageClient({ client, meter, phase: 'workload', endpoint: 'http://127.0.0.1:9000/' }), /Invalid cloud cost meter/);
});

test('observerRejectsMissingMalformedOrUnclassifiedCorrelation', () => {
  const input = { method: 'PUT', path: '/bucket/private', headers: {
    'x-cloud-cost-attempt': '12345678-1234-4234-8234-123456789012', 'x-cloud-cost-retry': '0', 'x-cloud-cost-phase': 'workload' } };
  for (const headers of [undefined, {}, { ...input.headers, 'x-cloud-cost-attempt': 'PRIVATE_SYNTHETIC_CANARY' },
    { ...input.headers, 'x-cloud-cost-retry': '-1' }, { ...input.headers, 'x-cloud-cost-retry': '1e2' },
    { ...input.headers, 'x-cloud-cost-retry': '9007199254740992' }, { ...input.headers, 'x-cloud-cost-phase': 'private' }])
    assert.throws(() => metering.correlatedStorageAttempt({ ...input, headers }), /Invalid cloud cost meter/);
  assert.throws(() => metering.correlatedStorageAttempt({ ...input, path: '/bucket/private?tagging' }), /Invalid cloud cost meter/);
});

test('deniedSdkCallRetainsAttemptAndUnknownErrorBillingWithoutRawText', async t => {
  const xml = '<Error><Code>AccessDenied</Code><Message>PRIVATE_SYNTHETIC_CANARY</Message></Error>';
  const { client, meter } = await fixture(t, (req, res) => {
    req.resume(); req.on('end', () => { res.writeHead(403, { 'content-type': 'application/xml', 'content-length': Buffer.byteLength(xml) }); res.end(xml); });
  });
  await assert.rejects(client.send(new GetObjectCommand({ Bucket: 'synthetic', Key: 'private' })), { name: 'AccessDenied' });
  const result = meter.snapshot(); assert.equal(result.reconciled, true);
  assert.deepEqual(result.accounting.producer, { attempts: 1, bytesIn: Buffer.byteLength(xml), bytesOut: 0 });
  assert.equal(result.accounting.requests[0].outcome, 'client-error');
  assert.equal(result.billing[0].quantity, null); assert.equal(result.billing[0].status, 'unknown');
  assert.equal(JSON.stringify(result).includes('PRIVATE_SYNTHETIC_CANARY'), false);
});

test('producerEndpointCannotBeRedirectedAfterInstrumentation', async t => {
  let calls = 0, redirectedCalls = 0;
  const redirected = createServer((req, res) => { redirectedCalls++; req.resume(); req.on('end', () => res.end()); });
  redirected.listen(0, '127.0.0.1'); await once(redirected, 'listening');
  t.after(() => { redirected.closeAllConnections(); return new Promise(resolve => redirected.close(resolve)); });
  const { client, meter } = await fixture(t, (req, res) => { calls++; req.resume(); res.end(); });
  client.middlewareStack.add(next => args => next({ ...args, request: { ...args.request, port: redirected.address().port } }),
    { name: 'syntheticRedirect', step: 'finalizeRequest', priority: 'low' });
  await assert.rejects(client.send(new PutObjectCommand({ Bucket: 'synthetic', Key: 'private', Body: Buffer.from('abc') })), /Invalid cloud cost meter/);
  assert.equal(calls, 0); assert.equal(redirectedCalls, 0); assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

// ECONNREFUSED is retryable by code in the installed handler, without its TimeoutError name.
test('connectionRefusalKeepsItsRetryCodeWithoutRetainingTheAddress', async t => {
  let calls = 0;
  const server = createServer((req, res) => { calls++; req.resume(); req.on('end', () => { res.writeHead(200, { 'content-length': '0' }); res.end(); }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const endpoint = `http://127.0.0.1:${port}`;
  const client = new S3Client({ endpoint, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 2,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  t.after(() => client.destroy());
  // The real connection is refused; start the owned listener only after the handler observes it.
  const handler = client.config.requestHandler, handle = handler.handle.bind(handler);
  handler.handle = async (...args) => {
    try { return await handle(...args); }
    catch (error) {
      assert.equal(error.code, 'ECONNREFUSED');
      server.listen(port, '127.0.0.1'); await once(server, 'listening');
      throw error;
    }
  };
  const meter = metering.createMeter({ phase: 'workload', clock: () => 0 });
  metering.instrumentStorageClient({ client, meter, phase: 'workload', endpoint });
  await client.send(new PutObjectCommand({ Bucket: 'synthetic', Key: 'private', Body: Buffer.from('abc') }));
  const result = meter.snapshot(); assert.equal(calls, 1);
  assert.equal(result.accounting.producer.attempts, 2);
  assert.deepEqual(result.accounting.requests.map(r => [r.outcome, r.retryOrdinal]), [['transport-error', 0], ['success', 1]]);
  assert.equal(result.status, 'unknown'); assert.equal(JSON.stringify(result).includes(String(port)), false);
});
