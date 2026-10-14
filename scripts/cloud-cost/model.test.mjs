import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceUsage, estimate, retainedBytes, forecastArchives } from './model.mjs';

const instant = '2026-10-14T12:00:00.000Z';
const input = (id, value, unit = 'count', overrides = {}) => ({ id, value, unit,
  status: value === null ? 'unknown' : 'assumed', scope: 'usage', region: 'eu-south-2',
  source: value === null ? null : 'assumption:workload-assumption', observedAt: null,
  effectiveAt: null, bounds: value === null ? null : { low: value, base: value, high: value, assumption: 'workload-assumption' },
  reason: value === null ? 'not-measured' : 'workload-assumption', ...overrides });
const rate = (id, value, unit = 'Requests', overrides = {}) => ({
  ...input(id, value, unit), status: 'list-priced', source: 'https://aws.amazon.com/s3/pricing/',
  observedAt: instant, effectiveAt: instant, bounds: null, reason: null,
  service: 'AmazonS3', product: 'Synthetic test rate', sku: 'ABCDEFGH12345678',
  rateCode: 'ABCDEFGH12345678.JRTCKXETXF.6YS6EN2CT7', attributes: { regionCode: 'eu-south-2' },
  currency: 'USD', tier: { begin: 0, end: null }, minimum: { quantity: 0, unit },
  rounding: { quantum: null, mode: 'none' }, retrievedAt: instant, quote: 'Synthetic test rate', ...overrides });
const capacity = (id, value) => input(id, value, 'count', {
  scope: 'cell', source: value === null ? null : 'assumption:topology-assumption',
  reason: value === null ? 'not-measured' : 'topology-assumption',
  bounds: value === null ? null : { low: value, base: value, high: value, assumption: 'topology-assumption' } });
function fixture(venues) {
  return { venues, horizon: null, inputs: [input('base-units', 1), input('cell-units', 1), capacity('cell-capacity', 10), capacity('warm-cells', 0)],
    prices: [rate('base-price', 2), rate('cell-price', 3)],
    scenario: { region: 'eu-south-2', lines: [{ id: 'base', quantity: 'base-units', price: 'base-price', scope: 'platform' }],
      steps: [{ id: 'cells', capacity: 'cell-capacity', warm: 'warm-cells', lines: [{ id: 'gateway', quantity: 'cell-units', price: 'cell-price' }] }] } };
}

