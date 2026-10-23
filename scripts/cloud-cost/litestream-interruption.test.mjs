import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
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
