import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeter } from './meter.mjs';
import { createLitestreamAfterStop, litestreamAfterStopOutput } from './litestream.mjs';

const bad = /Invalid cloud cost Litestream audit/;
const invocation = n => `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555`;
const attempt = (n = 1) => ({ invocation: invocation(n), ordinal: 0, operation: 'list' });
const stop = ledger => ledger.acknowledgeStop({ statusCode: 200, ownedPath: '/PRIVATE_CANARY',
  body: Buffer.from(JSON.stringify({ status: 'stopped', path: '/PRIVATE_CANARY', txid: 0 })) });
const admit = (ledger, n = 1) => {
  for (const hop of ['producer', 'observer']) ledger.admit({ ...attempt(n), hop, phase: 'workload' });
};
const event = (channel, n = 1, bytesIn = 4) => ({ token: `${invocation(n)}:1`, channel, phase: 'workload',
  operation: 'list', retryOrdinal: 0, outcome: 'success', statusCode: 200, errorCode: null, sameAccount: null,
  bytesIn, bytesOut: 0, attemptedBytesIn: bytesIn, attemptedBytesOut: 0 });

// A missing record must lose accounting certainty, never poison subsequent bounded collection.
for (const acknowledged of [false, true]) {
  for (const missing of ['issue', 'both-admissions', 'observer-admission', 'both-settlements', 'producer-settlement', 'observer-settlement']) {
    test(`missing shutdown ${missing} stays unknown ${acknowledged ? 'after' : 'before'} stop`, () => {
      const ledger = createLitestreamAfterStop({ clock: () => 0 });
      if (missing !== 'issue') ledger.issue(attempt());
      if (acknowledged) stop(ledger);
      if (missing !== 'both-admissions') ledger.admit({ ...attempt(), hop: 'producer', phase: 'workload' });
      if (!['both-admissions', 'observer-admission'].includes(missing)) ledger.admit({ ...attempt(), hop: 'observer', phase: 'workload' });
      if (!['both-admissions', 'observer-admission', 'both-settlements', 'producer-settlement'].includes(missing)) ledger.settle(event('producer'));
      if (!['both-admissions', 'observer-admission', 'both-settlements', 'observer-settlement'].includes(missing)) ledger.settle(event('observer'));
      const snapshot = ledger.snapshot();
      assert.equal(snapshot.status, 'unknown');
      assert.equal(snapshot.requestsReconciled, false);
      assert.ok(snapshot.gaps.includes('accounting:incomplete-history'));
      assert.deepEqual(litestreamAfterStopOutput(snapshot).afterStop, snapshot);
      assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_CANARY|2222-4333|amz-sdk/);
      if (acknowledged && missing === 'producer-settlement') {
        assert.deepEqual(snapshot.producer, { attempts: 0, bytesIn: 0, bytesOut: 0 });
        assert.deepEqual(snapshot.observer, { attempts: 1, bytesIn: 4, bytesOut: 0 });
        assert.equal(snapshot.used, 1);
      }
    });
  }
}

test('collecting a later shutdown record cannot erase a finalised history gap', () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 });
  ledger.issue(attempt()); stop(ledger); admit(ledger); ledger.settle(event('producer'));
  assert.equal(ledger.snapshot().status, 'unknown');
  ledger.settle(event('observer'));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.requestsReconciled, true);
  assert.equal(snapshot.bodiesReconciled, true);
  assert.equal(snapshot.status, 'unknown');
  assert.deepEqual(snapshot.gaps, ['accounting:incomplete-history']);
  assert.deepEqual(litestreamAfterStopOutput(snapshot).afterStop, snapshot);
});

for (const missing of ['issue', 'observer-settlement']) test(`the original meter retains missing shutdown ${missing} evidence`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 });
  const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop: ledger });
  if (missing !== 'issue') ledger.issue(attempt());
  stop(ledger); admit(ledger); meter.observeAttempt(event('producer'));
  if (missing !== 'observer-settlement') meter.observeAttempt(event('observer'));
  const snapshot = meter.snapshot();
  assert.equal(snapshot.status, 'unknown');
  assert.ok(snapshot.gaps.includes('accounting:incomplete-history'));
  assert.equal(snapshot.accounting.producer.attempts, 1);
  assert.equal(snapshot.accounting.observer.attempts, missing === 'issue' ? 1 : 0);
});

