import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter } from './meter.mjs';
import { createLitestreamAfterStop, createLitestreamRequestAudit, createLitestreamTransport, withLitestreamCloseDiagnostics } from './litestream.mjs';

const bad = /Invalid cloud cost Litestream audit/;
const invocation = '11111111-2222-4333-8444-555555555555';
const input = (changes = {}) => ({ invocation, ordinal: 0, operation: 'put', hop: 'producer', phase: 'workload', ...changes });
const stop = s => s.acknowledgeStop({ statusCode: 200, ownedPath: '/PRIVATE_CANARY.db',
  body: Buffer.from(JSON.stringify({ status: 'stopped', path: '/PRIVATE_CANARY.db', txid: 0 })) });
const detail = value => ({ operation: value.afterStopAdmissionOperation, attemptClass: value.afterStopAdmissionAttemptClass });
const errorDetail = value => ({ operation: value.litestreamAfterStopAdmissionOperation, attemptClass: value.litestreamAfterStopAdmissionAttemptClass });
const privateText = /PRIVATE_CANARY|11111111|55555555|amz-sdk|127\.0\.0\.1/;

// Dropping the validated row context, misclassifying a retry, or stamping a later call must fail these cases.
for (const operation of ['put', 'get', 'head', 'delete', 'delete-many', 'multipart-create', 'multipart-upload', 'multipart-complete', 'multipart-abort']) {
  for (const [ordinal, attemptClass] of [[0, 'initial'], [1, 'retry']]) {
    test(`the first refused ${operation} ${attemptClass} retains its own categories across later poisoned calls`, () => {
      const s = createLitestreamAfterStop({ clock: () => 0 });
      if (ordinal) s.admit(input({ operation }));
      stop(s);
      for (const call of [input({ operation, ordinal }), input({ operation: 'list' })]) {
        assert.throws(() => s.admit(call), error => {
          assert.match(error.message, bad);
          assert.equal(error.litestreamAfterStopAdmissionGuard, 'post-stop-operation');
          assert.deepEqual(errorDetail(error), { operation, attemptClass });
          assert.doesNotMatch(JSON.stringify(error), privateText); return true;
        });
      }
      assert.throws(() => s.snapshot(), bad);
    });
  }
}

test('a refusal before row validation never acquires a later request context or reads an accessor', () => {
  const s = createLitestreamAfterStop({ clock: () => 0 }); let reads = 0;
  for (const call of [{ ...input(), get operation() { reads++; throw Error('PRIVATE_CANARY'); } }, input()]) {
    assert.throws(() => s.admit(call), error => {
      assert.equal(error.litestreamAfterStopAdmissionGuard, 'input');
      assert.deepEqual(errorDetail(error), { operation: undefined, attemptClass: undefined }); return true;
    });
  }
  assert.equal(reads, 0);
});

test('the independent observer audit carries the first shared row rather than a later observer input', () => {
  const s = createLitestreamAfterStop({ clock: () => 0 }); s.admit(input()); stop(s);
  const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop: s });
  const headers = { 'amz-sdk-invocation-id': invocation, 'amz-sdk-request': 'attempt=1; max=3', authorization: 'PRIVATE_CANARY' };
  assert.throws(() => audit.observe({ operation: 'put', headers }), bad);
  assert.deepEqual(detail(audit.checkpoint().failure), { operation: 'put', attemptClass: 'initial' });
  assert.throws(() => audit.observe({ operation: 'get', headers }), bad);
  assert.deepEqual(detail(audit.checkpoint().failure), { operation: 'put', attemptClass: 'initial' });
  assert.doesNotMatch(JSON.stringify(audit.checkpoint()), privateText); assert.throws(() => audit.snapshot(), bad);
});

