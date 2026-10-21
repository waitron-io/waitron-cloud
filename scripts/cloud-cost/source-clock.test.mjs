import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync,
  readdirSync, statSync, chmodSync, symlinkSync, linkSync, renameSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as local from './local.mjs';

const first = '00000000-0000-4000-8000-000000000001', second = '00000000-0000-4000-8000-000000000002';
const invalid = { message: 'Invalid cloud cost local run' };
const available = () => assert.equal(typeof local.readPrivateReplayClock, 'function', 'read the saved clock only from an owned selection copy');
const fingerprint = path => ({ sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), mtime: statSync(path).mtimeMs });
async function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-source-clock-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const source = join(parent, 'source'), root = join(parent, 'owned');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const database = join(source, 'venue.db');
  const db = new DatabaseSync(database);
  try {
    // Deliberately permissive columns let malformed stored values reach the reader.
    db.exec(`CREATE TABLE locations (id TEXT PRIMARY KEY, time_zone TEXT, day_cutover TEXT);
      CREATE TABLE location_day_cutover_changes (location_id TEXT, effective_business_day TEXT, day_cutover TEXT);
      INSERT INTO locations VALUES ('00000000-0000-4000-8000-000000000001','Europe/Madrid','06:00:00'), ('00000000-0000-4000-8000-000000000002','Asia/Kathmandu','01:00:00');
      INSERT INTO location_day_cutover_changes VALUES
        ('00000000-0000-4000-8000-000000000001','2026-12-01','04:30:00'), ('00000000-0000-4000-8000-000000000002','2026-11-04','09:00:00'), ('00000000-0000-4000-8000-000000000001','2026-11-04','03:00:00');`);
  } finally { db.close(); }
  const token = randomBytes(32).toString('hex'), path = join(root, 'journal.json');
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  const args = { source, root, journal: { path, token } };
  const copy = await local.preparePrivateCopy({ ...args, database });
  return { ...args, database: copy.database, locationId: first, sourceDatabase: database, copy, parent };
}
function edit(f, sql) {
  const db = new DatabaseSync(f.database);
  try { db.exec(sql); } finally { db.close(); }
}

// Omitting history, using another location, or retaining seconds changes the selected trading day.
test('savedClockUsesOnlySelectedLocationAndOrdersEveryCutover', async t => {
  available(); const f = await fixture(t);
  assert.deepEqual(local.readPrivateReplayClock(f), { timeZone: 'Europe/Madrid', dayCutover: '06:00', cutoverChanges: [
    { effectiveBusinessDay: '2026-11-04', dayCutover: '03:00' },
    { effectiveBusinessDay: '2026-12-01', dayCutover: '04:30' },
  ] });
  assert.deepEqual(local.readPrivateReplayClock({ ...f, locationId: second }), { timeZone: 'Asia/Kathmandu', dayCutover: '01:00',
    cutoverChanges: [{ effectiveBusinessDay: '2026-11-04', dayCutover: '09:00' }] });
});

test('unchangedClockHasNoInventedCutoverHistory', async t => {
  available(); const f = await fixture(t); edit(f, 'DELETE FROM location_day_cutover_changes');
  assert.deepEqual(local.readPrivateReplayClock(f), { timeZone: 'Europe/Madrid', dayCutover: '06:00', cutoverChanges: [] });
});

test('readingClockLeavesSourceCopyAndDirectoryUnchanged', async t => {
  available(); const f = await fixture(t);
  const before = [f.sourceDatabase, f.database, f.journal.path].map(fingerprint), files = readdirSync(f.root).sort();
  local.readPrivateReplayClock(f); local.readPrivateReplayClock(f);
  assert.deepEqual([f.sourceDatabase, f.database, f.journal.path].map(fingerprint), before);
  assert.deepEqual(readdirSync(f.root).sort(), files);
  await f.copy.close();
  assert.throws(() => local.readPrivateReplayClock(f), invalid);
});

