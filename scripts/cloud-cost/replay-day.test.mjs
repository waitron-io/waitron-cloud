import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as local from './local.mjs';

const invalid = { message: 'Invalid cloud cost replay day' };
const bounds = { startAt: '2026-03-28T05:00:00.000Z', endAt: '2026-03-29T04:00:00.000Z' };
const event = (at, n) => ({ at, sale: { n, private: 'SYNTHETIC_PRIVATE_SALE' } });
const available = () => assert.equal(typeof local.prepareReplayDay, 'function', 'the local runner needs a private trading-day schedule');
const args = () => ({ bounds: { ...bounds }, expectedSales: 2, events: [
  event('2026-03-28T10:00:00.000Z', 1), event('2026-03-29T03:00:00.000Z', 2),
] });

// UTC dates, closed end bounds, or an unstable sort lose or reorder actual selected bills.
test('tradingDayUsesHalfOpenBoundsAndStableInstantOrder', () => {
  available();
  const events = [event(bounds.endAt, 9), event('2026-03-29T03:59:59.999Z', 4),
    event('2026-03-28T04:59:59.999Z', 8), event(bounds.startAt, 1),
    event('2026-03-28T10:00:00.000Z', 2), event('2026-03-28T10:00:00.000Z', 3)];
  const original = events.slice();
  const prepared = local.prepareReplayDay({ bounds, events, expectedSales: 4 });
  assert.deepEqual(prepared, { expectedSales: 4, events: [
    { offsetSeconds: 0, sale: events[3].sale },
    { offsetSeconds: 18000, sale: events[4].sale },
    { offsetSeconds: 18000, sale: events[5].sale },
    { offsetSeconds: 82799.999, sale: events[1].sale },
  ] });
  assert.deepEqual(events, original);
  assert.equal(prepared.events[0].sale, events[3].sale);
  assert.notEqual(prepared.events[0], events[3]);
});

test('selectedDayFeedsSchedulerWithoutChangingSalesOrElapsedSpacing', async t => {
  available();
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('CREATE TABLE committed (n INTEGER, at REAL)');
  const prepared = local.prepareReplayDay(args());
  let clock = 1000;
  const summary = await local.replayScheduledSales({ ...prepared,
    cadence: { mode: 'accelerated', factor: 100 }, windowSeconds: 1000,
    timing: { now: () => clock, wait: async ms => { clock += ms; } },
    recordSale: async sale => { db.prepare('INSERT INTO committed VALUES (?,?)').run(sale.n, (clock - 1000) / 1000); },
  });
  assert.deepEqual(db.prepare('SELECT * FROM committed ORDER BY rowid').all().map(v => ({ ...v })),
    [{ n: 1, at: 0 }, { n: 2, at: 612 }]);
  assert.deepEqual(summary.counts, { expected: 2, attempted: 2, successful: 2, failed: 0 });
  assert.equal(summary.cadence.coveredSeconds, 61200);
  assert.equal(JSON.stringify(summary).includes('2026-'), false);
  assert.equal(JSON.stringify(summary).includes('SYNTHETIC_PRIVATE'), false);
});

test('missingExtraAndEmptySelectionsRefuseBeforeScheduling', () => {
  available();
  for (const change of [{ expectedSales: 1 }, { expectedSales: 3 }, { expectedSales: 0 },
    { expectedSales: 1.5 }, { expectedSales: Infinity }, { expectedSales: '2' },
    { expectedSales: 100001 }, { events: [] }, { events: [event(bounds.endAt, 1)] }])
    assert.throws(() => local.prepareReplayDay({ ...args(), ...change }), invalid);
});

for (const at of ['2026-03-28', '2026-03-28T10:00:00', '2026-03-28T12:00:00+02:00',
  '2026-02-30T10:00:00.000Z', '2026-03-28T24:00:00.000Z', 'RAW_PRIVATE_TIMESTAMP', null, 0,
  '+010000-01-01T00:00:00.000Z', new Date('2026-03-28T10:00:00Z')])
  test(`malformedSourceInstantRefused-${typeof at}-${String(at).slice(0, 24)}`, () => {
    available(); const value = args(); value.events.push(event(at, 3));
    assert.throws(() => local.prepareReplayDay(value), invalid);
  });

