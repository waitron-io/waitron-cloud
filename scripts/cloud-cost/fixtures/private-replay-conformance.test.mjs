// Generated sales and the pinned public runtime only; never supply a real venue to this fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, realpathSync, renameSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import * as local from '../local.mjs';
import { openReplay } from '../waitron-adapter.mjs';
import { exportAggregate } from '../schema.mjs';

const fixture = JSON.parse(readFileSync(process.env.COST_SYNTHETIC_CONFIG, 'utf8'));
const invalid = { message: 'Invalid cloud cost private replay' };
const config = { localEndpoints: { s3: 'http://s3:8333', postgres: 'postgresql://fixture:fixture@postgres:5432/fixture',
  smtp: 'smtp://mailpit:1025', fiscal: 'http://fiscal:8080', gateway: 'https://gateway:443' },
  senders: { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' } };
const initial = { taxpayer: { country: 'ES', taxId: '12345678Z', legalName: 'Synthetic SL' },
  location: { name: 'Synthetic venue', invoiceLocales: ['es'], operationDescription: 'Servicio',
    timeZone: 'Europe/Madrid', dayCutover: '06:00:00' },
  nodeName: 'Synthetic node', seriesCode: 'R', fullSeriesCode: 'F', idSistemaInformatico: 'WR' };
function sale(at, n) {
  const instant = new Date(at);
  return { origin: { source: 'operator_script', deviceId: null }, locale: 'es', invoiceLocales: ['es'], total: '12.10',
    lines: [{ lineNo: 1, name: `PRIVATE_SYNTHETIC_ITEM_${n}`, descriptions: { es: 'Artículo' }, quantity: '1',
      unitPrice: '10.00', vatRate: '21.00', lineTotal: '10.00' }],
    clock: { now: () => ({ instant, offsetMinutes: 60, confident: true, confidence: 'anchored', anchorAgeSeconds: 0 }) },
    settlement: { kind: 'immediate', tenders: [{ method: 'card', amount: '12.10', tipAmount: '0', settledAt: instant }] } };
}
async function setup(t) {
  assert.equal(typeof local.replayPrivateDay, 'function', 'join private discovery, scheduling, genuine writing and cleanup');
  const parent = realpathSync(mkdtempSync(join(fixture.stateParent, 'private-day-')));
  const source = join(parent, 'source'), root = join(parent, 'owned');
  for (const p of [source, root]) mkdirSync(p, { mode: 0o700 });
  let replay, copy, token;
  t.after(async () => { try {
    if (token) writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
    await replay?.close(); await copy?.close();
  } finally { rmSync(parent, { recursive: true, force: true }); } });
  replay = await openReplay({ codeRoot: fixture.codeRoot, stateRoot: source, config, initial });
  for (const [n, at] of ['2026-01-01T12:00:00.000Z', '2026-01-02T12:00:00.000Z',
    '2026-01-02T12:00:00.050Z', '2026-01-02T12:00:00.100Z'].entries()) await replay.recordSale(sale(at, n));
  await replay.close();
  token = randomBytes(32).toString('hex'); const path = join(root, 'journal.json');
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  const args = { source, root, journal: { path, token } };
  const db = new DatabaseSync(join(source, 'venue/venue.db'), { readOnly: true }); let locationId;
  try {
    locationId = db.prepare('SELECT id FROM locations').get().id;
    copy = await local.preparePrivateCopy({ ...args, database: join(source, 'venue/venue.db') });
  } finally { db.close(); }
  return { ...args, database: copy.database, locationId, codeRoot: fixture.codeRoot, stateRoot: join(root, 'replay'),
    config, initial, expected: { sales: 4, paid: 4, tradingDays: 2, busiest: 3 },
    originalInventory: { timeZone: 'Europe/Madrid', days: 2, busiest: 3 },
    cadence: { mode: 'accelerated', factor: 100 }, windowSeconds: 10 };
}
const fingerprint = path => createHash('sha256').update(readFileSync(path)).digest('hex');

// A read-only container still needs private temporary space when SQLite spills beyond its cache.
test('isolatedReplayRuntimeSupportsSqliteTemporaryFiles', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA temp_store=FILE; PRAGMA temp.cache_size=1;
      CREATE TEMP TABLE spill(value BLOB);
      WITH RECURSIVE rows(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM rows WHERE n<1000)
      INSERT INTO spill SELECT zeroblob(4096) FROM rows;`);
    assert.equal(db.prepare('SELECT count(*) AS n FROM spill').get().n, 1000);
    assert.equal(db.prepare('SELECT sum(length(value)) AS bytes FROM spill').get().bytes, 4096000);
  } finally { db.close(); }
});

// Dropping or bypassing a sale, missing verification, wrong growth units or missing cleanup breaks this result.
test('privateDayReplaysTheEntireSelectedDayAndReturnsOnlyCountsAndSizes', async t => {
  const f = await setup(t), before = fingerprint(f.database), progress = [], sizes = [], observations = [];
  const result = await local.replayPrivateDay({ ...f,
    initial: { ...f.initial, location: { ...f.initial.location, timeZone: 'Asia/Kathmandu', dayCutover: '00:00:00' } },
    onProgress(value) {
    progress.push(value);
    if (value.successfulSales !== 0 && value.phase !== 'verification') return;
    const db = new DatabaseSync(join(f.stateRoot, 'venue/venue.db'), { readOnly: true });
    try {
      sizes.push(db.prepare('PRAGMA page_size').get().page_size * db.prepare('PRAGMA page_count').get().page_count);
      const entries = JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources;
      const ready = entries?.find(e => e.kind === 'private-replay-state' && e.state === 'ready');
      observations.push({ clock: { ...db.prepare('SELECT time_zone,day_cutover FROM locations').get() }, ready });
      if (value.phase === 'verification') {
        assert.deepEqual(db.prepare('SELECT invoice_number,total FROM sales ORDER BY invoice_number').all().map(r => ({ ...r })),
          [{ invoice_number: 1, total: 1210 }, { invoice_number: 2, total: 1210 }, { invoice_number: 3, total: 1210 }]);
        assert.deepEqual(db.prepare('SELECT name FROM sale_lines ORDER BY rowid').all().map(r => r.name),
          ['PRIVATE_SYNTHETIC_ITEM_1', 'PRIVATE_SYNTHETIC_ITEM_2', 'PRIVATE_SYNTHETIC_ITEM_3']);
        assert.equal(db.prepare('SELECT count(*) AS n FROM tenders').get().n, 3);
        assert.equal(db.prepare('SELECT count(*) AS n FROM registros_facturacion').get().n, 3);
        assert.equal(db.prepare("SELECT next_number AS n FROM invoice_series WHERE code='R'").get().n, 4);
      }
    } finally { db.close(); }
  } });
  assert.equal(result.complete, true);
  assert.deepEqual(result.source.counts, { sales: 4, paid: 4, tradingDays: 2, busiest: 3 });
  assert.deepEqual(result.source.originalInventory, { days: 2, busiest: 3 });
  for (const observation of observations) {
    assert.deepEqual(observation.clock, { time_zone: 'Europe/Madrid', day_cutover: '06:00:00' });
    assert.equal(observation.ready?.path, f.stateRoot, 'record owned replay state before raw sales are admitted');
    assert.equal(Number.isSafeInteger(observation.ready?.ino) && Number.isSafeInteger(observation.ready?.dev), true);
  }
  assert.deepEqual(result.replay.counts, { expected: 3, attempted: 3, successful: 3, failed: 0 });
  assert.deepEqual(result.replay.cadence, { mode: 'accelerated', factor: 100, coveredSeconds: 0.1 });
  assert.deepEqual(result.integrity, { ok: true, issues: 0 });
  assert.ok(result.storage.copiedDatabaseBytes > 100000);
  assert.ok(result.storage.freshBeforeBytes > 100000);
  assert.ok(result.storage.freshAfterBytes >= result.storage.freshBeforeBytes, 'existing free pages may absorb a small day');
  assert.deepEqual([result.storage.freshBeforeBytes, result.storage.freshAfterBytes], sizes);
  assert.equal(result.storage.freshGrowthBytes, result.storage.freshAfterBytes - result.storage.freshBeforeBytes);
  assert.equal(result.storage.freshBeforeBytes % 4096, 0); assert.equal(result.storage.freshAfterBytes % 4096, 0);
  assert.deepEqual(progress, [{ phase: 'workload', successfulSales: 0 }, { phase: 'workload', successfulSales: 1 },
    { phase: 'workload', successfulSales: 2 }, { phase: 'workload', successfulSales: 3 }, { phase: 'verification', successfulSales: 3 }]);
  assert.equal(fingerprint(f.database), before); assert.equal(existsSync(f.stateRoot), false);
  assert.deepEqual(result.cleanup, { ownedReplayRoots: 0 });
  assert.deepEqual(JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources
    .filter(e => e.kind === 'private-replay-state').map(e => e.state), ['intent', 'ready', 'cleanup-intent', 'removed']);
  assert.equal(/PRIVATE_|2026-|venue|\/|Synthetic/.test(JSON.stringify(result)), false);
  assert.throws(() => exportAggregate(result), 'replay completion alone is not complete cost evidence');
});

// Neither trading-day counts nor the original inventory can be silently replaced with a different sample.
for (const key of ['sales', 'paid', 'tradingDays', 'busiest']) test(`privateDayRefusesMismatched-${key}`, async t => {
  const f = await setup(t);
  await assert.rejects(local.replayPrivateDay({ ...f, expected: { ...f.expected, [key]: f.expected[key] + 1 } }), invalid);
  assert.equal(existsSync(f.stateRoot), false);
});
for (const key of ['days', 'busiest']) test(`privateDayRefusesMismatchedOriginal-${key}`, async t => {
  const f = await setup(t);
  await assert.rejects(local.replayPrivateDay({ ...f, originalInventory: { ...f.originalInventory, [key]: 9 } }), invalid);
  assert.equal(existsSync(f.stateRoot), false);
});
test('privateDayStopsAfterAnAdmittedSaleWhenCancelledAndRemovesOnlyItsOwnState', async t => {
  const f = await setup(t), controller = new AbortController(), progress = [], before = fingerprint(f.database);
  const foreign = join(f.root, 'earlier-state'); mkdirSync(foreign, { mode: 0o700 });
  writeFileSync(join(foreign, 'sentinel'), 'preserve', { mode: 0o600 });
  await assert.rejects(local.replayPrivateDay({ ...f, signal: controller.signal, onProgress(value) {
    progress.push(value); if (value.successfulSales === 1) controller.abort();
  } }), invalid);
  assert.deepEqual(progress, [{ phase: 'workload', successfulSales: 0 }, { phase: 'workload', successfulSales: 1 }]);
  assert.equal(existsSync(f.stateRoot), false); assert.equal(fingerprint(f.database), before);
  assert.equal(readFileSync(join(foreign, 'sentinel'), 'utf8'), 'preserve');
});
test('privateDayNeverOverwritesAnExistingReplayDestination', async t => {
  const f = await setup(t); mkdirSync(f.stateRoot, { mode: 0o700 });
  writeFileSync(join(f.stateRoot, 'sentinel'), 'preserve', { mode: 0o600 });
  await assert.rejects(local.replayPrivateDay(f), invalid);
  assert.equal(readFileSync(join(f.stateRoot, 'sentinel'), 'utf8'), 'preserve');
});
test('privateDayDoesNotDeleteAReplacedDestinationOrLeakRawCallbackErrors', async t => {
  const f = await setup(t);
  await assert.rejects(local.replayPrivateDay({ ...f, onProgress(value) {
    if (value.successfulSales !== 1) return;
    renameSync(f.stateRoot, f.stateRoot + '-saved'); mkdirSync(f.stateRoot, { mode: 0o700 });
    writeFileSync(join(f.stateRoot, 'sentinel'), 'foreign', { mode: 0o600 });
    throw Error('PRIVATE_SYNTHETIC_ERROR');
  } }), invalid);
  assert.equal(existsSync(join(f.stateRoot, 'sentinel')), true, 'replacement state must survive cleanup');
  assert.equal(readFileSync(join(f.stateRoot, 'sentinel'), 'utf8'), 'foreign');
  assert.ok(existsSync(f.stateRoot + '-saved/venue/venue.db'));
});
test('privateDayRefusesOutsideStateOrAReplacedOwnershipToken', async t => {
  const f = await setup(t);
  await assert.rejects(local.replayPrivateDay({ ...f, stateRoot: join(f.source, 'unowned') }), invalid);
  assert.equal(existsSync(join(f.source, 'unowned')), false);
  writeFileSync(join(f.root, '.cloud-cost-owner'), '0'.repeat(64), { mode: 0o600 });
  await assert.rejects(local.replayPrivateDay(f), invalid);
  assert.equal(existsSync(f.stateRoot), false);
});

test('privateDayRefusesNoncanonicalStateBeforeItCanLeaveAnUnremovableDestination', async t => {
  const f = await setup(t); mkdirSync(join(f.root, 'unused'), { mode: 0o700 });
  await assert.rejects(local.replayPrivateDay({ ...f, stateRoot: f.root + '/unused/../replay' }), invalid);
  assert.equal(existsSync(f.stateRoot), false, 'reject a spelling cleanup cannot safely remove before creating it');
});

function wrappedRuntime(f, body) {
  const codeRoot = join(f.root, 'code'); mkdirSync(codeRoot, { mode: 0o700 });
  cpSync(join(f.codeRoot, 'packages'), join(codeRoot, 'packages'), { recursive: true });
  const url = JSON.stringify(pathToFileURL(join(f.codeRoot, 'runtime.mjs')).href);
  const source = `export * from ${url}; import * as actual from ${url}; ${body}`;
  writeFileSync(join(codeRoot, 'runtime.mjs'), source, { mode: 0o600 });
  writeFileSync(join(codeRoot, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1,
    revision: 'fbadd15785464e59747e697c11048bfbc6e4938f', sha256: createHash('sha256').update(source).digest('hex') }), { mode: 0o600 });
  return codeRoot;
}
test('privateDayRefusesAFailedFinalIntegrityCheckAfterAllNormalSales', async t => {
  const f = await setup(t), progress = [];
  const codeRoot = wrappedRuntime(f, `export class VerifactuBackend extends actual.VerifactuBackend {
    async checkIntegrity() { return {ok:false,issues:['PRIVATE_SYNTHETIC_FAILURE']}; }
  }`);
  await assert.rejects(local.replayPrivateDay({ ...f, codeRoot, onProgress: p => progress.push(p) }), invalid);
  assert.deepEqual(progress.at(-1), { phase: 'verification', successfulSales: 3 });
  assert.equal(existsSync(f.stateRoot), false);
});
test('privateDayRemovesFailedWriterStateAndSuppressesItsRawException', async t => {
  const f = await setup(t), progress = [], before = fingerprint(f.database);
  const codeRoot = wrappedRuntime(f, `let admitted=0; export async function recordSale(...args) {
    if (++admitted===2) throw Error('PRIVATE_SYNTHETIC_FAILURE'); return actual.recordSale(...args);
  }`);
  await assert.rejects(local.replayPrivateDay({ ...f, codeRoot, onProgress: p => progress.push(p) }),
    e => e.message === invalid.message && !e.stack.includes('PRIVATE_SYNTHETIC_FAILURE') && e.cause === undefined);
  assert.deepEqual(progress, [{ phase: 'workload', successfulSales: 0 }, { phase: 'workload', successfulSales: 1 }]);
  assert.equal(existsSync(f.stateRoot), false); assert.equal(fingerprint(f.database), before);
});
test('privateDayCancellationDuringVerificationCannotReturnACompleteResult', async t => {
  const f = await setup(t), controller = new AbortController();
  await assert.rejects(local.replayPrivateDay({ ...f, signal: controller.signal, onProgress(value) {
    if (value.phase === 'verification') controller.abort();
  } }), invalid);
  assert.equal(existsSync(f.stateRoot), false);
});

test('privateDaySuppressesRawProgressErrorsAndStillRemovesItsDestination', async t => {
  const f = await setup(t);
  await assert.rejects(local.replayPrivateDay({ ...f, onProgress() { throw Error('PRIVATE_SYNTHETIC_PROGRESS'); } }),
    e => e.message === invalid.message && !e.stack.includes('PRIVATE_SYNTHETIC_PROGRESS') && e.cause === undefined);
  assert.equal(existsSync(f.stateRoot), false);
});

test('privateDayAwaitsAsyncProgressAndSuppressesItsRejectedPrivateError', async t => {
  const f = await setup(t), progress = [];
  await assert.rejects(local.replayPrivateDay({ ...f, async onProgress(value) {
    await Promise.resolve(); progress.push(value);
    if (value.successfulSales === 1) throw Error('PRIVATE_SYNTHETIC_ASYNC_PROGRESS');
  } }), e => e.message === invalid.message && !e.stack.includes('PRIVATE_SYNTHETIC_ASYNC_PROGRESS') && e.cause === undefined);
  assert.deepEqual(progress, [{ phase: 'workload', successfulSales: 0 }, { phase: 'workload', successfulSales: 1 }]);
  assert.equal(existsSync(f.stateRoot), false);
});

// Invalid measurement settings must fail before the private replay creates a fresh venue.
test('privateDayRefusesInvalidStreamSettingsBeforeOpeningTheReplay', async t => {
  const f = await setup(t), before = fingerprint(f.database);
  const base = { binary: '/not-opened', binarySha256: '0'.repeat(64), target: 'http://127.0.0.1:1', sdk: {},
    bucket: 'synthetic-settings', versioned: false, startupSeconds: 2, idleSeconds: 2, windowSeconds: 60 };
  for (const change of [s => { s.extra = true; }, s => { delete s.binary; }, s => { s.startupSeconds = 0; },
    s => { s.startupSeconds = 301; }, s => { s.idleSeconds = 0; }, s => { s.idleSeconds = 3601; },
    s => { s.windowSeconds = 7201; }, s => { s.windowSeconds = 4; }, s => { s.windowSeconds = NaN; }]) {
    const stream = { ...base }; change(stream);
    await assert.rejects(local.replayPrivateDay({ ...f, stream }), invalid);
    assert.equal(existsSync(f.stateRoot), false); assert.equal(fingerprint(f.database), before);
    assert.equal(JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources.some(e => e.kind === 'private-replay-state'), false);
  }
});

// Losing capture/restore, restoring only part of the replay, or returning an artifact breaks this boundary.
test('privateDayArchivesAndRestoresAllReplayedSalesWithoutReleasingPrivateState', async t => {
  const f = await setup(t), before = fingerprint(f.database), phases = [];
  const result = await local.replayPrivateDay({ ...f, archive: true, onProgress: p => phases.push(p.phase) });
  assert.ok(result.archive, 'requested archive must run before replay state closes');
  assert.deepEqual(Object.keys(result.archive).sort(), ['captureSeconds', 'capturedBytes', 'restoreSeconds', 'restored']);
  assert.equal(Number.isSafeInteger(result.archive.capturedBytes) && result.archive.capturedBytes > 1000, true);
  assert.ok(result.archive.captureSeconds > 0 && result.archive.captureSeconds < 60);
  assert.ok(result.archive.restoreSeconds > 0 && result.archive.restoreSeconds < 60);
  assert.deepEqual(result.archive.restored, { ok: true, issues: 0, sales: 3 });
  assert.deepEqual(phases.slice(-3), ['verification', 'archive', 'restore']);
  assert.equal(fingerprint(f.database), before); assert.equal(existsSync(f.stateRoot), false);
  assert.deepEqual(result.cleanup, { ownedReplayRoots: 0 });
  assert.equal(/PRIVATE_|2026-|venue|recoveryKey|artifact|tls|Synthetic/.test(JSON.stringify(result)), false);
});

for (const archive of [false, null, {}, 'true']) test('privateDayRefusesInvalidArchiveFlag_'+JSON.stringify(archive), async t => {
  const f = await setup(t);
  await assert.rejects(local.replayPrivateDay({ ...f, archive }), invalid);
  assert.equal(existsSync(f.stateRoot), false);
  assert.equal(JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources.some(e => e.kind === 'private-replay-state'), false);
});

for (const stage of ['archive', 'restore']) test('privateDayArchiveCancellation_'+stage, async t => {
  const f = await setup(t), controller = new AbortController(), before = fingerprint(f.database), phases = [];
  await assert.rejects(local.replayPrivateDay({ ...f, archive: true, signal: controller.signal, onProgress(p) {
    phases.push(p.phase); if (p.phase === stage) controller.abort();
  } }), invalid);
  assert.equal(phases.at(-1), stage); assert.equal(existsSync(f.stateRoot), false);
  assert.equal(fingerprint(f.database), before);
});

for (const fault of ['capture', 'restore', 'integrity', 'sales']) test('privateDayArchiveRefuses_'+fault, async t => {
  const f = await setup(t), before = fingerprint(f.database), phases = [];
  const body = fault === 'capture' ? `export async function createCloudSnapshotArchive() { throw Error('PRIVATE_SYNTHETIC_CAPTURE'); }`
    : fault === 'restore' ? `export async function restoreFromArtifact() { throw Error('PRIVATE_SYNTHETIC_RESTORE'); }`
    : fault === 'integrity' ? `let restored=false;
      export async function restoreFromArtifact(...args) { await actual.restoreFromArtifact(...args); restored=true; }
      export class VerifactuBackend extends actual.VerifactuBackend {
      async checkIntegrity(...args) { return restored ? {ok:false,issues:[]} : super.checkIntegrity(...args); } }`
    : `let restoredOpen=false, checked=false;
      export class VerifactuBackend extends actual.VerifactuBackend {
        async checkIntegrity(...args) { const result=await super.checkIntegrity(...args);
          if(restoredOpen) checked=true; return result; } }
      export async function openVenueDatabase(...args) { const store=await actual.openVenueDatabase(...args);
      if(args[0].includes('/restored/')) { restoredOpen=true; const execute=store.venue.execute.bind(store.venue);
        store.venue.execute=(...a)=>{ const result=execute(...a);
          return checked && result.rows?.[0] && Object.keys(result.rows[0]).join(',')==='n' ? {...result,rows:[{n:2}]} : result; }; }
      return store; }`;
  const codeRoot = wrappedRuntime(f, body);
  await assert.rejects(local.replayPrivateDay({ ...f, codeRoot, archive: true, onProgress: p => phases.push(p.phase) }),
    e => e.message === invalid.message && !e.stack.includes('PRIVATE_SYNTHETIC') && e.cause === undefined);
  assert.equal(existsSync(f.stateRoot), false); assert.equal(fingerprint(f.database), before);
  assert.equal(phases.at(-1), fault === 'capture' ? 'archive' : 'restore');
});

// A cancellation delivered inside the actual restore cannot escape as a completed archive measurement.
test('privateDayArchiveRefusesCancellationAfterApplicationRestore', async t => {
  const f = await setup(t), controller = new AbortController(), name = 'costArchiveAbort_' + randomBytes(8).toString('hex');
  globalThis[name] = () => controller.abort(); t.after(() => { delete globalThis[name]; });
  const codeRoot = wrappedRuntime(f, `export async function restoreFromArtifact(...args) {
    await actual.restoreFromArtifact(...args); globalThis[${JSON.stringify(name)}](); }`);
  await assert.rejects(local.replayPrivateDay({ ...f, codeRoot, archive: true, signal: controller.signal }), invalid);
  assert.equal(controller.signal.aborted, true); assert.equal(existsSync(f.stateRoot), false);
});

// Reject invalid artifacts before invoking restore; a downstream decryption refusal does not prove capture admission.
for (const bytes of ['new Uint8Array()', "'PRIVATE_SYNTHETIC_BYTES'"]) test('privateDayArchiveRejectsInvalidCapture_'+bytes, async t => {
  const f = await setup(t), phases = [];
  const codeRoot = wrappedRuntime(f, `export async function createCloudSnapshotArchive() { return {bytes:${bytes}}; }`);
  await assert.rejects(local.replayPrivateDay({ ...f, codeRoot, archive: true, onProgress: p => phases.push(p.phase) }), invalid);
  assert.equal(phases.at(-1), 'archive'); assert.equal(existsSync(f.stateRoot), false);
});

for (const mode of ['sync', 'async']) test('privateDayDiagnosticObserverCannotInterruptReplay_' + mode, async t => {
  const f = await setup(t), before = fingerprint(f.database);
  const throws = () => { throw Error('PRIVATE_DIAGNOSTIC_CANARY'); };
  const result = await local.replayPrivateDay({ ...f, onDiagnostic: mode === 'sync' ? throws : async () => throws() });
  assert.deepEqual(result.replay.counts, { expected: 3, attempted: 3, successful: 3, failed: 0 });
  assert.deepEqual(result.cleanup, { ownedReplayRoots: 0 });
  assert.equal(existsSync(f.stateRoot), false);
  assert.equal(fingerprint(f.database), before);
});