// Each literal catches a wrong divisor, tier boundary, or whole-request rounding.
test('billingUnitAndTierBoundaries', () => {
  assert.equal(priceUsage(input('traffic', 1e9, 'bytes'), rate('egress', 2, 'GB', {
    attributes: { regionCode: 'eu-south-2', billingBytesPerUnit: '1000000000' } })).cost, 2);
  assert.equal(priceUsage(input('traffic', 1073741824, 'bytes'), rate('egress', 2, 'GB', {
    attributes: { regionCode: 'eu-south-2', billingBytesPerUnit: '1073741824' } })).cost, 2);
  const tiers = [rate('requests', 2, 'Requests', { tier: { begin: 0, end: 10 } }),
    rate('requests', 1, 'Requests', { tier: { begin: 10, end: null } })];
  for (const [value, cost] of [[0, 0], [10, 20], [11, 21]]) assert.equal(priceUsage(input('requests', value), tiers).cost, cost);
  assert.equal(priceUsage(input('requests', 1), rate('requests', 0.000005)).cost, 0.000005);
});
test('missingRatePropagates', () => {
  assert.equal(priceUsage(input('requests', 1), null).cost, null);
  assert.equal(priceUsage(input('requests', null), rate('requests', 2)).cost, null);
  const f = fixture(10); f.prices.pop();
  const result = estimate(f); assert.equal(result.total, null); assert.equal(result.fixedAtZero, 2);
  assert.ok(result.gaps.includes('cell-price:not-priced'));
  assert.equal(priceUsage(input('requests', 0), null).cost, null);
});
test('zeroVenueAverage', () => {
  const result = estimate(fixture(0));
  assert.equal(result.fixedAtZero, 2); assert.equal(result.total, 2); assert.equal(result.average, null);
  assert.equal(result.steps.length, 1);
});
test('cellAndDatabaseCapacitySteps', () => {
  for (const [venues, fixed] of [[0, 2], [10, 5], [11, 8]]) assert.equal(estimate(fixture(venues)).fixed, fixed);
  const f = fixture(11);
  f.inputs.push(capacity('db-capacity', 5), capacity('warm-db', 1), input('db-units', 1));
  f.prices.push(rate('db-price', 4));
  f.scenario.steps.push({ id: 'database', capacity: 'db-capacity', warm: 'warm-db',
    lines: [{ id: 'database-runtime', quantity: 'db-units', price: 'db-price' }] });
  const result = estimate(f);
  assert.equal(result.fixedAtZero, 6); assert.equal(result.fixed, 20);
  assert.deepEqual(result.steps.map(s => [s.id, s.count]), [['cells', 2], ['database', 3]]);
  assert.ok(result.statuses.includes('assumed'));
});
test('noCapacityPretendsMeasured', () => {
  const f = fixture(11); f.inputs[2] = capacity('cell-capacity', null);
  assert.equal(estimate(f).total, null);
  f.inputs[2] = input('cell-capacity', 10, 'count', { status: 'measured',
    observedAt: instant, source: 'receipt:12345678-1234-4234-8234-123456789012', bounds: null, reason: null });
  assert.equal(estimate(f).total, null);
  assert.ok(estimate(f).gaps.includes('cell-capacity:capacity-assumption-required'));
});
test('aggregateTierAllocation', () => {
  const f = fixture(2);
  f.inputs.push(input('venue-requests', 6));
  f.prices.push(rate('usage-price', 2, 'Requests', { tier: { begin: 0, end: 10 } }),
    rate('usage-price', 1, 'Requests', { tier: { begin: 10, end: null } }));
  f.scenario.lines.push({ id: 'usage', quantity: 'venue-requests', price: 'usage-price', scope: 'venue' });
  assert.equal(estimate(f).venue, 22); assert.equal(estimate(f).average, 13.5);
});
test('regionalAndUnsupportedDimensionsStayUnknown', () => {
  assert.equal(priceUsage(input('traffic', 1e9, 'bytes'), rate('egress', 2, 'GB')).cost, null);
  assert.equal(priceUsage(input('requests', 1), rate('requests', 2, 'Requests', {
    region: 'eu-north-1', attributes: { regionCode: 'eu-north-1' } })).cost, null);
  const r = rate('requests', 2); r.rounding.mode = 'unknown'; assert.equal(priceUsage(input('requests', 1), r).cost, null);
  r.rounding.mode = 'none'; r.minimum.quantity = null; assert.equal(priceUsage(input('requests', 1), r).cost, null);
  assert.equal(priceUsage(input('requests', 1), [rate('requests', 2, 'Requests', { tier: { begin: 1, end: null } })]).cost, null);
  assert.equal(priceUsage(input('requests', 11), rate('requests', 2, 'Requests', { tier: { begin: 0, end: 10 } })).cost, null);
});
test('taskDurationIsRoundedBeforeResourceMultiplication', () => {
  const r = rate('cpu', 3600, 'hours', { attributes: { regionCode: 'eu-south-2', quantityDimension: 'vCPU-hour',
    minimumDurationSeconds: '60', billingDurationRoundSeconds: '1' }, minimum: { quantity: null, unit: 'hours' }, rounding: { quantum: null, mode: 'unknown' } });
  assert.equal(priceUsage({ duration: input('duration', 10, 'seconds'), resources: input('cpu-count', 0.25, 'vCPU') }, r).cost, 15);
  assert.ok(Math.abs(priceUsage({ duration: input('duration', 60.1, 'seconds'), resources: input('cpu-count', 2, 'vCPU') }, r).cost - 122) < 1e-10);
  assert.equal(priceUsage(input('cpu-hours', 1, 'hours'), r).cost, null);
  const scalarTermsKnown = { ...r, minimum: { quantity: 0, unit: 'hours' }, rounding: { mode: 'none', quantum: null } };
  assert.equal(priceUsage(input('cpu-hours', 1, 'hours'), scalarTermsKnown).cost, null);
});
test('storageByteSecondsNeedsExplicitBillingPeriod', () => {
  const r = rate('storage', 2, 'GB-Mo', { attributes: { regionCode: 'eu-south-2', billingBytesPerUnit: '1073741824' } });
  assert.equal(priceUsage({ input: input('storage', 1073741824 * 60, 'byte-seconds'), period: input('billing-period', 60, 'seconds') }, r).cost, 2);
  assert.equal(priceUsage(input('storage', 1073741824 * 60, 'byte-seconds'), r).cost, null);
});
test('invalidDriversAndArithmeticOverflowRefused', () => {
  for (const venues of [-1, 0.5, Infinity, NaN]) assert.throws(() => estimate(fixture(venues)), { message: 'Invalid cloud cost model' });
  assert.throws(() => priceUsage(input('requests', -1), rate('requests', 2)), { message: 'Invalid cloud cost evidence' });
  assert.equal(priceUsage(input('quantity', 1e308, 'hours'), rate('runtime', 2, 'hours')).cost, null);
  const f = fixture(1); f.inputs.push(f.inputs[0]); assert.throws(() => estimate(f), { message: 'Invalid cloud cost model' });
});

