import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';
import { createLitestreamTransport } from './litestream.mjs';
import { createMeter } from './meter.mjs';

// A held backend reply must remain distinguishable from an unfinished upload without exporting its identity.
test('pending transport diagnostics show upload and reply progress without private request data', async t => {
  let arrived;
  const ready = new Promise(resolve => { arrived = resolve; });
  const backend = createServer((req, res) => { req.resume(); req.once('end', () => arrived(res)); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: 'http://127.0.0.1:' + backend.address().port, meter, phase: 'workload' });
  t.after(() => front.close().catch(() => {}));
  const client = request(front.url + '/PRIVATE_BUCKET/PRIVATE_OBJECT', { method: 'PUT', headers: {
    'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=3',
    'content-length': '5', authorization: 'PRIVATE_AUTHORIZATION',
  } });
  client.on('error', () => {}); t.after(() => client.destroy());
  const completed = new Promise((resolve, reject) => {
    client.once('error', reject);
    client.once('response', response => { response.resume(); response.once('end', resolve); response.once('error', reject); });
  });
  completed.catch(() => {});
  client.end('hello'); const response = await ready;
  assert.equal(typeof front.pendingTransfers, 'function', 'show which part of an active transfer is still waiting');
  let rows = front.pendingTransfers();
  assert.equal(rows.length, 1);
  const { elapsedMs, ...progress } = rows[0];
  assert.ok(Number.isInteger(elapsedMs) && elapsedMs >= 0);
  assert.deepEqual(progress, { operation: 'put', phase: 'workload', retryOrdinal: 0,
    bytesOut: 5, expectedOut: 5, bytesIn: 0, expectedIn: 0,
    requestSent: true, responseReceived: false, statusCode: null, clientClosed: false });
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|11111111|127\.0\.0\.1|hello/);
  rows[0].operation = 'PRIVATE_MUTATION'; rows.length = 0;
  assert.equal(front.pendingTransfers()[0].operation, 'put', 'diagnostic snapshots cannot alter the active request');
  response.writeHead(200, { 'content-length': '2' }); response.write('o');
  const firstByte = once(client, 'response');
  await firstByte; await turn();
  rows = front.pendingTransfers();
  assert.equal(rows[0].statusCode, 200); assert.equal(rows[0].bytesIn, 1); assert.equal(rows[0].expectedIn, 2);
  assert.equal(rows[0].responseReceived, false);
  response.end('k'); await completed; await front.whenIdle(() => {});
  assert.deepEqual(front.pendingTransfers(), []);
  assert.equal(front.checkpoint().completed, 1);
});
