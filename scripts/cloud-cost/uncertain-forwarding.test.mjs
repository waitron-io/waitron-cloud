import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { openLitestreamHistories } from './storage-lifetimes.mjs';
import { createLitestreamTransport } from './litestream.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, instrumentStorageClient } from './meter.mjs';

const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3');
const key = 'PRIVATE_HISTORY', path = '/synthetic/' + key, bad = /Invalid cloud cost storage lifetimes/;
const deletion = Buffer.from(`<Delete><Object><Key>${key}</Key></Object></Delete>`);
const deleted = Buffer.from(`<DeleteResult><Deleted><Key>${key}</Key></Deleted></DeleteResult>`);
const put = bytes => ({ method: 'PUT', path, headers: { 'content-length': String(bytes) } });
const singleDelete = { method: 'DELETE', path, headers: {} };
const batch = { method: 'POST', path: '/synthetic?delete=', headers: { 'content-length': String(deletion.length) }, body: deletion };
const nextInput = op => op === 'put' ? put(6) : op === 'batch' ? batch : singleDelete;
const bytesFor = op => op === 'put' ? 6 : op === 'batch' ? deletion.length : 0;

async function fixture(t) {
  let time = 0;
  const objects = new Map(), state = { cutoff: false, mutations: 0 };
  const backend = createServer((req, res) => {
    let received = 0; req.on('data', chunk => { received += chunk.length; }); req.once('end', () => {
    const q = new URL(req.url, 'http://local').searchParams;
    if (req.method === 'PUT' || req.method === 'DELETE' || req.method === 'POST') {
      state.mutations++;
      if (req.method === 'PUT') objects.set(key, received);
      else objects.delete(key);
      if (state.cutoff) { state.cutoff = false; res.destroy(); return; }
      if (req.method === 'DELETE') res.writeHead(204);
      res.end(req.method === 'POST' ? deleted : '');
    } else if (q.has('versioning')) res.end('<VersioningConfiguration/>');
    else if (q.has('uploads')) res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>');
    else res.end('<ListBucketResult><IsTruncated>false</IsTruncated>' + [...objects].map(([k, bytes]) => `<Contents><Key>${k}</Key><Size>${bytes}</Size></Contents>`).join('') + '</ListBucketResult>');
  }); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'observer', clock: () => time });
  const proxy = await createMeteringProxy({ target: `http://127.0.0.1:${backend.address().port}`, meter, classify: correlatedStorageAttempt });
  t.after(() => proxy.close());
  const client = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  instrumentStorageClient({ client, meter, phase: 'observer', endpoint: proxy.url }); t.after(() => client.destroy());
  const audit = await openLitestreamHistories({ client, sdk, meter, bucket: 'synthetic', clock: () => time, allowBulkDeletes: true });
  return { objects, audit, meter, state, target: `http://127.0.0.1:${backend.address().port}`, time: n => { time = n; } };
}
function initial(f, first) {
  f.time(1); f.audit.begin(put(4))({ statusCode: 200, bytesOut: 4 }); f.objects.set(key, 4);
  f.time(2); f.audit.begin(first === 'put' ? put(8) : singleDelete)({ statusCode: null, bytesOut: first === 'put' ? 8 : 0, interrupted: true });
}

// Refusing the second operation, discarding an older possible size, or claiming an integral breaks these cases.
for (const first of ['put', 'delete']) for (const next of ['put', 'delete', 'batch']) {
  for (const successful of [false, true]) for (const observed of successful ? [next === 'put' ? 6 : null] : first === 'put' ? [4, 8, next === 'put' ? 6 : null] : [4, null, ...(next === 'put' ? [6] : [])]) {
    test(`uncertain ${first} forwards later ${next}: success=${successful}, stored=${observed}`, async t => {
      const f = await fixture(t); initial(f, first); f.time(3); let finish;
      assert.doesNotThrow(() => { finish = f.audit.begin(nextInput(next)); }, 'missing accounting history must not block a later owned operation');
      f.time(4); assert.doesNotThrow(() => finish({ statusCode: successful ? next === 'delete' ? 204 : 200 : null,
        bytesOut: bytesFor(next), interrupted: !successful, ...(next === 'batch' ? { responseBody: deleted } : {}) }));
      if (observed === null) f.objects.delete(key); else f.objects.set(key, observed);
      f.time(5); await assert.doesNotReject(f.audit.verify()); f.time(6);
      const result = f.audit.snapshot();
      assert.equal(result.status, 'unknown');
      assert.ok(result.gaps.includes('accounting:request-cutoff'));
      // A same-delete retry remains independently bounded. Different mutations erase the intermediate history.
      if (first === 'put' || next === 'put') {
        assert.ok(result.gaps.includes('accounting:incomplete-history'));
        assert.deepEqual(result.byteSeconds, { low: null, high: null });
      }
      assert.equal(result.objects.bytes, observed ?? 0);
      assert.equal(result.objects.currentVersions, observed === null ? 0 : 1);
      assert.equal(f.meter.diagnostics().firstInvalidation, null);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_HISTORY/);
      f.time(7); await f.audit.verify(); assert.deepEqual(f.audit.snapshot().gaps, result.gaps);
    });
  }
}

