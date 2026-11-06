import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeter } from './meter.mjs';

const attempt = (token, changes = {}) => ({ token, channel: 'producer', phase: 'workload', operation: 'put',
  retryOrdinal: 0, outcome: 'success', statusCode: 200, errorCode: null, sameAccount: true,
  bytesIn: 0, bytesOut: 10, attemptedBytesIn: 0, attemptedBytesOut: 10, ...changes });
const paired = (meter, event) => {
  meter.observeAttempt(event); meter.observeAttempt({ ...event, channel: 'observer' });
};
function fixture() {
  let time = 0;
  return { meter: createMeter({ phase: 'workload', clock: () => time }), time: value => { time = value; } };
}

// Making an accounting gap fatal would prevent later observations and lose supported rows.
for (const code of ['accounting:request-cutoff', 'accounting:meter-disagreement', 'accounting:incomplete-total',
  'accounting:incomplete-history', 'accounting:overflow', 'accounting:unreconciled', 'request-billing:unknown',
  'litestream:requests-unreconciled', 'litestream:body-bytes-unpaired', 'litestream:object-lifetimes-unpaired',
  'after-stop:list-response-interrupted', 'after-stop:put-response-interrupted', 'after-stop:body-bytes-unpaired']) {
  test(`a named ${code} gap survives further valid work without invalidating the meter`, () => {
    const { meter } = fixture();
    meter.markGap(code); meter.markGap(code);
    paired(meter, attempt('PRIVATE_REQUEST'));
    const result = meter.snapshot();
    assert.equal(result.status, 'unknown');
    assert.equal(result.reconciled, true);
    assert.deepEqual(result.gaps, [code]);
    assert.equal(result.accounting.producer.attempts, 1);
    assert.equal(result.accounting.observer.attempts, 1);
    assert.deepEqual(meter.diagnostics(), { firstInvalidation: null, snapshotRefusal: null, pendingAttempts: 0 });
    result.gaps.push('PRIVATE_VALUE');
    assert.deepEqual(meter.snapshot().gaps, [code]);
    assert.doesNotMatch(JSON.stringify(meter.snapshot()), /PRIVATE/);
  });
}

test('gap labels reject private values without invoking getters or coercion', () => {
  let reads = 0;
  const hostile = { get code() { reads++; throw Error('PRIVATE_GETTER'); },
    toString() { reads++; throw Error('PRIVATE_COERCION'); } };
  for (const value of ['PRIVATE_VALUE', 'accounting:made-up', '', null, undefined, hostile]) {
    const { meter } = fixture();
    assert.throws(() => meter.markGap(value), { message: 'Invalid cloud cost meter' });
    assert.throws(() => meter.snapshot(), { message: 'Invalid cloud cost meter' });
    assert.doesNotMatch(JSON.stringify(meter.diagnostics()), /PRIVATE/);
  }
  assert.equal(reads, 0);
});

test('a gap never revives fatal invalidation or a malformed event', () => {
  for (const invalidate of [meter => meter.invalidate(), meter => {
    assert.throws(() => meter.observeAttempt(attempt('PRIVATE', { bytesOut: Number.MAX_SAFE_INTEGER + 1 })),
      { message: 'Invalid cloud cost meter' });
  }]) {
    const { meter } = fixture(); invalidate(meter);
    meter.markGap('accounting:request-cutoff');
    assert.throws(() => meter.snapshot(), { message: 'Invalid cloud cost meter' });
  }
});

