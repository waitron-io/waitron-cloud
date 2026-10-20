// Generated source state and a pinned public runtime only; never use a real venue here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { preparePrivateCopy, discoverPrivateReplayDay, readPrivateReplayBills, prepareReplayDay, replayScheduledSales } from '../local.mjs';
import { openReplay } from '../waitron-adapter.mjs';

const fixture = JSON.parse(readFileSync(process.env.COST_SYNTHETIC_CONFIG, 'utf8'));
const runtime = await import(pathToFileURL(join(fixture.codeRoot, 'runtime.mjs')).href);
const calendar = { businessDayAt: runtime.businessDayAt, businessDayBounds: runtime.businessDayBounds };
const config = { localEndpoints: { s3: 'http://s3:8333', postgres: 'postgresql://fixture:fixture@postgres:5432/fixture',
  smtp: 'smtp://mailpit:1025', fiscal: 'http://fiscal:8080', gateway: 'https://gateway:443' },
  senders: { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' } };
const initial = { taxpayer: { country: 'ES', taxId: '12345678Z', legalName: 'Synthetic SL' },
  location: { name: 'Synthetic venue', invoiceLocales: ['es'], operationDescription: 'Servicio',
    timeZone: 'Europe/Madrid', dayCutover: '06:00:00' },
  nodeName: 'Synthetic node', seriesCode: 'R', fullSeriesCode: 'F', idSistemaInformatico: 'WR' };
function sale(at, n) {
  return { origin: { source: 'operator_script', deviceId: null }, locale: 'es', invoiceLocales: ['es'], total: '12.10',
    vatBreakdown: [{ rate: '21.00', base: '10.00', tax: '2.10' }],
    lines: [{ lineNo: 1, name: `Synthetic item ${n}`, descriptions: { es: 'Artículo' }, quantity: '1.000',
      priceQuantity: '1.000', unitPrice: '10.00', vatRate: '21.00', lineTotal: '10.00' }],
    clock: { now: () => ({ instant: new Date(at), offsetMinutes: 0, confident: true, confidence: 'anchored', anchorAgeSeconds: 0 }) },
    settlement: { kind: 'immediate', tenders: [{ method: 'card', amount: '12.10', tipAmount: '0.00', settledAt: new Date(at) }] } };
}
const cases = [
  { name: 'spring-forward', day: '2026-03-28', zone: 'Europe/Madrid', changes: [],
    startAt: '2026-03-28T05:00:00.000Z', endAt: '2026-03-29T04:00:00.000Z', seconds: 82800 },
  { name: 'fall-back', day: '2026-10-24', zone: 'Europe/Madrid', changes: [],
    startAt: '2026-10-24T04:00:00.000Z', endAt: '2026-10-25T05:00:00.000Z', seconds: 90000 },
  { name: 'historical-cutover', day: '2026-11-03', zone: 'Europe/Madrid', changes: [['2026-11-04', '03:00:00']],
    startAt: '2026-11-03T05:00:00.000Z', endAt: '2026-11-04T02:00:00.000Z', seconds: 75600 },
  { name: 'fractional-offset', day: '2026-01-02', zone: 'Asia/Kathmandu', changes: [],
    startAt: '2026-01-02T00:15:00.000Z', endAt: '2026-01-03T00:15:00.000Z', seconds: 86400 },
];

// The discovered day must feed the same bill reader and normal writer without losing a boundary sale.
for (const c of cases) test(`discoveredDayReconcilesRealWriterAndSavedCalendar-${c.name}`, async t => {
  const parent = mkdtempSync(join(fixture.stateParent, 'discovery-')); chmodSync(parent, 0o700);
  const source = join(parent, 'source'), root = join(parent, 'owned'), target = join(parent, 'target');
  for (const path of [source,root,target]) mkdirSync(path, { mode: 0o700 });
  let sourceReplay, targetReplay, copy;
  t.after(async () => { try { await sourceReplay?.close(); await targetReplay?.close(); await copy?.close(); }
    finally { rmSync(parent, { recursive: true, force: true }); } });
  const settings = { ...initial, location: { ...initial.location, timeZone: c.zone } };
  sourceReplay = await openReplay({ codeRoot: fixture.codeRoot, stateRoot: source, config, initial: settings });
  const times = [new Date(Date.parse(c.startAt) - 1).toISOString(), c.startAt,
    new Date(Date.parse(c.endAt) - 1).toISOString(), c.endAt];
  for (let n = 0; n < times.length; n++) await sourceReplay.recordSale(sale(times[n], n));
  await sourceReplay.close();
  const database = join(source, 'venue/venue.db'), db = new DatabaseSync(database);
  let locationId;
  try {
    locationId = db.prepare('SELECT id FROM locations').get().id;
    for (const [day, cutover] of c.changes) db.prepare('INSERT INTO location_day_cutover_changes VALUES(?,?,?)').run(locationId,day,cutover);
  } finally { db.close(); }
  const token = randomBytes(32).toString('hex'), path = join(root, 'journal.json');
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  const args = { source, root, journal: { path, token } };
  copy = await preparePrivateCopy({ ...args, database });
  const selectionArgs = { ...args, database: copy.database, locationId, calendar };
  const expected = { sales: 4, paid: 4, tradingDays: 3, busiest: 2 };
  const discovered = discoverPrivateReplayDay({ ...selectionArgs, expected });
  assert.deepEqual(discovered, { counts: expected, discrepancies: { sales: 0, paid: 0, tradingDays: 0, busiest: 0 },
    selection: { day: c.day, bounds: { startAt: c.startAt, endAt: c.endAt }, expectedSales: 2 } });
  const selected = readPrivateReplayBills({ ...selectionArgs, ...discovered.selection });
  assert.deepEqual(selected.events.map(e => e.sale.lines[0].name), ['Synthetic item 1', 'Synthetic item 2']);
  const prepared = prepareReplayDay({ bounds: discovered.selection.bounds, expectedSales: discovered.selection.expectedSales, events: selected.events });
  assert.deepEqual(prepared.events.map(e => e.offsetSeconds), [0, c.seconds - 0.001]);
  targetReplay = await openReplay({ codeRoot: fixture.codeRoot, stateRoot: target, config, initial: settings });
  const result = await replayScheduledSales({ ...prepared, cadence: { mode: 'accelerated', factor: 1000000 }, windowSeconds: 10,
    recordSale: input => targetReplay.recordSale(input) });
  assert.deepEqual(result.counts, { expected: 2, attempted: 2, successful: 2, failed: 0 });
  assert.deepEqual(await targetReplay.verify(), { ok: true, issues: 0 });
  const mismatch = discoverPrivateReplayDay({ ...selectionArgs, expected: { ...expected, paid: 5 } });
  assert.equal(mismatch.selection, null); assert.equal(mismatch.discrepancies.paid, -1);
});
