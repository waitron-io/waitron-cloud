import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as module from './stream-admission.mjs';

const options = { expectedSales: 3, startupSeconds: 2, idleSeconds: 2, windowSeconds: 60 };
const request = (phase, operation, requestClass, bytesIn, bytesOut, retryOrdinal = 0, outcome = 'success') => ({
  phase, operation, requestClass, outcome, retryOrdinal, attempts: 1,
  successful: outcome === 'success' ? 1 : 0, failed: outcome === 'success' ? 0 : 1,
  retried: retryOrdinal > 0 ? 1 : 0, bytesIn, bytesOut, attemptedBytesIn: bytesIn, attemptedBytesOut: bytesOut,
});
function counters(requests, totals) {
  return { reconciled: true, accounting: { requests, objects: [], producer: { ...totals }, observer: { ...totals },
    discrepancy: { attempts: 0, bytesIn: 0, bytesOut: 0 } }, observedRequests: structuredClone(requests) };
}
const evidence = () => ({
  phases: ['startup', 'workload', 'idle', 'verification', 'restore'].map(phase => ({ phase, elapsedSeconds: 2 })),
  requests: counters([
    request('startup', 'put', 's3-write', 3, 4096),
    request('workload', 'put', 's3-write', 4, 128, 0, 'server-error'),
    request('workload', 'put', 's3-write', 5, 128, 1),
    request('observer', 'list', 's3-list', 20, 0),
    request('restore', 'get', 's3-read', 4096, 0),
    request('cleanup', 'list', 's3-list', 30, 0),
  ], { attempts: 6, bytesIn: 4158, bytesOut: 4352 }),
  administration: counters([
    request('setup', 'bucket-create', 's3-control', 1, 0),
    request('cleanup', 'list', 's3-list', 40, 0),
    request('cleanup', 'delete', 's3-delete', 2, 0),
    request('cleanup', 'bucket-delete', 's3-control', 3, 0),
  ], { attempts: 4, bytesIn: 46, bytesOut: 0 }),
  storage: { status: 'measured', scope: 'unversioned-object-history', windowSeconds: 10,
    objects: { class: 'stream', bytes: 4096, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
    byteSeconds: { low: 5000, high: 6000 } },
  retainedStorage: { status: 'measured', scope: 'unversioned-cleanup-tail', windowSeconds: 2,
    initialBytes: 4096, deletedObjects: 1, remainingBytes: 0, remainingObjects: 0,
    byteSeconds: { low: 4096, high: 8192 } },
  native: { version: '0.5.17', writerStarts: 1, phaseRestarts: 0 }, restored: { sales: 3, integrity: true },
  cleanup: { processes: 0, privateRoots: 0, listeners: 0, clients: 0, buckets: 0, objects: 0, multipartUploads: 0 },
});

// Dropping either meter, observer requests, retries or either storage bound breaks these literal totals.
test('streamAccountingCombinesNativeObserverSetupAndCleanupWithoutLosingBounds', () => {
  assert.equal(typeof module.summarizeStreamAccounting, 'function', 'combine the complete stream measurement');
  const input = evidence(), result = module.summarizeStreamAccounting(input, options);
  assert.deepEqual(result.producer, { attempts: 10, bytesIn: 4204, bytesOut: 4352 });
  assert.deepEqual(result.observer, result.producer);
  assert.deepEqual(result.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  assert.deepEqual(result.requests, [
    ...input.requests.accounting.requests.slice(0, 5),
    { ...request('cleanup', 'list', 's3-list', 70, 0), attempts: 2, successful: 2 },
    input.administration.accounting.requests[0], ...input.administration.accounting.requests.slice(2),
  ]);
  assert.deepEqual(result.storage, { status: 'measured', scope: 'unversioned-stream-and-cleanup',
    windowSeconds: 12, remainingBytes: 0, remainingObjects: 0, byteSeconds: { low: 9096, high: 14192 } });
  assert.deepEqual(Object.keys(result).sort(), ['discrepancy', 'observer', 'producer', 'requests', 'storage']);
  assert.equal(/PRIVATE_|synthetic|\/state/.test(JSON.stringify(result)), false);
  input.requests.accounting.requests[0].bytesOut = 99;
  assert.equal(result.requests[0].bytesOut, 4096, 'return an independent public aggregate');
});

// Skipping admission lets a private field or an unmatched attempt cross the public boundary.
for (const [name, change] of [
  ['private-field', r => { r.requests.accounting.requests[0].key = 'PRIVATE_CANARY'; }],
  ['unmatched-attempt', r => { r.administration.observedRequests[0].attempts++; }],
  ['unfinished-cleanup', r => { r.cleanup.objects = 1; }],
  ['missing-tail', r => { delete r.retainedStorage; }],
]) test('streamAccountingRefuses_' + name, () => {
  assert.equal(typeof module.summarizeStreamAccounting, 'function');
  const input = evidence(); change(input);
  assert.throws(() => module.summarizeStreamAccounting(input, options), { message: 'Invalid cloud cost stream admission' });
});

// Each source counter is valid, but their sum must remain exactly representable in JavaScript.
test('streamAccountingRefusesUnsafeCombinedCounts', () => {
  assert.equal(typeof module.summarizeStreamAccounting, 'function');
  const input = evidence(), row = input.requests.accounting.requests[0];
  row.bytesOut = row.attemptedBytesOut = Number.MAX_SAFE_INTEGER - 256;
  input.requests.observedRequests = structuredClone(input.requests.accounting.requests);
  input.requests.accounting.producer.bytesOut = input.requests.accounting.observer.bytesOut = Number.MAX_SAFE_INTEGER;
  const admin = input.administration.accounting.requests[0]; admin.bytesOut = admin.attemptedBytesOut = 1;
  input.administration.observedRequests = structuredClone(input.administration.accounting.requests);
  input.administration.accounting.producer.bytesOut = input.administration.accounting.observer.bytesOut = 1;
  assert.doesNotThrow(() => module.validateStreamAdmission(input, options), 'both source meters are individually valid');
  assert.throws(() => module.summarizeStreamAccounting(input, options), { message: 'Invalid cloud cost stream admission' });
});

test('streamAccountingRefusesUnsafeMergedAttemptedBytesEvenWhenTransferredTotalsAreSafe', () => {
  const input = evidence();
  input.requests.accounting.requests[5].attemptedBytesIn = Number.MAX_SAFE_INTEGER;
  input.requests.observedRequests = structuredClone(input.requests.accounting.requests);
  assert.doesNotThrow(() => module.validateStreamAdmission(input, options), 'the separate counters remain valid');
  assert.throws(() => module.summarizeStreamAccounting(input, options), { message: 'Invalid cloud cost stream admission' });
});
