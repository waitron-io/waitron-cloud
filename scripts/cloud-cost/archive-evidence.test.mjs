import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLocalEvidence } from './joined-evidence.mjs';
const module = await import('./archive-evidence.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./archive-evidence.mjs', import.meta.url).href) return {};
  throw error;
});
const fixture = () => ({
  cloudRevision: 'a'.repeat(40), waitronRevision: 'fbadd15785464e59747e697c11048bfbc6e4938f',
  runtimeSha256: 'b'.repeat(64), image: 'sha256:' + 'c'.repeat(64),
  startedAt: '2026-10-21T03:32:53.354Z', endedAt: '2026-10-21T03:33:01.154Z', experimentSeconds: 7.797,
  costMeasured: false,
  replay: {
    complete: true, source: { counts: { sales: 10, paid: 10, tradingDays: 3, busiest: 2 }, originalInventory: { days: 4, busiest: 1 } },
    replay: { complete: true, cadence: { mode: 'accelerated', factor: 1000, coveredSeconds: 100 },
      counts: { expected: 2, attempted: 2, successful: 2, failed: 0 }, timing: { elapsedSeconds: 0.2, maxLagSeconds: 0.1 } },
    integrity: { ok: true, issues: 0 },
    storage: { copiedDatabaseBytes: 8192, freshBeforeBytes: 4096, freshAfterBytes: 5120, freshGrowthBytes: 1024 },
    archive: { capturedBytes: 4500, captureSeconds: 0.3, restoreSeconds: 0.4, restored: { ok: true, issues: 0, sales: 2 } },
    cleanup: { ownedReplayRoots: 0 },
  },
  isolation: { blockedConnections: 3, blockedDns: 2, localControl: true },
  cleanup: { workerContainers: 0, networks: 0, privateCopies: 0 },
  scope: 'selected-day-sales-replayed-into-fresh-venue', privateState: 'generated-32-byte-stand-ins',
  unknown: ['production-private-state-shape', 'representative-venue-database', 'archive-storage-http-traffic',
    'monthly-frequency', 'aws-capacity', 'daily-cost', 'monthly-cost'],
});
const build = input => {
  assert.equal(typeof module.buildArchiveEvidence, 'function', 'publish only checked anonymous archive evidence');
  return module.buildArchiveEvidence(input);
};
const bad = { message: 'Invalid cloud cost archive evidence' };

// Losing the scope would make fresh replay data look like a complete production archive.
test('archiveExportPreservesExactSourceSampleAndMissingProductionEvidence', () => {
  const input = fixture(), output = build(input);
  assert.equal(output.schemaVersion, 1); assert.equal(output.kind, 'local-archive-aggregate');
  assert.deepEqual(output.dataBoundary, { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 });
  assert.equal(output.cloudRevision, 'a'.repeat(40)); assert.equal(output.experimentSeconds, 7.797);
  assert.equal(output.scope, 'selected-day-sales-replayed-into-fresh-venue');
  assert.equal(output.privateState, 'generated-32-byte-stand-ins');
  assert.deepEqual(output.replay.archive, { capturedBytes: 4500, captureSeconds: 0.3, restoreSeconds: 0.4,
    restored: { ok: true, issues: 0, sales: 2 } });
  assert.equal(output.costMeasured, false);
  assert.deepEqual(output.unknown, ['production-private-state-shape', 'representative-venue-database', 'archive-storage-http-traffic',
    'monthly-frequency', 'aws-capacity', 'daily-cost', 'monthly-cost']);
  input.replay.archive.capturedBytes = 1;
  assert.equal(output.replay.archive.capturedBytes, 4500, 'detach producer state');
  assert.equal(typeof module.validateArchiveEvidence, 'function');
  assert.doesNotThrow(() => module.validateArchiveEvidence(output));
});

