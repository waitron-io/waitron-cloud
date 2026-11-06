import { test } from 'node:test';
import assert from 'node:assert/strict';
import net, { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { openRemoteMeasurement } from './remote.mjs';
import { assessAccounting } from './accounting-policy.mjs';

const bad = { message: 'Invalid cloud cost remote measurement' };

async function fixture(t, mode, options = {}) {
  const sockets = new Set(), received = [];
  const server = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    const chunks = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.once('end', () => { received.push(Buffer.concat(chunks).toString()); socket.end('reply'); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const targetPort = server.address().port;
  const original = net.connect, originalServer = net.createServer;
  if (mode === 'missing-client-read' || mode === 'zero-client-read') net.createServer = (options, handle) => originalServer(options, socket => {
    Object.defineProperty(socket, 'bytesRead', { value: mode === 'missing-client-read' ? undefined : 0 }); handle(socket);
  });
  let upstreams = 0;
  net.connect = (...args) => {
    const socket = original(...args);
    if (args[0]?.port === targetPort && (++upstreams === 1 || mode === 'balanced') && !mode.includes('client')) {
      const property = mode === 'missing-read' ? 'bytesRead' : 'bytesWritten';
      const read = Object.getOwnPropertyDescriptor(net.Socket.prototype, property).get;
      const offset = mode === 'balanced' && upstreams === 2 ? -1 : 1;
      if (mode !== 'clean') Object.defineProperty(socket, property, { get() {
        if (mode.startsWith('missing')) return undefined;
        if (mode === 'overflow') return Number.MAX_SAFE_INTEGER;
        if (mode === 'invalid') return -1;
        return read.call(this) + offset;
      } });
    }
    return socket;
  };
  syncBuiltinESMExports();
  const meter = await openRemoteMeasurement({ target: `tcp://127.0.0.1:${targetPort}`, audience: 'staff', ...options });
  t.after(async () => {
    net.connect = original; net.createServer = originalServer; syncBuiltinESMExports();
    await meter.close().catch(() => {});
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { meter, received };
}

async function exchange(port, body) {
  const socket = connect({ host: '127.0.0.1', port, allowHalfOpen: true });
  const chunks = []; socket.on('data', chunk => chunks.push(chunk));
  socket.once('end', () => socket.end());
  const closed = once(socket, 'close'); socket.end(body); await closed;
  return Buffer.concat(chunks).toString();
}

test('remoteEqualGrandTotalsCannotEraseAnEarlierConnectionDisagreement', { timeout: 3000 }, async t => {
  const { meter, received } = await fixture(t, 'balanced');
  assert.equal(await exchange(meter.port, 'first'), 'reply');
  assert.equal(await exchange(meter.port, 'second'), 'reply');
  assert.deepEqual(received, ['first', 'second']);
  await assert.doesNotReject(meter.close());
  const snapshot = meter.snapshot();
  assert.deepEqual(snapshot.producer, { connections: 2, bytesToGateway: 11, bytesFromGateway: 10 });
  assert.deepEqual(snapshot.observer, snapshot.producer);
  assert.equal(snapshot.status, 'unknown'); assert.equal(snapshot.reconciled, false);
  assert.deepEqual(snapshot.gaps, ['accounting:meter-disagreement']);
  assert.equal(assessAccounting({ producer: 'remote', sources: [{ scope: 'remote', record: snapshot }] }).publicationEligible, false);
});

for (const mode of ['missing-client-read', 'zero-client-read'])
test('remoteUsesActualForwardingForNonemptyAdmission_' + mode, { timeout: 3000 }, async t => {
  const { meter, received } = await fixture(t, mode);
  assert.equal(await exchange(meter.port, 'first'), 'reply');
  assert.deepEqual(received, ['first']);
  await assert.doesNotReject(meter.close(), 'missing observations do not erase actual forwarded bytes');
  const snapshot = meter.snapshot();
  assert.equal(snapshot.status, 'unknown'); assert.equal(snapshot.reconciled, false);
  assert.equal(snapshot.producer.bytesToGateway, mode === 'missing-client-read' ? null : 0);
  assert.equal(snapshot.observer.bytesToGateway, 5);
  assert.equal(assessAccounting({ producer: 'remote', sources: [{ scope: 'remote', record: snapshot }] }).publicationEligible, false);
});

// Removing the accounting/lifecycle split makes a completed exchange fail close;
// using counter availability for admission also prevents its independent reconnect.
for (const mode of ['mismatch', 'missing-write', 'missing-read', 'overflow'])
test('remoteAccountingGapPreservesCompletedJourney_' + mode, { timeout: 3000 }, async t => {
  const { meter, received } = await fixture(t, mode);
  assert.equal(await exchange(meter.port, 'first'), 'reply');
  await assert.doesNotReject(async () => {
    assert.equal(await exchange(meter.port, 'second'), 'reply');
  }, 'an earlier accounting gap cannot prevent the reconnect');
  assert.deepEqual(received, ['first', 'second'], 'the backend independently receives both complete requests');
  await assert.doesNotReject(meter.close(), 'cost observations cannot refuse completed transport');
  const snapshot = meter.snapshot();
  assert.equal(snapshot.status, 'unknown'); assert.equal(snapshot.reconciled, false);
  assert.deepEqual(snapshot.producer, { connections: 2, bytesToGateway: 11, bytesFromGateway: 10 });
  assert.deepEqual(snapshot.observer, { connections: 2,
    bytesToGateway: mode === 'mismatch' ? 12 : mode === 'missing-read' ? 11 : null,
    bytesFromGateway: mode === 'missing-read' ? null : 10 });
  assert.deepEqual(snapshot.discrepancy, { connections: 0,
    bytesToGateway: mode === 'mismatch' ? 1 : mode === 'missing-read' ? 0 : null,
    bytesFromGateway: mode === 'missing-read' ? null : 0 });
  assert.ok(Array.isArray(snapshot.gaps), 'unknown accounting retains its named gaps');
  assert.ok(snapshot.gaps.includes(mode === 'overflow' ? 'accounting:overflow'
    : mode.startsWith('missing') ? 'accounting:incomplete-total' : 'accounting:meter-disagreement'));
  const assessment = assessAccounting({ producer: 'remote', sources: [{ scope: 'remote', record: snapshot }] });
  assert.equal(assessment.status, 'unknown'); assert.equal(assessment.publicationEligible, false);
  assert.equal(meter.failure(), 'none', 'a cost gap is not a transport refusal');
  assert.doesNotMatch(JSON.stringify(snapshot), /first|second|reply|127\.0\.0\.1/);
  snapshot.gaps.length = 0;
  assert.ok(meter.snapshot().gaps.length > 0, 'detached reads cannot erase the original gap');
  await assert.rejects(exchange(meter.port, 'closed'));
});

test('remoteMalformedIndividualCounterStillRefusesCompletedTransport', { timeout: 3000 }, async t => {
  const { meter, received } = await fixture(t, 'invalid');
  assert.equal(await exchange(meter.port, 'first'), 'reply');
  assert.deepEqual(received, ['first']);
  await assert.rejects(meter.close(), bad); assert.throws(() => meter.snapshot(), bad);
});

for (const mode of ['bytes', 'connections'])
test('remoteAccountingGapCannotHideARealLimit_' + mode, { timeout: 3000 }, async t => {
  const { meter, received } = await fixture(t, 'mismatch', mode === 'bytes' ? { maxBytes: 11 } : { maxConnections: 1 });
  assert.equal(await exchange(meter.port, 'first'), 'reply');
  assert.deepEqual(received, ['first']);
  await exchange(meter.port, 'second').catch(() => {});
  await assert.rejects(meter.close(), bad); assert.throws(() => meter.snapshot(), bad);
  assert.equal(meter.failure(), mode === 'bytes' ? 'byte-limit' : 'admission-refused');
});