async function fixture(t, afterStop) {
  let forwarded = 0;
  const backend = createServer((req, res) => { forwarded++; req.resume(); req.on('end', () => res.end()); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop });
  const transport = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, meter, phase: 'workload', afterStop });
  t.after(() => transport.close().catch(() => {}));
  const send = (ordinal = 0, method = 'PUT') => new Promise((resolve, reject) => {
    const req = request(transport.url + '/PRIVATE_CANARY/key', { method, headers: {
      'amz-sdk-invocation-id': invocation, 'amz-sdk-request': `attempt=${ordinal + 1}; max=3`, authorization: 'PRIVATE_CANARY',
    } }, res => { res.on('error', reject); res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  return { send, transport, meter, forwarded: () => forwarded };
}

for (const [ordinal, attemptClass] of [[0, 'initial'], [1, 'retry']]) {
  test(`real HTTP ${attemptClass} refusal reaches checkpoints and repeated sanitized close reports`, async t => {
    const s = createLitestreamAfterStop({ clock: () => 0 }), f = await fixture(t, s);
    if (ordinal) { assert.equal(await f.send(), 200); await f.transport.whenIdle(() => {}); }
    stop(s); assert.equal(await f.send(ordinal), 400); assert.equal(await f.send(0, 'PATCH'), 400);
    assert.equal(f.forwarded(), ordinal);
    assert.deepEqual(detail(f.transport.checkpoint()), { operation: 'put', attemptClass });
    for (const stage of ['replication-transport', 'cleanup-replication-transport']) {
      const records = [];
      await assert.rejects(withLitestreamCloseDiagnostics({ stage, close: () => f.transport.close(),
        report: line => records.push(JSON.parse(line)) }), bad);
      assert.deepEqual(detail(records.at(-1).diagnostic), { operation: 'put', attemptClass });
      assert.doesNotMatch(JSON.stringify([records, f.transport.checkpoint()]), privateText);
    }
    assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
  });
}

test('a later producer reports the earlier observer refusal operation without attaching its own metadata', async t => {
  const s = createLitestreamAfterStop({ clock: () => 0 });
  s.admit(input({ operation: 'get' })); stop(s);
  assert.throws(() => s.admit(input({ operation: 'get', hop: 'observer' })), bad);
  const f = await fixture(t, s); assert.equal(await f.send(), 400); assert.equal(f.forwarded(), 0);
  assert.deepEqual(detail(f.transport.checkpoint()), { operation: 'get', attemptClass: 'initial' });
  const records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => f.transport.close(),
    report: line => records.push(JSON.parse(line)) }), bad);
  assert.deepEqual(detail(records.at(-1).diagnostic), { operation: 'get', attemptClass: 'initial' });
});

const raw = changes => ({ reason: 'request-validation', validationStage: 'after-stop-admission',
  afterStopAdmissionGuard: 'post-stop-operation', afterStopAdmissionOperation: 'put', afterStopAdmissionAttemptClass: 'retry', ...changes });
test('close reporting publishes only fixed admission context while retaining the exact original error', async () => {
  const error = Object.assign(Error('PRIVATE_CANARY'), { litestreamCloseDiagnostic: raw({}) }), records = [];
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => { throw error; },
    report: line => records.push(JSON.parse(line)) }), e => e === error);
  assert.deepEqual(detail(records.at(-1).diagnostic), { operation: 'put', attemptClass: 'retry' });
  assert.doesNotMatch(JSON.stringify(records), privateText);
});

for (const [label, changes] of [
  ['wrong stage', { validationStage: 'identity' }], ['wrong reason', { reason: 'client-error' }],
  ['unknown guard', { afterStopAdmissionGuard: 'PRIVATE_CANARY' }],
  ['unknown operation', { afterStopAdmissionOperation: 'PRIVATE_CANARY' }],
  ['unknown attempt', { afterStopAdmissionAttemptClass: 'PRIVATE_CANARY' }],
]) test(`close reporting filters admission context with ${label}`, async () => {
  const records = [], error = Object.assign(Error('PRIVATE_CANARY'), { litestreamCloseDiagnostic: raw(changes) });
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => { throw error; },
    report: line => records.push(JSON.parse(line)) }), e => e === error);
  const d = records.at(-1).diagnostic;
  if (label === 'unknown operation') assert.equal(d.afterStopAdmissionOperation, undefined);
  else if (label === 'unknown attempt') assert.equal(d.afterStopAdmissionAttemptClass, undefined);
  else assert.deepEqual(detail(d), { operation: undefined, attemptClass: undefined });
  assert.doesNotMatch(JSON.stringify(records), privateText);
});