const day = 86400;
const at = (dayNumber, month = '01') => `2026-${month}-${String(dayNumber).padStart(2, '0')}T00:00:00.000Z`;
const policy = { dailyDays: 30, monthlyMonths: 12, streamSeconds: 86400, noncurrentSeconds: null, steady: false };
const create = (token, time, bytes, classification = 'daily-archive') => ({ type: 'create', token, at: time,
  class: classification, bytes: input('archive-bytes', bytes, 'bytes'), retention: classification === 'monthly-archive' ? 'monthly' : 'daily' });
const window = (start, end) => ({ startedAt: start, endedAt: end });

// Growing literal sizes catch a forecast that freezes the mature database at month-one size.
test('monthOneVersusMatureGrowingDatabase', () => {
  const first = retainedBytes([create('first', at(1), 100), create('second', at(2), 110)], window(at(1), at(3)), policy);
  const mature = retainedBytes([create('first', at(1, '12'), 1000), create('second', at(2, '12'), 1010)], window(at(1, '12'), at(3, '12')), policy);
  assert.equal(first.byteSeconds, 310 * day); assert.equal(mature.byteSeconds, 3010 * day);
  assert.ok(mature.statuses.includes('assumed'));
});
test('calendarMonthBoundary', () => {
  // January 31 plus one calendar month ends February 28, not March 3 or 730 hours later.
  const result = retainedBytes([create('monthly', at(31), 100, 'monthly-archive'), create('replacement', at(28, '02'), 1)],
    window(at(31), at(1, '03')), { ...policy, monthlyMonths: 1 });
  assert.equal(result.byteSeconds, 100 * 28 * day + day);
});
test('dailyMonthlyCopiesNotInventedDedup', () => {
  const separate = retainedBytes([create('daily', at(1), 100), create('monthly', at(1), 100, 'monthly-archive')], window(at(1), at(2)), policy);
  assert.equal(separate.byteSeconds, 200 * day);
  const selected = retainedBytes([create('one-actual-capture', at(1), 100, 'monthly-archive')], window(at(1), at(2)), policy);
  assert.equal(selected.byteSeconds, 100 * day);
});
test('protectedLastVerifiedSurvives', () => {
  const events = [create('old', at(1), 100), { type: 'verify', token: 'old', at: at(2), verified: true }];
  assert.equal(retainedBytes(events, window(at(1, '03'), at(3, '03')), policy).byteSeconds, 200 * day);
  events.push(create('new', at(2, '03'), 10), { type: 'verify', token: 'new', at: at(2, '03'), verified: true });
  assert.equal(retainedBytes(events, window(at(1, '03'), at(3, '03')), policy).byteSeconds, 110 * day);
});
test('failedReplacementAndRecoveryReferenceSurvive', () => {
  const events = [create('old', at(1), 100), { type: 'verify', token: 'old', at: at(1), verified: true },
    create('failed', at(2, '03'), 10), { type: 'verify', token: 'failed', at: at(2, '03'), verified: false }];
  assert.equal(retainedBytes(events, window(at(1, '03'), at(3, '03')), policy).byteSeconds, 210 * day);
  events.push({ type: 'reference', token: 'old', at: at(1, '03') }, { type: 'verify', token: 'failed', at: at(2, '03'), verified: true });
  assert.equal(retainedBytes(events, window(at(1, '03'), at(3, '03')), policy).byteSeconds, 210 * day);
  events.push({ type: 'release', token: 'old', at: at(2, '03') });
  assert.equal(retainedBytes(events, window(at(1, '03'), at(3, '03')), policy).byteSeconds, 110 * day);
});
test('noncurrentUnboundedHasNoFiniteSteadyTotal', () => {
  const events = [create('version', at(1), 100, 'stream'), { type: 'noncurrent', token: 'version', at: at(2) }];
  const finiteWindow = retainedBytes(events, window(at(1), at(3)), policy);
  assert.equal(finiteWindow.byteSeconds, 200 * day);
  const steady = retainedBytes(events, window(at(1), at(3)), { ...policy, steady: true });
  assert.equal(steady.byteSeconds, null); assert.ok(steady.gaps.includes('noncurrent:unbounded-retention'));
});
test('retentionRejectsContradictoryOrRawEvents', () => {
  for (const events of [[create('same', at(1), 1), create('same', at(2), 1)],
    [{ type: 'verify', token: 'missing', at: at(1), verified: true }],
    [{ ...create('raw', at(1), 1), payload: 'PRIVATE_SYNTHETIC_CANARY' }],
    [create('released', at(1), 1), { type: 'release', token: 'released', at: at(2) }]]) {
    assert.throws(() => retainedBytes(events, window(at(1), at(3)), policy), { message: 'Invalid cloud cost model' });
  }
});

