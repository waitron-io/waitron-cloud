import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import * as local from './local.mjs';

const bad = { message: 'Invalid cloud cost remote measurement' };
async function refused(options) {
  let opened;
  try { await assert.rejects(async () => { opened = await local.openRemoteMeasurement(options); }, bad); }
  finally { await opened?.close().catch(() => {}); }
}
async function backend(t, handle) {
  const sockets = new Set();
  const server = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket)); handle(socket);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { target: `tcp://127.0.0.1:${server.address().port}` };
}
async function open(t, args) {
  assert.equal(typeof local.openRemoteMeasurement, 'function', 'measure opaque gateway traffic before claiming session cost');
  const run = await local.openRemoteMeasurement({ audience: 'staff', ...args });
  t.after(() => run.close().catch(() => {})); return run;
}
async function exchange(port, body) {
  const socket = connect({ host: '127.0.0.1', port, allowHalfOpen: true });
  const chunks = []; socket.on('data', chunk => chunks.push(chunk));
  socket.once('end', () => socket.end());
  const done = once(socket, 'close'); socket.end(body); await done;
  return Buffer.concat(chunks);
}

// Dropping a direction, counting logical requests or ending the response at client EOF loses these literal byte totals.
test('remoteCountsBothDirectionsAndReconnectsAfterHalfCloseWithoutExportingPayloads', async t => {
  const f = await backend(t, socket => { socket.resume(); socket.once('end', () => socket.end('seven!!')); });
  const run = await open(t, f);
  assert.equal((await exchange(run.port, 'four')).toString(), 'seven!!');
  assert.equal((await exchange(run.port, 'eleven!!!!!')).toString(), 'seven!!');
  await run.close(); await run.close();
  const snapshot = run.snapshot();
  assert.deepEqual(snapshot, { scope: 'gateway-tcp-stream', audience: 'staff', status: 'measured', reconciled: true,
    producer: { connections: 2, bytesToGateway: 15, bytesFromGateway: 14 },
    observer: { connections: 2, bytesToGateway: 15, bytesFromGateway: 14 },
    discrepancy: { connections: 0, bytesToGateway: 0, bytesFromGateway: 0 },
    excludedOverhead: ['ip', 'tcp', 'wireguard'] });
  snapshot.producer.bytesToGateway = 0;
  assert.equal(run.snapshot().producer.bytesToGateway, 15, 'returned copies cannot rewrite evidence');
  assert.equal(JSON.stringify(run.snapshot()).includes('seven!!'), false);
  await assert.rejects(exchange(run.port, 'closed'));
});

// Combining public customer traffic with an owner session hides a required separate driver.
test('remoteKeepsPublicTrafficInItsOwnMeasurement', async t => {
  const f = await backend(t, socket => { socket.resume(); socket.once('end', () => socket.end('ok')); });
  const staff = await open(t, f), customer = await open(t, { ...f, audience: 'public' });
  await exchange(staff.port, 'staff'); await exchange(customer.port, 'customer');
  await staff.close(); await customer.close();
  assert.equal(staff.snapshot().audience, 'staff'); assert.equal(customer.snapshot().audience, 'public');
  assert.equal(staff.snapshot().producer.bytesToGateway, 5);
  assert.equal(customer.snapshot().producer.bytesToGateway, 8);
});

// Only numeric loopback targets are allowed; URL credentials, caller paths and silent extra fields cannot reach a provider.
test('remoteRejectsOutsideTargetsAndUnboundedOrUnexpectedOptions', async () => {
  assert.equal(typeof local.openRemoteMeasurement, 'function');
  const args = { target: 'tcp://127.0.0.1:42', audience: 'staff' };
  for (const target of ['tcp://example.test:42', 'tcp://localhost:42', 'tcp://0.0.0.0:42', 'http://127.0.0.1:42',
    'tcp://127.0.0.1', 'tcp://127.0.0.1:0', 'tcp://user:private@127.0.0.1:42',
    'tcp://127.0.0.1:42/raw', 'tcp://127.0.0.1:42/?raw', 'tcp://127.0.0.1:42/#raw'])
    await refused({ ...args, target });
  for (const change of [{ audience: 'owner' }, { audience: undefined }, { maxConnections: 0 }, { maxConnections: 1001 },
    { maxConnections: 1.5 }, { maxBytes: 0 }, { maxBytes: 67108865 }, { maxBytes: 1.5 }, { timeoutMs: 0 },
    { timeoutMs: 30001 }, { timeoutMs: 0.5 }, { windowMs: 0 }, { windowMs: 600001 }, { private: 'raw' }, { signal: {} }])
    await refused({ ...args, ...change });
  const controller = new AbortController(); controller.abort();
  await refused({ ...args, signal: controller.signal });
  await refused(undefined);
  await refused({ ...args, get private() { throw Error('PRIVATE_OPTION_CANARY'); } });
});

// No connection is not evidence of zero session traffic, and partial live transfers are not publishable.
test('remoteRequiresAClosedNonemptyRun', async t => {
  const f = await backend(t, socket => socket.end());
  const run = await open(t, f);
  assert.throws(() => run.snapshot(), bad);
  await assert.rejects(run.close(), bad); assert.throws(() => run.snapshot(), bad);
  const empty = await open(t, f); await exchange(empty.port, '');
  await assert.rejects(empty.close(), bad); assert.throws(() => empty.snapshot(), bad);
});

