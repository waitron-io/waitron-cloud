import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeter } from './meter.mjs';
import { createLitestreamAfterStop, litestreamAfterStopOutput } from './litestream.mjs';
import { assertSmokeAccounting } from './litestream-smoke-test-utils.mjs';

function observed({ phase = 'workload', operation = 'put', mode = 'paired' } = {}) {
  const meter = createMeter({ phase, clock: () => 0 });
  const event = { token: 'synthetic', phase, operation, retryOrdinal: 0, outcome: 'success', statusCode: 200,
    errorCode: null, sameAccount: null, bytesIn: 8, bytesOut: 16, attemptedBytesIn: 8, attemptedBytesOut: 16 };
  meter.observeAttempt({ ...event, channel: 'producer', ...(mode === 'cutoff'
    ? { outcome: 'transport-error', statusCode: null, bytesIn: 2 } : {}) });
  if (mode !== 'missing') meter.observeAttempt({ ...event, channel: 'observer',
    ...(mode === 'disagreement' ? { bytesOut: 12 } : {}) });
  if (mode === 'overflow') for (const channel of ['producer', 'observer'])
    meter.observeAttempt({ ...event, token: 'second', channel, bytesOut: Number.MAX_SAFE_INTEGER, attemptedBytesOut: Number.MAX_SAFE_INTEGER });
  return meter.snapshot();
}
function evidence(options, scope = 'replication') {
  const proof = observed(options), paired = observed();
  const requestProof = value => ({ requestsReconciled: true,
    producerAttempts: value.accounting.producer.attempts, observerAttempts: value.accounting.observer.attempts,
    status: 'unknown', requests: [], gaps: ['litestream:body-bytes-unpaired', 'litestream:object-lifetimes-unpaired'] });
  const result = { ...litestreamAfterStopOutput(createLitestreamAfterStop({ clock: () => 0 }).snapshot()),
    replication: requestProof(scope === 'replication' ? proof : paired), restore: requestProof(scope === 'restore' ? proof : paired),
    observed: scope === 'replication' ? proof : paired,
    transport: { replication: scope === 'replication' ? proof : paired, restore: scope === 'restore' ? proof : paired },
    administration: scope === 'administration' ? proof : observed({ phase: 'setup', operation: 'bucket-inspect' }) };
  if (options.mode === 'missing' && scope !== 'administration') {
    result[scope].requestsReconciled = false;
    result[scope].gaps.push('litestream:requests-unreconciled');
  }
  return result;
}

// Reinstating the after-stop-only exception rejects these original meter snapshots.
for (const [phase, operation, mode, scope] of [
  ['startup', 'put', 'cutoff', 'replication'],
  ['workload', 'get', 'disagreement', 'replication'],
  ['idle', 'list', 'missing', 'replication'],
  ['restore', 'get', 'cutoff', 'restore'],
  ['cleanup', 'delete', 'missing', 'administration'],
  ['setup', 'bucket-inspect', 'paired', 'administration'],
  ['workload', 'put', 'overflow', 'replication'],
]) test(`native smoke retains ${phase} ${operation} ${mode} accounting without an after-stop exception`, () => {
  const result = evidence({ phase, operation, mode }, scope);
  assertSmokeAccounting(result);
  const proof = scope === 'administration' ? result.administration : result.transport[scope];
  assert.equal(proof.billing[0].status, mode === 'overflow' ? 'measured' : 'unknown');
  assert.equal(proof.billing[0].quantity, mode === 'overflow' ? 2 : null);
  if (mode !== 'paired') assert.equal(proof.status, 'unknown');
});

// Declaring an accounting gap must not legitimise altered rows, totals or private data.
for (const [name, mutate] of [
  ['false precision', r => r.observed.status = 'measured'],
  ['false reconciliation', r => r.observed.reconciled = true],
  ['hidden billing uncertainty', r => { r.observed.billing[0].quantity = 1; r.observed.billing[0].status = 'measured'; }],
  ['impossible total', r => r.observed.accounting.observer.bytesIn++],
  ['missing gap', r => r.observed.gaps = []],
  ['private meter field', r => r.observed.path = 'PRIVATE_CANARY'],
  ['private row field', r => r.observed.accounting.requests[0].key = 'PRIVATE_CANARY'],
  ['restore forgery', r => r.transport.restore.accounting.producer.attempts++],
  ['administration forgery', r => r.administration.accounting.observer.bytesOut++],
]) test(`gapped native smoke refuses ${name}`, () => {
  const result = evidence({ mode: name.endsWith('forgery') ? 'paired' : 'cutoff' }); mutate(result);
  assert.throws(() => assertSmokeAccounting(result));
});

test('native smoke compares row values independently of property insertion order', () => {
  const result = evidence({ mode: 'paired' });
  result.observed.observedRequests[0] = Object.fromEntries(Object.entries(result.observed.observedRequests[0]).reverse());
  assertSmokeAccounting(result);
});

for (const [name, mutate] of [
  ['hidden overflow', r => { r.observed.status = 'measured'; r.observed.gaps = []; }],
  ['hidden storage uncertainty', r => {
    r.observed.accounting.objects = [{ class: 'stream', bytes: 16, byteSeconds: null,
      currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }];
  }],
]) test(`native smoke refuses ${name} without truthful unknown status and gaps`, () => {
  const result = evidence({ mode: name === 'hidden overflow' ? 'overflow' : 'paired' }); mutate(result);
  assert.throws(() => assertSmokeAccounting(result));
});

function storageEvidence() {
  const result = evidence({ mode: 'paired' });
  result.lifetimes = { status: 'unknown', scope: 'unversioned-object-history', windowSeconds: 10,
    objects: { class: 'stream', bytes: 16, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
    byteSeconds: { low: null, high: null }, gaps: ['accounting:incomplete-history'] };
  return result;
}

test('native smoke retains unknown storage time while functional restore is checked separately', () => {
  assertSmokeAccounting(storageEvidence());
});
for (const [name, mutate] of [
  ['false measured storage', r => r.lifetimes.status = 'measured'],
  ['hidden storage time gap', r => delete r.lifetimes.gaps],
  ['negative storage time', r => r.lifetimes.byteSeconds.low = -1],
  ['private storage field', r => r.lifetimes.path = 'PRIVATE_CANARY'],
]) test(`native smoke refuses ${name}`, () => {
  const result = storageEvidence(); mutate(result);
  assert.throws(() => assertSmokeAccounting(result));
});