// Each mutation would either publish private data or claim incomplete work as measured.
const changes = [
  ['raw-top', f => { f.path = 'PRIVATE_CANARY'; }],
  ['raw-source', f => { f.replay.source.location = 'PRIVATE_CANARY'; }],
  ['raw-counts', f => { f.replay.source.counts.taxpayer = 'PRIVATE_CANARY'; }],
  ['raw-original-inventory', f => { f.replay.source.originalInventory.date = 'PRIVATE_CANARY'; }],
  ['raw-archive', f => { f.replay.archive.bytes = 'PRIVATE_CANARY'; }],
  ['raw-restored', f => { f.replay.archive.restored.key = 'PRIVATE_CANARY'; }],
  ['raw-storage', f => { f.replay.storage.database = 'PRIVATE_CANARY'; }],
  ['raw-timing', f => { f.replay.replay.timing.saleTime = 'PRIVATE_CANARY'; }],
  ['raw-isolation', f => { f.isolation.network = 'PRIVATE_CANARY'; }],
  ['raw-cleanup', f => { f.cleanup.container = 'PRIVATE_CANARY'; }],
  ['wrong-pin', f => { f.waitronRevision = 'd'.repeat(40); }],
  ['invalid-source', f => { f.cloudRevision = 'PRIVATE_CANARY'; }],
  ['invalid-runtime', f => { f.runtimeSha256 = 'PRIVATE_CANARY'; }],
  ['invalid-image', f => { f.image = 'PRIVATE_CANARY'; }],
  ['invalid-date', f => { f.startedAt = '2026-02-30T03:32:53.354Z'; }],
  ['normalized-impossible-dates', f => { f.startedAt = '2026-02-30T03:32:53.354Z'; f.endedAt = '2026-02-30T03:33:01.154Z'; }],
  ['negative-window', f => { f.endedAt = f.startedAt; }],
  ['unmatched-clock', f => { f.experimentSeconds = 1; }],
  ['false-cost', f => { f.costMeasured = true; }],
  ['false-scope', f => { f.scope = 'production-venue'; }],
  ['false-private-state', f => { f.privateState = 'production'; }],
  ['missing-gap', f => { f.unknown.pop(); }],
  ['raw-gap', f => { f.unknown[0] = 'PRIVATE_CANARY'; }],
  ['incomplete', f => { f.replay.complete = false; }],
  ['incomplete-sales', f => { f.replay.replay.complete = false; }],
  ['failed-integrity', f => { f.replay.integrity.ok = false; }],
  ['integrity-issue', f => { f.replay.integrity.issues = 1; }],
  ['failed-restore', f => { f.replay.archive.restored.ok = false; }],
  ['restore-issue', f => { f.replay.archive.restored.issues = 1; }],
  ['missing-sale', f => { f.replay.archive.restored.sales = 1; }],
  ['failed-sale', f => { f.replay.replay.counts.failed = 1; }],
  ['missed-attempt', f => { f.replay.replay.counts.attempted = 1; }],
  ['missed-success', f => { f.replay.replay.counts.successful = 1; }],
  ['wrong-selection', f => { f.replay.source.counts.busiest = 1; }],
  ['impossible-paid', f => { f.replay.source.counts.paid = 11; }],
  ['fractional-count', f => { f.replay.source.counts.sales = 10.5; }],
  ['empty-sales', f => { f.replay.replay.counts.expected = 0; }],
  ['bad-cadence-mode', f => { f.replay.replay.cadence.mode = 'PRIVATE_CANARY'; }],
  ['bad-cadence-factor', f => { f.replay.replay.cadence.factor = 0; }],
  ['bad-covered-time', f => { f.replay.replay.cadence.coveredSeconds = -1; }],
  ['bad-replay-time', f => { f.replay.replay.timing.elapsedSeconds = -1; }],
  ['bad-lag', f => { f.replay.replay.timing.maxLagSeconds = -1; }],
  ['empty-archive', f => { f.replay.archive.capturedBytes = 0; }],
  ['fractional-bytes', f => { f.replay.archive.capturedBytes = 4500.5; }],
  ['negative-capture-time', f => { f.replay.archive.captureSeconds = -1; }],
  ['negative-restore-time', f => { f.replay.archive.restoreSeconds = -1; }],
  ['impossible-stage-time', f => { f.replay.archive.restoreSeconds = 8; }],
  ['wrong-growth', f => { f.replay.storage.freshGrowthBytes = 1; }],
  ['negative-bytes', f => { f.replay.storage.copiedDatabaseBytes = -1; }],
  ['unclean-replay', f => { f.replay.cleanup.ownedReplayRoots = 1; }],
  ['unclean-container', f => { f.cleanup.workerContainers = 1; }],
  ['unclean-network', f => { f.cleanup.networks = 1; }],
  ['unclean-copy', f => { f.cleanup.privateCopies = 1; }],
  ['missing-egress-probe', f => { f.isolation.blockedConnections = 2; }],
  ['missing-dns-probe', f => { f.isolation.blockedDns = 1; }],
  ['failed-control', f => { f.isolation.localControl = false; }],
];
for (const [name, change] of changes) test('archiveExportRefuses_' + name, () => {
  const f = fixture(); change(f); assert.throws(() => build(f), bad);
});
for (const [name, change] of changes) test('publishedArchiveRefuses_' + name, () => {
  const output = build(fixture()); change(output);
  assert.throws(() => module.validateArchiveEvidence(output), bad);
});