for (const mode of ['unadmitted-size', 'foreign-key', 'active', 'malformed', 'duplicate']) test(`uncertain forwarding keeps ${mode} refusal`, async t => {
  const f = await fixture(t); initial(f, 'put'); f.time(3); let finish;
  assert.doesNotThrow(() => { finish = f.audit.begin(put(6)); });
  if (mode === 'active') assert.throws(() => f.audit.begin(singleDelete), bad);
  else if (mode === 'malformed') assert.throws(() => finish({ statusCode: null, bytesOut: 7, interrupted: true }), bad);
  else {
    finish({ statusCode: null, bytesOut: 6, interrupted: true });
    if (mode === 'duplicate') assert.throws(() => finish({ statusCode: 200, bytesOut: 6 }), bad);
    else { f.objects.set(mode === 'foreign-key' ? 'PRIVATE_FOREIGN' : key, mode === 'unadmitted-size' ? 5 : 6); await assert.rejects(f.audit.verify(), bad); }
  }
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

// A second real writer operation must reach storage after a reply was lost on the first.
for (const next of ['put', 'delete', 'batch']) for (const cutoffAgain of [false, true]) test(`real lost-reply write forwards ${next}, cutoffAgain=${cutoffAgain}`, async t => {
  const f = await fixture(t), meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: f.target, meter, phase: 'workload', lifetimes: f.audit, allowBulkDeletes: true });
  t.after(() => front.close().catch(() => {}));
  let invocation = 0;
  const send = async (input, body) => new Promise((resolve, reject) => {
    const req = request(front.url + input.path, { method: input.method, headers: { ...input.headers,
      'amz-sdk-invocation-id': `${String(++invocation).padStart(8, '0')}-2222-4333-8444-555555555555`,
      'amz-sdk-request': 'attempt=1; max=3' } }, async res => {
      try { for await (const chunk of res) void chunk; resolve(res.statusCode); }
      catch { reject(Error('Synthetic reply cutoff')); }
    });
    req.once('error', () => reject(Error('Synthetic request cutoff'))); req.end(body);
  });
  f.time(1); assert.equal(await send(put(4), 'four'), 200); await front.whenIdle(() => {});
  f.time(2); f.state.cutoff = true;
  await assert.rejects(send(put(8), 'eight888'), /Synthetic (request|reply) cutoff/); await front.whenIdle(() => {});
  f.time(3); f.state.cutoff = cutoffAgain;
  const result = send(nextInput(next), next === 'put' ? 'six666' : next === 'batch' ? deletion : undefined);
  if (cutoffAgain) await assert.rejects(result, /Synthetic (request|reply) cutoff/);
  else assert.equal(await result, next === 'delete' ? 204 : 200);
  await front.whenIdle(() => {}); await front.close();
  f.time(5); await f.audit.verify();
  assert.equal(f.state.mutations, 3);
  assert.equal(f.audit.snapshot().objects.bytes, next === 'put' ? 6 : 0);
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: null, high: null });
  assert.deepEqual(f.audit.snapshot().gaps, ['accounting:request-cutoff', 'accounting:incomplete-history']);
  assert.equal(front.checkpoint().pending, 0); assert.equal(front.checkpoint().connections, 0);
  assert.equal(meter.diagnostics().firstInvalidation, null);
  const rows = meter.snapshot().accounting.requests;
  assert.equal(rows.reduce((n, r) => n + r.attempts, 0), 3);
  assert.equal(rows.filter(r => r.outcome === 'transport-error').reduce((n, r) => n + r.attempts, 0), cutoffAgain ? 2 : 1);
});

for (const observed of [4, 8, null]) test(`a later successful write excludes stale size ${observed}`, async t => {
  const f = await fixture(t); initial(f, 'put'); f.time(3); let finish;
  assert.doesNotThrow(() => { finish = f.audit.begin(put(6)); }); finish({ statusCode: 200, bytesOut: 6 });
  if (observed === null) f.objects.delete(key); else f.objects.set(key, observed);
  await assert.rejects(f.audit.verify(), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

test('uncertain candidate storage refuses a 100001st distinct possible size', async t => {
  const f = await fixture(t); initial(f, 'put'); f.time(3);
  for (let bytes = 9; bytes <= 100006; bytes++) {
    let finish;
    assert.doesNotThrow(() => { finish = f.audit.begin(put(bytes)); });
    finish({ statusCode: null, bytesOut: bytes, interrupted: true });
  }
  assert.throws(() => f.audit.begin(put(100007)), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

test('later clean cleanup cannot replace an unknown earlier interval', async t => {
  const f = await fixture(t); initial(f, 'put'); f.time(3); let finish;
  assert.doesNotThrow(() => { finish = f.audit.begin(put(6)); }); finish({ statusCode: 200, bytesOut: 6 }); f.objects.set(key, 6);
  f.time(4); await f.audit.verify(); f.time(5);
  f.audit.begin(singleDelete)({ statusCode: 204, bytesOut: 0 }); f.objects.clear();
  f.time(6); await f.audit.verify();
  assert.equal(f.audit.snapshot().objects.bytes, 0);
  assert.deepEqual(f.audit.snapshot().byteSeconds, { low: null, high: null });
  assert.deepEqual(f.audit.snapshot().gaps, ['accounting:request-cutoff', 'accounting:incomplete-history']);
});
