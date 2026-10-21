import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const module = await import('./synthetic.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./synthetic.mjs', import.meta.url).href) return {};
  throw error;
});
const bad = { message: 'Invalid cloud cost live plan' };
const run = value => {
  assert.equal(typeof module.preflightLive, 'function', 'evaluate the complete shape before provider creation');
  return module.preflightLive(value);
};
const stamp = '2026-10-21T00:00:00.000Z';
const rate = (id, unit, value) => ({ id, unit, value, status: 'list-priced', scope: 'usage', region: 'eu-north-1',
  source: 'https://aws.amazon.com/s3/pricing/', observedAt: stamp, effectiveAt: stamp, bounds: null, reason: null,
  service: 'AmazonS3', product: 'Synthetic test rate', sku: 'A'.repeat(16), rateCode: 'A'.repeat(16) + '.TEST',
  attributes: { regionCode: 'eu-north-1', billingBytesPerUnit: '1073741824' }, currency: 'USD',
  tier: { begin: 0, end: null }, minimum: { quantity: 0, unit }, rounding: { quantum: null, mode: 'none' }, retrievedAt: stamp, quote: 'Test fixture' });
const fixture = () => ({
  manifest: { schemaVersion: 1, kind: 'anonymous-storage-plan', region: 'eu-north-1',
    gaps: [], bounds: { s3Attempts: 100, kmsAttempts: 20, peakBytes: 1024, versions: 10, unfinishedMultipart: 2,
      elapsedSeconds: 1200, activeKeySeconds: 1200, byteSeconds: 921600 } },
  rates: { s3Put: [rate('s3-put', 'Requests', 0.001)], s3Get: [rate('s3-get', 'Requests', 0.002)],
    s3List: [rate('s3-list', 'Requests', 0.003)], s3Delete: [rate('s3-delete', 'Requests', 0)],
    s3Control: [rate('s3-control', 'Requests', 0.004)], kmsRequests: [rate('kms-requests', 'Requests', 0.01)],
    kmsKeyHours: [rate('kms-hours', 'Hrs', 1)], s3Storage: [rate('s3-storage', 'GB-Mo', 1)],
    costExplorer: [rate('cost-explorer', 'Requests', 0.01)] },
  credits: { availableUsd: 100, applicable: true, observedAt: stamp, expiresAt: '2026-11-01T00:00:00.000Z' },
  window: { startedAt: stamp, remainingSeconds: 3600, storageMonthSeconds: 2678400 },
  contingencies: { delayedCleanupSeconds: 600, cancelledDeletionSeconds: 3600 }, caps: {},
});

// A complete envelope reserves version/multipart enumeration, deletion and confirmation.
test('cleanupHeadroomAndKeyContingenciesAreIncludedInGrossWorstCase', () => {
  const f = fixture(), before = structuredClone(f), r = run(f);
  assert.equal(r.preflightPassed, true); assert.equal(r.providerAuthorised, false);
  assert.equal(r.cleanup.s3Attempts, 9); assert.equal(r.cleanup.kmsAttempts, 2);
  assert.equal(r.totals.s3Attempts, 109); assert.equal(r.totals.kmsAttempts, 22);
  assert.equal(r.totals.elapsedSeconds, 1800); assert.equal(r.billingCalls, 3);
  assert.equal(r.costs.s3Requests, 0.436); assert.equal(r.costs.kmsRequests, 0.22);
  assert.equal(r.costs.keyHours, 1.5); assert.equal(r.costs.billing, 0.03);
  assert.ok(r.grossUpperUsd > 2.186 && r.grossUpperUsd < 2.187);
  assert.equal(r.cashExposureUsd, 0); assert.deepEqual(f, before);
});

for (const [field, value, gap] of [
  ['s3Attempts', 9992, 'cap:s3Attempts'], ['kmsAttempts', 9999, 'cap:kmsAttempts'],
  ['peakBytes', 1073741825, 'cap:peakBytes'], ['versions', 1001, 'cap:versions'],
  ['elapsedSeconds', 86000, 'cap:elapsedSeconds'],
]) test('completeProjectedShapeOverCapIsRefusedWithoutTruncation_' + field, () => {
  const f = fixture(); f.manifest.bounds[field] = value;
  if (field === 'elapsedSeconds') f.manifest.bounds.activeKeySeconds = value;
  f.window.remainingSeconds = 86400;
  const r = run(f); assert.equal(r.preflightPassed, false); assert.ok(r.gaps.includes(gap));
  assert.equal(r.totals[field], value + (r.cleanup[field] ?? 0));
});

