import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter } from './meter.mjs';
import { createLitestreamTransport, withLitestreamCloseDiagnostics } from './litestream.mjs';

const headers = { 'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555',
  'amz-sdk-request': 'attempt=1; max=3', 'content-length': 4 };

// Dropping first-event progress would make a truncated reply indistinguishable from a complete body.
for (const statusCode of [200, 503]) for (const body of ['x', 'xyz']) {
  test(`an aborted PUT preserves its first body progress: status=${statusCode}, bytes=${body.length}`, { timeout: 5000 }, async t => {
    let reply, invalidated, arrived;
    const refused = new Promise(resolve => { invalidated = resolve; });
    const received = new Promise(resolve => { arrived = resolve; });
    const backend = createServer((req, res) => {
      req.resume(); req.once('end', () => {
        reply = res; res.writeHead(statusCode, { 'content-length': 4 }); res.write(body);
      });
    });
    backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
    t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
    const meter = createMeter({ phase: 'workload', clock: () => 0 });
    const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, phase: 'workload',
      meter: { observeAttempt: meter.observeAttempt, invalidate: () => { meter.invalidate(); invalidated(); } } });
    t.after(() => front.close().catch(() => {}));
    const caller = request(front.url + '/PRIVATE_CANARY/key', { method: 'PUT', headers }, res => {
      res.on('error', () => {}); res.once('data', arrived); res.resume();
    });
    caller.on('error', () => {}); t.after(() => caller.destroy()); caller.end('four');
    await received;
    let idleRan = false;
    const idle = assert.rejects(front.whenIdle(() => { idleRan = true; }), /Invalid cloud cost Litestream audit/);
    reply.destroy(); await refused; await idle;
    const beforeClose = front.checkpoint(), records = [];
    await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => front.close(),
      report: line => records.push(JSON.parse(line)) }), /Invalid cloud cost Litestream audit/);
    for (const detail of [beforeClose, records.at(-1).diagnostic]) {
      assert.equal(detail.reason, 'upstream-response-interrupted'); assert.equal(detail.ioEvent, 'response-aborted');
      assert.equal(detail.operation, 'put'); assert.equal(detail.bytesIn, body.length);
      assert.equal(detail.expectedIn, 4); assert.equal(detail.bytesOut, 4); assert.equal(detail.expectedOut, 4);
      assert.equal(detail.statusCode, statusCode); assert.equal(detail.requestComplete, true);
      assert.equal(detail.responseComplete, false); assert.equal(detail.requestSent, true); assert.equal(detail.responseReceived, false);
      assert.equal(detail.idleActionsAtAdmission, 0); assert.equal(detail.clientClosed, false);
    }
    assert.equal(idleRan, false); assert.equal(beforeClose.pending, 0); assert.equal(beforeClose.completed, 1);
    assert.equal(records.at(-1).diagnostic.connections, 0);
    assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
    assert.equal(JSON.stringify([beforeClose, records]).includes('PRIVATE_CANARY'), false);
  });
}

test('an aborted early reply retains an unfinished upload at the first event', { timeout: 5000 }, async t => {
  let reply, arrived, invalidated;
  const received = new Promise(resolve => { arrived = resolve; });
  const refused = new Promise(resolve => { invalidated = resolve; });
  const backend = createServer((req, res) => {
    req.on('error', () => {}); req.once('data', () => {
      reply = res; res.writeHead(200, { 'content-length': 4 }); res.write('x');
    }); req.resume();
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, phase: 'workload',
    meter: { observeAttempt: meter.observeAttempt, invalidate: () => { meter.invalidate(); invalidated(); } } });
  t.after(() => front.close().catch(() => {}));
  const caller = request(front.url + '/PRIVATE_CANARY/key', { method: 'PUT', headers }, res => {
    res.on('error', () => {}); res.once('data', arrived); res.resume();
  });
  caller.on('error', () => {}); t.after(() => caller.destroy()); caller.write('f');
  await received; reply.destroy(); await refused;
  const checkpoint = front.checkpoint(), records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => front.close(),
    report: line => records.push(JSON.parse(line)) }), /Invalid cloud cost Litestream audit/);
  for (const detail of [checkpoint, records.at(-1).diagnostic]) {
    assert.equal(detail.ioEvent, 'response-aborted'); assert.equal(detail.bytesIn, 1); assert.equal(detail.expectedIn, 4);
    assert.equal(detail.bytesOut, 1); assert.equal(detail.expectedOut, 4); assert.equal(detail.statusCode, 200);
    assert.equal(detail.requestComplete, false); assert.equal(detail.requestSent, false);
    assert.equal(detail.responseComplete, false); assert.equal(detail.responseReceived, false);
    assert.equal(detail.code, 'ECONNRESET');
  }
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  assert.equal(JSON.stringify([checkpoint, records]).includes('PRIVATE_CANARY'), false);
});

test('response progress reporting excludes malformed values and accessors', async () => {
  let reads = 0;
  const raw = { reason: 'upstream-response-interrupted', statusCode: 700, bytesIn: -1, expectedIn: Infinity,
    bytesOut: 'PRIVATE_CANARY', expectedOut: Number.MAX_SAFE_INTEGER + 1, requestComplete: 'PRIVATE_CANARY',
    responseComplete: null, requestSent: 1 };
  Object.defineProperty(raw, 'responseReceived', { get() { reads++; throw Error('PRIVATE_CANARY'); } });
  const original = Object.assign(Error('PRIVATE_CANARY'), { litestreamCloseDiagnostic: raw }), records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => { throw original; },
    report: line => records.push(JSON.parse(line)) }), error => error === original);
  assert.deepEqual(records.at(-1).diagnostic, { reason: 'upstream-response-interrupted' });
  assert.equal(reads, 0); assert.equal(JSON.stringify(records).includes('PRIVATE_CANARY'), false);
});
