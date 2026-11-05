import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter } from './meter.mjs';
import { createLitestreamTransport } from './litestream.mjs';
import { checkpointTransportDiagnostic, workerFailureTrace } from './worker-diagnostic.mjs';

// Removing socket-count forwarding hides how many validated requests belonged to the failed socket.
test('a real reset after request settlement retains zero forwarding requests through the worker', { timeout: 5000 }, async t => {
  const backend = createServer((req, res) => { req.resume(); req.on('end', () => res.end('ok')); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  let invalidate;
  const invalidated = new Promise(resolve => { invalidate = resolve; });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, phase: 'workload',
    meter: { observeAttempt: meter.observeAttempt, invalidate() { meter.invalidate(); invalidate(); } } });
  t.after(() => front.close().catch(() => {}));
  const agent = new Agent({ keepAlive: true }); t.after(() => agent.destroy());
  let socket;
  assert.equal(await new Promise((resolve, reject) => {
    const caller = request(front.url + '/PRIVATE_BUCKET?list-type=2', { agent, headers: {
      'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=3',
    } }, response => { response.on('error', reject); response.resume(); response.on('end', () => resolve(response.statusCode)); });
    caller.on('socket', value => { socket = value; }); caller.on('error', reject); caller.end();
  }), 200);
  await front.whenIdle(() => {});
  assert.equal(front.checkpoint().completed, 1); assert.equal(front.checkpoint().pending, 0);
  socket.resetAndDestroy(); await invalidated;
  const trace = workerFailureTrace(JSON.parse(JSON.stringify([checkpointTransportDiagnostic(front.checkpoint())])));
  assert.deepEqual(trace, [{ kind: 'checkpoint-transport', reason: 'client-error', validationStage: 'none',
    pending: 0, completed: 1, ioEvent: 'client-error', code: 'ECONNRESET', forwardingTransfers: 0 }]);
  assert.doesNotMatch(JSON.stringify(trace), /PRIVATE|127\.0\.0\.1|11111111|amz-sdk/);
  assert.throws(() => front.snapshot(), /Invalid cloud cost Litestream audit/);
  await assert.rejects(front.close(), /Invalid cloud cost Litestream audit/);
});

const base = { kind: 'checkpoint-transport', reason: 'client-error', validationStage: 'none', pending: 1, completed: 2 };
for (const count of [0, 1, 2, 1000000000]) test(`socket forwarding count ${count} survives serialization without changing the failure`, () => {
  const expected = { ...base, forwardingTransfers: count };
  assert.deepEqual(checkpointTransportDiagnostic(expected), expected);
  assert.deepEqual(workerFailureTrace(JSON.parse(JSON.stringify([expected]))), [expected]);
});
for (const value of [-1, 0.5, 1000000001, 'PRIVATE_COUNT', null]) test(`socket forwarding count rejects ${value}`, () => {
  const input = { ...base, forwardingTransfers: value };
  assert.deepEqual(checkpointTransportDiagnostic(input), base);
  assert.throws(() => workerFailureTrace([input]), { message: 'Invalid cloud cost worker diagnostic' });
});
test('socket counts cannot execute accessors or inherit private values', () => {
  let reads = 0;
  const input = Object.defineProperty({ ...base }, 'forwardingTransfers', { enumerable: true,
    get() { reads++; throw Error('PRIVATE_GETTER'); } });
  assert.deepEqual(checkpointTransportDiagnostic(input), base);
  assert.throws(() => workerFailureTrace([input]), { message: 'Invalid cloud cost worker diagnostic' });
  assert.equal(reads, 0);
  assert.deepEqual(checkpointTransportDiagnostic(Object.assign(Object.create({ forwardingTransfers: 1 }), base)), base);
});