// Large responses and many reconnects must fail rather than silently truncate or count only a prefix.
test('remoteByteAndConnectionCapsInvalidateTheWholeRun', async t => {
  const f = await backend(t, socket => { socket.resume(); socket.once('end', () => socket.end('four')); });
  for (const args of [{ maxBytes: 7 }, { maxConnections: 1 }]) {
    const run = await open(t, { ...f, ...args });
    await exchange(run.port, 'four').catch(() => {});
    if (args.maxConnections) await exchange(run.port, 'four').catch(() => {});
    await assert.rejects(run.close(), bad); assert.throws(() => run.snapshot(), bad);
  }
});

// A cancelled or timed-out transport must collect its own listener and sockets and retain no successful evidence.
test('remoteCancellationAndDeadlinesCollectOwnedSockets', async t => {
  for (const mode of ['signal', 'timeout', 'window']) {
    let admitted;
    const ready = new Promise(resolve => { admitted = resolve; });
    const f = await backend(t, socket => { socket.resume(); admitted(); });
    const controller = new AbortController();
    const run = await open(t, { ...f, signal: controller.signal, timeoutMs: mode === 'timeout' ? 50 : 30000,
      windowMs: mode === 'window' ? 50 : 60000 });
    const socket = connect(run.port, '127.0.0.1'); socket.on('error', () => {});
    t.after(() => socket.destroy());
    const done = new Promise(resolve => socket.once('close', resolve));
    socket.write('private'); await ready;
    if (mode === 'signal') controller.abort();
    assert.equal(await Promise.race([done.then(() => true), delay(1000, false)]), true, 'the stop guard must close the owned socket');
    await assert.rejects(run.close(), bad); assert.throws(() => run.snapshot(), bad);
    await assert.rejects(exchange(run.port, 'later'));
  }
});

// A refused upstream or a reset before EOF cannot masquerade as a complete session; raw socket errors stay private.
test('remoteRefusedAndInterruptedUpstreamsNeverQualify', async t => {
  const f = await backend(t, socket => { socket.once('data', () => socket.resetAndDestroy()); });
  const run = await open(t, f); await exchange(run.port, 'PRIVATE_TRANSPORT_CANARY').catch(() => {});
  await assert.rejects(run.close(), bad); assert.throws(() => run.snapshot(), bad);
  const temporary = createServer(); temporary.listen(0, '127.0.0.1'); await once(temporary, 'listening');
  const port = temporary.address().port; await new Promise(resolve => temporary.close(resolve));
  const refused = await open(t, { target: `tcp://127.0.0.1:${port}` });
  await exchange(refused.port, 'private').catch(() => {});
  await assert.rejects(refused.close(), bad); assert.throws(() => refused.snapshot(), bad);
});

// Backpressure must preserve every byte when the reply is much larger than socket buffers.
test('remoteBackpressurePreservesLargeBidirectionalTransfers', async t => {
  const sent = Buffer.alloc(1048576, 0x53), reply = Buffer.alloc(2097152, 0x52);
  let read = 0;
  const f = await backend(t, socket => {
    socket.on('data', bytes => { read += bytes.length; });
    socket.once('end', () => socket.end(reply));
  });
  const run = await open(t, f); const result = await exchange(run.port, sent);
  assert.equal(read, 1048576); assert.deepEqual(result, reply); await run.close();
  assert.deepEqual(run.snapshot().producer, { connections: 1, bytesToGateway: 1048576, bytesFromGateway: 2097152 });
  assert.deepEqual(run.snapshot().observer, run.snapshot().producer);
});

// HTTP completion precedes socket-close callbacks. Checking totals at response EOF can lose the last reconnect.
test('remoteCloseWaitsForUpstreamSocketsAfterTheLastHttpResponse', async t => {
  const f = await backend(t, socket => {
    socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'));
    socket.resume();
  });
  const run = await open(t, f);
  for (let n = 0; n < 4; n++) await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: run.port, agent: false }, res => {
      res.resume(); res.once('end', resolve); res.once('error', reject);
    });
    req.once('error', reject); req.end();
  });
  await run.close();
  assert.equal(run.snapshot().producer.connections, 4);
  assert.deepEqual(run.snapshot().producer, run.snapshot().observer);
});

// Independent counter disagreement must block evidence, even when every application byte arrived.
test('remoteCounterDisagreementCannotPublishAMeasuredRun', async t => {
  const f = await backend(t, socket => { socket.resume(); socket.once('end', () => socket.end('four')); });
  const original = net.connect, written = Object.getOwnPropertyDescriptor(net.Socket.prototype, 'bytesWritten').get;
  const targetPort = Number(new URL(f.target).port);
  net.connect = (...args) => {
    const socket = original(...args);
    if (args[0]?.port === targetPort) Object.defineProperty(socket, 'bytesWritten', { get() { return written.call(this) + 1; } });
    return socket;
  };
  syncBuiltinESMExports();
  t.after(() => { net.connect = original; syncBuiltinESMExports(); });
  const run = await open(t, f);
  assert.equal((await exchange(run.port, 'four')).toString(), 'four');
  await assert.rejects(run.close(), bad); assert.throws(() => run.snapshot(), bad);
});
