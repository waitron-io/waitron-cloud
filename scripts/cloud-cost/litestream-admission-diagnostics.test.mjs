import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter } from './meter.mjs';
import { createLitestreamAfterStop, createLitestreamRequestAudit, createLitestreamTransport, withLitestreamCloseDiagnostics } from './litestream.mjs';

const bad = /Invalid cloud cost Litestream audit/;
const invocation = n => `${n.toString(16).padStart(8, '0')}-2222-4333-8444-555555555555`;
const row = (changes = {}) => ({ invocation: invocation(1), ordinal: 0, operation: 'list', ...changes });
const admission = (changes = {}) => ({ ...row(), hop: 'producer', phase: 'workload', ...changes });
const stop = session => session.acknowledgeStop({ statusCode: 200, ownedPath: '/PRIVATE_CANARY.db',
  body: Buffer.from(JSON.stringify({ status: 'stopped', path: '/PRIVATE_CANARY.db', txid: 0 })) });

// Losing a label, accepting its refused input, or replacing the first cause must fail these controls.
for (const [guard, setup, input] of [
  ['state', s => s.invalidate(), admission()],
  ['input', () => {}, { ...admission(), private: 'PRIVATE_CANARY' }],
  ['hop-phase', () => {}, admission({ hop: 'PRIVATE_CANARY' })],
  ['row-metadata', () => {}, admission({ ordinal: -1 })],
  ['row-identity', () => {}, admission({ invocation: 'PRIVATE_CANARY' })],
  ['row-operation', s => s.issue(row({ operation: 'put' })), admission()],
  ['duplicate-hop', s => s.admit(admission()), admission()],
  ['retry-sequence', () => {}, admission({ ordinal: 1 })],
  ['observer-pairing', () => {}, admission({ hop: 'observer' })],
  ['observer-pairing', s => s.admit(admission()), admission({ hop: 'observer', phase: 'idle' })],
  ['post-stop-operation', stop, admission({ operation: 'put' })],
  ['post-stop-ordinal', s => { s.admit(admission()); stop(s); }, admission({ ordinal: 1 })],
  ['affected-cap', s => {
    stop(s);
    for (let n = 1; n <= 3; n++) {
      s.admit(admission({ invocation: invocation(n) }));
      s.admit(admission({ invocation: invocation(n), hop: 'observer' }));
    }
    s.admit(admission({ invocation: invocation(4) }));
  }, admission({ invocation: invocation(4), hop: 'observer' })],
  ['row-cap', s => { for (let n = 1; n <= 100000; n++) s.issue(row({ invocation: invocation(n) })); },
    admission({ invocation: invocation(100001) })],
]) test(`admission refusal names ${guard} and retains the first cause after poisoning`, () => {
  const s = createLitestreamAfterStop({ clock: () => 0 }); setup(s);
  let original;
  assert.throws(() => s.admit(input), error => {
    original = error; assert.match(error.message, bad);
    assert.equal(error.litestreamAfterStopAdmissionGuard, guard); return true;
  });
  assert.throws(() => s.admit(admission()), error => {
    assert.equal(error.litestreamAfterStopAdmissionGuard, guard); return true;
  });
  assert.throws(() => s.snapshot(), bad);
  assert.doesNotMatch(JSON.stringify(original), /PRIVATE_CANARY|55555555|amz-sdk/);
});

test('admission identifies a backward clock without publishing its value', () => {
  let time = 10;
  const s = createLitestreamAfterStop({ clock: () => time });
  s.admit(admission()); time = 9;
  assert.throws(() => s.admit(admission({ hop: 'observer' })), error => {
    assert.equal(error.litestreamAfterStopAdmissionGuard, 'clock'); return true;
  });
  assert.throws(() => s.snapshot(), bad);
});

test('admission input accessors are refused without being evaluated', () => {
  let reads = 0;
  const s = createLitestreamAfterStop({ clock: () => 0 });
  assert.throws(() => s.admit({ ...admission(), get invocation() { reads++; throw Error('PRIVATE_CANARY'); } }), error => {
    assert.match(error.message, bad); assert.equal(error.litestreamAfterStopAdmissionGuard, 'input'); return true;
  });
  assert.equal(reads, 0);
});

for (const stopped of [false, true]) test(`admission labels preserve the existing operation read count when stopped=${stopped}`, () => {
  const s = createLitestreamAfterStop({ clock: () => 0 });
  if (stopped) stop(s);
  let reads = 0;
  const limit = stopped ? 3 : 2;
  const input = new Proxy(admission(), { get(target, key, receiver) {
    if (key === 'operation' && ++reads > limit) throw Error('PRIVATE_CANARY');
    return Reflect.get(target, key, receiver);
  } });
  assert.doesNotThrow(() => s.admit(input));
  assert.equal(reads, limit);
});

