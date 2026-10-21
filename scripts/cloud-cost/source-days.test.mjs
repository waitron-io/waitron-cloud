import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync,
  statSync, chmodSync, copyFileSync, renameSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as local from './local.mjs';
import { exportAggregate } from './schema.mjs';

const invalid = { message: 'Invalid cloud cost local run' };
const available = () => assert.equal(typeof local.discoverPrivateReplayDay, 'function', 'discover and reconcile the copied trading days');
const bounds = {
  '2026-03-27': { startAt: '2026-03-27T05:00:00.000Z', endAt: '2026-03-28T05:00:00.000Z' },
  '2026-03-28': { startAt: '2026-03-28T05:00:00.000Z', endAt: '2026-03-29T04:00:00.000Z' },
  '2026-03-29': { startAt: '2026-03-29T04:00:00.000Z', endAt: '2026-03-30T04:00:00.000Z' },
};
const clock = { timeZone: 'Europe/Madrid', dayCutover: '06:00', cutoverChanges: [] };
const expected = { sales: 8, paid: 5, tradingDays: 3, busiest: 2 };
const calendar = {
  businessDayAt(saved, at) {
    assert.deepEqual(saved, clock); assert.ok(at instanceof Date);
    return Object.keys(bounds).find(day => bounds[day].startAt <= at.toISOString() && at.toISOString() < bounds[day].endAt);
  },
  businessDayBounds(saved, day) { assert.deepEqual(saved, clock); return { ...bounds[day] }; },
};
const fingerprint = path => ({ sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), mtime: statSync(path).mtimeMs });
async function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-source-days-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const source = join(parent, 'source'), root = join(parent, 'owned');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const database = join(source, 'venue.db'), db = new DatabaseSync(database);
  try {
    db.exec(`CREATE TABLE locations(id TEXT PRIMARY KEY,time_zone TEXT,day_cutover TEXT);
      CREATE TABLE location_day_cutover_changes(location_id TEXT,effective_business_day TEXT,day_cutover TEXT);
      INSERT INTO locations VALUES('one','Europe/Madrid','06:00:00'),('two','UTC','00:00:00');
      CREATE TABLE nodes(id TEXT PRIMARY KEY,location_id TEXT);
      INSERT INTO nodes VALUES('node-one','one'),('node-two','two');
      CREATE TABLE sales(id TEXT PRIMARY KEY,node_id TEXT,issued_at TEXT,total INTEGER);
      CREATE TABLE sale_settlements(sale_id TEXT,settled_at TEXT);`);
    for (const [id,node,at,total,paid] of [
      ['next','node-one',bounds['2026-03-29'].startAt,100,true],
      ['first','node-one',bounds['2026-03-28'].startAt,100,true],
      ['left','node-one','2026-03-28T04:59:59.999Z',100,true],
      ['last','node-one','2026-03-29T03:59:59.999Z',100,true],
      ['next-last','node-one','2026-03-30T03:59:59.999Z',100,true],
      ['unpaid','node-one',bounds['2026-03-28'].startAt,100,false],
      ['zero','node-one',bounds['2026-03-28'].startAt,0,true],
      ['negative','node-one',bounds['2026-03-28'].startAt,-100,true],
      ['foreign','node-two','SYNTHETIC_PRIVATE_NOT_A_TIME',100,true],
    ]) {
      db.prepare('INSERT INTO sales VALUES(?,?,?,?)').run(id,node,at,total);
      if (paid) db.prepare('INSERT INTO sale_settlements VALUES(?,?)').run(id,at);
    }
  } finally { db.close(); }
  const token = randomBytes(32).toString('hex'), path = join(root, 'journal.json');
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  const args = { source, root, journal: { path, token } };
  const copy = await local.preparePrivateCopy({ ...args, database });
  return { ...args, database: copy.database, sourceDatabase: database, copy, locationId: 'one', calendar, expected };
}
function edit(f, sql) { const db = new DatabaseSync(f.database); try { db.exec(sql); } finally { db.close(); } }