test('archiveExportNeverInvokesPrivateProducerAccessors', () => {
  const f = fixture(); let invoked = false;
  Object.defineProperty(f, 'replay', { enumerable: true, get() { invoked = true; throw Error('PRIVATE_CANARY'); } });
  try { assert.throws(() => build(f), bad); } finally { assert.equal(invoked, false); }
});

for (const [name, change] of [
  ['getter', f => { Object.defineProperty(f.replay.archive, 'capturedBytes', { get() { throw Error('PRIVATE_CANARY'); } }); }],
  ['symbol', f => { f[Symbol('PRIVATE_CANARY')] = 1; }],
  ['array-field', f => { f.unknown.path = 'PRIVATE_CANARY'; }],
  ['sparse-array', f => { delete f.unknown[0]; }],
  ['prototype', f => { Object.setPrototypeOf(f.replay.archive, { path: 'PRIVATE_CANARY' }); }],
  ['cycle', f => { f.replay.archive.loop = f; }],
]) test('archiveExportRefusesHiddenData_' + name, () => {
  const f = fixture(); change(f); assert.throws(() => build(f), bad);
});

const joinedFixture = () => {
  const read = name => JSON.parse(readFileSync(new URL('../../docs/cost-model/' + name + '.json', import.meta.url)));
  return { stream: read('measurements'), services: [read('service-mail-retry-fiscal-lifecycle'), read('service-signup-recovery-fiscal-refusal')],
    api: read('remote-owner-public-api'), browser: read('remote-owner-browser'), archive: build(fixture()) };
};
test('joinedArchiveRetainsItsOwnWindowWithoutInventingStorageTrafficOrDayCosts', () => {
  const input = joinedFixture(); const result = buildLocalEvidence(input);
  assert.equal(result.experiments.archive.replay.archive.capturedBytes, 4500);
  assert.equal(result.experiments.archive.cloudRevision, 'a'.repeat(40));
  assert.equal(result.experiments.archive.experimentSeconds, 7.797);
  assert.equal(result.experiments.stream.window.elapsedSeconds, 1287.607);
  assert.equal(result.costMeasured, false); assert.equal(result.dailyCost, null); assert.equal(result.monthlyCost, null);
  assert.deepEqual(result.unmeasured, ['representative-archive-shape', 'archive-storage-http-traffic', 'representative-remote-activity',
    'public-browser-journey', 'monthly-frequencies', 'provider-billing', 'daily-projection']);
  input.archive.replay.archive.capturedBytes = 1;
  assert.equal(result.experiments.archive.replay.archive.capturedBytes, 4500);
});
for (const [name, change] of [
  ['raw', f => { f.archive.raw = 'PRIVATE_CANARY'; }],
  ['false-boundary', f => { f.archive.dataBoundary.rawIncluded = true; }],
  ['wrong-kind', f => { f.archive.kind = 'production'; }],
  ['incomplete-restore', f => { f.archive.replay.archive.restored.sales = 1; }],
]) test('joinedArchiveRefuses_' + name, () => {
  const input = joinedFixture(); change(input);
  assert.throws(() => buildLocalEvidence(input), { message: 'Invalid cloud cost joined evidence' });
});
