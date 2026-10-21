// Explicit integration with a prepared public Waitron runtime and generated synthetic events only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { prepareReplayDay, replayScheduledSales } from '../local.mjs';
import { openReplay } from '../waitron-adapter.mjs';

const fixture = JSON.parse(readFileSync(process.env.COST_SYNTHETIC_CONFIG, 'utf8'));
const runtime = await import(pathToFileURL(join(fixture.codeRoot, 'runtime.mjs')).href);
const clock = { timeZone: 'Europe/Madrid', dayCutover: '06:00', cutoverChanges: [] };
const cases = [
  { name: 'spring-forward', day: '2026-03-28', clock, start: '2026-03-28T05:00:00.000Z', end: '2026-03-29T04:00:00.000Z', seconds: 82800 },
  { name: 'fall-back', day: '2026-10-24', clock, start: '2026-10-24T04:00:00.000Z', end: '2026-10-25T05:00:00.000Z', seconds: 90000 },
  { name: 'cutover-history', day: '2026-11-03', clock: { ...clock, cutoverChanges: [{ effectiveBusinessDay: '2026-11-04', dayCutover: '03:00' }] },
    start: '2026-11-03T05:00:00.000Z', end: '2026-11-04T02:00:00.000Z', seconds: 75600 },
  { name: 'year-boundary', day: '2026-12-31', clock, start: '2026-12-31T05:00:00.000Z', end: '2027-01-01T05:00:00.000Z', seconds: 86400 },
  { name: 'fractional-zone-offset', day: '2026-01-02', clock: { ...clock, timeZone: 'Asia/Kathmandu' },
    start: '2026-01-02T00:15:00.000Z', end: '2026-01-03T00:15:00.000Z', seconds: 86400 },
];
const at = ms => new Date(ms).toISOString();

// A fixed 24-hour day or UTC calendar grouping changes these independently calculated selections.
for (const c of cases) test(`${c.name}UsesPinnedWaitronBusinessDayBounds`, () => {
  assert.equal(typeof runtime.businessDayBounds, 'function');
  const bounds = runtime.businessDayBounds(c.clock, c.day);
  assert.deepEqual(bounds, { startAt: c.start, endAt: c.end });
  const start = Date.parse(c.start), end = Date.parse(c.end);
  const events = [
    { at: at(end), sale: { n: 4 } }, { at: at(end - 1), sale: { n: 3 } },
    { at: at(start - 1), sale: { n: 0 } }, { at: at(start), sale: { n: 1 } },
    { at: at(start + 1000), sale: { n: 2 } },
  ];
  assert.deepEqual(prepareReplayDay({ bounds, events, expectedSales: 3 }), { expectedSales: 3, events: [
    { offsetSeconds: 0, sale: { n: 1 } }, { offsetSeconds: 1, sale: { n: 2 } },
    { offsetSeconds: c.seconds - 0.001, sale: { n: 3 } },
  ] });
});

const config = {
  localEndpoints: { s3: 'http://s3:8333', postgres: 'postgresql://fixture:fixture@postgres:5432/fixture',
    smtp: 'smtp://mailpit:1025', fiscal: 'http://fiscal:8080', gateway: 'https://gateway:443' },
  senders: { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' },
};
const initial = {
  taxpayer: { country: 'ES', taxId: '12345678Z', legalName: 'Synthetic SL' },
  location: { name: 'Synthetic venue', invoiceLocales: ['es'], operationDescription: 'Servicio',
    timeZone: 'Europe/Madrid', dayCutover: '06:00:00' },
  nodeName: 'Synthetic node', seriesCode: 'R', fullSeriesCode: 'F', idSistemaInformatico: 'WR',
};
function sale(n, at) {
  const instant = new Date(at);
  return { origin: { source: 'operator_script', deviceId: null }, locale: 'es', invoiceLocales: ['es'],
    total: '12.10', lines: [{ lineNo: 1, name: `Synthetic item ${n}`, descriptions: { es: `Synthetic item ${n}` },
      quantity: '1', unitPrice: '10.00', vatRate: '21.00', lineTotal: '10.00' }],
    clock: { now: () => ({ instant, offsetMinutes: at < '2026-03-29T01:00:00.000Z' ? 60 : 120,
      confident: true, confidence: 'anchored', anchorAgeSeconds: 0 }) },
    settlement: { kind: 'immediate', tenders: [{ method: 'cash', amount: '12.10', tipAmount: '0', settledAt: instant }] } };
}

test('privateDaySelectionReplaysOnlySelectedBillsThroughGenuineWriter', async t => {
  const stateRoot = mkdtempSync(join(fixture.stateParent, 'day-')); chmodSync(stateRoot, 0o700);
  let replay;
  t.after(async () => { try { await replay?.close(); } finally { rmSync(stateRoot, { recursive: true, force: true }); } });
  replay = await openReplay({ codeRoot: fixture.codeRoot, stateRoot, config, initial });
  const bounds = runtime.businessDayBounds(clock, '2026-03-28');
  const timestamps = ['2026-03-29T04:00:00.000Z', '2026-03-29T03:59:59.999Z',
    '2026-03-28T04:59:59.999Z', '2026-03-28T05:00:00.000Z', '2026-03-28T05:00:00.000Z'];
  const events = timestamps.map((at, n) => ({ at, sale: sale(n, at) }));
  const prepared = prepareReplayDay({ bounds, events, expectedSales: 3 });
  const summary = await replayScheduledSales({ ...prepared, cadence: { mode: 'accelerated', factor: 1000000 },
    windowSeconds: 10, recordSale: value => replay.recordSale(value) });
  assert.deepEqual(summary.counts, { expected: 3, attempted: 3, successful: 3, failed: 0 });
  assert.equal(summary.cadence.coveredSeconds, 82799.999);
  assert.equal(JSON.stringify(summary).includes('2026-'), false);
  assert.equal(JSON.stringify(summary).includes('Synthetic'), false);
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try {
    assert.deepEqual(db.prepare('SELECT name FROM sale_lines ORDER BY rowid').all().map(v => v.name),
      ['Synthetic item 3', 'Synthetic item 4', 'Synthetic item 1']);
    assert.deepEqual(db.prepare('SELECT invoice_number,total FROM sales ORDER BY invoice_number').all().map(v => ({ ...v })),
      [{ invoice_number: 1, total: 1210 }, { invoice_number: 2, total: 1210 }, { invoice_number: 3, total: 1210 }]);
  } finally { db.close(); }
  assert.deepEqual(replay.counts(), { attempted: 3, successful: 3, failed: 0 });
  assert.deepEqual(await replay.verify(), { ok: true, issues: 0 });
});
