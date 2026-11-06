import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { connect } from 'node:net';
import { createMeter } from './meter.mjs';
import { createLitestreamTransport } from './litestream.mjs';

const headers = invocation => ({ 'amz-sdk-invocation-id': invocation,
  'amz-sdk-request': 'attempt=1; max=3' });
const first = '11111111-2222-4333-8444-555555555555', second = '22222222-2222-4333-8444-555555555555';
const send = (url, method, path, invocation, body = '') => new Promise((resolve, reject) => {
  const caller = request(url + path, { method, headers: { ...headers(invocation), 'content-length': Buffer.byteLength(body) } }, async res => {
    try { let bytes = 0; for await (const chunk of res) bytes += chunk.length; resolve({ statusCode: res.statusCode, bytes }); }
    catch { reject(Error('Synthetic interrupted response')); }
  });
  caller.on('error', () => reject(Error('Synthetic failed request'))); caller.end(body);
});

// A refused accounting close must not stop the next functional operation from reaching storage.
for (const [operation, method, path, body = ''] of [
  ['put', 'PUT', '/bucket/PRIVATE_CANARY', 'four'],
  ['get', 'GET', '/bucket/PRIVATE_CANARY'], ['head', 'HEAD', '/bucket/PRIVATE_CANARY'],
  ['list', 'GET', '/bucket?list-type=2'], ['delete', 'DELETE', '/bucket/PRIVATE_CANARY'],
  ['delete-many', 'POST', '/bucket?delete', '<Delete><Object><Key>PRIVATE_CANARY</Key></Object></Delete>'],
  ['multipart-create', 'POST', '/bucket/PRIVATE_CANARY?uploads'],
  ['multipart-upload', 'PUT', '/bucket/PRIVATE_CANARY?uploadId=PRIVATE_UPLOAD&partNumber=1', 'four'],
  ['multipart-complete', 'POST', '/bucket/PRIVATE_CANARY?uploadId=PRIVATE_UPLOAD', '<CompleteMultipartUpload/>'],
  ['multipart-abort', 'DELETE', '/bucket/PRIVATE_CANARY?uploadId=PRIVATE_UPLOAD'],
]) test(`a native ${operation} cutoff preserves its actual failure and permits independent later work`, async t => {
  let forwarded = 0;
  const backend = createServer((req, res) => {
    forwarded++; req.resume(); req.once('end', () => {
      if (forwarded === 1) res.destroy(); else res.end('ok');
    });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const transport = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`,
    meter, phase: 'workload', allowBulkDeletes: true });
  t.after(() => transport.close().catch(() => {}));
  await assert.rejects(send(transport.url, method, path, first, body), /Synthetic failed request/);
  assert.equal(forwarded, 1);
  let idle = false;
  await transport.whenIdle(() => { idle = true; });
  assert.equal(idle, true);
  transport.setPhase('restore');
  assert.deepEqual(await send(transport.url, 'GET', '/bucket/PRIVATE_RESTORE', second), { statusCode: 200, bytes: 2 });
  assert.equal(forwarded, 2);
  await transport.close();
  const result = transport.snapshot();
  assert.equal(result.status, 'unknown');
  assert.ok(result.gaps.includes('accounting:request-cutoff'));
  assert.equal(result.accounting.requests.find(row => row.operation === operation && row.phase === 'workload').outcome, 'transport-error');
  assert.equal(result.accounting.requests.find(row => row.phase === 'restore').outcome, 'success');
  assert.equal(result.accounting.producer.attempts, 2);
  assert.equal(meter.diagnostics().firstInvalidation, null);
  assert.equal(transport.checkpoint().pending, 0);
  assert.equal(transport.checkpoint().connections, 0);
  assert.doesNotMatch(JSON.stringify(transport.checkpoint()), /PRIVATE|11111111|22222222/);
});

// A response cap protects collection memory independently of whether its billing is known.
test('an oversized mutation response remains fatal despite nonblocking cutoff accounting', async t => {
  const backend = createServer((req, res) => { req.resume(); req.once('end', () => res.end(Buffer.alloc(1048577))); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const transport = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`,
    meter, phase: 'workload', lifetimes: { begin: () => () => {} } });
  t.after(() => transport.close().catch(() => {}));
  await assert.rejects(send(transport.url, 'POST', '/bucket/key?uploads', first), /Synthetic interrupted response/);
  await assert.rejects(transport.close(), /Invalid cloud cost Litestream audit/);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

test('an unfinished pipelined next request stays fatal while an earlier response is active', async t => {
  let arrived, release, observed;
  const active = new Promise(resolve => { arrived = resolve; });
  const settled = new Promise(resolve => { observed = resolve; });
  const backend = createServer((req, res) => {
    req.resume(); req.once('end', () => { release = () => res.end('ok'); arrived(); });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const transport = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`,
    phase: 'workload', meter: { ...meter,
      observeAttempt: (...args) => { try { return meter.observeAttempt(...args); } finally { observed(); } } } });
  t.after(() => transport.close().catch(() => {}));
  const client = connect(Number(new URL(transport.url).port), '127.0.0.1');
  client.on('error', () => {}); t.after(() => client.destroy()); await once(client, 'connect');
  client.write(`GET /bucket/key HTTP/1.1\r\nHost: local\r\namz-sdk-invocation-id: ${first}\r\namz-sdk-request: attempt=1; max=3\r\n\r\n`);
  await active;
  const closed = new Promise(resolve => client.once('close', resolve));
  client.end('GET /bucket/PRIVATE_NEXT HTTP/1.1\r\nHost: local\r\n');
  await closed; release(); await settled;
  await assert.rejects(transport.close(), /Invalid cloud cost Litestream audit/);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  assert.equal(transport.checkpoint().reason, 'client-error');
});
