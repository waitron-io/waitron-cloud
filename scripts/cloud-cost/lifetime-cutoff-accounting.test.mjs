import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { openLitestreamLifetimes, openLitestreamHistories } from './storage-lifetimes.mjs';
import { openLitestreamVersionHistories } from './stream-versions.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from './meter.mjs';
import { assessAccounting } from './accounting-policy.mjs';
import { createLitestreamTransport } from './litestream.mjs';

const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3');
const key = 'PRIVATE_CUTOFF', path = '/synthetic/' + key;
const bad = /Invalid cloud cost storage lifetimes/;
const models = [
  ['put-only', openLitestreamLifetimes],
  ['unversioned', openLitestreamHistories],
  ['versioned', openLitestreamVersionHistories],
];
const input = operation => ({ method: { put: 'PUT', get: 'GET', head: 'HEAD', list: 'GET', delete: 'DELETE' }[operation],
  path: operation === 'list' ? '/synthetic?list-type=2' : path,
  headers: operation === 'put' ? { 'content-length': '4' } : {} });

// Real inventory resolves presence; a cut-off HTTP reply never invents a commit time.
for (const [name, open] of models) for (const statusCode of [null, 200, 503]) {
  test(`${name} cutoff PUT retains unknown accounting and independent lifetime bounds, status=${statusCode}`, async t => {
    const f = await fixture(t, name === 'versioned'), audit = await open(f.args);
    f.time(2); const finish = audit.begin(input('put'));
    f.time(3);
    assert.doesNotThrow(() => finish({ statusCode, bytesOut: 2, interrupted: true, responseHeaders: {} }));
    f.stored(true); f.time(5); await audit.verify(); f.time(10);
    const result = audit.snapshot();
    assert.equal(result.status, 'unknown');
    assert.deepEqual(result.gaps, ['accounting:request-cutoff']);
    assert.equal(result.objects.bytes, 4); assert.equal(result.objects.currentVersions, 1);
    assert.deepEqual(result.byteSeconds, { low: 20, high: 32 });
    assert.ok(f.meter.snapshot().gaps.includes('accounting:request-cutoff'));
    const sources = ['requests', 'restore', 'administration'].map(scope => ({ scope, record: createMeter({ phase: 'workload', clock: () => 0 }).snapshot() }));
    sources.push({ scope: 'storage', record: result });
    assert.equal(assessAccounting({ producer: 'local-stream', sources }).publicationEligible, false);
    result.gaps.length = 0; await audit.verify();
    assert.deepEqual(audit.snapshot().gaps, ['accounting:request-cutoff']);
    assert.doesNotMatch(JSON.stringify(audit.snapshot()), /PRIVATE/);
  });
}

