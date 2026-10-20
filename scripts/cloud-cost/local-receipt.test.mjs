import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStreamAccounting } from './stream-admission.mjs';
import { exportAggregate } from './schema.mjs';
const module = await import('./local-receipt.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./local-receipt.mjs', import.meta.url).href) return {};
  throw error;
});
const bad = { message: 'Invalid cloud cost local receipt' };
const request = (phase, operation, requestClass, bytesIn, bytesOut, retryOrdinal = 0, outcome = 'success') => ({
  phase, operation, requestClass, outcome, retryOrdinal, attempts: 1,
  successful: outcome === 'success' ? 1 : 0, failed: outcome === 'success' ? 0 : 1,
  retried: retryOrdinal > 0 ? 1 : 0, bytesIn, bytesOut, attemptedBytesIn: bytesIn, attemptedBytesOut: bytesOut,
});
const counters = (requests, totals) => ({ reconciled: true,
  accounting: { requests, objects: [], producer: { ...totals }, observer: { ...totals },
    discrepancy: { attempts: 0, bytesIn: 0, bytesOut: 0 } }, observedRequests: structuredClone(requests) });
function fixture() {
  const options = { expected: { sales: 4, paid: 4, tradingDays: 2, busiest: 3 },
    originalInventory: { days: 2, busiest: 3 }, cadence: { mode: 'accelerated', factor: 100 },
    replayWindowSeconds: 10, stream: { startupSeconds: 2, idleSeconds: 2, windowSeconds: 60 } };
  const stream = {
    phases: ['startup', 'workload', 'idle', 'verification', 'restore'].map(phase => ({ phase, elapsedSeconds: 2 })),
    requests: counters([
      request('startup', 'put', 's3-write', 3, 4096),
      request('workload', 'put', 's3-write', 4, 128, 0, 'server-error'),
      request('workload', 'put', 's3-write', 5, 128, 1),
      request('observer', 'list', 's3-list', 20, 0),
      request('restore', 'get', 's3-read', 4096, 0),
    ], { attempts: 5, bytesIn: 4128, bytesOut: 4352 }),
    administration: counters([
      request('setup', 'bucket-create', 's3-control', 1, 0),
      request('cleanup', 'list', 's3-list', 40, 0),
      request('cleanup', 'delete', 's3-delete', 2, 0),
      request('cleanup', 'bucket-delete', 's3-control', 3, 0),
    ], { attempts: 4, bytesIn: 46, bytesOut: 0 }),
    storage: { status: 'measured', scope: 'unversioned-object-history', windowSeconds: 10,
      objects: { class: 'stream', bytes: 4096, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
      byteSeconds: { low: 5000, high: 6000 } },
    retainedStorage: { status: 'measured', scope: 'unversioned-cleanup-tail', windowSeconds: 2,
      initialBytes: 4096, deletedObjects: 1, remainingBytes: 0, remainingObjects: 0, byteSeconds: { low: 4096, high: 8192 } },
    native: { version: '0.5.17', writerStarts: 1, phaseRestarts: 0 }, restored: { sales: 3, integrity: true },
    cleanup: { processes: 0, privateRoots: 0, listeners: 0, clients: 0, buckets: 0, objects: 0, multipartUploads: 0 },
  };
  const admission = { complete: true,
    source: { counts: { ...options.expected }, originalInventory: { days: 2, busiest: 3 } },
    replay: { complete: true, cadence: { ...options.cadence, coveredSeconds: 2 },
      counts: { expected: 3, attempted: 3, successful: 3, failed: 0 }, timing: { elapsedSeconds: 2, maxLagSeconds: 0.01 } },
    integrity: { ok: true, issues: 0 },
    storage: { copiedDatabaseBytes: 8192, freshBeforeBytes: 4096, freshAfterBytes: 8192, freshGrowthBytes: 4096 },
    cleanup: { ownedReplayRoots: 0 }, stream };
  return { options, result: { costMeasured: false, admission,
    streamAccounting: summarizeStreamAccounting(stream, { ...options.stream, expectedSales: 3 }),
    isolation: { blockedConnections: 3, blockedDns: 2, localControl: true },
    cleanup: { workerContainers: 0, networks: 0, privateCopies: 0 } },
    metadata: { runId: '12345678-1234-4234-8234-123456789012', cloudRevision: 'a'.repeat(40),
      waitronRevision: 'fbadd15785464e59747e697c11048bfbc6e4938f',
      window: { startedAt: '2026-10-21T00:00:00.000Z', endedAt: '2026-10-21T00:01:00.000Z', elapsedSeconds: 60 } } };
}
function build(f) {
  assert.equal(typeof module.buildLocalReceipt, 'function', 'export a closed partial local receipt');
  return module.buildLocalReceipt(f);
}

// Dropping either meter or collapsing storage uncertainty changes these hand-derived quantities.
test('localReceiptPreservesAllStreamTrafficBoundsAndKnownReplayQuantities', () => {
  const f = fixture(), receipt = build(f), inputs = Object.fromEntries(receipt.inputs.map(row => [row.id, row]));
  assert.deepEqual(exportAggregate(receipt), receipt);
  assert.deepEqual(receipt.accounting.producer, { attempts: 9, bytesIn: 4174, bytesOut: 4352 });
  assert.deepEqual(receipt.accounting.observer, receipt.accounting.producer);
  assert.deepEqual(receipt.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  assert.equal(receipt.accounting.requests.find(row => row.outcome === 'server-error').failed, 1);
  assert.equal(receipt.accounting.requests.find(row => row.retryOrdinal === 1).retried, 1);
  assert.equal(receipt.accounting.requests.find(row => row.phase === 'observer').bytesIn, 20);
  assert.deepEqual(receipt.accounting.objects, [], 'do not invent an exact storage lifetime');
  for (const [id, value, unit] of [['successful-sales', 3, 'count'], ['bill-count', 3, 'count'],
    ['orders-per-day', 3, 'count'], ['database-bytes', 8192, 'bytes'], ['database-growth-bytes', 4096, 'bytes'],
    ['replay-seconds', 2, 'seconds'], ['stream-byte-seconds-low', 9096, 'byte-seconds'],
    ['stream-byte-seconds-high', 14192, 'byte-seconds'], ['stream-storage-seconds', 12, 'seconds']]) {
    assert.equal(inputs[id]?.value, value, id); assert.equal(inputs[id].unit, unit, id);
    assert.equal(inputs[id].status, 'measured', id); assert.equal(inputs[id].region, 'local', id);
    assert.equal(inputs[id].source, 'receipt:' + f.metadata.runId, id);
    assert.equal(inputs[id].observedAt, f.metadata.window.endedAt, id);
  }
  assert.deepEqual(receipt.cadence, { mode: 'accelerated', factor: 100, coveredSeconds: 2,
    configuredSchedule: null, observedSchedule: null });
  assert.deepEqual(receipt.checks.map(row => [row.code, row.passed, row.count]), [
    ['no-raw-data', true, 1], ['outbound-denied', true, 5], ['all-sales-replayed', true, 3],
    ['accounting-reconciled', true, 9], ['cleanup-complete', true, 0],
  ]);
  assert.deepEqual(receipt.cleanup, { ownedProcesses: 0, ownedContainers: 0, ownedNetworks: 0,
    ownedVolumes: 0, ownedObjects: 0, residualKinds: [] });
  assert.equal(receipt.kind, 'local-aggregate');
  assert.deepEqual(receipt.dataBoundary, { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 });
  f.result.admission.storage.copiedDatabaseBytes = 1;
  assert.equal(inputs['database-bytes'].value, 8192, 'detach the published receipt');
});

// A stream experiment does not measure daily traffic, archives, sessions, mail or the fiscal API.
test('localReceiptKeepsEveryUnavailableDriverUnknownInsteadOfZeroOrAProjection', () => {
  const receipt = build(fixture()), inputs = Object.fromEntries(receipt.inputs.map(row => [row.id, row]));
  for (const [id, unit] of [['stream-bytes', 'bytes'], ['stream-uploads', 'count'], ['archive-bytes', 'bytes'],
    ['snapshot-bytes', 'bytes'], ['idle-bytes', 'bytes'], ['startup-bytes', 'bytes'],
    ['remote-session-bytes-in', 'bytes'], ['remote-session-bytes-out', 'bytes'], ['remote-sessions-per-month', 'count'],
    ['public-bytes', 'bytes'], ['email-operations', 'count'], ['fiscal-operations', 'count'], ['restore-bytes', 'bytes'],
    ['verification-bytes', 'bytes'], ['retention-months', 'months'],
    ['stream-snapshot-seconds', 'seconds'], ['stream-retention-seconds', 'seconds']]) {
    assert.deepEqual(inputs[id], { id, unit, value: null, status: 'unknown', source: null, scope: 'venue',
      region: 'local', observedAt: null, effectiveAt: null, bounds: null, reason: 'not-measured' }, id);
  }
  assert.equal(receipt.inputs.length, 26);
});

// These mutations remove evidence or inject private values at the export boundary.
for (const [name, change] of [
  ['raw-result', f => { f.result.private = 'PRIVATE_CANARY'; }],
  ['raw-replay', f => { f.result.admission.replay.sales = ['PRIVATE_CANARY']; }],
  ['raw-stream-row', f => { f.result.admission.stream.requests.accounting.requests[0].key = 'PRIVATE_CANARY'; }],
  ['raw-summary', f => { f.result.streamAccounting.storage.key = 'PRIVATE_CANARY'; }],
  ['raw-isolation', f => { f.result.isolation.network = 'PRIVATE_CANARY'; }],
  ['raw-metadata', f => { f.metadata.source = '/private/PRIVATE_CANARY'; }],
  ['raw-window', f => { f.metadata.window.saleAt = 'PRIVATE_CANARY'; }],
  ['raw-options', f => { f.options.path = '/private/PRIVATE_CANARY'; }],
  ['raw-top-level', f => { f.source = 'PRIVATE_CANARY'; }],
  ['missing-driver-result', f => { delete f.result.admission.stream; }],
  ['partial-replay', f => { f.result.admission.replay.counts.successful--; }],
  ['unreconciled', f => { f.result.admission.stream.administration.observedRequests[0].bytesIn++; }],
  ['wrong-summary', f => { f.result.streamAccounting.producer.attempts++; }],
  ['unproved-isolation', f => { f.result.isolation.blockedConnections = 0; }],
  ['unproved-dns', f => { f.result.isolation.blockedDns = 0; }],
  ['broken-control', f => { f.result.isolation.localControl = false; }],
  ['unfinished-host-cleanup', f => { f.result.cleanup.networks = 1; }],
  ['unfinished-worker-cleanup', f => { f.result.admission.stream.cleanup.processes = 1; }],
  ['false-complete-cost', f => { f.result.costMeasured = true; }],
  ['wrong-runtime', f => { f.metadata.waitronRevision = 'b'.repeat(40); }],
  ['short-window', f => { f.metadata.window.endedAt = '2026-10-21T00:00:01.000Z'; f.metadata.window.elapsedSeconds = 1; }],
  ['invalid-window', f => { f.metadata.window.elapsedSeconds = 61; }],
  ['invalid-run', f => { f.metadata.runId = 'PRIVATE_CANARY'; }],
]) test('localReceiptRefuses_' + name, () => {
  const f = fixture(); change(f);
  assert.equal(typeof module.buildLocalReceipt, 'function', 'validate before publishing');
  assert.throws(() => module.buildLocalReceipt(f), bad);
});

// Malformed experiment settings cannot supply the expected values used to admit the worker.
for (const [name, change] of [
  ['extra-expected', f => { f.options.expected.raw = 'PRIVATE_CANARY'; }],
  ['extra-original', f => { f.options.originalInventory.raw = 'PRIVATE_CANARY'; }],
  ['extra-cadence', f => { f.options.cadence.raw = 'PRIVATE_CANARY'; }],
  ['extra-stream', f => { f.options.stream.raw = 'PRIVATE_CANARY'; }],
  ['zero-sales', f => { f.options.expected.sales = 0; }],
  ['unsafe-sales', f => { f.options.expected.sales = Number.MAX_SAFE_INTEGER + 1; }],
  ['oversized-sales', f => { f.options.expected.sales = 100001; }],
  ['more-paid-than-sales', f => { f.options.expected.paid = 5; }],
  ['more-busiest-than-paid', f => { f.options.expected.busiest = 5; }],
  ['zero-original-days', f => { f.options.originalInventory.days = 0; }],
  ['negative-replay-budget', f => { f.options.replayWindowSeconds = -1; }],
  ['unbounded-replay', f => { f.options.replayWindowSeconds = 3601; }],
  ['no-startup', f => { f.options.stream.startupSeconds = 0; }],
  ['oversized-startup', f => { f.options.stream.startupSeconds = 301; }],
  ['oversized-idle', f => { f.options.stream.idleSeconds = 3601; }],
  ['oversized-stream', f => { f.options.stream.windowSeconds = 7201; }],
  ['exhausted-stream-window', f => { f.options.replayWindowSeconds = 59; }],
]) test('localReceiptRefusesOptions_' + name, () => {
  const f = fixture(); change(f); assert.throws(() => build(f), bad);
});

for (const field of ['expected', 'originalInventory', 'cadence', 'stream'])
  test('localReceiptRefusesNumericExtraOption_' + field, () => {
    const f = fixture(); f.options[field].raw = 1;
    assert.throws(() => build(f), bad, 'valid numeric values do not permit unrecognised fields');
  });
