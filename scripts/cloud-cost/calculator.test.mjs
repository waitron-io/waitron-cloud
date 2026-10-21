import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const module = await import('./calculator.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./calculator.mjs', import.meta.url).href) return {};
  throw error;
});
const read = name => JSON.parse(readFileSync(new URL('../../docs/cost-model/' + name + '.json', import.meta.url)));
const fixture = () => ({ schemaVersion: 1, prices: read('prices').records,
  inventory: read('inventory').rows.map(({ id, inclusion }) => ({ id, inclusion })),
  basis: { sales: 207, databaseBytes: 19546112, growthBytes: 700416, archiveBytes: 3527677,
    ownerBytesOut: 2836968, idleSeconds: 1200.008791962,
    requests: read('measurements').accounting.requests,
    sources: { stream: { file: 'measurements.json', revision: '67774bcbe85283c614b1b64a3cdcee585531629d', observedAt: '2026-10-21T00:21:31.699Z' },
      archive: { file: 'archive-replay.json', revision: '73cd7239fc24d34271bca351e5b23c20aa9295ca', observedAt: '2026-10-21T03:33:01.154Z' },
      owner: { file: 'remote-owner-browser.json', revision: '4c26e9f052ff880f65b138ba9ac8fe5440b97771', observedAt: '2026-10-21T02:48:07.000Z' } } } });
const calculate = (data, controls) => {
  assert.equal(typeof module.calculateCosts, 'function', 'calculate the public model without private data or network');
  return module.calculateCosts({ data, controls });
};
const controls = () => ({ region: 'eu-south-2', topology: 'single', ordersPerDay: 207, retentionMonths: 12,
  sessionsPerMonth: null, capacity: 10, databaseCapacity: 100, warmCells: 0,
  controlDiskGB: 10, gatewayDiskGB: 5, databaseGB: 20, natGateways: 0, platformKeys: 1, venueKeys: 1,
  archiveBaseBytes: 19546112, growthFactor: 1, cadenceFactor: 1, idleSeconds: 32228.364, startsPerDay: 1,
  sessionOverhead: 1, egressBytesPerGB: null, publicGB: null });
const row = (r, n, level = 'base') => r.scenarios[level].rows.find(row => row.venues === n);
const line = (r, n, id) => row(r, n).lines.find(row => row.id === id);

// Missing required drivers must leave a named gap, even when other lines can be priced.
test('defaultsShowUsefulPricedSubtotalsAndNeverClaimACompleteBill', () => {
  const r = calculate(fixture(), controls());
  assert.deepEqual(r.scenarios.base.rows.map(row => row.venues), [0, 1, 10, 100, 1000]);
  assert.equal(row(r, 0).averageSubtotal, null);
  assert.equal(row(r, 0).total, null); assert.equal(row(r, 10).total, null);
  assert.ok(row(r, 1).subtotal > 40); assert.ok(row(r, 1).gaps.includes('sessionsPerMonth:unknown'));
  assert.ok(r.gaps.includes('inventory:versions-multipart'));
  assert.ok(r.gaps.includes('inventory:mail'));
  assert.equal(r.allowancesApplied, false); assert.equal(r.creditsApplied, false); assert.equal(r.tax, null);
});

// A gateway costs one whole instance per cell; the RDS Multi-AZ price already includes standby.
test('capacityCrossingsAndRedundancyUseWholeResourcesAndGrossRegionalRates', () => {
  const c = controls(), data = fixture(), r = calculate(data, c);
  assert.equal(line(r, 10, 'gateway-compute').quantity, 730);
  assert.equal(line(r, 100, 'gateway-compute').quantity, 7300);
  assert.equal(line(r, 10, 'gateway-compute').cost, 16.644000000000002);
  c.topology = 'redundant'; const redundant = calculate(data, c);
  assert.equal(line(redundant, 10, 'gateway-compute').quantity, 1460);
  assert.equal(line(redundant, 10, 'database-compute').quantity, 730);
  assert.ok(Math.abs(line(redundant, 10, 'database-compute').cost - 25.55) < 1e-10);
  c.region = 'eu-north-1'; const stockholm = calculate(data, c);
  assert.notEqual(line(stockholm, 10, 'gateway-compute').cost, line(redundant, 10, 'gateway-compute').cost);
  assert.deepEqual(r.scenarios.base.rows[2].capacity, { cells: 1, databases: 1, assumed: true });
});

// Sales may be zero while startup, idle and per-venue keys still cost money.
test('zeroSalesKeepsStartupIdleAndKeysWhileRequestTiersAggregateAcrossVenues', () => {
  const c = controls(); c.ordersPerDay = 0;
  const r = calculate(fixture(), c);
  assert.ok(line(r, 1, 'stream-write-list').quantity > 0);
  assert.equal(line(r, 1, 'venue-keys').quantity, 1);
  assert.equal(line(r, 0, 'venue-keys').cost, 0);
  c.startsPerDay = 0; c.idleSeconds = 0; c.ordersPerDay = 1;
  const tiny = calculate(fixture(), c);
  // 65 / 207 * 31 * 10 => 97.342..., rounded once to 98 at account scope.
  assert.equal(line(tiny, 10, 'stream-write-list').quantity, 98);
});

// A blank field differs from a deliberate zero. No regional rate may be borrowed.
test('missingCapacityAndRatesPropagateWithoutHidingThePricedRemainder', () => {
  const data = fixture(), c = controls(); c.capacity = null;
  data.prices = data.prices.filter(row => row.id !== 'ec2-t3-small' || row.region !== 'eu-south-2');
  const r = calculate(data, c);
  assert.equal(line(r, 10, 'gateway-compute').cost, null);
  assert.equal(row(r, 10).capacity.cells, null);
  assert.equal(line(r, 10, 'control-compute').cost, null);
  assert.ok(row(r, 10).subtotal > 0);
  assert.ok(row(r, 10).gaps.includes('capacity:unknown'));
  assert.ok(row(r, 10).gaps.some(code => code.includes('not-priced')));
});