test('malformedBoundsAndPrivateExtraFieldsRefused', () => {
  available();
  for (const value of [null, {}, { ...bounds, endAt: bounds.startAt },
    { ...bounds, startAt: bounds.endAt, endAt: bounds.startAt },
    { ...bounds, endAt: '2026-03-29' }, { ...bounds, startAt: '2026-02-30T00:00:00.000Z' },
    { ...bounds, private: 'SYNTHETIC_PRIVATE' }])
    assert.throws(() => local.prepareReplayDay({ ...args(), bounds: value }), invalid);
  for (const change of [{ private: 'SYNTHETIC_PRIVATE' }, { events: null }, { events: {} },
    { events: [null] }, { events: [event(bounds.startAt, 1), { ...event('2026-03-28T10:00:00.000Z', 2), private: 'SYNTHETIC_PRIVATE' }] },
    { events: [event(bounds.startAt, 1), { at: '2026-03-28T10:00:00.000Z', sale: null }] },
    { events: [event(bounds.startAt, 1), { at: '2026-03-28T10:00:00.000Z', sale: [] }] }])
    assert.throws(() => local.prepareReplayDay({ ...args(), ...change }), invalid);
});

test('getterAndSymbolFieldsRefuseWithoutExposingPrivateErrors', () => {
  available();
  const value = args(); let invoked = false;
  Object.defineProperty(value.events[1], 'at', { get() { invoked = true; throw Error('SYNTHETIC_PRIVATE'); } });
  assert.throws(() => local.prepareReplayDay(value), error => error.message === invalid.message && !error.stack.includes('SYNTHETIC_PRIVATE'));
  assert.equal(invoked, false);
  for (const target of ['args', 'bounds', 'event']) {
    const value = args(); const object = target === 'args' ? value : target === 'bounds' ? value.bounds : value.events[0];
    object[Symbol('SYNTHETIC_PRIVATE')] = true;
    assert.throws(() => local.prepareReplayDay(value), invalid);
  }
});

test('oversizedAndSparseSourceCollectionsCannotClaimCompleteSelection', () => {
  available();
  const large = Array(100001).fill(event(bounds.endAt, 9));
  large[0] = event(bounds.startAt, 1); large[1] = event(bounds.startAt, 2);
  assert.throws(() => local.prepareReplayDay({ ...args(), events: large }), invalid);
  const value = args(); value.events.length = 4;
  assert.throws(() => local.prepareReplayDay(value), invalid);
});

test('sourceIteratorCannotHideMalformedRows', () => {
  available();
  const hidden = args(); hidden.events.push(event('SYNTHETIC_PRIVATE', 3));
  hidden.events[Symbol.iterator] = function* () { yield this[0]; yield this[1]; };
  assert.throws(() => local.prepareReplayDay(hidden), invalid);
  const valid = args(); valid.events[Symbol.iterator] = function* () {};
  assert.throws(() => local.prepareReplayDay(valid), invalid);
});

test('sourceRowGettersCannotRun', () => {
  available();
  const accessor = args(); let invoked = false;
  const row = accessor.events[1];
  Object.defineProperty(accessor.events, '1', { get() { invoked = true; return row; } });
  assert.throws(() => local.prepareReplayDay(accessor), invalid);
  assert.equal(invoked, false);
});

test('singleSaleStartsAtZeroAndDoesNotPublishThePrivateDay', () => {
  available();
  const sale = { n: 1 };
  assert.deepEqual(local.prepareReplayDay({ bounds, events: [{ at: '2026-03-28T10:30:00.123Z', sale }], expectedSales: 1 }),
    { expectedSales: 1, events: [{ offsetSeconds: 0, sale }] });
});

test('privateSourceFailureNeverEscapesTheDayBoundary', () => {
  available(); const value = args();
  value.events[0] = new Proxy(value.events[0], { ownKeys() { throw Error('SYNTHETIC_PRIVATE_SOURCE'); } });
  assert.throws(() => local.prepareReplayDay(value), error => error.message === invalid.message
    && !error.stack.includes('SYNTHETIC_PRIVATE_SOURCE') && error.cause === undefined);
});

test('invalidBoundsRefuseBeforeTraversingPrivateRows', () => {
  available(); const value = args(); let traversed = false;
  value.bounds.endAt = value.bounds.startAt;
  value.events = new Proxy(value.events, { ownKeys(target) { traversed = true; return Reflect.ownKeys(target); } });
  assert.throws(() => local.prepareReplayDay(value), invalid);
  assert.equal(traversed, false);
});
