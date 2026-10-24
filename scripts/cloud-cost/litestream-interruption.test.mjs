import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientRequest, Server, createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter } from './meter.mjs';
import { createLitestreamTransport, withLitestreamCloseDiagnostics } from './litestream.mjs';

const headers = { 'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=3' };

// Losing the first I/O event must not turn a refused transfer into an unexplained close.
for (const side of ['request', 'response']) test(`interrupted ${side} identifies its first event without exposing the request`, async t => {
  let entered;
  const active = new Promise(resolve => { entered = resolve; });
  const backend = createServer((req, res) => {
    if (side === 'request') { req.on('error', () => {}); req.resume(); entered(); }
    else { req.resume(); res.writeHead(200, { 'content-length': 100 }); res.write('PRIVATE_CANARY'); entered(); }
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  let invalidated;
  const refused = new Promise(resolve => { invalidated = resolve; });
  const transport = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`,
    meter: { observeAttempt: meter.observeAttempt, invalidate: () => { meter.invalidate(); invalidated(); } }, phase: 'workload' });
  t.after(() => transport.close().catch(() => {}));
  const client = request(transport.url + '/PRIVATE_CANARY/key', { method: 'PUT', headers: { ...headers, 'content-length': 100 } });
  const ended = new Promise(resolve => {
    client.on('error', resolve);
    client.on('response', response => { response.on('error', resolve); response.on('end', resolve); response.resume(); });
  });
  if (side === 'request') client.write('partial'); else client.end('x'.repeat(100));
  await active;
  if (side === 'request') client.destroy(); else backend.closeAllConnections();
  await ended;
  await refused;
  const records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => transport.close(), report: line => records.push(JSON.parse(line)) }));
  assert.equal(records.at(-1).diagnostic.ioEvent, side === 'request' ? 'client-error' : 'response-aborted');
  if (side === 'response') assert.equal(records.at(-1).diagnostic.operation, 'put');
  assert.equal(JSON.stringify(records).includes('PRIVATE_CANARY'), false);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

test('forged interruption details and accessors cannot publish private content', async () => {
  let reads = 0;
  const detail = { reason: 'transfer-interrupted', ioEvent: 'PRIVATE_CANARY', operation: 'PRIVATE_CANARY' };
  Object.defineProperty(detail, 'code', { get() { reads++; throw Error('PRIVATE_CANARY'); } });
  const error = Object.assign(Error('PRIVATE_CANARY'), { litestreamCloseDiagnostic: detail }), records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: async () => { throw error; }, report: line => records.push(JSON.parse(line)) }), e => e === error);
  assert.equal(reads, 0); assert.equal(JSON.stringify(records).includes('PRIVATE_CANARY'), false);
});

test('an upstream timeout keeps its original refusal and network code while naming the event', async t => {
  let upstream;
  const setTimeout = ClientRequest.prototype.setTimeout;
  t.mock.method(ClientRequest.prototype, 'setTimeout', function (...args) {
    upstream = this; return setTimeout.apply(this, args);
  });
  const backend = createServer((req, res) => { req.resume(); upstream.emit('timeout'); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const transport = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload' });
  t.after(() => transport.close().catch(() => {}));
  await new Promise(resolve => {
    const client = request(transport.url + '/PRIVATE_CANARY/key', { method: 'PUT', headers });
    client.on('error', resolve); client.end();
  });
  const records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => transport.close(), report: line => records.push(JSON.parse(line)) }));
  assert.equal(records.at(-1).diagnostic.reason, 'upstream-error');
  assert.equal(records.at(-1).diagnostic.code, 'ECONNRESET');
  assert.equal(records.at(-1).diagnostic.ioEvent, 'upstream-timeout');
  assert.equal(records.at(-1).diagnostic.operation, 'put');
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

test('a response with unauditable body length identifies header validation and refuses accounting', async t => {
  const backend = createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-length': '01' }); res.end('x'); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const transport = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload' });
  t.after(() => transport.close().catch(() => {}));
  await new Promise(resolve => {
    const client = request(transport.url + '/PRIVATE_CANARY/key', { method: 'PUT', headers });
    client.on('error', resolve); client.end();
  });
  const records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => transport.close(), report: line => records.push(JSON.parse(line)) }));
  assert.equal(records.at(-1).diagnostic.ioEvent, 'response-headers');
  assert.equal(records.at(-1).diagnostic.operation, 'put');
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

// A closed client can disappear before upstream headers arrive; preserve the ordering as well as refusal.
for (const timing of ['before', 'immediate', 'waited']) test(`a cancelled list retains its pipe error and idle ordering: ${timing}`, async t => {
  const afterIdle = timing !== 'before';
  let arrived, reply, invalidated;
  const admitted = new Promise(resolve => { arrived = resolve; });
  const refused = new Promise(resolve => { invalidated = resolve; });
  let firstArrived, firstReply;
  const firstAdmitted = new Promise(resolve => { firstArrived = resolve; });
  const backend = createServer((req, res) => {
    req.resume(); req.on('end', () => {
      if (req.method === 'PUT') { firstReply = () => res.end(); firstArrived(); }
      else { reply = () => res.end('ok'); arrived(); }
    });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const transport = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`,
    meter: { observeAttempt: meter.observeAttempt, invalidate: () => { meter.invalidate(); invalidated(); } }, phase: 'workload' });
  t.after(() => transport.close().catch(() => {}));
  let clientClosed;
  const destinationClosed = new Promise(resolve => { clientClosed = resolve; });
  const emit = Server.prototype.emit;
  t.mock.method(Server.prototype, 'emit', function (event, ...args) {
    if (event === 'request' && args[0].method === 'GET' && args[0].socket.localPort === Number(new URL(transport.url).port))
      args[1].once('close', clientClosed);
    return emit.call(this, event, ...args);
  });
  const cancel = async () => {
    const client = request(transport.url + '/PRIVATE_CANARY?list-type=2', { headers });
    client.on('error', () => {}); const closed = new Promise(resolve => client.once('close', resolve)); client.end();
    await admitted;
    // Observe both ends of the client connection closing before releasing the upstream reply.
    client.destroy(); await closed;
    await destinationClosed;
    reply(); await refused;
  };
  if (timing === 'waited') {
    const first = new Promise((resolve, reject) => {
      const client = request(transport.url + '/PRIVATE_CANARY/key', { method: 'PUT', headers: { ...headers,
        'amz-sdk-invocation-id': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } }, res => { res.resume(); res.on('end', resolve); });
      client.on('error', reject); client.end();
    });
    await firstAdmitted; const action = transport.whenIdle(cancel); firstReply(); await first; await action;
  } else if (afterIdle) await transport.whenIdle(cancel); else await cancel();
  const records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => transport.close(),
    report: line => records.push(JSON.parse(line)) }));
  assert.deepEqual(records.at(-1).diagnostic, {
    reason: 'transfer-interrupted', pending: 0, completed: timing === 'waited' ? 2 : 1, connections: 0,
    code: 'ERR_STREAM_UNABLE_TO_PIPE', ioEvent: 'response-pipeline', operation: 'list',
    idleActionsAtAdmission: afterIdle ? 1 : 0,
    clientClosed: true, responseHeadersSeen: true,
  });
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  assert.equal(JSON.stringify(records).includes('PRIVATE_CANARY'), false);
});

