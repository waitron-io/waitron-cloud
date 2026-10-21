import { test } from 'node:test';
import assert from 'node:assert/strict';
const module = await import('./aws.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./aws.mjs', import.meta.url).href) return {};
  throw error;
});
const window = { startedAt: '2026-10-21T00:00:00.000Z', endedAt: '2026-10-22T00:00:00.000Z' };
const line = (changes = {}) => ({ service: 'AmazonS3', usageType: 'EUN1-Requests-Tier1', region: 'eu-north-1',
  operation: 'PutObject', unit: 'Requests', ...window, amount: 1, quantity: 100, ...changes });
const prediction = changes => ({ id: 'stream-put', ...line(changes) });
const observed = changes => ({ id: 'usage-1', recordType: 'Usage', attribution: 'exclusive-run', ...line(changes) });
const fixture = () => ({ predicted: [prediction()], observed: [observed()], window });
const compare = value => {
  assert.equal(typeof module.compareUsage, 'function', 'reconcile gross usage without allocating ambiguous account charges');
  return module.compareUsage(value);
};
const bad = { message: 'Invalid cloud cost billing evidence' };

// Credits are reported independently; net zero never validates the prediction.
test('creditsCannotMaskGrossUsageVariance', () => {
  const f = fixture(); f.observed[0].amount = 2;
  f.observed.push(observed({ id: 'credit-1', recordType: 'Credit', amount: -2 }));
  const r = compare(f);
  assert.equal(r.matched.length, 1); assert.equal(r.matched[0].observedAmount, 2);
  assert.equal(r.credits.length, 1); assert.equal(r.credits[0].amount, -2);
  assert.equal(r.variance[0].ratio, 1); assert.equal(r.variance[0].requiresExplanation, true);
  assert.equal(r.complete, false); assert.deepEqual(r.pending, []);
});

test('matchingUsageRetainsGrossQuantitiesAndNeverAltersInput', () => {
  const f = fixture(), before = structuredClone(f), r = compare(f);
  assert.equal(r.complete, true); assert.equal(r.matched[0].predictedAmount, 1);
  assert.equal(r.matched[0].observedAmount, 1); assert.equal(r.matched[0].observedQuantity, 100);
  assert.deepEqual(r.pending, []); assert.deepEqual(r.unmatched, []); assert.deepEqual(f, before);
});

test('missingAndZeroBillingStayPendingRatherThanFree', () => {
  for (const rows of [null, [], [observed({ amount: 0, quantity: 0 })]]) {
    const f = fixture(); f.observed = rows;
    const r = compare(f); assert.equal(r.complete, false); assert.deepEqual(r.pending, ['stream-put']);
    assert.equal(r.matched.length, 0);
  }
});

test('priorKeyOtherLaneAndAmbiguousChargesAreUnmatched', () => {
  const f = fixture(); f.observed = ['prior-key', 'other-activity', 'ambiguous'].map((attribution, i) => observed({ id: 'other-' + i, attribution }));
  const r = compare(f); assert.equal(r.unmatched.length, 3); assert.deepEqual(r.pending, ['stream-put']);
  assert.equal(r.matched.length, 0); assert.equal(r.complete, false);
});

for (const [key, value] of [['region', 'eu-south-2'], ['operation', 'GetObject'], ['unit', 'GiB'],
  ['usageType', 'EUS2-Requests-Tier1'], ['service', 'AWSKMS'], ['startedAt', '2026-10-21T01:00:00.000Z'],
  ['endedAt', '2026-10-23T00:00:00.000Z']]) test('regionOperationUnitAndExactWindowMustMatch_' + key, () => {
  const f = fixture(); f.observed = [observed({ [key]: value })];
  const r = compare(f); assert.equal(r.unmatched.length, 1); assert.deepEqual(r.pending, ['stream-put']);
  assert.equal(r.matched.length, 0);
});