test('requiredUnknownQuantitiesHaveNamedGaps', () => {
  const f = fixture(10); f.inputs[0] = input('base-units', null);
  const result = estimate(f); assert.equal(result.total, null);
  assert.ok(result.gaps.includes('base-units:not-measured'));
});
test('minimumAndRoundingTermsApplyToAggregateUsage', () => {
  const r = rate('requests', 2, 'Requests', { minimum: { quantity: 10, unit: 'Requests' }, rounding: { mode: 'ceil', quantum: 5 } });
  assert.equal(priceUsage(input('requests', 0), r).cost, 0);
  assert.equal(priceUsage(input('requests', 1), r).cost, 20);
  assert.equal(priceUsage(input('requests', 11), r).cost, 30);
});
test('aggregateStorageCannotInventPerObjectMinimums', () => {
  const r = rate('storage', 2, 'GB-Mo', { attributes: { regionCode: 'eu-south-2', minimumObjectBytes: '131072', minimumDurationDays: '30' } });
  const result = priceUsage(input('storage', 1, 'GB-Mo'), r);
  assert.equal(result.cost, null); assert.ok(result.gaps.includes('storage:object-lifecycle-required'));
});

test('forecastUsesMeasuredGrowthAndExplicitFutureWorkload', () => {
  const measured = (id, value) => input(id, value, 'bytes', { status: 'measured', source: 'receipt:12345678-1234-4234-8234-123456789012',
    observedAt: instant, bounds: null, reason: null });
  const args = { initial: measured('database-bytes', 100), growthPerSale: measured('database-growth-bytes', 2),
    ordersPerDay: input('orders-per-day', 3), originAt: at(1), captures: [
      { token: 'first', at: at(2), retention: 'monthly' }, { token: 'next', at: at(3), retention: 'daily' }] };
  const result = forecastArchives(args);
  assert.deepEqual(result.events?.map(e => [e.bytes.value, e.class]), [[106, 'monthly-archive'], [112, 'daily-archive']]);
  assert.deepEqual(result.statuses, ['measured', 'assumed']);
  assert.equal(result.events[0].bytes.status, 'assumed');
  const mature = forecastArchives({ ...args, captures: [{ token: 'later', at: at(2, '03'), retention: 'monthly' }] });
  assert.equal(mature.events[0].bytes.value, 460);
  const missing = forecastArchives({ ...args, ordersPerDay: input('orders-per-day', null) });
  assert.equal(missing.events, null); assert.ok(missing.gaps.includes('orders-per-day:not-measured'));
});
test('modelErrorsCannotEchoPrivateAccessorText', () => {
  const raw = {}; Object.defineProperty(raw, 'type', { get() { throw new Error('PRIVATE_SYNTHETIC_CANARY'); } });
  assert.throws(() => retainedBytes([raw], window(at(1), at(2)), policy), { message: 'Invalid cloud cost model' });
  const quantity = {}; Object.defineProperty(quantity, 'duration', { get() { throw new Error('PRIVATE_SYNTHETIC_CANARY'); } });
  assert.throws(() => priceUsage(quantity, rate('requests', 1)), { message: 'Invalid cloud cost model' });
  assert.throws(() => estimate(null), { message: 'Invalid cloud cost model' });
  assert.throws(() => forecastArchives(null), { message: 'Invalid cloud cost model' });
});
test('taskResourcesKeepTheirActualUnits', () => {
  const r = rate('cpu', 3600, 'hours', { attributes: { regionCode: 'eu-south-2', quantityDimension: 'vCPU-hour',
    minimumDurationSeconds: '60', billingDurationRoundSeconds: '1' }, minimum: { quantity: null, unit: 'hours' }, rounding: { quantum: null, mode: 'unknown' } });
  assert.equal(priceUsage({ duration: input('duration', 10, 'seconds'), resources: input('cpu-count', 0.25, 'vCPU') }, r).cost, 15);
  const memory = { ...r, id: 'memory', attributes: { ...r.attributes, quantityDimension: 'GB-hour' } };
  assert.equal(priceUsage({ duration: input('duration', 10, 'seconds'), resources: input('memory-gb', 2, 'GB') }, memory).cost, 120);
  assert.equal(priceUsage({ duration: input('duration', 10, 'seconds'), resources: input('memory-gb', 2, 'GB') }, r).cost, null);
});
test('unboundedStreamCannotClaimFiniteSteadyStorage', () => {
  const result = retainedBytes([create('stream', at(1), 100, 'stream')], window(at(1), at(3)), {
    ...policy, streamSeconds: null, steady: true });
  assert.equal(result.byteSeconds, null); assert.ok(result.gaps.includes('stream:unbounded-retention'));
});