test('admission context readers skip getters and contain descriptor traps', async t => {
  let reads = 0;
  for (const key of ['litestreamAfterStopAdmissionOperation', 'litestreamAfterStopAdmissionAttemptClass']) {
    for (const throwingDescriptor of [false, true]) {
      let error = Object.assign(Error('PRIVATE_CANARY'), { litestreamAfterStopAdmissionGuard: 'post-stop-operation' });
      if (throwingDescriptor) error = new Proxy(error, { getOwnPropertyDescriptor(target, field) {
        if (field === key) throw Error('PRIVATE_CANARY'); return Reflect.getOwnPropertyDescriptor(target, field);
      } });
      else Object.defineProperty(error, key, { get() { reads++; throw Error('PRIVATE_CANARY'); } });
      const afterStop = { admit() { throw error; }, invalidate() {} }, audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
      assert.throws(() => audit.observe({ operation: 'put', headers: {
        'amz-sdk-invocation-id': invocation, 'amz-sdk-request': 'attempt=1; max=3',
      } }), bad);
      assert.deepEqual(detail(audit.checkpoint().failure), { operation: undefined, attemptClass: undefined });
      const f = await fixture(t, afterStop); assert.equal(await f.send(), 400);
      assert.deepEqual(detail(f.transport.checkpoint()), { operation: undefined, attemptClass: undefined });
      assert.doesNotMatch(JSON.stringify([audit.checkpoint(), f.transport.checkpoint()]), privateText);
    }
  }
  assert.equal(reads, 0);
});

test('a refusal before the post-stop checks keeps its existing context-free audit shape', () => {
  const s = createLitestreamAfterStop({ clock: () => 0 });
  const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop: s });
  assert.throws(() => audit.observe({ operation: 'list', headers: {
    'amz-sdk-invocation-id': invocation, 'amz-sdk-request': 'attempt=1; max=3',
  } }), bad);
  assert.deepEqual(audit.checkpoint().failure, { stage: 'after-stop-admission', afterStopAdmissionGuard: 'observer-pairing' });
});

test('a refused post-stop list retry retains its ordinal category', () => {
  const s = createLitestreamAfterStop({ clock: () => 0 }); s.admit(input({ operation: 'list' })); stop(s);
  assert.throws(() => s.admit(input({ operation: 'list', ordinal: 1 })), error => {
    assert.equal(error.litestreamAfterStopAdmissionGuard, 'post-stop-ordinal');
    assert.deepEqual(errorDetail(error), { operation: 'list', attemptClass: 'retry' }); return true;
  });
});

for (const [operation, attemptClass, expected] of [
  ['PRIVATE_CANARY', 'initial', { operation: undefined, attemptClass: 'initial' }],
  ['put', 'PRIVATE_CANARY', { operation: 'put', attemptClass: undefined }],
]) test(`audit and HTTP checkpoint filter untrusted ${operation === 'put' ? 'attempt' : 'operation'} categories`, async t => {
  const error = Object.assign(Error('PRIVATE_CANARY'), { litestreamAfterStopAdmissionGuard: 'post-stop-operation',
    litestreamAfterStopAdmissionOperation: operation, litestreamAfterStopAdmissionAttemptClass: attemptClass });
  const afterStop = { admit() { throw error; }, invalidate() {} }, audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
  assert.throws(() => audit.observe({ operation: 'put', headers: {
    'amz-sdk-invocation-id': invocation, 'amz-sdk-request': 'attempt=1; max=3',
  } }), bad);
  assert.deepEqual(detail(audit.checkpoint().failure), expected);
  const f = await fixture(t, afterStop); assert.equal(await f.send(), 400);
  assert.deepEqual(detail(f.transport.checkpoint()), expected);
  assert.doesNotMatch(JSON.stringify([audit.checkpoint(), f.transport.checkpoint()]), privateText);
});

test('close context skips accessor output and contains descriptor traps without changing the rejection', async () => {
  let reads = 0;
  for (const key of ['afterStopAdmissionOperation', 'afterStopAdmissionAttemptClass']) {
    for (const trap of [false, true]) {
      let diagnostic = raw({});
      if (trap) diagnostic = new Proxy(diagnostic, { getOwnPropertyDescriptor(target, field) {
        if (field === key) throw Error('PRIVATE_CANARY'); return Reflect.getOwnPropertyDescriptor(target, field);
      } });
      else Object.defineProperty(diagnostic, key, { get() { reads++; throw Error('PRIVATE_CANARY'); } });
      const error = Object.assign(Error('PRIVATE_CANARY'), { litestreamCloseDiagnostic: diagnostic }), records = [];
      await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => { throw error; },
        report: line => records.push(JSON.parse(line)) }), e => e === error);
      assert.equal(records.at(-1).diagnostic[key], undefined); assert.doesNotMatch(JSON.stringify(records), privateText);
      await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => { throw error; },
        report: () => { throw Error('REPORT_PRIVATE_CANARY'); } }), e => e === error);
    }
  }
  assert.equal(reads, 0);
});
