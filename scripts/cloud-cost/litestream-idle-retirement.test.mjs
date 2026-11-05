import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { createMeter } from './meter.mjs';
import { createLitestreamTransport } from './litestream.mjs';

const request = 'GET /synthetic?list-type=2 HTTP/1.1\r\nHost: local\r\n'
  + 'amz-sdk-invocation-id: 11111111-2222-4333-8444-555555555555\r\n'
  + 'amz-sdk-request: attempt=1; max=3\r\n\r\n';
async function fixture(t, held = false) {
  let release, arrived, heldArrival;
  const heldRequest = new Promise(resolve => { heldArrival = resolve; });
  const received = new Promise(resolve => { arrived = resolve; });
  const backend = createServer((req, res) => {
    req.resume(); req.once('end', () => {
      release = () => res.end('four'); arrived(); if (!held) release(); else heldArrival();
    });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload' });
  t.after(() => front.close().catch(() => {}));
  let serverSocket;
  const incoming = [];
  const emit = Server.prototype.emit;
  t.mock.method(Server.prototype, 'emit', function(event, ...args) {
    if (event === 'connection' && args[0].localPort === Number(new URL(front.url).port)) incoming.push(args[0]);
    if (event === 'request' && args[0].socket.localPort === Number(new URL(front.url).port)) serverSocket = args[0].socket;
    return emit.call(this, event, ...args);
  });
  const client = connect(Number(new URL(front.url).port), '127.0.0.1');
  client.on('error', () => {}); t.after(() => client.destroy());
  await once(client, 'connect');
  return { front, meter, client, received, incoming, heldRequest, hold: () => { held = true; }, release: () => release(), serverSocket: () => serverSocket };
}

// Omitting retirement leaves an owned, completed socket exposed to the writer's exit reset.
for (const queued of [false, true]) test(`retirement closes settled storage sockets before the ${queued ? 'queued' : 'immediate'} stop action`, { timeout: 5000 }, async t => {
  const f = await fixture(t, queued), reply = once(f.client, 'data');
  f.client.write(request); await f.received;
  if (!queued) { await reply; await f.front.whenIdle(() => {}); }
  let called = false;
  const action = f.front.whenIdle(() => {
    called = true;
    assert.equal(f.serverSocket().destroyed, true, 'retire the owned socket before signalling');
    f.client.resetAndDestroy();
  }, { retireConnections: true });
  if (queued) { assert.equal(called, false); f.release(); }
  await action; assert.equal(called, true);
  await f.front.close();
  assert.equal(f.meter.snapshot().reconciled, false, 'the absent observer cannot manufacture measured evidence');
  assert.equal(f.front.checkpoint().completed, 1);
  assert.equal(f.front.checkpoint().reason, undefined);
});

test('retirement leaves a fresh connection available for its first request', { timeout: 5000 }, async t => {
  const f = await fixture(t), reply = once(f.client, 'data');
  f.client.write(request); await reply; await f.front.whenIdle(() => {});
  const fresh = connect(Number(new URL(f.front.url).port), '127.0.0.1');
  fresh.on('error', () => {}); t.after(() => fresh.destroy()); await once(fresh, 'connect');
  await f.front.whenIdle(() => {
    assert.equal(f.incoming.length, 2);
    assert.equal(f.incoming[1].destroyed, false);
    assert.equal(f.incoming[1].writableEnded, false);
  }, { retireConnections: true });
  const received = once(fresh, 'data');
  fresh.write(request.replace('11111111-2222-4333-8444-555555555555', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'));
  await received; await f.front.whenIdle(() => {});
  assert.equal(f.front.checkpoint().completed, 2);
  assert.equal(f.front.checkpoint().reason, undefined);
});

test('retirement waits for a request admitted while an older peer finishes closing', { timeout: 5000 }, async t => {
  const f = await fixture(t), reply = once(f.client, 'data');
  f.client.allowHalfOpen = true;
  f.client.write(request); await reply; await f.front.whenIdle(() => {});
  const halfClosed = once(f.client, 'end');
  let called = false;
  const draining = f.front.whenIdle(() => {
    called = true;
    assert.equal(f.incoming[1].destroyed, true, 'retire the later socket before signalling');
  }, { retireConnections: true });
  await halfClosed;
  f.hold();
  const next = connect(Number(new URL(f.front.url).port), '127.0.0.1');
  next.on('error', () => {}); t.after(() => next.destroy()); await once(next, 'connect');
  next.write(request.replace('11111111-2222-4333-8444-555555555555', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'));
  await f.heldRequest;
  const oldClosed = once(f.incoming[0], 'close');
  f.client.end(); await oldClosed;
  assert.equal(called, false, 'the later request still owns an unsettled reply');
  const completed = once(next, 'data');
  f.release(); await completed; await draining;
  assert.equal(called, true); assert.equal(f.front.checkpoint().completed, 2);
  assert.equal(f.front.checkpoint().reason, undefined);
});

test('retirement rechecks a later socket whose request finished before the old peer closed', { timeout: 5000 }, async t => {
  const f = await fixture(t), reply = once(f.client, 'data');
  f.client.allowHalfOpen = true;
  f.client.write(request); await reply; await f.front.whenIdle(() => {});
  const halfClosed = once(f.client, 'end');
  let called = false;
  const draining = f.front.whenIdle(() => {
    called = true;
    assert.equal(f.incoming[1].destroyed, true, 'recheck used connections after the first drain');
  }, { retireConnections: true });
  await halfClosed;
  const next = connect(Number(new URL(f.front.url).port), '127.0.0.1');
  next.on('error', () => {}); t.after(() => next.destroy()); await once(next, 'connect');
  const completed = once(next, 'data');
  next.write(request.replace('11111111-2222-4333-8444-555555555555', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'));
  await completed; await f.front.whenIdle(() => {});
  assert.equal(f.front.checkpoint().completed, 2); assert.equal(called, false);
  f.client.end(); await draining;
  assert.equal(called, true); assert.equal(f.front.checkpoint().reason, undefined);
});

// A later request on the half-closed connection must remain refused even if storage received it.
test('a request reusing a half-closed socket refuses before any stop signal', { timeout: 5000 }, async t => {
  const f = await fixture(t), reply = once(f.client, 'data');
  f.client.allowHalfOpen = true;
  f.client.write(request); await reply; await f.front.whenIdle(() => {});
  const halfClosed = once(f.client, 'end');
  let called = false;
  const rejected = assert.rejects(f.front.whenIdle(() => { called = true; }, { retireConnections: true }), /Invalid cloud cost Litestream audit/);
  await halfClosed; f.hold();
  f.client.write(request.replace('11111111-2222-4333-8444-555555555555', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'));
  await f.heldRequest; f.release(); f.client.end();
  await rejected;
  assert.equal(called, false); assert.equal(f.front.checkpoint().completed, 2);
  assert.equal(f.front.checkpoint().reason, 'transfer-interrupted');
  assert.equal(f.front.checkpoint().idleActionsAtAdmission, 2, 'idle callbacks include the drain before the stop action');
  await assert.rejects(f.front.close(), /Invalid cloud cost Litestream audit/);
});

// A partial next message must still reach the parser's refusal after the graceful half-close.
test('retirement refuses an unfinished next request without running the stop action', { timeout: 5000 }, async t => {
  const f = await fixture(t), reply = once(f.client, 'data');
  f.client.write(request); await reply; await f.front.whenIdle(() => {});
  let read;
  const partial = new Promise(resolve => { read = resolve; });
  f.serverSocket().once('data', read);
  const next = request.replace('11111111-2222-4333-8444-555555555555', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  f.client.write(next.slice(0, -4)); await partial;
  let called = false;
  await assert.rejects(f.front.whenIdle(() => { called = true; }, { retireConnections: true }), /Invalid cloud cost Litestream audit/);
  assert.equal(called, false);
  assert.equal(f.front.checkpoint().reason, 'client-error');
  assert.equal(f.front.checkpoint().completed, 1);
  await assert.rejects(f.front.close(), /Invalid cloud cost Litestream audit/);
});

// Retirement cannot turn an interrupted active reply into accepted accounting.
test('retirement still refuses an active request reset without running the stop action', { timeout: 5000 }, async t => {
  const f = await fixture(t, true);
  f.client.write(request); await f.received;
  let called = false;
  const rejected = assert.rejects(f.front.whenIdle(() => { called = true; }, { retireConnections: true }), /Invalid cloud cost Litestream audit/);
  f.client.resetAndDestroy(); f.release();
  await rejected; assert.equal(called, false);
  await assert.rejects(f.front.close(), /Invalid cloud cost Litestream audit/);
});

for (const value of [1, 'true', null]) test(`an invalid retirement choice ${JSON.stringify(value)} cannot close a socket or run an action`, async t => {
  const f = await fixture(t), reply = once(f.client, 'data');
  f.client.write(request); await reply; await f.front.whenIdle(() => {});
  let called = false;
  await assert.rejects(f.front.whenIdle(() => { called = true; }, { retireConnections: value }), /Invalid cloud cost Litestream audit/);
  assert.equal(called, false); assert.equal(f.serverSocket().destroyed, false);
});
