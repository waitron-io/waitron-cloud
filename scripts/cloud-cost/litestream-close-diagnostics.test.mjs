import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import * as stream from './litestream.mjs';
import { createMeter } from './meter.mjs';

async function observe(stage, close, records) {
  assert.equal(typeof stream.withLitestreamCloseDiagnostics, 'function', 'close outcomes must be reported');
  return stream.withLitestreamCloseDiagnostics({ stage, close, report: record => records.push(JSON.parse(record)) });
}

test('close diagnostics preserve success and identify each close', async () => {
  const records = [], result = {};
  assert.equal(await observe('replication-transport', async () => result, records), result);
  assert.deepEqual(records, [
    { kind: 'litestream-close', stage: 'replication-transport', status: 'started' },
    { kind: 'litestream-close', stage: 'replication-transport', status: 'fulfilled' },
  ]);
});

test('a rejected close reports a safe reason and rethrows the original error', async () => {
  const records = [], error = Error('PRIVATE path=/state/secret Authorization=secret');
  await assert.rejects(observe('restore-transport', () => { throw error; }, records), e => e === error);
  assert.deepEqual(records, [
    { kind: 'litestream-close', stage: 'restore-transport', status: 'started' },
    { kind: 'litestream-close', stage: 'restore-transport', status: 'rejected', error: 'unclassified' },
  ]);
  assert.equal(JSON.stringify(records).includes('PRIVATE'), false);
});

test('cleanup closes report separately without swallowing either rejection', async () => {
  const records = [], first = Error('PRIVATE first'), second = Error('PRIVATE second');
  const results = await Promise.allSettled([
    observe('cleanup-replication-transport', async () => { throw first; }, records),
    observe('cleanup-restore-transport', async () => { throw second; }, records),
  ]);
  assert.equal(results[0].reason, first); assert.equal(results[1].reason, second);
  assert.deepEqual(records.filter(r => r.status === 'rejected').map(r => r.stage),
    ['cleanup-replication-transport', 'cleanup-restore-transport']);
});

test('unknown fields and accessors cannot disclose error content', async () => {
  const records = []; let reads = 0;
  const error = Object.defineProperty(Error('PRIVATE'), 'litestreamCloseDiagnostic', { get() { reads++; throw Error('PRIVATE'); } });
  await assert.rejects(observe('restore-transport', async () => { throw error; }, records), e => e === error);
  assert.equal(reads, 0); assert.equal(JSON.stringify(records).includes('PRIVATE'), false);
  const forged = Object.assign(Error('PRIVATE'), { litestreamCloseDiagnostic: { reason: 'PRIVATE', pending: 'PRIVATE', completed: -1 } });
  await assert.rejects(observe('restore-transport', async () => { throw forged; }, records), e => e === forged);
  assert.equal(JSON.stringify(records).includes('PRIVATE'), false);
});

async function fixture(t, handler = (req, res) => { req.resume(); res.end(); }) {
  const backend = createServer(handler); backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const transport = await stream.createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload' });
  t.after(() => transport.close().catch(() => {}));
  return { transport, meter };
}
const headers = { 'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=3' };
function send(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url + '/PRIVATE_BUCKET/PRIVATE_KEY', { method: 'PUT', ...options }, res => {
      res.on('error', reject); res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end();
  });
}

test('invalid request retains the first refusal through repeated cleanup closes', async t => {
  const { transport, meter } = await fixture(t), records = [];
  assert.equal(await send(transport.url), 400);
  await assert.rejects(observe('replication-transport', () => transport.close(), records), /Invalid cloud cost Litestream audit/);
  await assert.rejects(observe('cleanup-replication-transport', () => transport.close(), records), /Invalid cloud cost Litestream audit/);
  assert.deepEqual(records.filter(r => r.status === 'rejected').map(r => r.diagnostic), [
    { reason: 'request-validation', pending: 0, completed: 0, connections: 0 },
    { reason: 'request-validation', pending: 0, completed: 0, connections: 0 },
  ]);
  assert.equal(JSON.stringify(records).includes('PRIVATE'), false);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
});

test('an unfinished response reports active-close and still refuses accounting', async t => {
  let entered; const received = new Promise(resolve => { entered = resolve; });
  const { transport, meter } = await fixture(t, (req, res) => { req.resume(); res.writeHead(200); res.write('partial'); entered(); });
  const pending = send(transport.url, { headers }).catch(() => {});
  // The response is deliberately incomplete; consume its error so the client also settles.
  const records = []; await received;
  await assert.rejects(observe('restore-transport', () => transport.close(), records), /Invalid cloud cost Litestream audit/);
  assert.equal(records.at(-1).diagnostic.reason, 'active-close');
  assert.equal(records.at(-1).diagnostic.pending, 0);
  assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  await pending;
});

// A completed HTTP exchange can still fail the independent lifetime or byte evidence.
for (const origin of ['lifetime-completion', 'body-accounting']) {
  test(`close identifies ${origin} without disclosing the rejected payload`, async t => {
    const backend = createServer((req, res) => { req.resume(); req.on('end', () => res.end()); });
    backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
    t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
    const meter = createMeter({ phase: 'workload', clock: () => 0 });
    const refuse = () => { throw Error('PRIVATE canary'); };
    const front = await stream.createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, phase: 'workload',
      meter: origin === 'body-accounting' ? { observeAttempt: refuse, invalidate: () => meter.invalidate() } : meter,
      ...(origin === 'lifetime-completion' ? { lifetimes: { begin: () => refuse } } : {}) });
    t.after(() => front.close().catch(() => {}));
    assert.equal(await send(front.url, { headers }), 200);
    const records = [];
    await assert.rejects(observe('replication-transport', () => front.close(), records), /Invalid cloud cost Litestream audit/);
    assert.equal(records.at(-1).diagnostic.reason, origin);
    assert.equal(records.at(-1).diagnostic.completed, 1);
    assert.equal(JSON.stringify(records).includes('PRIVATE'), false);
    assert.throws(() => meter.snapshot(), /Invalid cloud cost meter/);
  });
}