for (const credits of [null, { availableUsd: null, applicable: true, observedAt: stamp, expiresAt: '2026-11-01T00:00:00.000Z' },
  { availableUsd: 100, applicable: false, observedAt: stamp, expiresAt: '2026-11-01T00:00:00.000Z' },
  { availableUsd: 100, applicable: true, observedAt: stamp, expiresAt: stamp },
  { availableUsd: 0.1, applicable: true, observedAt: stamp, expiresAt: '2026-11-01T00:00:00.000Z' },
]) test('unknownInsufficientOrExpiredCreditsStopBeforeCreation_' + JSON.stringify(credits), () => {
  const f = fixture(); f.credits = credits;
  const r = run(f); assert.equal(r.preflightPassed, false); assert.equal(r.needsCreditDecision, true);
});

test('creditsMustCoverTheWholeWorstCaseCleanupAndCancelledDeletionWindow', () => {
  const f = fixture(); f.credits.expiresAt = '2026-10-21T00:30:00.000Z';
  assert.ok(run(f).gaps.includes('credits:expiry'));
});

test('unknownRatesAndWrongRegionNeverBecomeZero', () => {
  for (const change of [f => { f.rates.s3Control = []; }, f => { f.rates.s3Put[0].region = 'eu-south-2';
    f.rates.s3Put[0].attributes.regionCode = 'eu-south-2'; }]) {
    const f = fixture(); change(f); const r = run(f);
    assert.equal(r.preflightPassed, false); assert.equal(r.grossUpperUsd, null); assert.equal(r.cashExposureUsd, null);
    assert.ok(r.gaps.some(code => code.startsWith('rate:')));
  }
});

test('missingCompleteDailyShapeAndObjectBoundsRemainExplicitlyIneligible', () => {
  for (const gap of ['daily-cadence', 'scheduled-boundaries', 'object-size-lifetimes', 'retry-ceilings', 'operation-billing']) {
    const f = fixture(); f.manifest.gaps = [gap]; const r = run(f);
    assert.equal(r.preflightPassed, false); assert.ok(r.gaps.includes('shape:' + gap));
  }
  const f = fixture(); f.manifest = null; const r = run(f);
  assert.equal(r.preflightPassed, false); assert.ok(r.gaps.includes('shape:missing')); assert.equal(r.grossUpperUsd, null);
});

test('acceptedComponentProjectionCannotPretendToBeTheCompleteSyntheticManifest', () => {
  const f = fixture(); f.manifest = JSON.parse(readFileSync(new URL('../../docs/cost-model/usage-projection.json', import.meta.url)));
  assert.throws(() => run(f), bad);
});

// Payload-bearing shapes never pass merely by asserting synthetic provenance.
for (const change of [f => { f.manifest.raw = 'PRIVATE_RAW_CANARY'; }, f => { f.manifest.synthetic = true; },
  f => { f.manifest.path = '/PRIVATE_ARCHIVE'; }, f => { f.manifest.encrypted = true; },
  f => { f.manifest.bounds.versions = 1.5; }, f => { f.manifest.bounds.peakBytes = null; },
  f => { f.manifest.bounds.unfinishedMultipart = 11; }, f => { f.caps.s3Attempts = 10001; },
  f => { f.contingencies = null; }, f => { f.window.remainingSeconds = NaN; },
]) test('malformedRawOrWeakenedPlansAreRefused_' + change.toString(), () => {
  const f = fixture(); change(f); assert.throws(() => run(f), bad);
});

test('foregroundBudgetIncludesCleanupAndCanUseOnlyStricterCaps', () => {
  const f = fixture(); f.window.remainingSeconds = 1799;
  assert.ok(run(f).gaps.includes('foreground:insufficient-time'));
  f.window.remainingSeconds = 3600; f.caps.s3Attempts = 108;
  assert.ok(run(f).gaps.includes('cap:s3Attempts'));
});

test('runtimeGuardStopsBeforeTheNextOverBudgetPhysicalAttempt', () => {
  assert.equal(typeof module.createLiveBudgetGuard, 'function', 'charge attempts before dispatch and preserve cleanup headroom');
  const f = fixture(); f.caps.s3Attempts = 11; f.manifest.bounds.s3Attempts = 2;
  const guard = module.createLiveBudgetGuard(run(f));
  const action = { s3Attempts: 1, kmsAttempts: 0, peakBytes: 0, versions: 0, elapsedSeconds: 0 };
  let dispatched = 0;
  for (let i = 0; i < 3; i++) {
    try { guard.admit(action); dispatched++; } catch (e) { assert.equal(e.message, bad.message); }
  }
  assert.equal(dispatched, 2); assert.equal(guard.snapshot().s3Attempts, 2);
  assert.throws(() => module.createLiveBudgetGuard(structuredClone(run(f))), bad);
});

