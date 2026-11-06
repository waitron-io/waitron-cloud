import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeter, createMeteringProxy, classifyStorageOperation } from './meter.mjs';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createLitestreamAfterStop, createLitestreamRequestAudit, createLitestreamTransport, litestreamAfterStopOutput } from './litestream.mjs';

const bad = /Invalid cloud cost Litestream audit/;
const invocation = n => `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555`;
const row = (operation = 'list', n = 1) => ({ invocation: invocation(n), ordinal: 0, operation });
const stop = ledger => ledger.acknowledgeStop({ statusCode: 200, ownedPath: '/PRIVATE_CANARY',
  body: Buffer.from(JSON.stringify({ status: 'stopped', path: '/PRIVATE_CANARY', txid: 0 })) });
const admission = (hop, operation = 'list', n = 1) => ({ ...row(operation, n), hop, phase: 'workload' });
const event = (channel, operation = 'list', n = 1) => ({ token: `${invocation(n)}:1`, channel, phase: 'workload',
  operation, retryOrdinal: 0, outcome: 'success', statusCode: 200, errorCode: null, sameAccount: null,
  bytesIn: 4, bytesOut: 0, attemptedBytesIn: 4, attemptedBytesOut: 0 });
const interruption = { reason: 'transfer-interrupted', ioEvent: 'response-pipeline', code: 'ECONNRESET',
  clientClosed: true, responseHeadersSeen: true };

for (const operation of ['list', 'put', 'delete']) for (const observed of [false, true])
test(`a pre-stop ${operation} cutoff survives an observer admitted after stop observed=${observed}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 });
  ledger.issue(row(operation)); ledger.admit(admission('producer', operation));
  ledger.settle({ ...event('producer', operation), outcome: 'transport-error', statusCode: null }, interruption);
  stop(ledger); ledger.admit(admission('observer', operation));
  if (observed) ledger.settle(event('observer', operation));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.used, 1); assert.equal(snapshot.lateAdmissions, 1);
  assert.equal(snapshot.lateSettlements, Number(observed && operation !== 'list'));
  assert.equal(snapshot.producer.attempts, 1); assert.equal(snapshot.observer.attempts, Number(observed));
  assert.equal(snapshot.status, 'unknown');
  assert.deepEqual(litestreamAfterStopOutput(snapshot).afterStop, snapshot);
});

// Refusing an absent hop, inventing its admission, or erasing its gap breaks these controls.
for (const operation of ['put', 'get', 'head', 'list', 'delete', 'delete-many', 'multipart-create',
  'multipart-upload', 'multipart-complete', 'multipart-abort']) {
  for (const missing of ['producer', 'observer', 'both']) {
    test(`well-formed ${operation} settlements retain missing ${missing} admission as unknown`, () => {
      const ledger = createLitestreamAfterStop({ clock: () => 0 }); ledger.issue(row(operation));
      for (const hop of ['producer', 'observer']) if (missing !== hop && missing !== 'both') ledger.admit(admission(hop, operation));
      for (const channel of ['producer', 'observer']) assert.doesNotThrow(() => ledger.settle(event(channel, operation)));
      const snapshot = ledger.snapshot();
      assert.equal(snapshot.status, 'unknown');
      assert.equal(snapshot.requestsReconciled, false);
      assert.deepEqual(snapshot.gaps, ['accounting:incomplete-history']);
      assert.equal(snapshot.used, 0);
      assert.deepEqual(litestreamAfterStopOutput(snapshot).afterStop, snapshot);
      assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_CANARY|2222-4333|invocation/);
    });
  }
}

for (const stopped of [false, true]) test(`observer admission before its producer stays unknown stopped=${stopped}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); ledger.issue(row()); if (stopped) stop(ledger);
  ledger.admit(admission('observer')); ledger.admit(admission('producer'));
  for (const channel of ['producer', 'observer']) ledger.settle(event(channel));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.status, 'unknown'); assert.equal(snapshot.requestsReconciled, true);
  assert.deepEqual(snapshot.gaps, ['accounting:incomplete-history']);
  assert.equal(snapshot.used, Number(stopped)); assert.equal(snapshot.lateAdmissions, Number(stopped));
  assert.equal(snapshot.producer.attempts, Number(stopped));
  assert.equal(snapshot.observer.attempts, Number(stopped));
  assert.deepEqual(litestreamAfterStopOutput(snapshot).afterStop, snapshot);
});

for (const channel of ['producer', 'observer']) test(`cutoff ${channel} without any admission records keeps original meter observations`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); stop(ledger);
  const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop: ledger });
  const e = { ...event(channel), outcome: 'transport-error', statusCode: null };
  assert.doesNotThrow(() => meter.observeAttempt(e, channel === 'producer' ? interruption : null));
  const snapshot = meter.snapshot(), subset = ledger.snapshot();
  assert.equal(snapshot.status, 'unknown');
  assert.ok(snapshot.gaps.includes('accounting:incomplete-history'));
  assert.ok(snapshot.gaps.includes('accounting:request-cutoff'));
  assert.equal(snapshot.accounting[channel].attempts, 1);
  assert.equal(subset.used, 1); assert.equal(subset.lateSettlements, 1);
  assert.equal(subset[channel].attempts, 1); assert.equal(subset[channel].bytesIn, 4);
  assert.deepEqual(litestreamAfterStopOutput(subset).afterStop, subset);
});