for (const overflowing of [false, true]) test(`shutdown grouped bytes ${overflowing ? 'overflow is unknown' : 'safe maximum stays exact'}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); stop(ledger);
  for (const n of [1, 2]) { ledger.issue(attempt(n)); admit(ledger, n); }
  for (const n of [1, 2]) for (const channel of ['producer', 'observer'])
    ledger.settle(event(channel, n, n === 1 ? Number.MAX_SAFE_INTEGER - Number(!overflowing) : 1));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.status, overflowing ? 'unknown' : 'measured');
  assert.equal(snapshot.producer.bytesIn, overflowing ? null : Number.MAX_SAFE_INTEGER);
  assert.equal(snapshot.observer.bytesIn, snapshot.producer.bytesIn);
  assert.equal(snapshot.producer.attempts, 2);
  assert.equal(snapshot.bodiesReconciled, true);
  assert.deepEqual(snapshot.gaps, overflowing ? ['accounting:overflow'] : []);
  assert.deepEqual(litestreamAfterStopOutput(snapshot).afterStop, snapshot);
  if (overflowing) for (const row of snapshot.requests) {
    assert.equal(row.bytesIn, null); assert.equal(row.attemptedBytesIn, null);
    assert.equal(row.attempts, 2);
  }
});

test('separate safe shutdown rows can overflow only their combined total', () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); stop(ledger);
  for (const n of [1, 2]) {
    ledger.issue(attempt(n));
    for (const hop of ['producer', 'observer']) ledger.admit({ ...attempt(n), hop, phase: n === 1 ? 'workload' : 'idle' });
  }
  for (const n of [1, 2]) for (const channel of ['producer', 'observer']) ledger.settle({ ...event(channel, n, n === 1 ? Number.MAX_SAFE_INTEGER : 1), phase: n === 1 ? 'workload' : 'idle' });
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.status, 'unknown');
  assert.deepEqual(snapshot.gaps, ['accounting:overflow']);
  assert.equal(snapshot.producer.bytesIn, null);
  assert.deepEqual(snapshot.requests.filter(r => r.hop === 'producer').map(r => r.bytesIn), [Number.MAX_SAFE_INTEGER, 1]);
  assert.deepEqual(litestreamAfterStopOutput(snapshot).afterStop, snapshot);
  const rounded = structuredClone(snapshot); rounded.producer.bytesIn = Number.MAX_SAFE_INTEGER;
  assert.throws(() => litestreamAfterStopOutput(rounded), bad);
  const erased = structuredClone(snapshot); erased.gaps = [];
  assert.throws(() => litestreamAfterStopOutput(erased), bad);
});

for (const field of ['bytesOut', 'attemptedBytesIn', 'attemptedBytesOut']) test(`shutdown ${field} overflow keeps the other observed figures`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); stop(ledger);
  for (const n of [1, 2]) { ledger.issue(attempt(n)); admit(ledger, n); }
  for (const n of [1, 2]) for (const channel of ['producer', 'observer']) {
    const e = event(channel, n, 0); e[field] = n === 1 ? Number.MAX_SAFE_INTEGER : 1;
    if (field === 'bytesOut') e.attemptedBytesOut = e.bytesOut;
    ledger.settle(e);
  }
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.status, 'unknown');
  assert.deepEqual(snapshot.gaps, ['accounting:overflow']);
  assert.equal(snapshot.producer.bytesIn, 0);
  assert.equal(snapshot.producer.bytesOut, field === 'bytesOut' ? null : 0);
  assert.equal(snapshot.producer.attempts, 2);
  for (const row of snapshot.requests) assert.equal(row[field], null);
  assert.deepEqual(litestreamAfterStopOutput(snapshot).afterStop, snapshot);
});

test('missing-history output cannot erase its gap, observed counts, or original row identity', () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); stop(ledger); admit(ledger);
  ledger.settle(event('observer'));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.status, 'unknown');
  for (const change of [
    s => s.gaps = s.gaps.filter(g => g !== 'accounting:incomplete-history'),
    s => s.status = 'measured',
    s => s.observer.bytesIn = 0,
    s => s.requests[0].private = 'PRIVATE_CANARY',
    s => s.requests[0].operation = 'PRIVATE_CANARY',
    s => s.requestsReconciled = true,
  ]) {
    const altered = structuredClone(snapshot); change(altered);
    assert.throws(() => litestreamAfterStopOutput(altered), bad);
  }
  assert.deepEqual(litestreamAfterStopOutput(snapshot).afterStop, snapshot);
});

for (const [label, change] of [
  ['unsafe individual size', e => e.bytesIn = e.attemptedBytesIn = Number.MAX_SAFE_INTEGER + 1],
  ['negative individual size', e => e.bytesIn = -1],
  ['phase disagreement', e => e.phase = 'idle'],
  ['private field', e => e.private = 'PRIVATE_CANARY'],
]) test(`missing history never forgives ${label}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); admit(ledger); stop(ledger);
  const e = event('producer'); change(e);
  assert.throws(() => ledger.settle(e), bad);
  assert.throws(() => ledger.snapshot(), bad);
});