// UTC dates, an unpaid sale, another location or a latest-day tie would select the wrong sample.
test('discoveryUsesTheSavedClockAndEarliestBusiestTradingDay', async t => {
  available(); const f = await fixture(t), result = local.discoverPrivateReplayDay(f);
  assert.deepEqual(result, { counts: expected, discrepancies: { sales: 0, paid: 0, tradingDays: 0, busiest: 0 },
    selection: { day: '2026-03-28', bounds: bounds['2026-03-28'], expectedSales: 2 } });
  assert.throws(() => exportAggregate(result));
});

test('eachCountDiscrepancyWithholdsTheReplaySelection', async t => {
  available(); const f = await fixture(t);
  for (const key of Object.keys(expected)) for (const delta of [-1,1]) {
    const result = local.discoverPrivateReplayDay({ ...f, expected: { ...expected, [key]: expected[key] + delta } });
    assert.deepEqual(result.counts, expected);
    assert.deepEqual(result.discrepancies, { sales: 0, paid: 0, tradingDays: 0, busiest: 0, [key]: -delta });
    assert.equal(result.selection, null);
  }
});

test('emptyCopiedLocationCannotYieldAMeasuredReplayDay', async t => {
  available(); const f = await fixture(t); edit(f, "DELETE FROM sales WHERE node_id='node-one'");
  const zero = { sales: 0, paid: 0, tradingDays: 0, busiest: 0 };
  assert.deepEqual(local.discoverPrivateReplayDay({ ...f, expected: zero }), { counts: zero, discrepancies: zero, selection: null });
});

test('malformedExpectedCountsCannotApproveASelection', async t => {
  available(); const f = await fixture(t);
  for (const value of [undefined,null,{},[],{...expected,extra:1}])
    assert.throws(() => local.discoverPrivateReplayDay({ ...f, expected: value }), invalid);
  for (const key of Object.keys(expected)) for (const value of [undefined,-1,0.5,NaN,Infinity,100001,'2'])
    assert.throws(() => local.discoverPrivateReplayDay({ ...f, expected: {...expected,[key]:value} }), invalid);
});

for (const [name, sql] of [
  ['unpaid-time',"UPDATE sales SET issued_at='SYNTHETIC_PRIVATE_TIME' WHERE id='unpaid'"],
  ['normalised-date',"UPDATE sales SET issued_at='2026-02-30T05:00:00.000Z' WHERE id='unpaid'"],
  ['fractional-money',"UPDATE sales SET total=100.5 WHERE id='first'"],
  ['text-money',"UPDATE sales SET total='SYNTHETIC_PRIVATE_MONEY' WHERE id='first'"],
  ['duplicate-settlement',"INSERT INTO sale_settlements VALUES('first','2026-03-28T05:00:00.000Z')"],
  ['clock',"UPDATE locations SET day_cutover='06:00:01' WHERE id='one'"],
  ['missing-schema','DROP TABLE sale_settlements'],
]) test(`discoveryRefusesMalformedCopiedState-${name}`, async t => {
  available(); const f = await fixture(t); edit(f, sql);
  assert.throws(() => local.discoverPrivateReplayDay(f), error => error.message === invalid.message
    && error.cause === undefined && !error.stack.includes('SYNTHETIC_PRIVATE'));
});

