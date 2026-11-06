import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeter } from './meter.mjs';
import { createLitestreamAfterStop } from './litestream.mjs';

const attempt = (token, changes = {}) => ({ token, channel: 'producer', phase: 'workload', operation: 'put',
  retryOrdinal: 0, outcome: 'success', statusCode: 200, errorCode: null, sameAccount: true,
  bytesIn: 0, bytesOut: 10, attemptedBytesIn: 0, attemptedBytesOut: 10, ...changes });
function paired(meter, event) {
  meter.observeAttempt(event);
  meter.observeAttempt({ ...event, channel: 'observer' });
}
const meterFor = () => createMeter({ phase: 'workload', clock: () => 0 });
const bill = (phase, requestClass, quantity) => ({ phase, requestClass, quantity,
  status: quantity === null ? 'unknown' : 'measured' });
const sorted = result => result.billing.toSorted((a, b) => `${a.phase}:${a.requestClass}`.localeCompare(`${b.phase}:${b.requestClass}`));

// Blanket invalidation loses a witnessed row; ignoring either unmatched hop invents a complete one.
for (const missing of ['producer', 'observer']) test(`independentRowsSurviveOnlyTheirOwnProvenance: missing ${missing}`, () => {
  const meter = meterFor();
  paired(meter, attempt('PRIVATE_GOOD', { phase: 'restore', operation: 'get' }));
  meter.observeAttempt(attempt('PRIVATE_UNPAIRED', { channel: missing === 'producer' ? 'observer' : 'producer' }));
  const result = meter.snapshot();
  assert.equal(result.status, 'unknown');
  assert.equal(result.reconciled, false);
  assert.ok(result.gaps.includes('accounting:unreconciled'));
  assert.deepEqual(sorted(result), [bill('restore', 's3-read', 1), bill('workload', 's3-write', null)]);
  assert.equal(result.accounting.producer.attempts, missing === 'producer' ? 1 : 2);
  assert.equal(result.accounting.observer.attempts, missing === 'observer' ? 1 : 2);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

test('a paired request cannot certify another request in the same billing row', () => {
  const meter = meterFor();
  paired(meter, attempt('paired'));
  meter.observeAttempt(attempt('unpaired'));
  paired(meter, attempt('startup', { phase: 'startup' }));
  assert.deepEqual(sorted(meter.snapshot()), [bill('startup', 's3-write', 1), bill('workload', 's3-write', null)]);
});

test('equal grand totals cannot hide different request classes', () => {
  const meter = meterFor();
  paired(meter, attempt('independent', { phase: 'restore' }));
  meter.observeAttempt(attempt('mismatch'));
  meter.observeAttempt(attempt('mismatch', { channel: 'observer', operation: 'get' }));
  const result = meter.snapshot();
  assert.deepEqual(result.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  assert.equal(result.reconciled, false);
  assert.deepEqual(sorted(result), [bill('restore', 's3-write', 1),
    bill('workload', 's3-read', null), bill('workload', 's3-write', null)]);
});

for (const [name, changes] of [
  ['phase', { phase: 'idle' }],
  ['operation', { operation: 'multipart-upload' }],
  ['retry', { retryOrdinal: 1 }],
  ['outcome', { outcome: 'server-error', statusCode: 503 }],
  ['status', { statusCode: 201 }],
  ['bytes received', { bytesIn: 1, attemptedBytesIn: 1 }],
  ['bytes sent', { bytesOut: 9 }],
  ['attempted bytes received', { attemptedBytesIn: 1 }],
  ['attempted bytes sent', { attemptedBytesOut: 11 }],
]) test(`a ${name} mismatch cannot borrow an unrelated row's evidence`, () => {
  const meter = meterFor();
  paired(meter, attempt('independent', { phase: 'restore', operation: 'list' }));
  meter.observeAttempt(attempt('mismatch'));
  meter.observeAttempt(attempt('mismatch', { channel: 'observer', ...changes }));
  const result = meter.snapshot();
  assert.equal(result.status, 'unknown');
  assert.equal(result.reconciled, false);
  assert.deepEqual(result.billing.find(r => r.phase === 'restore'), bill('restore', 's3-list', 1));
  assert.ok(result.billing.filter(r => r.phase !== 'restore').length > 0);
  for (const row of result.billing.filter(r => r.phase !== 'restore')) {
    assert.equal(row.quantity, null);
    assert.equal(row.status, 'unknown');
  }
});

test('independent billing remains unknown when its paired request is not priceable', () => {
  const meter = meterFor();
  paired(meter, attempt('unknown-price', { phase: 'setup', operation: 'bucket-create' }));
  paired(meter, attempt('known', { phase: 'restore', operation: 'get' }));
  meter.observeAttempt(attempt('mismatch'));
  const result = meter.snapshot();
  assert.deepEqual(sorted(result), [bill('restore', 's3-read', 1), bill('setup', 's3-control', null),
    bill('workload', 's3-write', null)]);
  assert.ok(result.gaps.includes('request-billing:unknown'));
});

for (const [name, observer] of [
  ['missing account attribution', { sameAccount: null }],
  ['different account attribution', { sameAccount: false }],
  ['unknown error billing', { errorCode: 'unknown' }],
  ['different error billing', { errorCode: 'SignatureDoesNotMatch' }],
]) test(`paired transport totals do not certify billing with ${name}`, () => {
  const meter = meterFor();
  paired(meter, attempt('independent', { phase: 'restore', operation: 'list' }));
  const denied = attempt('denied', { outcome: 'client-error', statusCode: 403, errorCode: 'AccessDenied' });
  meter.observeAttempt(denied);
  meter.observeAttempt({ ...denied, channel: 'observer', ...observer });
  const result = meter.snapshot();
  assert.equal(result.reconciled, true);
  assert.deepEqual(result.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  assert.deepEqual(sorted(result), [bill('restore', 's3-list', 1), bill('workload', 's3-write', null)]);
  assert.ok(result.gaps.includes('request-billing:unknown'));
});

test('an acknowledged stop cutoff leaves independently paired earlier billing intact', () => {
  const afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop });
  const admit = (invocation, phase, operation) => {
    const identity = { invocation, ordinal: 0, operation };
    afterStop.issue(identity);
    for (const hop of ['producer', 'observer']) afterStop.admit({ ...identity, phase, hop });
    return attempt(invocation + ':1', { phase, operation, bytesOut: 0, attemptedBytesOut: 0 });
  };
  paired(meter, admit('11111111-2222-4333-8444-555555555555', 'startup', 'get'));
  const list = admit('22222222-2222-4333-8444-555555555555', 'workload', 'list');
  afterStop.acknowledgeStop({ statusCode: 200, ownedPath: '/owned/PRIVATE.db',
    body: Buffer.from('{"status":"stopped","path":"/owned/PRIVATE.db","txid":0}') });
  paired(meter, admit('33333333-2222-4333-8444-555555555555', 'idle', 'list'));
  meter.observeAttempt({ ...list, outcome: 'transport-error', attemptedBytesIn: 8 },
    { reason: 'transfer-interrupted', ioEvent: 'response-pipeline', code: 'ERR_STREAM_UNABLE_TO_PIPE',
      clientClosed: true, responseHeadersSeen: true });
  meter.observeAttempt({ ...list, channel: 'observer', bytesIn: 8, attemptedBytesIn: 8 });
  const result = meter.snapshot();
  assert.deepEqual(sorted(result), [bill('idle', 's3-list', 1), bill('startup', 's3-read', 1),
    bill('workload', 's3-list', null)]);
  assert.equal(result.status, 'unknown');
  assert.equal(result.reconciled, false);
  assert.ok(result.gaps.includes('after-stop:list-response-interrupted'));
  assert.deepEqual(result.accounting.discrepancy, { attempts: 0, bytesIn: 8, bytesOut: 0 });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|11111111|22222222/);
});