for (const [name, open] of models) {
  test(`${name} absent cutoff PUT does not invent a retained object and permits later work`, async t => {
    const f = await fixture(t, name === 'versioned'), audit = await open(f.args);
    audit.begin(input('put'))({ statusCode: null, bytesOut: 0, interrupted: true });
    await audit.verify();
    assert.equal(audit.snapshot().objects.bytes, 0);
    assert.deepEqual(audit.snapshot().byteSeconds, { low: 0, high: 0 });
    const finish = audit.begin(input('put'));
    finish({ statusCode: 200, bytesOut: 4, responseHeaders: { 'x-amz-version-id': 'v1' } });
    f.stored(true); await audit.verify();
    assert.equal(audit.snapshot().objects.bytes, 4);
    assert.equal(audit.snapshot().status, 'unknown');
    assert.ok(audit.snapshot().gaps.includes('accounting:request-cutoff'));
  });
  for (const operation of ['get', 'head', 'list']) {
    test(`${name} ${operation} cutoff retires accounting work without poisoning later inventory`, async t => {
      const f = await fixture(t, name === 'versioned'), audit = await open(f.args);
      assert.doesNotThrow(() => audit.begin(input(operation))({ statusCode: null, bytesOut: 0, interrupted: true }));
      await audit.verify();
      assert.equal(audit.snapshot().status, 'unknown');
      assert.deepEqual(audit.snapshot().gaps, ['accounting:request-cutoff']);
      audit.begin(input(operation))({ statusCode: 200, bytesOut: 0 });
      await audit.verify();
      assert.equal(audit.snapshot().objects.bytes, 0);
      assert.equal(f.meter.diagnostics().firstInvalidation, null);
    });
  }
  for (const [label, completion] of [
    ['invalid-status', { statusCode: 99, bytesOut: 0, interrupted: true }],
    ['missing-status-without-cutoff', { statusCode: null, bytesOut: 4 }],
    ['nonboolean-cutoff', { statusCode: 200, bytesOut: 0, interrupted: 'yes' }],
    ['negative-bytes', { statusCode: null, bytesOut: -1, interrupted: true }],
    ['oversize-body', { statusCode: null, bytesOut: 5, interrupted: true }],
    ['partial-success', { statusCode: 200, bytesOut: 2 }],
  ]) test(`${name} accounting uncertainty cannot hide malformed ${label}`, async t => {
    const f = await fixture(t, name === 'versioned'), audit = await open(f.args);
    assert.throws(() => audit.begin(input('put'))(completion), bad);
    await assert.rejects(audit.verify(), bad);
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
  test(`${name} cutoff cannot hide duplicate settlement or a foreign inventory object`, async t => {
    for (const mode of ['duplicate', 'foreign']) {
      const f = await fixture(t, name === 'versioned'), audit = await open(f.args);
      const finish = audit.begin(input('get'));
      finish({ statusCode: null, bytesOut: 0, interrupted: true });
      if (mode === 'duplicate') assert.throws(() => finish({ statusCode: null, bytesOut: 0, interrupted: true }), bad);
      else f.stored(true);
      await assert.rejects(audit.verify(), bad);
      assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
    }
  });
}

for (const [name, open] of models.slice(1)) for (const removed of [false, true]) {
  test(`${name} cutoff DELETE uses independent inventory, removed=${removed}`, async t => {
    const f = await fixture(t, name === 'versioned'), audit = await open(f.args);
    audit.begin(input('put'))({ statusCode: 200, bytesOut: 4, responseHeaders: { 'x-amz-version-id': 'v1' } });
    f.stored(true); await audit.verify();
    f.time(2);
    const deletion = input('delete'); if (name === 'versioned') deletion.path += '?versionId=v1';
    audit.begin(deletion)({ statusCode: null, bytesOut: 0, interrupted: true });
    if (removed) f.stored(false);
    f.time(5); await audit.verify(); f.time(10);
    const result = audit.snapshot();
    assert.equal(result.status, 'unknown'); assert.deepEqual(result.gaps, ['accounting:request-cutoff']);
    assert.equal(result.objects.bytes, removed ? 0 : 4);
    assert.deepEqual(result.byteSeconds, removed ? { low: 8, high: 20 } : { low: 40, high: 40 });
  });
}

// An actual committed write with a lost reply must leave both the HTTP failure and stored bytes visible.
for (const [name, open] of models) test(`${name} real cutoff PUT collects, retains its failure and permits a later request`, async t => {
  const f = await fixture(t, name === 'versioned'), lifetimes = await open(f.args);
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const transport = await createLitestreamTransport({ target: f.target, meter, phase: 'workload', lifetimes });
  t.after(() => transport.close().catch(() => {}));
  f.time(2); f.cutoffNext();
  const send = (method, path, invocation, body = '') => new Promise((resolve, reject) => {
    const caller = request(transport.url + path, { method, headers: {
      'amz-sdk-invocation-id': invocation, 'amz-sdk-request': 'attempt=1; max=3', 'content-length': Buffer.byteLength(body),
    } }, async res => {
      try { for await (const chunk of res) void chunk; resolve(res.statusCode); }
      catch { reject(Error('Synthetic response cutoff')); }
    });
    caller.on('error', () => reject(Error('Synthetic request cutoff'))); caller.end(body);
  });
  await assert.rejects(send('PUT', path, '11111111-2222-4333-8444-555555555555', 'four'), /Synthetic request cutoff/);
  await transport.whenIdle(() => {});
  assert.equal(transport.checkpoint().pending, 0);
  assert.equal(await send('GET', '/synthetic?list-type=2', '22222222-2222-4333-8444-555555555555'), 200);
  await transport.close(); f.time(5); await lifetimes.verify(); f.time(10);
  assert.equal(lifetimes.snapshot().objects.bytes, 4);
  assert.deepEqual(lifetimes.snapshot().byteSeconds, { low: 20, high: 32 });
  assert.equal(lifetimes.snapshot().status, 'unknown');
  assert.deepEqual(lifetimes.snapshot().gaps, ['accounting:request-cutoff']);
  const original = meter.snapshot().accounting.requests;
  assert.equal(original.find(r => r.operation === 'put').outcome, 'transport-error');
  assert.equal(original.find(r => r.operation === 'list').outcome, 'success');
  assert.equal(meter.diagnostics().firstInvalidation, null);
  assert.equal(transport.checkpoint().connections, 0);
  assert.doesNotMatch(JSON.stringify(lifetimes.snapshot()), /PRIVATE/);
});

async function fixture(t, versioned) {
  let time = 0, stored = false, cutoff = false;
  const provider = createServer((req, res) => {
    req.resume(); req.once('end', () => {
      if (req.method === 'PUT') { stored = true; if (cutoff) { cutoff = false; res.destroy(); } else res.end(); }
      else if (req.url.includes('versioning')) res.end(`<VersioningConfiguration>${versioned ? '<Status>Enabled</Status>' : ''}</VersioningConfiguration>`);
      else if (req.url.includes('uploads')) res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>');
      else if (req.url.includes('versions')) res.end(`<ListVersionsResult><IsTruncated>false</IsTruncated>${stored ? `<Version><Key>${key}</Key><VersionId>v1</VersionId><IsLatest>true</IsLatest><Size>4</Size></Version>` : ''}</ListVersionsResult>`);
      else res.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${stored ? `<Contents><Key>${key}</Key><Size>4</Size></Contents>` : ''}</ListBucketResult>`);
    });
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  t.after(() => { provider.closeAllConnections(); return new Promise(resolve => provider.close(resolve)); });
  const meter = createMeter({ phase: 'observer', clock: () => time });
  const proxy = await createMeteringProxy({ target: `http://127.0.0.1:${provider.address().port}`, meter, classify: correlatedStorageAttempt });
  t.after(() => proxy.close());
  const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  instrumentStorageClient({ client, meter, phase: 'observer', endpoint: proxy.url }); t.after(() => client.destroy());
  return { args: { client, sdk, meter, bucket: 'synthetic', clock: () => time }, meter,
    target: `http://127.0.0.1:${provider.address().port}`, cutoffNext: () => { cutoff = true; },
    time: value => { time = value; }, stored: value => { stored = value; } };
}