for (const [amount, expected] of [[1.2, false], [1.2001, true], [0.8, false], [0.7999, true]]) {
  test('strictTwentyPercentThreshold_' + amount, () => {
    const f = fixture(); f.observed[0].amount = amount;
    const r = compare(f); assert.equal(r.variance[0].requiresExplanation, expected); assert.equal(r.complete, !expected);
  });
}
test('positiveUsageAgainstZeroPredictionNeedsExplanation', () => {
  const f = fixture(); f.predicted[0].amount = 0;
  const r = compare(f); assert.equal(r.variance[0].requiresExplanation, true); assert.equal(r.variance[0].ratio, null);
  assert.equal(r.complete, false);
});
test('multipleAccountRowsAggregateOnceWithoutDuplicatingAPrediction', () => {
  const f = fixture(); f.observed = [observed({ id: 'first', amount: 0.4, quantity: 40 }), observed({ id: 'second', amount: 0.6, quantity: 60 })];
  const r = compare(f); assert.equal(r.matched.length, 1); assert.equal(r.matched[0].observedAmount, 1);
  assert.equal(r.matched[0].observedQuantity, 100); assert.equal(r.complete, true);
});
test('aSharedAccountDimensionCannotBeAllocatedToTwoRunPredictions', () => {
  const f = fixture(); f.predicted.push(prediction({ id: 'archive-put' }));
  const r = compare(f); assert.equal(r.matched.length, 0); assert.equal(r.unmatched.length, 1);
  assert.deepEqual(r.pending, ['stream-put', 'archive-put']); assert.equal(r.complete, false);
});
test('quantityVarianceCannotDisappearBehindAnUnchangedCost', () => {
  const f = fixture(); f.observed[0].quantity = 200;
  const r = compare(f); assert.equal(r.variance[0].quantityRatio, 1);
  assert.equal(r.variance[0].requiresExplanation, true); assert.equal(r.complete, false);
});
for (const change of [f => { f.observed[0].raw = 'PRIVATE_CANARY'; }, f => { f.predicted[0].amount = -1; },
  f => { f.observed[0].amount = -1; }, f => { f.observed[0].quantity = NaN; },
  f => { f.observed[0].attribution = 'guess'; }, f => { f.observed.push(structuredClone(f.observed[0])); },
  f => { f.predicted[0].endedAt = window.startedAt; },
]) test('malformedBillingCannotEscapeOrMatch_' + change.toString(), () => {
  const f = fixture(); change(f); assert.throws(() => compare(f), bad);
});

const checkpoint = () => ({ window, region: 'eu-north-1', dueAt: window.endedAt, callsUsed: 0, maxCalls: 3,
  usage: 'unread', credit: 'unread', continuation: null });
const next = (value, now = window.endedAt) => {
  assert.equal(typeof module.nextBillingCall, 'function', 'plan due reads inside one physical call budget');
  return module.nextBillingCall(value, now);
};
test('billingWaitsUntilDueAndReadsGrossUsageBeforeCreditWithoutPolling', () => {
  const c = checkpoint(); assert.deepEqual(next(c, window.startedAt), { pending: true, reason: 'not-due', request: null });
  const r = next(c); assert.equal(r.request.Filter.Dimensions.Key, 'RECORD_TYPE');
  assert.deepEqual(r.request.Filter.Dimensions.Values, ['Usage']);
  assert.deepEqual(r.request.GroupBy, [{ Type: 'DIMENSION', Key: 'SERVICE' }, { Type: 'DIMENSION', Key: 'USAGE_TYPE' }]);
  assert.deepEqual(r.request.Metrics, ['UnblendedCost', 'UsageQuantity']);
  assert.deepEqual(r.request.TimePeriod, { Start: '2026-10-21', End: '2026-10-22' });
  assert.equal(r.debitBeforeDispatch, 1); assert.equal(r.callsRemainingAfterDebit, 2);
  c.callsUsed = 1; c.usage = 'complete';
  assert.deepEqual(next(c).request.Filter.Dimensions.Values, ['Credit']);
  c.credit = 'complete'; c.callsUsed = 2;
  assert.deepEqual(next(c), { pending: false, reason: 'reads-complete', request: null });
});
test('continuationsAndFailuresConsumeTheSameAtMostThreePhysicalCalls', () => {
  const c = checkpoint(); c.callsUsed = 2; c.usage = 'incomplete';
  c.continuation = { recordType: 'Usage', token: 'PRIVATE_TOKEN' };
  const r = next(c); assert.equal(r.request.NextPageToken, 'PRIVATE_TOKEN'); assert.equal(r.callsRemainingAfterDebit, 0);
  assert.equal(r.request.Filter.Dimensions.Values[0], 'Usage');
  c.callsUsed = 3;
  assert.deepEqual(next(c), { pending: true, reason: 'call-budget-exhausted', request: null });
  c.continuation = null;
  assert.equal(next(c).request, null);
});
test('checkpointCannotClaimCompletedReadsWithNoDebitedPhysicalCall', () => {
  const c = checkpoint(); c.usage = 'complete'; assert.throws(() => next(c), bad);
  c.callsUsed = 1; c.credit = 'complete'; assert.throws(() => next(c), bad);
});
for (const change of [c => { c.maxCalls = 4; }, c => { c.callsUsed = -1; }, c => { c.region = 'eu-south-2'; },
  c => { c.window = { ...window, startedAt: '2026-10-21T01:00:00.000Z' }; },
  c => { c.dueAt = window.startedAt; }, c => { c.secret = 'PRIVATE_KEY'; },
  c => { c.continuation = { recordType: 'Credit', token: 'x' }; },
]) test('malformedBillingCheckpointIsRefused_' + change.toString(), () => {
  const c = checkpoint(); change(c); assert.throws(() => next(c), bad);
});