for (const channel of ['producer', 'observer']) test(`missing ${channel} admission cannot bypass the three-request stop cap`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); stop(ledger);
  for (let n = 1; n <= 3; n++) ledger.settle(event(channel, 'list', n));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.used, 3); assert.equal(snapshot.lateSettlements, 3);
  assert.equal(snapshot[channel].attempts, 3);
  assert.deepEqual(litestreamAfterStopOutput(snapshot).afterStop, snapshot);
  assert.throws(() => ledger.settle(event(channel, 'list', 4)), bad);
  assert.throws(() => ledger.snapshot(), bad);
});

for (const hop of ['producer', 'observer']) test(`a single ${hop} admission consumes the stop cap without waiting for the other hop`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); stop(ledger);
  for (let n = 1; n <= 3; n++) ledger.admit(admission(hop, 'list', n));
  assert.equal(ledger.snapshot().used, 3);
  assert.throws(() => ledger.admit(admission(hop, 'list', 4)), bad);
});

for (const direction of ['producer-first', 'observer-first', 'settlement-first']) test(`contradictory observed phase still refuses ${direction}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 });
  if (direction === 'settlement-first') ledger.settle(event('producer'));
  else ledger.admit(admission(direction === 'producer-first' ? 'producer' : 'observer'));
  const hop = direction === 'producer-first' ? 'observer' : 'producer';
  assert.throws(() => ledger.admit({ ...admission(hop), phase: 'idle' }), bad);
  assert.throws(() => ledger.snapshot(), bad);
});

for (const [label, change] of [
  ['unknown phase', e => e.phase = 'PRIVATE_CANARY'], ['unknown channel', e => e.channel = 'PRIVATE_CANARY'],
  ['mismatched ordinal', e => e.retryOrdinal = 1], ['unsafe size', e => e.bytesIn = e.attemptedBytesIn = Number.MAX_SAFE_INTEGER + 1],
  ['impossible bytes', e => e.bytesIn = 5], ['private field', e => e.private = 'PRIVATE_CANARY'],
]) test(`missing admission does not forgive ${label}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); const e = event('producer'); change(e);
  assert.throws(() => ledger.settle(e), bad); assert.throws(() => ledger.snapshot(), bad);
});

test('a duplicate settlement without admission remains a fatal control error', () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); ledger.settle(event('producer'));
  assert.throws(() => ledger.settle(event('producer')), bad); assert.throws(() => ledger.snapshot(), bad);
});

for (const missing of ['producer', 'observer', 'both']) for (const stopped of [false, true]) {
  test(`real HTTP collects missing ${missing} admission stopped=${stopped}`, { timeout: 3000 }, async t => {
    const ledger = createLitestreamAfterStop({ clock: () => 0 });
    const afterStop = { ...ledger, admit: input => {
      if (input.hop !== missing && missing !== 'both') ledger.admit(input);
    } };
    const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop });
    const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
    let requests = 0;
    const backend = createServer((req, res) => {
      requests++; req.resume(); req.on('end', () => res.end('four'));
    });
    backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
    t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
    const observer = await createMeteringProxy({ target: `http://127.0.0.1:${backend.address().port}`, meter,
      classify: input => audit.observe({ headers: input.headers, operation: classifyStorageOperation(input) }) });
    t.after(() => observer.close().catch(() => {}));
    const front = await createLitestreamTransport({ target: observer.url, meter, phase: 'workload', afterStop });
    t.after(() => front.close().catch(() => {}));
    audit.write(Buffer.from(`SDK 2026/11/06 DEBUG Request\nGET /bucket?list-type=2 HTTP/1.1\namz-sdk-invocation-id: ${invocation(1)}\namz-sdk-request: attempt=1; max=3\n\n`));
    if (stopped) stop(ledger);
    const response = await new Promise((resolve, reject) => {
      const req = request(front.url + '/bucket?list-type=2', { headers: {
        'amz-sdk-invocation-id': invocation(1), 'amz-sdk-request': 'attempt=1; max=3',
      } }, res => {
        let body = ''; res.on('data', chunk => body += chunk); res.on('error', reject);
        res.on('end', () => resolve({ code: res.statusCode, body }));
      });
      req.on('error', reject); req.end();
    });
    assert.deepEqual(response, { code: 200, body: 'four' });
    await front.whenIdle(() => {}); audit.end(); await front.close(); await observer.close();
    assert.equal(requests, 1); assert.equal(front.checkpoint().pending, 0);
    assert.equal(audit.snapshot().requestsReconciled, true);
    const snapshot = meter.snapshot(), subset = ledger.snapshot();
    assert.equal(snapshot.status, 'unknown'); assert.equal(snapshot.reconciled, true);
    assert.deepEqual(snapshot.accounting.producer, { attempts: 1, bytesIn: 4, bytesOut: 0 });
    assert.deepEqual(snapshot.accounting.observer, { attempts: 1, bytesIn: 4, bytesOut: 0 });
    assert.ok(snapshot.gaps.includes('accounting:incomplete-history'));
    assert.equal(subset.requestsReconciled, false); assert.equal(subset.used, Number(stopped));
    assert.deepEqual(litestreamAfterStopOutput(subset).afterStop, subset);
  });
}

for (const stopped of [false, true]) test(`later admissions cannot erase an event-time settlement history gap stopped=${stopped}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); ledger.issue(row()); if (stopped) stop(ledger);
  for (const channel of ['producer', 'observer']) assert.doesNotThrow(() => ledger.settle(event(channel)));
  for (const hop of ['producer', 'observer']) ledger.admit(admission(hop));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.requestsReconciled, true); assert.equal(snapshot.bodiesReconciled, true);
  assert.equal(snapshot.status, 'unknown'); assert.deepEqual(snapshot.gaps, ['accounting:incomplete-history']);
  assert.deepEqual(litestreamAfterStopOutput(snapshot).afterStop, snapshot);
});