test('aggregate request overflow keeps independent counts, rows and billing', () => {
  const { meter } = fixture();
  paired(meter, attempt('first', { bytesOut: Number.MAX_SAFE_INTEGER, attemptedBytesOut: Number.MAX_SAFE_INTEGER }));
  paired(meter, attempt('second', { bytesOut: 1, attemptedBytesOut: 1 }));
  paired(meter, attempt('independent', { phase: 'restore', operation: 'get', bytesOut: 7, attemptedBytesOut: 7 }));
  const result = meter.snapshot();
  assert.equal(result.status, 'unknown'); assert.equal(result.reconciled, true);
  assert.deepEqual(result.gaps, ['accounting:overflow']);
  assert.deepEqual(result.accounting.producer, { attempts: 3, bytesIn: 0, bytesOut: null });
  assert.deepEqual(result.accounting.observer, { attempts: 3, bytesIn: 0, bytesOut: null });
  assert.deepEqual(result.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: null });
  assert.equal(result.accounting.requests[0].bytesOut, null);
  assert.equal(result.accounting.requests[0].attemptedBytesOut, null);
  assert.equal(result.observedRequests[0].bytesOut, null);
  assert.equal(result.observedRequests[0].attemptedBytesOut, null);
  assert.equal(result.accounting.requests[1].bytesOut, 7);
  assert.deepEqual(result.billing, [
    { phase: 'workload', requestClass: 's3-write', quantity: 2, status: 'measured' },
    { phase: 'restore', requestClass: 's3-read', quantity: 1, status: 'measured' }]);
  assert.deepEqual(meter.checkpoint().producer, { attempts: 3, bytesIn: 0, bytesOut: null });
  assert.deepEqual(meter.checkpoint().observer, { attempts: 3, bytesIn: 0, bytesOut: null });
});

test('overflowing attempted bytes cannot be published as measured when received totals fit', () => {
  const { meter } = fixture();
  for (const token of ['first', 'second']) paired(meter, attempt(token, { bytesOut: 0, attemptedBytesOut: Number.MAX_SAFE_INTEGER }));
  const result = meter.snapshot();
  assert.equal(result.status, 'unknown'); assert.deepEqual(result.gaps, ['accounting:overflow']);
  assert.equal(result.accounting.producer.bytesOut, 0);
  assert.equal(result.accounting.requests[0].attemptedBytesOut, null);
});

test('overflow in one storage class leaves other storage evidence usable', () => {
  const f = fixture();
  f.meter.observeObject({ token: 'large', action: 'create', class: 'stream', bytes: Number.MAX_SAFE_INTEGER });
  f.meter.observeObject({ token: 'small', action: 'create', class: 'stream', bytes: 1 });
  f.meter.observeObject({ token: 'independent', action: 'create', class: 'snapshot', bytes: 3 });
  f.time(2);
  const result = f.meter.snapshot();
  assert.equal(result.status, 'unknown'); assert.deepEqual(result.gaps, ['accounting:overflow']);
  assert.deepEqual(result.accounting.objects, [
    { class: 'stream', bytes: null, byteSeconds: null, currentVersions: 2, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
    { class: 'snapshot', bytes: 3, byteSeconds: 6, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }]);
  f.meter.observeObject({ token: 'large', action: 'delete', class: 'stream', bytes: 0 });
  f.time(3);
  const later = f.meter.snapshot();
  assert.equal(later.accounting.objects[0].bytes, 1);
  assert.equal(later.accounting.objects[0].byteSeconds, null, 'lost integral cannot recover by deleting an object');
  assert.equal(later.accounting.objects[1].byteSeconds, 9);
});

test('safe aggregate boundary remains measured and does not reset between snapshots', () => {
  const { meter } = fixture();
  paired(meter, attempt('first', { bytesOut: Number.MAX_SAFE_INTEGER - 1, attemptedBytesOut: Number.MAX_SAFE_INTEGER - 1 }));
  paired(meter, attempt('last', { bytesOut: 1, attemptedBytesOut: 1 }));
  const result = meter.snapshot();
  assert.equal(result.status, 'measured'); assert.deepEqual(result.gaps, []);
  assert.equal(result.accounting.producer.bytesOut, Number.MAX_SAFE_INTEGER);
  assert.equal(result.accounting.requests[0].attemptedBytesOut, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(meter.snapshot(), result);
});