test('missingLocationAndInvalidIdentityCannotSelectAnotherVenue', async t => {
  available(); const f = await fixture(t);
  for (const locationId of [0, 1, -1, null, undefined, '1', '', 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '00000000-0000-4000-8000-000000000003'])
    assert.throws(() => local.readPrivateReplayClock({ ...f, locationId }), invalid);
});

test('numericIdentityCannotCoerceATextLocationKey', async t => {
  available(); const f = await fixture(t);
  edit(f, "INSERT INTO locations VALUES('1.0','Europe/Madrid','06:00:00')");
  assert.throws(() => local.readPrivateReplayClock({ ...f, locationId: 1 }), invalid);
  assert.deepEqual(local.readPrivateReplayClock({ ...f, locationId: '1.0' }),
    { timeZone: 'Europe/Madrid', dayCutover: '06:00', cutoverChanges: [] });
});

test('missingHistorySchemaIsNotTreatedAsAnUnchangedClock', async t => {
  available(); const f = await fixture(t); edit(f, 'DROP TABLE location_day_cutover_changes');
  assert.throws(() => local.readPrivateReplayClock(f), invalid);
});

for (const [name, sql] of [
  ['missing-zone', "UPDATE locations SET time_zone=NULL WHERE id='00000000-0000-4000-8000-000000000001'"],
  ['unknown-zone', "UPDATE locations SET time_zone='SYNTHETIC_PRIVATE_ZONE' WHERE id='00000000-0000-4000-8000-000000000001'"],
  ['offset-zone', "UPDATE locations SET time_zone='+01:00' WHERE id='00000000-0000-4000-8000-000000000001'"],
  ['cutover-seconds', "UPDATE locations SET day_cutover='06:00:01' WHERE id='00000000-0000-4000-8000-000000000001'"],
  ['cutover-short', "UPDATE locations SET day_cutover='06:00' WHERE id='00000000-0000-4000-8000-000000000001'"],
  ['cutover-hour', "UPDATE locations SET day_cutover='24:00:00' WHERE id='00000000-0000-4000-8000-000000000001'"],
  ['missing-cutover', "UPDATE locations SET day_cutover=NULL WHERE id='00000000-0000-4000-8000-000000000001'"],
  ['changed-seconds', "UPDATE location_day_cutover_changes SET day_cutover='03:00:01' WHERE location_id='00000000-0000-4000-8000-000000000001'"],
  ['changed-minute', "UPDATE location_day_cutover_changes SET day_cutover='03:60:00' WHERE location_id='00000000-0000-4000-8000-000000000001'"],
  ['missing-changed-cutover', "UPDATE location_day_cutover_changes SET day_cutover=NULL WHERE location_id='00000000-0000-4000-8000-000000000001'"],
  ['normalised-date', "UPDATE location_day_cutover_changes SET effective_business_day='2026-02-30' WHERE location_id='00000000-0000-4000-8000-000000000001' AND effective_business_day='2026-12-01'"],
  ['short-date', "UPDATE location_day_cutover_changes SET effective_business_day='2026-1-04' WHERE location_id='00000000-0000-4000-8000-000000000001' AND effective_business_day='2026-12-01'"],
  ['missing-date', "UPDATE location_day_cutover_changes SET effective_business_day=NULL WHERE location_id='00000000-0000-4000-8000-000000000001' AND effective_business_day='2026-12-01'"],
  ['duplicate-date', "INSERT INTO location_day_cutover_changes VALUES('00000000-0000-4000-8000-000000000001','2026-11-04','08:00:00')"],
]) test(`malformedStoredClockRefuses-${name}`, async t => {
  available(); const f = await fixture(t); edit(f, sql);
  assert.throws(() => local.readPrivateReplayClock(f), error => error.message === invalid.message
    && !error.stack.includes('SYNTHETIC_PRIVATE') && error.cause === undefined);
});

