import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter, createMeteringProxy, classifyStorageOperation } from './meter.mjs';
import { createLitestreamTransport, createLitestreamAfterStop, createLitestreamRequestAudit, withLitestreamCloseDiagnostics } from './litestream.mjs';

// Removing response-pipeline body context must lose the distinction between a complete upstream and a truncated one.
for (const acknowledged of [false, true]) test(`a client close after upstream completion retains response-pipeline body evidence: stop acknowledged=${acknowledged}`, { timeout: 5000 }, async t => {
  let endReached, refused, received, clientSocket;
  const dataReceived = new Promise(resolve => { received = resolve; });
  const ended = new Promise(resolve => { endReached = resolve; });
  const invalidated = new Promise(resolve => { refused = resolve; });
  const backend = createServer((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(200, { 'content-length': 4 }); res.end('list'); });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const afterStop = acknowledged ? createLitestreamAfterStop({ clock: () => 0 }) : undefined;
  const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
  const meter = createMeter({ phase: 'workload', clock: () => 0, ...(afterStop ? { afterStop } : {}) });
  const observer = await createMeteringProxy({ target: `http://127.0.0.1:${backend.address().port}`, meter,
    classify: input => audit.observe({ headers: input.headers, operation: classifyStorageOperation(input) }) });
  t.after(() => observer.close().catch(() => {}));
  const front = await createLitestreamTransport({ target: observer.url, phase: 'workload', afterStop,
    meter: { ...meter, invalidate() { meter.invalidate(); refused(); } } });
  t.after(() => front.close().catch(() => {}));
  const emit = Server.prototype.emit;
  t.mock.method(Server.prototype, 'emit', function(event, ...args) {
    if (event === 'request' && args[0].socket.localPort === Number(new URL(front.url).port)) {
      // Hold only downstream completion, after real upstream bytes have traversed the counter.
      t.mock.method(args[1], 'end', function() { endReached(); return this; });
    }
    return emit.call(this, event, ...args);
  });
  audit.write(Buffer.from('SDK now DEBUG Request\nGET /PRIVATE_CANARY?list-type=2 HTTP/1.1\namz-sdk-invocation-id: 11111111-2222-4333-8444-555555555555\namz-sdk-request: attempt=1; max=3\n\n'));
  const client = request(front.url + '/PRIVATE_CANARY?list-type=2', { headers: {
    'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=3',
  } }, response => { response.on('error', () => {}); response.once('data', received); response.resume(); });
  client.on('error', () => {}); client.once('socket', socket => { clientSocket = socket; });
  t.after(() => { client.destroy(); clientSocket?.destroy(); }); client.end();
  await ended; await dataReceived;
  if (acknowledged) afterStop.acknowledgeStop({ statusCode: 200, ownedPath: '/PRIVATE_CANARY.db',
    body: Buffer.from(JSON.stringify({ status: 'stopped', path: '/PRIVATE_CANARY.db', txid: 0 })) });
  clientSocket.end(); await invalidated;
  const diagnostic = front.checkpoint();
  assert.equal(diagnostic.reason, 'transfer-interrupted');
  assert.equal(diagnostic.ioEvent, 'response-pipeline');
  assert.equal(diagnostic.code, 'ERR_STREAM_PREMATURE_CLOSE');
  assert.equal(diagnostic.operation, 'list');
  assert.equal(diagnostic.bytesIn, 4);
  assert.equal(diagnostic.expectedIn, 4);
  assert.equal(diagnostic.bytesOut, 0);
  assert.equal(diagnostic.expectedOut, 0);
  assert.equal(diagnostic.statusCode, 200);
  assert.equal(diagnostic.requestComplete, true);
  assert.equal(diagnostic.responseComplete, true);
  assert.equal(diagnostic.requestSent, true);
  assert.equal(diagnostic.responseReceived, false);
  assert.equal(diagnostic.clientClosed, true);
  assert.equal(diagnostic.pending, 0);
  assert.equal(diagnostic.completed, 1);
  assert.throws(() => front.snapshot(), /Invalid cloud cost Litestream audit/);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  if (afterStop) assert.throws(() => afterStop.snapshot(), /Invalid cloud cost Litestream audit/);
  assert.deepEqual(diagnostic.accounting.producer, { attempts: 1, bytesIn: 4, bytesOut: 0 });
  assert.deepEqual(diagnostic.accounting.observer, { attempts: 1, bytesIn: 4, bytesOut: 0 });
  assert.deepEqual(diagnostic.accounting.outcomes, [
    { hop: 'producer', outcome: 'transport-error', attempts: 1 },
    { hop: 'observer', outcome: 'success', attempts: 1 },
  ]);
  const records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => front.close(),
    report: line => records.push(JSON.parse(line)) }), /Invalid cloud cost Litestream audit/);
  for (const key of ['bytesIn', 'expectedIn', 'bytesOut', 'expectedOut', 'statusCode', 'requestComplete', 'responseComplete',
    'requestSent', 'responseReceived', 'clientClosed']) assert.equal(records.at(-1).diagnostic[key], diagnostic[key], key);
  assert.doesNotMatch(JSON.stringify([diagnostic, records]), /PRIVATE_CANARY|11111111|amz-sdk/);
});
