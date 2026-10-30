import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeter } from './meter.mjs';

function diagnostics(meter) {
  assert.equal(typeof meter.diagnostics, 'function', 'refused accounting must expose its boundary without private input');
  return meter.diagnostics();
}

const refused = { message: 'Invalid cloud cost meter' };
const attempt = (token, channel = 'producer', bytes = 1) => ({ token, channel, phase: 'workload', operation: 'put',
  retryOrdinal: 0, outcome: 'success', statusCode: 200, errorCode: null, sameAccount: true,
  bytesIn: 0, bytesOut: bytes, attemptedBytesIn: 0, attemptedBytesOut: bytes });
const object = { token: 'PRIVATE_OBJECT', action: 'create', class: 'stream', bytes: 1 };
function fixture(afterStop) {
  let time = 0;
  const meter = createMeter({ phase: 'workload', clock: () => time, afterStop });
  return { meter, time: value => { time = value; } };
}

// Losing a boundary label must make a real refused snapshot indistinguishable from another cause.
test('a pending request is identified without exposing its token or consuming it', () => {
  const { meter } = fixture(); meter.beginAttempt('PRIVATE_ATTEMPT');
  assert.throws(() => meter.snapshot(), refused);
  assert.deepEqual(diagnostics(meter), { firstInvalidation: null, snapshotRefusal: 'pending-attempts', pendingAttempts: 1 });
  assert.throws(() => meter.snapshot(), refused);
  meter.observeAttempt(attempt('PRIVATE_ATTEMPT')); meter.observeAttempt(attempt('PRIVATE_ATTEMPT', 'observer'));
  assert.equal(meter.snapshot().status, 'measured');
  assert.equal(diagnostics(meter).pendingAttempts, 0);
});

for (const [boundary, invalidate] of [
  ['explicit', meter => meter.invalidate('PRIVATE_REASON')],
  ['observe-attempt', meter => assert.throws(() => meter.observeAttempt({ ...attempt('PRIVATE_ATTEMPT'), secret: 'PRIVATE_PAYLOAD' }), refused)],
  ['observe-object', meter => assert.throws(() => meter.observeObject({ ...object, secret: 'PRIVATE_PAYLOAD' }), refused)],
  ['begin-attempt', meter => { meter.beginAttempt('PRIVATE_ATTEMPT'); assert.throws(() => meter.beginAttempt('PRIVATE_ATTEMPT'), refused); }],
]) test(`the first ${boundary} invalidation survives later cleanup and diagnostic mutation`, () => {
  const { meter } = fixture(); invalidate(meter); meter.invalidate();
  assert.throws(() => meter.snapshot(), refused);
  const diagnostic = diagnostics(meter);
  assert.deepEqual(diagnostic, { firstInvalidation: boundary, snapshotRefusal: 'invalidated', pendingAttempts: boundary === 'begin-attempt' ? 1 : 0 });
  diagnostic.firstInvalidation = 'PRIVATE_REPLACEMENT';
  assert.equal(diagnostics(meter).firstInvalidation, boundary);
  assert.doesNotMatch(JSON.stringify(diagnostics(meter)), /PRIVATE/);
  assert.throws(() => meter.snapshot(), refused);
});

for (const value of [-1, NaN, Infinity]) test(`a refused snapshot identifies the clock guard for ${value}`, () => {
  const f = fixture(); f.time(value);
  assert.throws(() => f.meter.snapshot(), refused);
  assert.deepEqual(diagnostics(f.meter), { firstInvalidation: null, snapshotRefusal: 'clock', pendingAttempts: 0 });
});

test('a refused snapshot distinguishes storage integration overflow from clock failure', () => {
  const f = fixture(); f.meter.observeObject({ ...object, bytes: Number.MAX_SAFE_INTEGER }); f.time(1e308);
  assert.throws(() => f.meter.snapshot(), refused);
  assert.equal(diagnostics(f.meter).snapshotRefusal, 'storage-integral');
});

test('a refused snapshot identifies after-stop refusal without reading its error', () => {
  const privateError = new Error('PRIVATE_PAYLOAD');
  Object.defineProperty(privateError, 'message', { get() { throw Error('PRIVATE_GETTER'); } });
  const { meter } = fixture({ snapshot() { throw privateError; } });
  assert.throws(() => meter.snapshot(), refused);
  assert.deepEqual(diagnostics(meter), { firstInvalidation: null, snapshotRefusal: 'after-stop', pendingAttempts: 0 });
});

test('unsafe aggregate byte totals remain refused and identify their guard', () => {
  const { meter } = fixture();
  for (const token of ['PRIVATE_ONE', 'PRIVATE_TWO']) for (const channel of ['producer', 'observer'])
    meter.observeAttempt(attempt(token, channel, Number.MAX_SAFE_INTEGER));
  assert.throws(() => meter.snapshot(), refused);
  assert.equal(diagnostics(meter).snapshotRefusal, 'attempt-totals');
});

test('reading diagnostics does not advance the clock or alter valid accounting', () => {
  const f = fixture(); f.meter.observeObject(object); f.time(3);
  assert.deepEqual(diagnostics(f.meter), { firstInvalidation: null, snapshotRefusal: null, pendingAttempts: 0 });
  assert.equal(f.meter.snapshot().accounting.objects[0].byteSeconds, 3);
  assert.equal(f.meter.snapshot().status, 'measured');
});

test('reading diagnostics never calls the accounting clock', () => {
  let reads = 0;
  const meter = createMeter({ phase: 'workload', clock: () => { reads++; return 0; } });
  const before = reads;
  diagnostics(meter); diagnostics(meter);
  assert.equal(reads, before);
});