test('runtimeGuardKeepsAllResourceDimensionsAndCannotSpendRefusedOrAlteredBudgets', () => {
  assert.equal(typeof module.createLiveBudgetGuard, 'function');
  for (const [field, amount] of [['kmsAttempts', 10000], ['peakBytes', 1073741825], ['versions', 1001], ['elapsedSeconds', 86400]]) {
    const b = run(fixture()), guard = module.createLiveBudgetGuard(b);
    assert.throws(() => guard.admit({ s3Attempts: 0, kmsAttempts: 0, peakBytes: 0, versions: 0, elapsedSeconds: 0, [field]: amount }), bad);
    assert.deepEqual(guard.snapshot(), { s3Attempts: 0, kmsAttempts: 0, peakBytes: 0, versions: 0, elapsedSeconds: 0 });
  }
  const f = fixture(); f.credits = null; assert.throws(() => module.createLiveBudgetGuard(run(f)), bad);
  const b = run(fixture()); b.preflightPassed = false; assert.throws(() => module.createLiveBudgetGuard(b), bad);
  const enlarged = run(fixture()); enlarged.totals.s3Attempts++;
  assert.throws(() => module.createLiveBudgetGuard(enlarged), bad);
});

test('expiredCreditsDoNotReduceReportedCashExposure', () => {
  const f = fixture(); f.credits.expiresAt = stamp;
  const r = run(f); assert.equal(r.cashExposureUsd, null); assert.equal(r.preflightPassed, false);
});
test('aBudgetCannotBeReopenedToResetItsConsumedAttempts', () => {
  const b = run(fixture()); module.createLiveBudgetGuard(b);
  assert.throws(() => module.createLiveBudgetGuard(b), bad);
});
test('explicitNullCapsCannotFallBackToLargerLimits', () => {
  const f = fixture(); f.caps.s3Attempts = null; assert.throws(() => run(f), bad);
});
test('elapsedWallTimeCannotBeHiddenByZeroReportedActionDuration', () => {
  let seconds = 100;
  const guard = module.createLiveBudgetGuard(run(fixture()), { clock: () => seconds });
  seconds = 1301;
  assert.throws(() => guard.admit({ s3Attempts: 1, kmsAttempts: 0, peakBytes: 0, versions: 0, elapsedSeconds: 0 }), bad);
  assert.equal(guard.snapshot().s3Attempts, 0);
});
test('separateClassVolumeDiscountsCannotUnderpriceAMixedWorkload', () => {
  const f = fixture();
  for (const key of ['s3Put', 's3Get']) {
    const first = f.rates[key][0], discounted = structuredClone(first);
    first.value = 1; first.tier.end = 1;
    discounted.value = 0; discounted.tier.begin = 1;
    f.rates[key].push(discounted);
  }
  for (const key of ['s3List', 's3Delete', 's3Control']) f.rates[key][0].value = 0;
  // One put and one get cost $2; neither class's whole-volume total exceeds $1.
  assert.ok(run(f).costs.s3Requests >= 2, 'the upper bound must cover both independent first-tier charges');
});
test('marginalUpperBoundKeepsEachAttemptsMinimumAndRounding', () => {
  const f = fixture(); f.credits.availableUsd = 2000;
  for (const key of ['s3Put', 's3Get', 's3List', 's3Delete', 's3Control']) f.rates[key][0].value = 0;
  const p = f.rates.s3Put[0]; p.value = 0.005; p.minimum.quantity = 1000;
  p.rounding = { mode: 'ceil', quantum: 2000 };
  const r = run(f); assert.equal(r.costs.s3Requests, 1090); assert.equal(r.preflightPassed, true);
});
test('minimumChargeRemainsWithoutARoundingRuleToMaskIt', () => {
  const f = fixture(); f.credits.availableUsd = 2000;
  for (const key of ['s3Put', 's3Get', 's3List', 's3Delete', 's3Control']) f.rates[key][0].value = 0;
  const p = f.rates.s3Put[0]; p.value = 0.005; p.minimum.quantity = 1000;
  const r = run(f); assert.equal(r.costs.s3Requests, 545); assert.equal(r.preflightPassed, true);
});
