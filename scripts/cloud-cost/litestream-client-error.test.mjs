import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter } from './meter.mjs';
import { createLitestreamTransport, withLitestreamCloseDiagnostics } from './litestream.mjs';

const headers = { 'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555',
  'amz-sdk-request': 'attempt=1; max=3' };

// Losing the socket's active request would leave a broken-pipe refusal without its operation or ordering.
for (const operation of ['list', 'put']) test(`a socket write error identifies its active ${operation} without accepting it`, async t => {
  let received;
  const active = new Promise(resolve => { received = resolve; });
  const backend = createServer((req, res) => {
    req.on('error', () => {}); req.resume();
    req.on('end', () => { res.writeHead(200, { 'content-length': 100 }); res.write('partial'); });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload' });
  t.after(() => front.close().catch(() => {}));
  let destination;
  const emit = Server.prototype.emit;
  t.mock.method(Server.prototype, 'emit', function (event, ...args) {
    if (event === 'request' && args[0].socket.localPort === Number(new URL(front.url).port)) destination = args[1];
    return emit.call(this, event, ...args);
  });
  const caller = request(front.url + (operation === 'list' ? '/PRIVATE_CANARY?list-type=2' : '/PRIVATE_CANARY/key'),
    { method: operation === 'put' ? 'PUT' : 'GET', headers }, response => {
      response.on('error', () => {}); response.once('data', received); response.resume();
    });
  caller.on('error', () => {});
  t.after(() => caller.destroy()); caller.end(); await active;
  const before = front.pendingTransfers();
  assert.equal(before.length, 1); assert.equal(before[0].operation, operation);
  assert.equal(before[0].bytesIn, 7);
  // Inject only the OS error at a real HTTP socket; keep request parsing, counters and refusal real.
  destination.socket.emit('error', Object.assign(Error('PRIVATE_CANARY'), { code: 'EPIPE' }));
  const records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => front.close(),
    report: line => records.push(JSON.parse(line)) }), /Invalid cloud cost Litestream audit/);
  const diagnostic = records.at(-1).diagnostic;
  assert.equal(diagnostic.reason, 'client-error'); assert.equal(diagnostic.ioEvent, 'client-error');
  assert.equal(diagnostic.code, 'EPIPE'); assert.equal(diagnostic.operation, operation);
  assert.equal(diagnostic.idleActionsAtAdmission, 0);
  assert.equal(diagnostic.responseHeadersSeen, true); assert.equal(diagnostic.clientClosed, false);
  assert.equal(diagnostic.bytesIn, 7); assert.equal(diagnostic.expectedIn, 100);
  assert.equal(diagnostic.bytesOut, 0); assert.equal(diagnostic.expectedOut, 0);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  assert.equal(JSON.stringify(records).includes('PRIVATE_CANARY'), false);
});

async function heldFixture(t) {
  const backend = createServer((req, res) => { req.on('error', () => {}); req.resume(); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload' });
  t.after(() => front.close().catch(() => {}));
  const sockets = [], waiters = [];
  const emit = Server.prototype.emit;
  t.mock.method(Server.prototype, 'emit', function (event, ...args) {
    const result = emit.call(this, event, ...args);
    if (event === 'request' && args[0].socket.localPort === Number(new URL(front.url).port)) {
      sockets.push(args[0].socket); waiters.shift()?.();
    }
    return result;
  });
  const waitFor = async count => { while (sockets.length < count) await new Promise(resolve => waiters.push(resolve)); };
  const refuse = async socket => {
    socket.emit('error', Object.assign(Error('PRIVATE_CANARY'), { code: 'EPIPE' }));
    const records = [];
    await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => front.close(),
      report: line => records.push(JSON.parse(line)) }), /Invalid cloud cost Litestream audit/);
    assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
    assert.equal(JSON.stringify(records).includes('PRIVATE_CANARY'), false);
    return records.at(-1).diagnostic;
  };
  return { front, sockets, waitFor, refuse };
}

// Other connections cannot change which request owns the failing socket.
test('a client error identifies its own socket while another operation is active', async t => {
  const f = await heldFixture(t);
  for (const [index, path] of ['/PRIVATE_CANARY?list-type=2', '/PRIVATE_CANARY/key'].entries()) {
    const caller = request(f.front.url + path, { method: index ? 'PUT' : 'GET', headers: { ...headers,
      'amz-sdk-invocation-id': index ? 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' : headers['amz-sdk-invocation-id'] } });
    caller.on('error', () => {}); t.after(() => caller.destroy()); caller.end();
    await f.waitFor(index + 1);
  }
  const diagnostic = await f.refuse(f.sockets[0]);
  assert.equal(diagnostic.activeTransfers, 1); assert.equal(diagnostic.operation, 'list');
  assert.equal(diagnostic.responseHeadersSeen, false);
});

// Several requests sharing one socket cannot be attributed to one operation without evidence.
test('a pipelined socket error reports ambiguity instead of guessing an operation', async t => {
  const { connect } = await import('node:net');
  const f = await heldFixture(t), url = new URL(f.front.url);
  const caller = connect(Number(url.port), url.hostname); caller.on('error', () => {});
  t.after(() => caller.destroy()); await once(caller, 'connect');
  const message = (method, path, id) => `${method} ${path} HTTP/1.1\r\nHost: local\r\nAmz-Sdk-Invocation-Id: ${id}\r\nAmz-Sdk-Request: attempt=1; max=3\r\nContent-Length: 0\r\n\r\n`;
  caller.write(message('GET', '/PRIVATE_CANARY?list-type=2', headers['amz-sdk-invocation-id'])
    + message('PUT', '/PRIVATE_CANARY/key', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'));
  await f.waitFor(2); assert.equal(f.sockets[0], f.sockets[1]);
  const diagnostic = await f.refuse(f.sockets[0]);
  assert.equal(diagnostic.activeTransfers, 2); assert.equal(Object.hasOwn(diagnostic, 'operation'), false);
  assert.equal(Object.hasOwn(diagnostic, 'bytesIn'), false);
});

// A completed keep-alive request must not supply stale context for a later socket error.
test('a socket error after settlement leaves its earlier operation unattributed', async t => {
  let socket;
  const backend = createServer((req, res) => { req.resume(); req.on('end', () => res.end('ok')); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload' });
  t.after(() => front.close().catch(() => {}));
  const emit = Server.prototype.emit;
  t.mock.method(Server.prototype, 'emit', function (event, ...args) {
    if (event === 'request' && args[0].socket.localPort === Number(new URL(front.url).port)) socket = args[0].socket;
    return emit.call(this, event, ...args);
  });
  await new Promise((resolve, reject) => {
    const caller = request(front.url + '/PRIVATE_CANARY?list-type=2', { headers }, response => {
      response.on('error', reject); response.resume(); response.on('end', resolve);
    }); caller.on('error', reject); caller.end();
  });
  await front.whenIdle(() => {}); assert.equal(front.checkpoint().completed, 1);
  socket.emit('error', Object.assign(Error('PRIVATE_CANARY'), { code: 'EPIPE' }));
  const records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => front.close(),
    report: line => records.push(JSON.parse(line)) }));
  assert.equal(records.at(-1).diagnostic.activeTransfers, 0);
  assert.equal(Object.hasOwn(records.at(-1).diagnostic, 'operation'), false);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});
