import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter, createMeteringProxy, classifyStorageOperation } from './meter.mjs';
import { createLitestreamTransport, createLitestreamAfterStop, createLitestreamRequestAudit, withLitestreamCloseDiagnostics } from './litestream.mjs';

// A complete upstream response must remain visible when downstream completion is interrupted.
for (const acknowledged of [false, true]) test(`a client close after upstream completion retains response-pipeline body evidence: stop acknowledged=${acknowledged}`, { timeout: 5000 }, async t => {
  let endReached, settled, received, clientSocket;
  const dataReceived = new Promise(resolve => { received = resolve; });
  const ended = new Promise(resolve => { endReached = resolve; });
  const settlement = new Promise(resolve => { settled = resolve; });
  const backend = createServer((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(200, { 'content-length': 4 }); res.end('list'); });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
  const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop });
  const observer = await createMeteringProxy({ target: `http://127.0.0.1:${backend.address().port}`, meter,
    classify: input => audit.observe({ headers: input.headers, operation: classifyStorageOperation(input) }) });
  t.after(() => observer.close().catch(() => {}));
  const front = await createLitestreamTransport({ target: observer.url, phase: 'workload', afterStop,
    meter: { ...meter, observeAttempt(event, interruption) {
      try { return meter.observeAttempt(event, interruption); }
      finally { if (event.channel === 'producer' && event.outcome === 'transport-error') settled(); }
    } } });
  t.after(() => front.close().catch(() => {}));
  if (acknowledged) afterStop.acknowledgeStop({ statusCode: 200, ownedPath: '/PRIVATE_CANARY.db',
    body: Buffer.from(JSON.stringify({ status: 'stopped', path: '/PRIVATE_CANARY.db', txid: 0 })) });
  const primerId = 'aaaaaaaa-2222-4333-8444-555555555555';
  audit.write(Buffer.from(`SDK now DEBUG Request\nGET /PRIVATE_CANARY?list-type=2 HTTP/1.1\namz-sdk-invocation-id: ${primerId}\namz-sdk-request: attempt=1; max=3\n\n`));
  await new Promise((resolve, reject) => {
    const primer = request(front.url + '/PRIVATE_CANARY?list-type=2', { headers: {
      'amz-sdk-invocation-id': primerId, 'amz-sdk-request': 'attempt=1; max=3',
    } }, response => { response.on('error', reject); response.on('end', resolve); response.resume(); });
    primer.on('error', reject); primer.end();
  });
  await front.whenIdle(() => {});
  assert.equal(afterStop.snapshot().lateAdmissions, acknowledged ? 1 : 0, 'storage admission must observe the validated stop');
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
  clientSocket.end(); await settlement;
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
  assert.equal(diagnostic.completed, 2);
  assert.throws(() => front.snapshot(), /Invalid cloud cost Litestream audit/);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  assert.throws(() => afterStop.snapshot(), /Invalid cloud cost Litestream audit/);
  assert.deepEqual(diagnostic.accounting.producer, { attempts: 2, bytesIn: 8, bytesOut: 0 });
  assert.deepEqual(diagnostic.accounting.observer, { attempts: 2, bytesIn: 8, bytesOut: 0 });
  assert.deepEqual(diagnostic.accounting.outcomes, [
    { hop: 'producer', outcome: 'success', attempts: 1 },
    { hop: 'producer', outcome: 'transport-error', attempts: 1 },
    { hop: 'observer', outcome: 'success', attempts: 2 },
  ]);
  const records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => front.close(),
    report: line => records.push(JSON.parse(line)) }), /Invalid cloud cost Litestream audit/);
  for (const key of ['bytesIn', 'expectedIn', 'bytesOut', 'expectedOut', 'statusCode', 'requestComplete', 'responseComplete',
    'requestSent', 'responseReceived', 'clientClosed']) assert.equal(records.at(-1).diagnostic[key], diagnostic[key], key);
  assert.doesNotMatch(JSON.stringify([diagnostic, records]), /PRIVATE_CANARY|11111111|aaaaaaaa|amz-sdk/);
});