test('hostile idle-ordering fields cannot escape the closed diagnostic categories', async () => {
  let reads = 0;
  const detail = { reason: 'transfer-interrupted', idleActionsAtAdmission: 'PRIVATE_CANARY',
    idleActionsAtInterruption: -1, clientClosed: 'PRIVATE_CANARY', responseHeadersSeen: 'PRIVATE_CANARY' };
  Object.defineProperty(detail, 'code', { get() { reads++; throw Error('PRIVATE_CANARY'); } });
  const error = Object.assign(Error('PRIVATE_CANARY'), { litestreamCloseDiagnostic: detail }), records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: async () => { throw error; },
    report: line => records.push(JSON.parse(line)) }), value => value === error);
  assert.deepEqual(records.at(-1).diagnostic, { reason: 'transfer-interrupted' });
  assert.equal(reads, 0); assert.equal(JSON.stringify(records).includes('PRIVATE_CANARY'), false);
});

for (const responseHeadersSeen of [false, true]) test(`upstream resets retain client state with response headers=${responseHeadersSeen}`, async t => {
  let reset;
  const backend = createServer((req, res) => {
    req.resume(); req.on('end', () => {
      if (!responseHeadersSeen) { res.destroy(); return; }
      reset = () => res.destroy(); res.writeHead(200, { 'content-length': 100 }); res.write('x');
    });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const transport = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload' });
  t.after(() => transport.close().catch(() => {}));
  await new Promise(resolve => {
    const client = request(transport.url + '/PRIVATE_CANARY/key', { headers }, res => {
      res.on('error', resolve); res.once('data', () => reset()); res.resume(); res.on('end', resolve);
    });
    client.on('error', resolve); client.end();
  });
  const records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => transport.close(),
    report: line => records.push(JSON.parse(line)) }));
  const detail = records.at(-1).diagnostic;
  assert.equal(detail.reason, responseHeadersSeen ? 'upstream-response-interrupted' : 'upstream-error');
  assert.equal(detail.ioEvent, responseHeadersSeen ? 'response-aborted' : 'upstream-error');
  assert.equal(detail.code, 'ECONNRESET'); assert.equal(detail.operation, 'get');
  assert.equal(detail.idleActionsAtAdmission, 0);
  assert.equal(detail.clientClosed, false); assert.equal(detail.responseHeadersSeen, responseHeadersSeen);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  assert.equal(JSON.stringify(records).includes('PRIVATE_CANARY'), false);
});
