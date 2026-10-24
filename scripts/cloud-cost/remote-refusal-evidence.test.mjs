import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, connect} from 'node:net';
import {once} from 'node:events';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
import {openRemoteMeasurement} from './remote.mjs';

async function fixture(t, handle, options = {}) {
  const sockets = new Set();
  const server = createServer({allowHalfOpen: true}, socket => {
    sockets.add(socket); socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket)); handle(socket);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const meter = await openRemoteMeasurement({target: `tcp://127.0.0.1:${server.address().port}`, audience: 'staff', ...options});
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await meter.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  });
  return meter;
}
async function exchange(t, meter, write = 'PRIVATE_PAYLOAD') {
  const socket = connect(meter.port, '127.0.0.1'); socket.on('error', () => {});
  t.after(() => socket.destroy()); socket.resume();
  const closed = new Promise(resolve => socket.once('close', resolve));
  socket.end(write); await closed;
}
function evidence(meter, expected) {
  assert.equal(typeof meter.failure, 'function', 'relay refusals need a fixed first-cause observation');
  if (expected instanceof RegExp) assert.match(meter.failure(), expected);
  else assert.equal(meter.failure(), expected);
}

// Removing any classification leaves the original refusal intact but loses its cause.
for (const [mode, expected] of [
  ['reset', 'socket-upstream-reset'], ['empty', 'empty-exchange'],
  ['timeout', /^timeout-(client|upstream)$/], ['bytes', 'byte-limit'],
]) test('remoteRetainsFirstRefusal_' + mode, {timeout: 3000}, async t => {
  const meter = await fixture(t, socket => {
    if (mode === 'reset') socket.once('data', () => socket.resetAndDestroy());
    else {socket.resume(); socket.once('end', () => {if (mode !== 'timeout') socket.end(mode === 'empty' ? '' : 'response');});}
  }, mode === 'timeout' ? {timeoutMs: 50} : mode === 'bytes' ? {maxBytes: 1} : {});
  await exchange(t, meter);
  await assert.rejects(meter.close(), {message: 'Invalid cloud cost remote measurement'});
  evidence(meter, expected);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost remote measurement/);
  await meter.close().catch(() => {});
  evidence(meter, expected);
});

test('remoteHealthyAndUnstartedEvidenceDoNotInventASocketFailure', {timeout: 3000}, async t => {
  const meter = await fixture(t, socket => {socket.resume(); socket.once('end', () => socket.end('ok'));});
  evidence(meter, 'none');
  await exchange(t, meter); await meter.close(); evidence(meter, 'none');
  assert.deepEqual(meter.snapshot().producer, {connections: 1, bytesToGateway: 15, bytesFromGateway: 2});
  const empty = await fixture(t, () => {});
  await assert.rejects(empty.close(), /Invalid cloud cost remote measurement/);
  evidence(empty, 'final-accounting');
});

for (const mode of ['cancelled', 'window']) test('remoteRetainsFirstStopReason_' + mode, {timeout: 3000}, async t => {
  const controller = new AbortController();
  let admitted;
  const ready = new Promise(resolve => {admitted = resolve;});
  const meter = await fixture(t, socket => {socket.resume(); admitted();}, {
    signal: controller.signal, windowMs: mode === 'window' ? 50 : 60000,
  });
  const socket = connect(meter.port, '127.0.0.1'); socket.on('error', () => {});
  t.after(() => socket.destroy());
  const closed = new Promise(resolve => socket.once('close', resolve));
  socket.write('PRIVATE'); await ready;
  if (mode === 'cancelled') controller.abort(Error('PRIVATE_ABORT_REASON'));
  await closed; await assert.rejects(meter.close(), /Invalid cloud cost remote measurement/);
  evidence(meter, mode);
});

test('remoteRetainsConnectionLimitWithoutPublishingTheCompletedPrefix', {timeout: 3000}, async t => {
  const meter = await fixture(t, socket => {socket.resume(); socket.once('end', () => socket.end('ok'));}, {maxConnections: 1});
  await exchange(t, meter); await exchange(t, meter);
  await assert.rejects(meter.close(), /Invalid cloud cost remote measurement/);
  evidence(meter, 'admission-refused');
  assert.throws(() => meter.snapshot(), /Invalid cloud cost remote measurement/);
});

// Inject only the socket boundary fault; connection, forwarding and refusal stay real.
for (const [mode, expected] of [
  ['incomplete', 'incomplete-upstream'], ['mismatch', 'counter-mismatch'],
  ['EPIPE', 'socket-upstream-pipe'], ['ECONNREFUSED', 'socket-upstream-refused'],
  ['PRIVATE_CODE', 'socket-upstream-other'], ['accessor', 'socket-upstream-other'],
]) test('remoteClassifiesBoundaryFailureWithoutRawErrorInspection_' + mode, {timeout: 3000}, async t => {
  let upstream, admitted;
  const ready = new Promise(resolve => {admitted = resolve;});
  const original = net.connect;
  net.connect = (...args) => {
    const socket = original(...args);
    if (typeof args[0] === 'object') {upstream = socket; socket.once('connect', admitted);}
    return socket;
  };
  syncBuiltinESMExports();
  t.after(() => {net.connect = original; syncBuiltinESMExports();});
  const meter = await fixture(t, socket => {socket.resume(); socket.once('end', () => socket.end('ok'));});
  let reads = 0;
  if (mode === 'mismatch') {
    const written = Object.getOwnPropertyDescriptor(net.Socket.prototype, 'bytesWritten').get;
    // Set the differing counter after the relay creates its outgoing socket.
    const done = exchange(t, meter); await ready;
    Object.defineProperty(upstream, 'bytesWritten', {get() {return written.call(this) + 1;}});
    await done;
  } else {
    const client = connect(meter.port, '127.0.0.1'); client.on('error', () => {});
    t.after(() => client.destroy());
    const closed = new Promise(resolve => client.once('close', resolve));
    await ready;
    if (mode === 'incomplete') upstream.destroy();
    else {
      const error = Error('PRIVATE_ERROR_MESSAGE');
      if (mode === 'accessor') Object.defineProperty(error, 'code', {get() {reads++; throw Error('PRIVATE_GETTER');}});
      else error.code = mode;
      upstream.emit('error', error);
    }
    await closed;
  }
  await assert.rejects(meter.close(), /Invalid cloud cost remote measurement/);
  evidence(meter, expected); assert.equal(reads, 0);
  upstream.emit('error', Object.assign(Error('PRIVATE_LATER_ERROR'), {code: 'ECONNRESET'}));
  evidence(meter, expected);
  assert.doesNotMatch(meter.failure(), /PRIVATE/);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost remote measurement/);
});
