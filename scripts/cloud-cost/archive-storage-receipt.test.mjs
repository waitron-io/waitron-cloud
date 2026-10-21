import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReceipt } from './schema.mjs';
const module = await import('./archive-storage-receipt.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./archive-storage-receipt.mjs', import.meta.url).href) return {};
  throw error;
});
function fixture() {
  const requests = [
    ['setup', 'bucket-create', 's3-control', 1, 0, 192],
    ['workload', 'put', 's3-write', 1, 0, 4500],
    ['workload', 'head', 's3-read', 1, 0, 0],
    ['workload', 'get', 's3-read', 2, 4511, 0],
    ['workload', 'multipart-create', 's3-multipart', 1, 100, 0],
    ['workload', 'multipart-upload', 's3-multipart', 1, 0, 4],
    ['workload', 'list', 's3-list', 1, 200, 0],
    ['cleanup', 'multipart-abort', 's3-delete', 1, 0, 0],
    ['cleanup', 'delete', 's3-delete', 1, 0, 0],
    ['cleanup', 'bucket-delete', 's3-control', 1, 0, 0],
  ].map(([phase, operation, requestClass, attempts, bytesIn, bytesOut]) => ({ phase, operation, requestClass,
    outcome: 'success', retryOrdinal: 0, attempts, successful: attempts, failed: 0, retried: 0,
    bytesIn, bytesOut, attemptedBytesIn: bytesIn, attemptedBytesOut: bytesOut }));
  const accounting = { requests, objects: [], producer: { attempts: 11, bytesIn: 4811, bytesOut: 4696 },
    observer: { attempts: 11, bytesIn: 4811, bytesOut: 4696 }, discrepancy: { attempts: 0, bytesIn: 0, bytesOut: 0 } };
  return {
    metadata: { runId: '12345678-1234-4234-8234-123456789012', cloudRevision: 'a'.repeat(40),
      waitronRevision: 'fbadd15785464e59747e697c11048bfbc6e4938f',
      window: { startedAt: '2026-10-21T00:00:00.000Z', endedAt: '2026-10-21T00:00:02.000Z', elapsedSeconds: 2 } },
    result: { capturedBytes: 4500, headBytes: 4500, downloadedBytes: 4500, rangeBytes: 11, parts: 1,
      restored: { ok: true, issues: 0, sales: 1 }, integrity: { ok: true, issues: 0 },
      sales: { attempted: 1, successful: 1, failed: 0 }, leaked: false,
      accounting: { status: 'measured', reconciled: true, gaps: ['request-billing:unknown'], accounting,
        observedRequests: structuredClone(requests), billing: [
          { phase: 'setup', requestClass: 's3-control', quantity: null, status: 'unknown' },
          { phase: 'workload', requestClass: 's3-write', quantity: 1, status: 'measured' },
          { phase: 'workload', requestClass: 's3-read', quantity: 3, status: 'measured' },
          { phase: 'workload', requestClass: 's3-multipart', quantity: 2, status: 'measured' },
          { phase: 'workload', requestClass: 's3-list', quantity: 1, status: 'measured' },
          { phase: 'cleanup', requestClass: 's3-delete', quantity: 0, status: 'measured' },
          { phase: 'cleanup', requestClass: 's3-control', quantity: null, status: 'unknown' },
        ] },
    },
    cleanup: { ownedProcesses: 0, ownedContainers: 0, ownedNetworks: 0, ownedVolumes: 0, ownedObjects: 0, residualKinds: [] },
  };
}
const build = input => {
  assert.equal(typeof module.buildArchiveStorageReceipt, 'function', 'export generated archive storage traffic after reconciliation');
  return module.buildArchiveStorageReceipt(input);
};
const bad = { message: 'Invalid cloud cost archive storage evidence' };
function changeWireBytes(input, operation, field, delta) {
  const m = input.result.accounting, a = m.accounting;
  for (const rows of [a.requests, m.observedRequests]) {
    const row = rows.find(row => row.operation === operation);
    row[field] += delta; row[field === 'bytesIn' ? 'attemptedBytesIn' : 'attemptedBytesOut'] += delta;
  }
  a.producer[field] += delta; a.observer[field] += delta;
}

// Dropping SDK/proxy traffic or relabelling this synthetic archive would understate usage.
test('archiveStorageReceiptRetainsEveryAttemptAndOnlyTheSyntheticMeasuredShape', () => {
  const input = fixture(), output = build(input);
  assert.doesNotThrow(() => validateReceipt(output));
  assert.equal(output.cloudRevision, 'a'.repeat(40));
  assert.deepEqual(output.accounting.producer, { attempts: 11, bytesIn: 4811, bytesOut: 4696 });
  assert.deepEqual(output.accounting.observer, output.accounting.producer);
  assert.deepEqual(output.inputs.map(row => [row.id, row.value, row.status, row.unit]), [
    ['archive-bytes', 4500, 'measured', 'bytes'], ['restore-bytes', 4500, 'measured', 'bytes'],
    ['successful-sales', 1, 'measured', 'count'],
  ]);
  assert.deepEqual(output.checks, [{ code: 'synthetic-only', passed: true, count: 1 },
    { code: 'all-sales-replayed', passed: true, count: 1 }, { code: 'accounting-reconciled', passed: true, count: 11 },
    { code: 'cleanup-complete', passed: true, count: 0 }]);
  assert.deepEqual(output.accounting.objects, [], 'object lifetimes are not measured by this scenario');
  input.result.accounting.accounting.requests[1].bytesOut = 1;
  assert.equal(output.accounting.requests[1].bytesOut, 4500);
});