test('unrecordedOrReplacedDatabaseCannotBeReadAsThePrivateCopy', async t => {
  available(); const f = await fixture(t);
  const other = join(f.root, 'other.db'); copyFileSync(f.database, other); chmodSync(other, 0o600);
  assert.throws(() => local.readPrivateReplayClock({ ...f, database: other }), invalid);
  assert.throws(() => local.readPrivateReplayClock({ ...f, database: f.sourceDatabase }), invalid);
  renameSync(f.database, join(f.root, 'retained.db')); copyFileSync(other, f.database); chmodSync(f.database, 0o600);
  assert.throws(() => local.readPrivateReplayClock(f), invalid);
});

test('preparedCopyMustMatchEveryRecordedIdentityField', async t => {
  available(); const f = await fixture(t), original = readFileSync(f.journal.path, 'utf8');
  for (const change of [{ kind: 'other' }, { state: 'intent' }, { path: f.sourceDatabase }, { ino: -1 }, { dev: -1 }]) {
    const value = JSON.parse(original), ready = value.localResources.find(v => v.state === 'ready');
    Object.assign(ready, change); writeFileSync(f.journal.path, JSON.stringify(value));
    assert.throws(() => local.readPrivateReplayClock(f), invalid);
  }
  writeFileSync(f.journal.path, original);
  assert.equal(local.readPrivateReplayClock(f).timeZone, 'Europe/Madrid');
});

test('sourceFileCannotBecomeASelectionCopyThroughJournalMetadata', async t => {
  available(); const f = await fixture(t), identity = statSync(f.sourceDatabase);
  chmodSync(f.sourceDatabase, 0o600);
  const value = JSON.parse(readFileSync(f.journal.path, 'utf8'));
  value.localResources.push({ kind: 'database-copy', state: 'ready', path: f.sourceDatabase, ino: identity.ino, dev: identity.dev });
  writeFileSync(f.journal.path, JSON.stringify(value));
  assert.throws(() => local.readPrivateReplayClock({ ...f, database: f.sourceDatabase }), invalid);
});

test('changedOwnershipAndCopyPermissionsRefuseBeforeReading', async t => {
  available(); const f = await fixture(t);
  writeFileSync(join(f.root, '.cloud-cost-owner'), '0'.repeat(64));
  assert.throws(() => local.readPrivateReplayClock(f), invalid);
  writeFileSync(join(f.root, '.cloud-cost-owner'), f.journal.token);
  chmodSync(f.database, 0o644); assert.throws(() => local.readPrivateReplayClock(f), invalid);
  chmodSync(f.database, 0o600); chmodSync(f.journal.path, 0o644);
  assert.throws(() => local.readPrivateReplayClock(f), invalid);
});

test('linkedAndWalCopiesCannotCreateSelectionSidecars', async t => {
  available(); const f = await fixture(t), original = join(f.root, 'retained.db');
  renameSync(f.database, original); symlinkSync(original, f.database);
  assert.throws(() => local.readPrivateReplayClock(f), invalid);
  rmSync(f.database); renameSync(original, f.database);
  linkSync(f.database, original); assert.throws(() => local.readPrivateReplayClock(f), invalid); rmSync(original);
  edit(f, 'PRAGMA journal_mode=WAL'); const before = readdirSync(f.root).sort();
  assert.throws(() => local.readPrivateReplayClock(f), invalid);
  assert.deepEqual(readdirSync(f.root).sort(), before);
});

test('oversizedCutoverHistoryRefusesInsteadOfReturningATruncatedClock', async t => {
  available(); const f = await fixture(t);
  edit(f, `DELETE FROM location_day_cutover_changes;
    WITH RECURSIVE days(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM days WHERE n<10000)
    INSERT INTO location_day_cutover_changes SELECT '00000000-0000-4000-8000-000000000001',date('2000-01-01','+'||n||' days'),'03:00:00' FROM days`);
  assert.throws(() => local.readPrivateReplayClock(f), invalid);
});
