import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createMeter } from './meter.mjs';
import { streamCounters } from './worker-storage.mjs';

test('workerStorageRetainsCleanOriginalBillingBeforeTheWorkerChoosesItsResultVariant', () => {
  const result = spawnSync(process.execPath, [new URL('./fixtures/worker-storage-diagnostic-probe.mjs', import.meta.url).pathname,
    'measured:success', 'finish'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.message, null);
  assert.equal(output.evidence.status, 'measured');
  assert.deepEqual(output.evidence.gaps, []);
  assert.deepEqual(output.evidence.billing, [{ phase: 'setup', requestClass: 's3-write', quantity: 1, status: 'measured' }]);
  assert.equal(output.evidence.reconciled, true);
  assert.equal(output.collected, true);
});

test('workerStorageReportsBucketWitnessesAfterIndependentCleanupDespiteMeterDisagreement', () => {
  const result = spawnSync(process.execPath, [new URL('./fixtures/worker-storage-diagnostic-probe.mjs', import.meta.url).pathname,
    'gap:success', 'finish'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.message, null);
  assert.deepEqual(output.evidence.functional, { bucketCreated: true, bucketRemoved: true });
  assert.equal(output.evidence.reconciled, false);
  assert.equal(output.bucketRemoved, true);
  assert.equal(output.collected, true);
  assert.equal(output.rootRetained, false);
});

test('cleanStreamCountersKeepTheirOriginalProjectionAndDetachedValues', () => {
  const meter = createMeter({ phase: 'setup', clock: () => 0 });
  for (const channel of ['producer', 'observer']) meter.observeAttempt({ token: 'synthetic:0', channel,
    phase: 'startup', operation: 'put', retryOrdinal: 0, outcome: 'success', statusCode: 200,
    errorCode: null, sameAccount: null, bytesIn: 0, bytesOut: 4, attemptedBytesIn: 0, attemptedBytesOut: 4 });
  const original = meter.snapshot(), result = streamCounters(original);
  assert.deepEqual(Object.keys(result).sort(), ['accounting', 'observedRequests', 'reconciled']);
  assert.equal(result.reconciled, true);
  assert.deepEqual(result.accounting.producer, { attempts: 1, bytesIn: 0, bytesOut: 4 });
  assert.deepEqual(result.accounting.observer, result.accounting.producer);
  original.accounting.requests[0].bytesOut = 99;
  assert.equal(result.accounting.requests[0].bytesOut, 4);
});

// Dropping original billing or either hop can turn an unknown measurement into an exportable one.
for (const kind of ['mismatch', 'cutoff', 'billing']) test(`streamCountersRetainsOriginalAccounting_${kind}`, () => {
  const meter = createMeter({ phase: 'setup', clock: () => 0 });
  for (const channel of kind === 'mismatch' ? ['producer'] : ['producer', 'observer']) meter.observeAttempt({
    token: 'synthetic:0', channel, phase: 'setup', operation: kind === 'billing' ? 'bucket-inspect' : 'put',
    retryOrdinal: 0, outcome: kind === 'cutoff' ? 'transport-error' : 'success',
    statusCode: kind === 'cutoff' ? null : 200, errorCode: null, sameAccount: null,
    bytesIn: 0, bytesOut: 4, attemptedBytesIn: 0, attemptedBytesOut: 4,
  });
  const original = meter.snapshot(), result = streamCounters(original);
  assert.equal(result.status, kind === 'billing' ? 'measured' : 'unknown');
  assert.deepEqual(result, original, 'retain both actual hops, billing quantities and the original gap labels');
  assert.equal(result.billing[0].quantity, null);
  original.gaps.push('accounting:overflow'); original.accounting.requests[0].bytesOut = 99;
  assert.equal(result.accounting.requests[0].bytesOut, 4, 'return detached evidence');
  assert.equal(result.gaps.includes('accounting:overflow'), false);
});

for (const mode of ['gap', 'billing']) for (const action of ['finish', 'close', 'concurrent']) {
  test(`gappedAdminAccountingDoesNotFailCleanup_${mode}_${action}`, () => {
    const result = spawnSync(process.execPath, [new URL('./fixtures/worker-storage-diagnostic-probe.mjs', import.meta.url).pathname,
      mode + ':success', action], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.message, null, 'accounting uncertainty must not refuse independently verified cleanup');
    assert.deepEqual(output.records, []);
    assert.equal(output.collected, true);
    assert.equal(output.proxyClosed, 1);
    assert.equal(output.destroyed, 2);
    assert.equal(output.bucketRemoved, true);
    assert.equal(output.rootRetained, false);
    if (action !== 'close') {
      assert.equal(output.evidence.status, mode === 'billing' ? 'measured' : 'unknown');
      assert.equal(output.evidence.reconciled, mode === 'billing');
      assert.equal(output.evidence.billing[0].quantity, null);
      assert.equal(output.evidence.accounting.producer.attempts, 1);
      assert.equal(output.evidence.accounting.observer.attempts, mode === 'billing' ? 1 : 0);
      assert.equal(output.evidence.accounting.discrepancy.attempts, mode === 'billing' ? 0 : -1);
    }
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE/);
  });
}

// A measurement gap cannot excuse an actual failed delete, lost ownership or failed collection.
for (const fault of ['bucket-inventory', 'bucket-present', 'object-list', 'multipart-list', 'delete-bucket',
  'proxy-close', 'client-close', 'process-collect', 'root-remove', 'retained-inventory', 'storage-health',
  'bucket-ownership', 'delete-object', 'abort-upload', 'accounting', 'retained-accounting']) {
  test(`cleanupFailureWithAccountingGapStillFails_${fault}`, () => {
    const result = spawnSync(process.execPath, [new URL('./fixtures/worker-storage-diagnostic-probe.mjs', import.meta.url).pathname,
      'gap:' + fault], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.message, 'Invalid cloud cost worker storage');
    assert.deepEqual(output.records, [{ kind: 'storage-refusal', stage: fault }]);
    assert.equal(output.collected, fault !== 'bucket-ownership');
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE/);
  });
}

test('retainedCleanupAggregateOverflowBecomesUnknownAfterVerifiedDeletion', () => {
  const result = spawnSync(process.execPath, [new URL('./fixtures/worker-storage-diagnostic-probe.mjs', import.meta.url).pathname,
    'retained-overflow'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.message, null, 'safe individual observations cannot fail cleanup through aggregate overflow');
  assert.deepEqual(output.evidence.retainedStorage, { status: 'unknown', scope: 'unversioned-cleanup-tail',
    gaps: ['accounting:overflow'], windowSeconds: 3000000000000000 - 10, initialBytes: 4,
    deletedObjects: 1, remainingBytes: 0, remainingObjects: 0, byteSeconds: { low: null, high: null } });
  assert.equal(output.rootRetained, false);
  assert.equal(output.bucketRemoved, true);
  assert.equal(output.collected, true);
  assert.equal(output.proxyClosed, 1);
  assert.deepEqual(output.records, []);
});
