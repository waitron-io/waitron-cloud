import { test } from 'node:test';
import assert from 'node:assert/strict';
const controller = await import('./isolated-replay.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./isolated-replay.mjs', import.meta.url).href) return {};
  throw error;
});

const admission = () => ({
  complete: true,
  source: { counts: { sales: 4, paid: 4, tradingDays: 2, busiest: 3 }, originalInventory: { days: 2, busiest: 3 } },
  replay: { complete: true, cadence: { mode: 'accelerated', factor: 100, coveredSeconds: 0.1 },
    counts: { expected: 3, attempted: 3, successful: 3, failed: 0 }, timing: { elapsedSeconds: 0.2, maxLagSeconds: 0.1 } },
  integrity: { ok: true, issues: 0 },
  storage: { copiedDatabaseBytes: 8192, freshBeforeBytes: 4096, freshAfterBytes: 8192, freshGrowthBytes: 4096 },
  cleanup: { ownedReplayRoots: 0 },
});
const options = { expected: { sales: 4, paid: 4, tradingDays: 2, busiest: 3 },
  originalInventory: { timeZone: 'Europe/Madrid', days: 2, busiest: 3 },
  cadence: { mode: 'accelerated', factor: 100 }, replayWindowSeconds: 10 };

// Passing unknown fields through this boundary could publish private worker data.
test('replayAdmissionAcceptsOnlyReconciledCountSizeAndDurationEvidence', () => {
  assert.equal(typeof controller.validateReplayAdmission, 'function', 'validate worker evidence before releasing it');
  const input = admission();
  assert.deepEqual(controller.validateReplayAdmission(input, options), input);
  const result = controller.validateReplayAdmission(input, options);
  input.source.counts.sales = 9;
  assert.equal(result.source.counts.sales, 4);
});

for (const [name, change] of [
  ['extra root data', r => { r.raw = 'PRIVATE_SYNTHETIC'; }],
  ['extra nested data', r => { r.source.counts.name = 'PRIVATE_SYNTHETIC'; }],
  ['extra timing data', r => { r.replay.timing.path = '/PRIVATE_SYNTHETIC'; }],
  ['extra storage data', r => { r.storage.rows = []; }],
  ['extra cleanup data', r => { r.cleanup.path = '/PRIVATE_SYNTHETIC'; }],
  ['incomplete selection', r => { r.complete = false; }],
  ['different selection', r => { r.source.counts.sales = 5; }],
  ['different original inventory', r => { r.source.originalInventory.busiest = 4; }],
  ['incomplete schedule', r => { r.replay.complete = false; }],
  ['different cadence', r => { r.replay.cadence.factor = 99; }],
  ['changed cadence mode', r => { r.replay.cadence.mode = 'original'; }],
  ['lost sale', r => { r.replay.counts.successful = 2; }],
  ['wrong attempted count', r => { r.replay.counts.attempted = 4; }],
  ['wrong expected count', r => { r.replay.counts.expected = 4; }],
  ['failed sale', r => { r.replay.counts.failed = 1; }],
  ['unverified fiscal chain', r => { r.integrity.ok = false; }],
  ['fiscal issue', r => { r.integrity.issues = 1; }],
  ['uncollected replay state', r => { r.cleanup.ownedReplayRoots = 1; }],
  ['negative duration', r => { r.replay.timing.elapsedSeconds = -1; }],
  ['nonfinite timing', r => { r.replay.timing.maxLagSeconds = Infinity; }],
  ['exceeded replay window', r => { r.replay.timing.elapsedSeconds = 10; }],
  ['unreplayable duration', r => { r.replay.cadence.coveredSeconds = 1000; }],
  ['fractional bytes', r => { r.storage.copiedDatabaseBytes = 1.5; }],
  ['missing database baseline', r => { r.storage.copiedDatabaseBytes = 0; }],
  ['negative growth', r => { r.storage.freshAfterBytes = 0; }],
  ['wrong growth', r => { r.storage.freshGrowthBytes = 0; }],
]) {
  test('replayAdmissionRefuses'+name, () => {
    assert.equal(typeof controller.validateReplayAdmission, 'function', 'reject unsafe or incomplete worker evidence');
    const result = admission(); change(result);
    assert.throws(() => controller.validateReplayAdmission(result, options), { message: 'Invalid isolated cloud cost replay' });
  });
}

const archive = () => ({ capturedBytes: 2048, captureSeconds: 0.2, restoreSeconds: 0.3,
  restored: { ok: true, issues: 0, sales: 3 } });
// Releasing an unchecked archive can leak private data or qualify a partial restore.
test('replayAdmissionAdmitsOnlyTheRequestedCompleteArchiveMeasurement', () => {
  const input = { ...admission(), archive: archive() };
  assert.deepEqual(controller.validateReplayAdmission(input, { ...options, archive: true }), input);
  assert.throws(() => controller.validateReplayAdmission(input, options));
  assert.throws(() => controller.validateReplayAdmission(admission(), { ...options, archive: true }));
  const result = controller.validateReplayAdmission(input, { ...options, archive: true });
  input.archive.restored.sales = 2; assert.equal(result.archive.restored.sales, 3);
});
for (const [name, change] of [
  ['artifact', a => { a.artifact = 'PRIVATE_SYNTHETIC'; }],
  ['key', a => { a.recoveryKey = 'PRIVATE_SYNTHETIC'; }],
  ['extra-restored-field', a => { a.restored.path = '/PRIVATE_SYNTHETIC'; }],
  ['zero-bytes', a => { a.capturedBytes = 0; }],
  ['fractional-bytes', a => { a.capturedBytes = 1.5; }],
  ['negative-duration', a => { a.captureSeconds = -1; }],
  ['zero-duration', a => { a.restoreSeconds = 0; }],
  ['infinite-duration', a => { a.restoreSeconds = Infinity; }],
  ['failed-integrity', a => { a.restored.ok = false; }],
  ['issues', a => { a.restored.issues = 1; }],
  ['lost-sale', a => { a.restored.sales = 2; }],
]) test('replayAdmissionRefusesArchive_'+name, () => {
  const input = { ...admission(), archive: archive() }; change(input.archive);
  assert.throws(() => controller.validateReplayAdmission(input, { ...options, archive: true }),
    { message: 'Invalid isolated cloud cost replay' });
});

// Worker evidence outside the caller's overall window cannot qualify a bounded archive experiment.
test('replayAdmissionRefusesArchiveDurationsOutsideTheOverallWindow', () => {
  const input = { ...admission(), archive: archive() };
  input.archive.captureSeconds = 100; input.archive.restoreSeconds = 21;
  assert.throws(() => controller.validateReplayAdmission(input, { ...options, archive: true, windowSeconds: 120 }),
    { message: 'Invalid isolated cloud cost replay' });
});