test('the independent observer audit retains its first admission guard without recording headers', () => {
  const afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
  const input = { operation: 'list', headers: {
    'amz-sdk-invocation-id': invocation(1), 'amz-sdk-request': 'attempt=1; max=3', authorization: 'PRIVATE_CANARY',
  } };
  assert.throws(() => audit.observe(input), bad);
  assert.equal(audit.checkpoint().failure.afterStopAdmissionGuard, 'observer-pairing');
  assert.throws(() => audit.observe(input), bad);
  assert.deepEqual(audit.checkpoint().failure, { stage: 'after-stop-admission', afterStopAdmissionGuard: 'observer-pairing' });
  assert.doesNotMatch(JSON.stringify(audit.checkpoint()), /PRIVATE_CANARY|55555555|amz-sdk/);
  assert.throws(() => audit.snapshot(), bad);
});

test('an SDK issue refusal cannot run a diagnostic descriptor trap or supply an admission label', () => {
  let reads = 0;
  const error = new Proxy(Error('PRIVATE_CANARY'), { getOwnPropertyDescriptor() { reads++; throw Error('PRIVATE_CANARY'); } });
  const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop: {
    issue() { throw error; }, invalidate() {},
  } });
  const log = `SDK 2026/10/28 DEBUG Request\nGET /bucket?list-type=2 HTTP/1.1\namz-sdk-invocation-id: ${invocation(1)}\namz-sdk-request: attempt=1; max=3\n\n`;
  assert.throws(() => audit.write(Buffer.from(log)), bad);
  assert.deepEqual(audit.checkpoint().failure, { stage: 'after-stop-issue' });
  assert.equal(reads, 0);
});

for (const label of ['clock', 'PRIVATE_CANARY']) test(`an observer audit filters a forged guard from the ${label === 'clock' ? 'wrong stage' : 'unknown category'}`, () => {
  const error = Object.assign(Error('PRIVATE_CANARY'), { litestreamAfterStopAdmissionGuard: label });
  const afterStop = { issue() { throw error; }, admit() { throw error; }, invalidate() {} };
  const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
  if (label === 'clock') {
    assert.throws(() => audit.write(Buffer.from(`SDK 2026/10/28 DEBUG Request\nGET /bucket?list-type=2 HTTP/1.1\namz-sdk-invocation-id: ${invocation(1)}\namz-sdk-request: attempt=1; max=3\n\n`)), bad);
  } else {
    assert.throws(() => audit.observe({ operation: 'list', headers: {
      'amz-sdk-invocation-id': invocation(1), 'amz-sdk-request': 'attempt=1; max=3',
    } }), bad);
  }
  assert.equal(Object.hasOwn(audit.checkpoint().failure, 'afterStopAdmissionGuard'), false);
  assert.doesNotMatch(JSON.stringify(audit.checkpoint()), /PRIVATE_CANARY|55555555/);
});

