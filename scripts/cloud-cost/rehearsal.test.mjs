import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const module = await import('./rehearsal.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./rehearsal.mjs', import.meta.url).href) return {};
  throw error;
});
const read = name => JSON.parse(readFileSync(new URL('../../docs/cost-model/' + name + '.json', import.meta.url)));
const fixture = () => ({ samples: read('local-driver-evidence').experiments, ...read('projection-settings') });
const assess = value => {
  assert.equal(typeof module.assessStorageRehearsal, 'function', 'assess the accepted evidence before any AWS trial');
  return module.assessStorageRehearsal(value);
};

// Shrinking the high cadence scenario to the base value would hide this cap breach.
test('highAssumedWorkloadAloneExceedsTheTrialCapWithoutTruncation', () => {
  const f = fixture(), before = structuredClone(f), r = assess(f);
  assert.equal(r.status, 'stopped-before-provision'); assert.equal(r.providerAuthorised, false);
  assert.equal(r.trialRun, false); assert.equal(r.billingReadRequired, false);
  assert.equal(r.dailyVectorComplete, false); assert.equal(r.s3AttemptCap, 10000);
  assert.equal(r.scenarios.high.workloadAttempts, 130000);
  assert.equal(r.scenarios.base.workloadAttempts, 65);
  assert.equal(r.scenarios.base.startupAttempts, 24);
  assert.ok(r.scenarios.high.knownComponentAttempts > 143000);
  assert.ok(r.reasons.includes('assumed-high-components-exceed-s3-cap'));
  assert.deepEqual(f, before);
});

// Even zero sales and low assumed cadence cannot supply missing size/lifetime evidence.
test('underCapComponentsCannotAuthoriseAnIncompleteTrial', () => {
  const f = fixture();
  for (const row of Object.values(f.assumptions)) if (row.value !== null) row.bounds = {
    low: row.value, base: row.value, high: row.value, assumption: row.bounds.assumption };
  const r = assess(f);
  assert.ok(r.scenarios.high.knownComponentAttempts < 10000);
  assert.equal(r.status, 'stopped-before-provision'); assert.equal(r.providerAuthorised, false);
  for (const reason of ['object-size-lifetimes-unknown', 'scheduled-boundaries-unknown', 'retry-ceilings-unknown',
    'operation-billing-unknown']) assert.ok(r.reasons.includes(reason));
  assert.equal(r.completeDailyAttempts, null); assert.equal(r.completeDailyBytes, null);
});

// Excluding failed/setup/restore calls here could let a later manifest silently discard them.
test('assessmentRetainsEverySourceAttemptAndItsSeparatePhase', () => {
  const f = fixture(), r = assess(f);
  assert.deepEqual(r.sourceRequests, f.samples.stream.accounting.requests);
  assert.equal(r.sourceRequests.reduce((sum, row) => sum + row.attempts, 0), 342);
  assert.equal(r.sourceRequests.filter(row => row.outcome !== 'success').reduce((sum, row) => sum + row.attempts, 0), 8);
  assert.equal(r.sources.streamRunId, f.samples.stream.runId);
  assert.equal(r.scenarios.base.status, 'assumed');
  assert.equal(r.syntheticReplaySeconds, 900); assert.equal(r.syntheticTimingStatus, 'assumed');
  assert.ok(r.reasons.includes('owner-sessions-per-month:unknown'));
  assert.ok(r.unmeasured.includes('provider-billing'));
});

test('unsafeOrUnreconciledEvidenceCannotBecomeAStopReceipt', () => {
  for (const change of [f => { f.samples.stream.raw = 'PRIVATE_CANARY'; },
    f => { f.samples.stream.accounting.observer.attempts--; },
    f => { f.assumptions['workload-cadence-factor'].bounds.high = 0; }]) {
    const f = fixture(); change(f); assert.throws(() => assess(f), { message: 'Invalid cloud cost projection' });
  }
});