test('calendarFailuresAndImpossibleBoundsDoNotLeakPrivateData', async t => {
  available(); const f = await fixture(t);
  for (const value of [null,{}, { ...calendar, extra: true }, { ...calendar, businessDayAt: null },
    { ...calendar, businessDayAt() { throw Error('SYNTHETIC_PRIVATE_CALENDAR'); } },
    { ...calendar, businessDayAt: () => '2026-02-30' },
    { ...calendar, businessDayAt: () => '2026-02-30', businessDayBounds: () => ({
      startAt: bounds['2026-03-27'].startAt, endAt: bounds['2026-03-29'].endAt }) },
    { ...calendar, businessDayAt: () => 'not-a-date' },
    { ...calendar, businessDayAt: (saved, at) => at.toISOString() === bounds['2026-03-28'].endAt
      ? '2026-03-28' : calendar.businessDayAt(saved, at) },
    { ...calendar, businessDayBounds: () => ({ startAt: bounds['2026-03-29'].endAt, endAt: bounds['2026-03-29'].startAt }) },
    { ...calendar, businessDayBounds: () => ({ startAt: bounds['2026-03-29'].startAt, endAt: bounds['2026-03-29'].endAt }) },
    { ...calendar, businessDayBounds: (saved, day) => ({ ...calendar.businessDayBounds(saved, day), privateExtra: true }) },
  ]) assert.throws(() => local.discoverPrivateReplayDay({ ...f, calendar: value }), error => error.message === invalid.message
    && error.cause === undefined && !error.stack.includes('SYNTHETIC_PRIVATE'));
});

test('discoveryLeavesTheSourceCopyJournalAndSidecarSetUnchanged', async t => {
  available(); const f = await fixture(t), paths = [f.database, f.sourceDatabase, f.journal.path];
  const before = paths.map(fingerprint), entries = readdirSync(f.root).sort();
  local.discoverPrivateReplayDay(f); local.discoverPrivateReplayDay(f);
  assert.deepEqual(paths.map(fingerprint), before); assert.deepEqual(readdirSync(f.root).sort(), entries);
  await f.copy.close(); assert.throws(() => local.discoverPrivateReplayDay(f), invalid);
});

test('discoveryRequiresEveryRecordedCopyIdentityAndPrivatePermission', async t => {
  available(); const f = await fixture(t), original = readFileSync(f.journal.path, 'utf8');
  for (const field of ['kind','state','path','ino','dev']) {
    const value = JSON.parse(original), ready = value.localResources.find(v => v.state === 'ready');
    ready[field] = ['ino','dev'].includes(field) ? -1 : 'wrong'; writeFileSync(f.journal.path, JSON.stringify(value));
    assert.throws(() => local.discoverPrivateReplayDay(f), invalid);
  }
  writeFileSync(f.journal.path, original);
  for (const path of [f.database, f.journal.path]) {
    chmodSync(path, 0o644); assert.throws(() => local.discoverPrivateReplayDay(f), invalid); chmodSync(path, 0o600);
  }
  writeFileSync(join(f.root,'.cloud-cost-owner'),'0'.repeat(64));
  assert.throws(() => local.discoverPrivateReplayDay(f), invalid);
});

test('unrecordedLinkedReplacedAndWalCopiesCannotBeDiscovered', async t => {
  available(); const f = await fixture(t), other = join(f.root, 'unrecorded.db');
  copyFileSync(f.database, other); chmodSync(other, 0o600);
  for (const database of [other, f.sourceDatabase]) assert.throws(() => local.discoverPrivateReplayDay({...f,database}),invalid);
  const saved = join(f.root, 'saved.db'); renameSync(f.database,saved); copyFileSync(saved,f.database); chmodSync(f.database,0o600);
  assert.throws(() => local.discoverPrivateReplayDay(f),invalid); rmSync(f.database); symlinkSync(saved,f.database);
  assert.throws(() => local.discoverPrivateReplayDay(f),invalid); rmSync(f.database); renameSync(saved,f.database);
  linkSync(f.database,saved); assert.throws(() => local.discoverPrivateReplayDay(f),invalid); rmSync(saved);
  edit(f,'PRAGMA journal_mode=WAL'); const before = readdirSync(f.root).sort();
  assert.throws(() => local.discoverPrivateReplayDay(f),invalid); assert.deepEqual(readdirSync(f.root).sort(),before);
});

test('discoveryCannotTruncateAnOversizedCopiedLocation', async t => {
  available(); const f = await fixture(t);
  edit(f, `WITH RECURSIVE n(i) AS(VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<100000)
    INSERT INTO sales SELECT 'cap-'||i,'node-one','2026-03-28T05:00:00.000Z',0 FROM n`);
  assert.throws(() => local.discoverPrivateReplayDay(f),invalid);
});