async function httpFixture(t, afterStop, options = {}) {
  let forwarded = 0;
  const backend = createServer((req, res) => { forwarded++; req.resume(); req.on('end', () => res.end()); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop });
  const transport = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`,
    meter, phase: 'workload', afterStop, ...options });
  t.after(() => transport.close().catch(() => {}));
  const send = method => new Promise((resolve, reject) => {
    const req = request(transport.url + '/PRIVATE_CANARY/key', { method, headers: {
      'amz-sdk-invocation-id': invocation(1), 'amz-sdk-request': 'attempt=1; max=3', authorization: 'PRIVATE_CANARY',
    } }, res => { res.on('error', reject); res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  return { transport, meter, send, forwarded: () => forwarded };
}

test('real HTTP refusal carries the admission guard through stop checkpoints and repeated close reporting', async t => {
  const s = createLitestreamAfterStop({ clock: () => 0 }); stop(s);
  const f = await httpFixture(t, s);
  assert.equal(await f.send('PUT'), 400); assert.equal(await f.send('PATCH'), 400);
  assert.equal(f.forwarded(), 0);
  assert.equal(f.transport.checkpoint().afterStopAdmissionGuard, 'post-stop-operation');
  for (const stage of ['replication-transport', 'cleanup-replication-transport']) {
    const records = [];
    await assert.rejects(withLitestreamCloseDiagnostics({ stage, close: () => f.transport.close(),
      report: line => records.push(JSON.parse(line)) }), bad);
    assert.equal(records.at(-1).diagnostic.afterStopAdmissionGuard, 'post-stop-operation');
    assert.doesNotMatch(JSON.stringify([records, f.transport.checkpoint()]), /PRIVATE_CANARY|55555555|amz-sdk|127\.0\.0\.1/);
  }
  assert.throws(() => f.meter.snapshot(), /Invalid cloud cost meter/);
});

test('successful HTTP requests do not manufacture an admission diagnostic', async t => {
  const s = createLitestreamAfterStop({ clock: () => 0 });
  const f = await httpFixture(t, s);
  assert.equal(await f.send('PUT'), 200);
  await f.transport.whenIdle(() => {});
  assert.equal(f.forwarded(), 1);
  assert.equal(Object.hasOwn(f.transport.checkpoint(), 'afterStopAdmissionGuard'), false);
  await f.transport.close();
});

test('unrelated lifetime errors cannot run a diagnostic descriptor trap or supply an admission label', async t => {
  let reads = 0;
  const error = new Proxy(Error('PRIVATE_CANARY'), { getOwnPropertyDescriptor() { reads++; throw Error('PRIVATE_CANARY'); } });
  const f = await httpFixture(t, undefined, { lifetimes: { begin() { throw error; } } });
  assert.equal(await f.send('PUT'), 400); assert.equal(f.forwarded(), 0);
  assert.equal(f.transport.checkpoint().validationStage, 'lifetime-begin');
  assert.equal(reads, 0);
  assert.equal(Object.hasOwn(f.transport.checkpoint(), 'afterStopAdmissionGuard'), false);
});

test('an unrelated lifetime error cannot forge an admission label', async t => {
  const f = await httpFixture(t, undefined, { lifetimes: { begin() {
    throw Object.assign(Error('PRIVATE_CANARY'), { litestreamAfterStopAdmissionGuard: 'clock' });
  } } });
  assert.equal(await f.send('PUT'), 400);
  assert.equal(Object.hasOwn(f.transport.checkpoint(), 'afterStopAdmissionGuard'), false);
  await assert.rejects(f.transport.close(), bad);
});

test('the transport drops an unknown admission category without evaluating accessor output', async t => {
  let reads = 0;
  for (const error of [
    Object.assign(Error('PRIVATE_CANARY'), { litestreamAfterStopAdmissionGuard: 'PRIVATE_CANARY' }),
    Object.defineProperty(Error('PRIVATE_CANARY'), 'litestreamAfterStopAdmissionGuard', {
      get() { reads++; throw Error('PRIVATE_CANARY'); },
    }),
  ]) {
    const f = await httpFixture(t, { admit() { throw error; }, invalidate() {} });
    assert.equal(await f.send('PUT'), 400); assert.equal(f.forwarded(), 0);
    assert.equal(f.transport.checkpoint().validationStage, 'after-stop-admission');
    assert.equal(Object.hasOwn(f.transport.checkpoint(), 'afterStopAdmissionGuard'), false);
    assert.doesNotMatch(JSON.stringify(f.transport.checkpoint()), /PRIVATE_CANARY/);
    await assert.rejects(f.transport.close(), bad);
  }
  assert.equal(reads, 0);
});

test('the shared tracker reports its first observer refusal when a later producer is already poisoned', async t => {
  const s = createLitestreamAfterStop({ clock: () => 0 });
  assert.throws(() => s.admit(admission({ hop: 'observer' })), bad);
  const f = await httpFixture(t, s);
  assert.equal(await f.send('PUT'), 400); assert.equal(f.forwarded(), 0);
  assert.equal(f.transport.checkpoint().afterStopAdmissionGuard, 'observer-pairing');
  await assert.rejects(f.transport.close(), bad);
});

test('close reporting filters untrusted admission labels and preserves the original thrown error', async () => {
  let reads = 0;
  for (const diagnostic of [
    { reason: 'request-validation', validationStage: 'after-stop-admission', afterStopAdmissionGuard: 'PRIVATE_CANARY' },
    { reason: 'request-validation', validationStage: 'after-stop-admission',
      get afterStopAdmissionGuard() { reads++; throw Error('PRIVATE_CANARY'); } },
    { reason: 'request-validation', validationStage: 'identity', afterStopAdmissionGuard: 'clock' },
    { reason: 'client-error', validationStage: 'after-stop-admission', afterStopAdmissionGuard: 'clock' },
  ]) {
    const error = Object.assign(Error('PRIVATE_CANARY'), { litestreamCloseDiagnostic: diagnostic });
    const records = [];
    await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => { throw error; },
      report: line => records.push(JSON.parse(line)) }), e => e === error);
    assert.equal(Object.hasOwn(records.at(-1).diagnostic, 'afterStopAdmissionGuard'), false);
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE_CANARY/);
  }
  assert.equal(reads, 0);
});

test('a broken diagnostic reporter cannot replace the original admission close error', async () => {
  const error = Object.assign(Error('original'), { litestreamCloseDiagnostic: {
    reason: 'request-validation', validationStage: 'after-stop-admission', afterStopAdmissionGuard: 'clock',
  } });
  await assert.rejects(withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => { throw error; },
    report: () => { throw Error('PRIVATE_CANARY'); } }), e => e === error);
});
