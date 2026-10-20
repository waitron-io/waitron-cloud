// Generated databases and a pinned public runtime only; never point this fixture at a venue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { preparePrivateCopy, readPrivateReplayClock, prepareReplayDay } from '../local.mjs';
import { openReplay } from '../waitron-adapter.mjs';

const fixture = JSON.parse(readFileSync(process.env.COST_SYNTHETIC_CONFIG, 'utf8'));
const runtime = await import(pathToFileURL(join(fixture.codeRoot, 'runtime.mjs')).href);
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
async function savedClock(t, timeZone, changes) {
  const parent = mkdtempSync(join(fixture.stateParent, 'saved-clock-')); chmodSync(parent, 0o700);
  let copy;
  t.after(async () => { try { await copy?.close(); } finally { rmSync(parent, { recursive: true, force: true }); } });
  const source = join(parent, 'source'), root = join(parent, 'owned');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const replay = await openReplay({ codeRoot: fixture.codeRoot, stateRoot: source, config,
    initial: { ...initial, location: { ...initial.location, timeZone } } });
  await replay.close();
  const database = join(source, 'venue/venue.db'), db = new DatabaseSync(database);
  let locationId;
  try {
    locationId = db.prepare('SELECT id FROM locations').get().id;
    for (const [day, cutover] of changes)
      db.prepare('INSERT INTO location_day_cutover_changes(location_id,effective_business_day,day_cutover) VALUES(?,?,?)')
        .run(locationId, day, cutover);
  } finally { db.close(); }
  const store = await runtime.openVenueDatabase(join(source, 'venue'));
  let official;
  try { official = await runtime.withTransaction(store.venue, tx => runtime.readLocationClock(tx, locationId)); }
  finally { await store.close(); }
  const token = randomBytes(32).toString('hex'), path = join(root, 'journal.json');
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  const args = { source, root, journal: { path, token } };
  copy = await preparePrivateCopy({ ...args, database });
  return { clock: readPrivateReplayClock({ ...args, database: copy.database, locationId }), official };
}

const cases = [
  { name: 'spring-forward', day: '2026-03-28', zone: 'Europe/Madrid', changes: [],
    start: '2026-03-28T05:00:00.000Z', end: '2026-03-29T04:00:00.000Z', seconds: 82800 },
  { name: 'fall-back', day: '2026-10-24', zone: 'Europe/Madrid', changes: [],
    start: '2026-10-24T04:00:00.000Z', end: '2026-10-25T05:00:00.000Z', seconds: 90000 },
  { name: 'next-day-history', day: '2026-11-03', zone: 'Europe/Madrid', changes: [['2026-11-04', '03:00:00']],
    start: '2026-11-03T05:00:00.000Z', end: '2026-11-04T02:00:00.000Z', seconds: 75600 },
  { name: 'ordered-multiple-changes', day: '2026-11-04', zone: 'Europe/Madrid',
    changes: [['2026-12-01', '04:30:00'], ['2026-11-04', '03:00:00']],
    start: '2026-11-04T02:00:00.000Z', end: '2026-11-05T02:00:00.000Z', seconds: 86400 },
  { name: 'fractional-offset', day: '2026-01-02', zone: 'Asia/Kathmandu', changes: [],
    start: '2026-01-02T00:15:00.000Z', end: '2026-01-03T00:15:00.000Z', seconds: 86400 },
];

// A default clock, lost history, or day grouping in UTC selects the wrong copied events.
for (const c of cases) test(`copiedClockMatchesPinnedWaitronReaderAndBounds-${c.name}`, async t => {
  const { clock, official } = await savedClock(t, c.zone, c.changes);
  assert.deepEqual(clock, official);
  const bounds = runtime.businessDayBounds(clock, c.day);
  assert.deepEqual(bounds, { startAt: c.start, endAt: c.end });
  const events = [
    { at: c.end, sale: { n: 3 } },
    { at: new Date(Date.parse(c.end) - 1).toISOString(), sale: { n: 2 } },
    { at: c.start, sale: { n: 1 } },
    { at: new Date(Date.parse(c.start) - 1).toISOString(), sale: { n: 0 } },
  ];
  assert.deepEqual(prepareReplayDay({ bounds, events, expectedSales: 2 }), { expectedSales: 2, events: [
    { offsetSeconds: 0, sale: { n: 1 } }, { offsetSeconds: c.seconds - 0.001, sale: { n: 2 } },
  ] });
});