// Retention is a calendar simulation with continued database growth, not a flat mature database.
test('retentionAndFutureGrowthChangeStorageWithExplicitAssumptionBounds', () => {
  const c = controls(); c.growthFactor = 0;
  const flat = calculate(fixture(), c);
  assert.ok(flat.scenarios.base.archive.monthOneByteSeconds > 0);
  assert.ok(flat.scenarios.base.archive.matureByteSeconds > flat.scenarios.base.archive.monthOneByteSeconds);
  c.retentionMonths = 2; const short = calculate(fixture(), c);
  assert.ok(short.scenarios.base.archive.matureByteSeconds < flat.scenarios.base.archive.matureByteSeconds);
  c.growthFactor = 1; const growing = calculate(fixture(), c);
  assert.ok(growing.scenarios.high.archive.matureByteSeconds > growing.scenarios.base.archive.matureByteSeconds);
  assert.ok(growing.scenarios.base.archive.matureByteSeconds > growing.scenarios.low.archive.matureByteSeconds);
  assert.equal(growing.scenarios.base.archive.steady, false);
});

// Measured TLS bytes are not provider-billed GB until the mapping is explicitly assumed.
test('sessionVolumeAffectsCostOnlyWithAnExplicitByteMappingAndStaysAssumed', () => {
  const c = controls(), data = fixture(); c.sessionsPerMonth = 2; c.publicGB = 0;
  // The public rates still have unknown transfer minimums/rounding. Only this
  // synthetic fixture supplies those terms to test the arithmetic independently.
  for (const rate of data.prices.filter(row => row.id === 'internet-egress')) {
    rate.minimum.quantity = 0; rate.rounding.mode = 'none';
  }
  let r = calculate(data, c);
  assert.equal(line(r, 1, 'internet-transfer').cost, null);
  assert.equal(r.scenarios.base.sessionBytesPerVenue, 5673936);
  c.egressBytesPerGB = 1000000000; r = calculate(data, c);
  assert.ok(Math.abs(line(r, 1, 'internet-transfer').cost - 0.00051065424) < 1e-12);
  c.sessionsPerMonth = 4;
  assert.ok(line(calculate(data, c), 1, 'internet-transfer').cost > line(r, 1, 'internet-transfer').cost);
  assert.ok(line(r, 1, 'internet-transfer').statuses.includes('assumed'));
});

for (const [key, value] of [['ordersPerDay', -1], ['ordersPerDay', 1.5], ['retentionMonths', 0], ['retentionMonths', 37],
  ['sessionsPerMonth', NaN], ['capacity', 0], ['capacity', 1.5], ['region', 'other'], ['topology', 'other'], ['growthFactor', Infinity],
  ['egressBytesPerGB', 0]]) test('invalidControlIsRefused_' + key + '_' + value, () => {
  const c = controls(); c[key] = value;
  assert.throws(() => calculate(fixture(), c), { message: 'Invalid cloud cost calculator' });
});

test('extraDataAndAccessorsAreRejectedWithoutEvaluatingPrivateCode', () => {
  const data = fixture(); data.raw = 'PRIVATE_CANARY';
  assert.throws(() => calculate(data, controls()), { message: 'Invalid cloud cost calculator' });
  const c = controls(); let called = 0;
  Object.defineProperty(c, 'ordersPerDay', { get() { called++; throw Error('PRIVATE_CANARY'); } });
  assert.throws(() => calculate(fixture(), c), { message: 'Invalid cloud cost calculator' }); assert.equal(called, 0);
});

test('startupAndIdleAreIndependentlyPricedWhenNoSalesOccur', () => {
  const data = fixture(), c = controls(); c.ordersPerDay = 0; c.startsPerDay = 0; c.idleSeconds = data.basis.idleSeconds;
  const idle = calculate(data, c);
  assert.equal(line(idle, 1, 'stream-write-list').quantity, 5456);
  assert.equal(line(idle, 1, 'stream-read').quantity, 124);
  c.startsPerDay = 1; c.idleSeconds = 0; const startup = calculate(data, c);
  assert.equal(line(startup, 1, 'stream-write-list').quantity, 744);
  assert.equal(line(startup, 1, 'stream-read').quantity, 0);
});

test('crossingBothCapacitiesByOneKeepsAWholeNewGatewayAndDatabase', () => {
  const c = controls(); c.capacity = 9; c.databaseCapacity = 99;
  const r = calculate(fixture(), c);
  assert.equal(line(r, 10, 'gateway-compute').quantity, 1460);
  assert.equal(line(r, 100, 'database-compute').quantity, 1460);
});

test('monthOneAndMatureArchiveForecastsAreNeverAddedToTheSameMonthlySubtotal', () => {
  const data = fixture();
  for (const rate of data.prices.filter(row => row.id === 's3-standard-storage')) {
    rate.minimum.quantity = 0; rate.rounding.mode = 'none';
  }
  const r = calculate(data, controls()), one = row(r, 1);
  const alternatives = one.lines.filter(line => line.id.startsWith('archive-'));
  assert.equal(alternatives.length, 2); assert.ok(alternatives.every(line => line.cost > 0));
  const otherVenueLines = one.lines.filter(line => line.scope === 'venue' && !line.id.startsWith('archive-'));
  assert.ok(Math.abs(one.venueSubtotal - (otherVenueLines.reduce((sum, line) => sum + (line.cost ?? 0), 0)
    + alternatives.find(line => line.id === 'archive-mature').cost)) < 1e-10);
});