const changes = [
  ['raw-top', f => { f.path = 'PRIVATE_CANARY'; }],
  ['raw-metadata', f => { f.metadata.path = 'PRIVATE_CANARY'; }],
  ['raw-result', f => { f.result.key = 'PRIVATE_CANARY'; }],
  ['raw-meter', f => { f.result.accounting.path = 'PRIVATE_CANARY'; }],
  ['raw-request', f => { f.result.accounting.accounting.requests[1].key = 'PRIVATE_CANARY'; }],
  ['raw-observer', f => { f.result.accounting.observedRequests[1].key = 'PRIVATE_CANARY'; }],
  ['raw-billing', f => { f.result.accounting.billing[0].path = 'PRIVATE_CANARY'; }],
  ['raw-cleanup', f => { f.cleanup.bucket = 'PRIVATE_CANARY'; }],
  ['wrong-pin', f => { f.metadata.waitronRevision = 'b'.repeat(40); }],
  ['leak', f => { f.result.leaked = true; }],
  ['unreconciled', f => { f.result.accounting.reconciled = false; }],
  ['false-status', f => { f.result.accounting.status = 'unknown'; }],
  ['missing-billing-gap', f => { f.result.accounting.gaps = []; }],
  ['false-control-cost', f => { f.result.accounting.billing[0].quantity = 0; }],
  ['missing-cleanup-billing', f => { f.result.accounting.billing.pop(); }],
  ['observer-discrepancy', f => { f.result.accounting.accounting.observer.bytesOut++; f.result.accounting.accounting.discrepancy.bytesOut++; }],
  ['observer-row-discrepancy', f => { f.result.accounting.observedRequests[1].bytesOut++; }],
  ['missing-attempt', f => { f.result.accounting.accounting.requests.pop(); }],
  ['wrong-phase', f => { f.result.accounting.accounting.requests[9].phase = 'workload'; }],
  ['head-size', f => { f.result.headBytes--; }],
  ['download-size', f => { f.result.downloadedBytes--; }],
  ['range-size', f => { f.result.rangeBytes--; }],
  ['missing-part', f => { f.result.parts = 0; }],
  ['empty-archive', f => { f.result.capturedBytes = 0; }],
  ['unmatched-upload-body', f => { changeWireBytes(f, 'put', 'bytesOut', 1); }],
  ['unmatched-download-body', f => { changeWireBytes(f, 'get', 'bytesIn', 1); }],
  ['invented-head-body', f => { changeWireBytes(f, 'head', 'bytesIn', 1); }],
  ['unmatched-part-body', f => { changeWireBytes(f, 'multipart-upload', 'bytesOut', -1); }],
  ['unexpected-cleanup-body', f => { changeWireBytes(f, 'delete', 'bytesOut', 1); }],
  ['matched-wrong-phase', f => { f.result.accounting.accounting.requests[9].phase = 'workload'; f.result.accounting.observedRequests[9].phase = 'workload'; }],
  ['matched-failed-request', f => {
    for (const rows of [f.result.accounting.accounting.requests, f.result.accounting.observedRequests]) {
      rows[1].outcome = 'client-error'; rows[1].successful = 0; rows[1].failed = 1;
    }
  }],
  ['unmeasured-object-lifetime', f => { f.result.accounting.accounting.objects = [
    { class: 'scratch', bytes: 1, byteSeconds: 1, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
  ]; }],
  ['failed-restore', f => { f.result.restored.ok = false; }],
  ['missing-sale', f => { f.result.restored.sales = 0; }],
  ['failed-integrity', f => { f.result.integrity.issues = 1; }],
  ['failed-sale', f => { f.result.sales.failed = 1; }],
  ['unclean-container', f => { f.cleanup.ownedContainers = 1; }],
  ['unclean-object', f => { f.cleanup.ownedObjects = 1; }],
  ['cleanup-residue', f => { f.cleanup.residualKinds.push('object'); }],
];
for (const [name, change] of changes) test('archiveStorageRefuses_' + name, () => {
  const input = fixture(); change(input); assert.throws(() => build(input), bad);
});
test('archiveStorageDoesNotInvokeRawProducerGetters', () => {
  const input = fixture(); let invoked = false;
  Object.defineProperty(input.result, 'accounting', { get() { invoked = true; throw Error('PRIVATE_CANARY'); } });
  try { assert.throws(() => build(input), bad); } finally { assert.equal(invoked, false); }
});
