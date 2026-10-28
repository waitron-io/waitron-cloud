import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter } from './meter.mjs';
import { createLitestreamAfterStop, createLitestreamTransport, withLitestreamCloseDiagnostics } from './litestream.mjs';

const headers = { 'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555',
  'amz-sdk-request': 'attempt=1; max=3' };
const bad = /Invalid cloud cost Litestream audit/;

async function fixture(t, options = {}) {
  let forwarded = 0;
  const backend = createServer((req, res) => { forwarded++; req.resume(); req.on('end', () => res.end()); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop: options.afterStop });
  const transport = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`,
    meter, phase: 'workload', ...options });
  t.after(() => transport.close().catch(() => {}));
  const send = (options = {}) => new Promise((resolve, reject) => {
    const req = request(transport.url + (options.path ?? '/PRIVATE_CANARY/key'),
      { method: 'PUT', ...options, headers: { ...headers, authorization: 'PRIVATE_CANARY', ...options.headers } }, res => {
        res.on('error', reject); res.resume(); res.on('end', () => resolve(res.statusCode));
      });
    req.on('error', reject); req.end();
  });
  return { meter, transport, send, forwarded: () => forwarded };
}

// The real HTTP boundary must distinguish refused checks without accepting or forwarding the request.
for (const [stage, options, requestOptions] of [
  ['copy-source', {}, { headers: { 'x-amz-copy-source': '/PRIVATE_CANARY/source' } }],
  ['identity', {}, { headers: { 'amz-sdk-invocation-id': 'PRIVATE_CANARY' } }],
  ['operation', {}, { method: 'PATCH' }],
  ['retry-sequence', {}, { headers: { 'amz-sdk-request': 'attempt=2; max=3' } }],
  ['content-length', {}, { headers: { 'content-length': '9007199254740992' } }],
  ['mutation-body', { allowBulkDeletes: true }, { method: 'POST', path: '/PRIVATE_CANARY?delete', headers: { 'content-length': '1048577' } }],
  ['lifetime-begin', { lifetimes: { begin() { throw Error('PRIVATE_CANARY'); } } }, {}],
  ['lifetime-callback', { lifetimes: { begin() { return 'PRIVATE_CANARY'; } } }, {}],
]) test(`request validation names ${stage} while still refusing the request and accounting`, async t => {
  const f = await fixture(t, options);
  assert.equal(await f.send(requestOptions), 400);
  assert.equal(f.forwarded(), 0);
  assert.equal(f.transport.checkpoint().reason, 'request-validation');
  assert.equal(f.transport.checkpoint().validationStage, stage);
  const records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => f.transport.close(),
    report: line => records.push(JSON.parse(line)) }), bad);
  assert.equal(records.at(-1).diagnostic.reason, 'request-validation');
  assert.equal(records.at(-1).diagnostic.validationStage, stage);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  assert.doesNotMatch(JSON.stringify([f.transport.checkpoint(), records]), /PRIVATE_CANARY|11111111|amz-sdk|127\.0\.0\.1/);
});

test('an after-stop mutation identifies admission refusal without changing the stop rule', async t => {
  const afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const path = '/PRIVATE_CANARY.db';
  afterStop.acknowledgeStop({ statusCode: 200, ownedPath: path,
    body: Buffer.from(JSON.stringify({ status: 'stopped', path, txid: 0 })) });
  const f = await fixture(t, { afterStop });
  assert.equal(await f.send(), 400); assert.equal(f.forwarded(), 0);
  assert.equal(f.transport.checkpoint().validationStage, 'after-stop-admission');
  assert.throws(() => afterStop.snapshot(), bad);
  await assert.rejects(f.transport.close(), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

test('later refused requests and repeated cleanup retain the original validation boundary', async t => {
  const f = await fixture(t);
  assert.equal(await f.send({ method: 'PATCH' }), 400);
  assert.equal(await f.send({ headers: { 'amz-sdk-invocation-id': 'PRIVATE_CANARY' } }), 400);
  for (const stage of ['replication-transport', 'cleanup-replication-transport']) {
    const records = [];
    await assert.rejects(withLitestreamCloseDiagnostics({ stage, close: () => f.transport.close(),
      report: line => records.push(JSON.parse(line)) }), bad);
    assert.equal(records.at(-1).diagnostic.validationStage, 'operation');
  }
  assert.equal(f.forwarded(), 0);
});

test('successful requests have no validation refusal and still forward', async t => {
  const f = await fixture(t);
  assert.equal(await f.send(), 200);
  await f.transport.whenIdle(() => {});
  assert.equal(f.forwarded(), 1); assert.equal(f.transport.checkpoint().completed, 1);
  assert.equal(Object.hasOwn(f.transport.checkpoint(), 'validationStage'), false);
  await f.transport.close();
});

test('request validation cannot attach its stage to an earlier unrelated refusal', async t => {
  const f = await fixture(t);
  assert.throws(() => f.transport.setPhase('PRIVATE_CANARY'), bad);
  assert.equal(await f.send(), 400);
  assert.equal(f.transport.checkpoint().reason, 'phase-change');
  assert.equal(Object.hasOwn(f.transport.checkpoint(), 'validationStage'), false);
  await assert.rejects(f.transport.close(), bad);
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

test('published validation stages omit unknown values and never read accessors', async () => {
  let reads = 0;
  for (const diagnostic of [
    { reason: 'request-validation', validationStage: 'PRIVATE_CANARY' },
    { reason: 'request-validation', get validationStage() { reads++; throw Error('PRIVATE_CANARY'); } },
    { reason: 'client-error', validationStage: 'identity' },
  ]) {
    const error = Object.assign(Error('PRIVATE_CANARY'), { litestreamCloseDiagnostic: diagnostic }), records = [];
    await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => { throw error; },
      report: line => records.push(JSON.parse(line)) }), e => e === error);
    assert.equal(Object.hasOwn(records.at(-1).diagnostic, 'validationStage'), false);
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE_CANARY/);
  }
  assert.equal(reads, 0);
});
