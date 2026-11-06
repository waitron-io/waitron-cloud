import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeter } from './meter.mjs';
import { validateStreamAdmission, summarizeStreamAccounting } from './stream-admission.mjs';
const worker = await import('./replay-worker.mjs');
const controller = await import('./isolated-replay.mjs');

const options = { expectedSales: 2, startupSeconds: 2, idleSeconds: 2, windowSeconds: 60 };
const bad = { message: 'Invalid cloud cost stream admission' };
function meter(kind, mode = 'clean') {
  const value = createMeter({ phase: 'setup', clock: () => 0 });
  const events = kind === 'native' ? [['startup', 'put', 0, 4096], ['restore', 'get', 4096, 0]]
    : [['setup', 'bucket-create', 0, 0], ['cleanup', 'bucket-delete', 0, 0], ['cleanup', 'bucket-inspect', 0, 0]];
  for (const [i, [phase, operation, bytesIn, bytesOut]] of events.entries()) {
    for (const channel of mode === 'missing-observer' ? ['producer'] : ['producer', 'observer']) {
      value.observeAttempt({ token: 'synthetic:' + i, phase, operation, channel,
        retryOrdinal: 0, outcome: mode === 'cutoff' ? 'transport-error' : 'success',
        statusCode: mode === 'cutoff' ? null : 200, errorCode: null, sameAccount: null,
        bytesIn, bytesOut, attemptedBytesIn: bytesIn, attemptedBytesOut: bytesOut });
    }
  }
  return value.snapshot();
}
function evidence(mode = 'clean') {
  return { phases: ['startup', 'workload', 'idle', 'verification', 'restore'].map(phase => ({ phase, elapsedSeconds: 2 })),
    requests: meter('native', mode), administration: meter('admin'),
    functional: { startupUpload: true, restore: true, bucketCreated: true, bucketRemoved: true },
    storage: { status: 'measured', scope: 'unversioned-object-history', windowSeconds: 10,
      objects: { class: 'stream', bytes: 4096, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
      byteSeconds: { low: 5000, high: 6000 } },
    retainedStorage: { status: 'measured', scope: 'unversioned-cleanup-tail', windowSeconds: 2,
      initialBytes: 4096, deletedObjects: 1, remainingBytes: 0, remainingObjects: 0, byteSeconds: { low: 4096, high: 8192 } },
    native: { version: '0.5.17', writerStarts: 1, phaseRestarts: 0 }, restored: { sales: 2, integrity: true },
    cleanup: { processes: 0, privateRoots: 0, listeners: 0, clients: 0, buckets: 0, objects: 0, multipartUploads: 0 } };
}

const hostOptions = { expected: { sales: 4, paid: 4, tradingDays: 2, busiest: 2 },
  originalInventory: { days: 2, busiest: 2 }, cadence: { mode: 'accelerated', factor: 100 },
  replayWindowSeconds: 10, stream: options };
function hostEvidence(mode = 'clean') {
  return { admission: { complete: true,
    source: { counts: { sales: 4, paid: 4, tradingDays: 2, busiest: 2 }, originalInventory: { days: 2, busiest: 2 } },
    replay: { complete: true, cadence: { mode: 'accelerated', factor: 100, coveredSeconds: 0.1 },
      counts: { expected: 2, attempted: 2, successful: 2, failed: 0 }, timing: { elapsedSeconds: 0.2, maxLagSeconds: 0.1 } },
    integrity: { ok: true, issues: 0 },
    storage: { copiedDatabaseBytes: 8192, freshBeforeBytes: 4096, freshAfterBytes: 8192, freshGrowthBytes: 4096 },
    cleanup: { ownedReplayRoots: 0 }, stream: evidence(mode) },
  isolation: { blockedConnections: 3, blockedDns: 2, localControl: true },
  cleanup: { workerContainers: 0, networks: 0, privateCopies: 0 } };
}

for (const mode of ['clean', 'missing-observer', 'cutoff']) test(`hostReturnsClosedFunctionalResultWithOriginalUnknownAccounting_${mode}`, () => {
  assert.equal(typeof controller.completeReplayResult, 'function', 'normalise the result only after functional admission and collection');
  const input = hostEvidence(mode), result = controller.completeReplayResult(input, hostOptions);
  assert.deepEqual(Object.keys(result).sort(), ['accounting', 'costMeasured', 'evidence', 'functional', 'receipt']);
  assert.equal(result.functional, 'passed'); assert.equal(result.costMeasured, false); assert.equal(result.receipt, null);
  assert.equal(result.accounting.publicationEligible, false);
  assert.ok(result.accounting.gaps.includes('request-billing:unknown'));
  assert.deepEqual(result.evidence, input);
  input.admission.stream.administration.billing[0].quantity = 99;
  assert.equal(result.evidence.admission.stream.administration.billing[0].quantity, null);
});

test('legacyCleanHostResultKeepsItsOriginalNumericShape', () => {
  assert.equal(typeof controller.completeReplayResult, 'function');
  const input = hostEvidence(), stream = input.admission.stream;
  delete stream.functional;
  for (const key of ['requests', 'administration']) {
    const { reconciled, accounting, observedRequests } = stream[key]; stream[key] = { reconciled, accounting, observedRequests };
  }
  const result = controller.completeReplayResult(input, hostOptions);
  assert.deepEqual(Object.keys(result).sort(), ['admission', 'cleanup', 'costMeasured', 'isolation', 'streamAccounting']);
  assert.deepEqual(result.streamAccounting.producer, { attempts: 5, bytesIn: 4096, bytesOut: 4096 });
  assert.deepEqual(result.streamAccounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  assert.deepEqual(result.streamAccounting.storage.byteSeconds, { low: 9096, high: 14192 });
  assert.deepEqual(result.admission, input.admission);
});

for (const [name, change] of [
  ['fiscal-failure', r => { r.admission.integrity.ok = false; }],
  ['fiscal-issues', r => { r.admission.integrity.issues = 1; }],
  ['lost-replayed-sale', r => { r.admission.replay.counts.successful = 1; }],
  ['failed-replay', r => { r.admission.replay.complete = false; }],
  ['uncollected-worker', r => { r.cleanup.workerContainers = 1; }],
  ['uncollected-network', r => { r.cleanup.networks = 1; }],
  ['uncollected-copy', r => { r.cleanup.privateCopies = 1; }],
  ['unisolated-worker', r => { r.isolation.blockedConnections = 2; }],
  ['unisolated-dns', r => { r.isolation.blockedDns = 1; }],
  ['missing-local-control', r => { r.isolation.localControl = false; }],
  ['private-output', r => { r.key = 'PRIVATE_CANARY'; }],
  ['private-cleanup', r => { r.cleanup.path = 'PRIVATE_CANARY'; }],
]) test(`accountingGapsDoNotMaskHostFunctionalRefusal_${name}`, () => {
  assert.equal(typeof controller.completeReplayResult, 'function');
  const input = hostEvidence('cutoff'); change(input);
  assert.throws(() => controller.completeReplayResult(input, hostOptions), { message: 'Invalid isolated cloud cost replay' });
});

test('hostResultAdmissionDoesNotExecutePrivateNestedGettersOrProxyTraps', () => {
  let accessed = 0;
  for (const kind of ['accessor', 'proxy']) {
    const input = hostEvidence();
    if (kind === 'accessor') Object.defineProperty(input.admission, 'stream', { get() { accessed++; return evidence(); } });
    else input.admission.integrity = new Proxy(input.admission.integrity, { getPrototypeOf() { accessed++; return Object.prototype; } });
    assert.throws(() => controller.completeReplayResult(input, hostOptions), { message: 'Invalid isolated cloud cost replay' });
    assert.equal(accessed, 0);
  }
});

for (const mode of ['clean', 'missing-observer', 'cutoff']) test(`workerSerializationRetainsOriginalSourcesAndFunctionalWitnesses_${mode}`, () => {
  const input = evidence(mode);
  assert.equal(typeof worker.workerStreamEvidence, 'function', 'collect original evidence before any lossy counter projection');
  const { functional, administration, retainedStorage, requests, phases, storage, native, restored, cleanup } = input;
  const result = worker.workerStreamEvidence({ stream: { phases, requests, storage }, native, restored,
    functional: { startupUpload: functional.startupUpload, restore: functional.restore },
    cleanup: { processes: cleanup.processes, privateRoots: cleanup.privateRoots } },
  { ...administration, retainedStorage, functional: { bucketCreated: functional.bucketCreated, bucketRemoved: functional.bucketRemoved } });
  let admitted;
  assert.doesNotThrow(() => { admitted = validateStreamAdmission(result, options); }, 'both original meters must remain admissible after worker serialization');
  assert.deepEqual(admitted, input);
  assert.equal(summarizeStreamAccounting(result, options).accounting.publicationEligible, false);
  assert.equal(Object.hasOwn(result.administration, 'functional'), false, 'functional witnesses stay separate from original accounting records');
  requests.accounting.requests[0].bytesOut = 99;
  assert.equal(result.requests.accounting.requests[0].bytesOut, 4096, 'detach worker evidence from producer-owned records');
});

// Requiring paired rows here would fail a completed rehearsal after an observer loses a reply.
for (const mode of ['clean', 'missing-observer', 'cutoff']) test(`gappedWorkerResultSurvivesClosedAdmission_${mode}`, () => {
  const input = evidence(mode);
  let admitted;
  assert.doesNotThrow(() => { admitted = validateStreamAdmission(input, options); });
  assert.deepEqual(admitted, input, 'preserve complete original status, gaps, billing and both actual hops');
  const result = summarizeStreamAccounting(input, options);
  assert.equal(result.functional, 'passed');
  assert.equal(result.costMeasured, false);
  assert.equal(result.receipt, null);
  assert.equal(result.accounting.status, 'unknown');
  assert.equal(result.accounting.publicationEligible, false, 'unknown bucket-inspection billing cannot be exported');
  assert.ok(result.accounting.gaps.includes('request-billing:unknown'));
  assert.deepEqual(result.evidence, input);
  input.requests.accounting.requests[0].bytesOut = 99;
  assert.equal(admitted.requests.accounting.requests[0].bytesOut, 4096);
  assert.equal(result.evidence.requests.accounting.requests[0].bytesOut, 4096);
});

test('equalWorkerGrandTotalsCannotEraseOriginalRowDisagreement', () => {
  const input = evidence(); input.requests.observedRequests[0].phase = 'idle'; input.requests.reconciled = false;
  assert.deepEqual(input.requests.accounting.producer, input.requests.accounting.observer);
  let result;
  assert.doesNotThrow(() => { result = summarizeStreamAccounting(input, options); });
  assert.ok(result.accounting.gaps.includes('accounting:meter-disagreement'));
  assert.equal(result.evidence.requests.accounting.requests[0].phase, 'startup');
  assert.equal(result.evidence.requests.observedRequests[0].phase, 'idle');
  assert.equal(result.accounting.publicationEligible, false);
});

for (const field of ['storage', 'retainedStorage']) test(`unknownWorkerStorageBoundsRemainNull_${field}`, () => {
  const input = evidence(); input[field].status = 'unknown';
  input[field].gaps = ['accounting:incomplete-history']; input[field].byteSeconds = { low: null, high: null };
  let result;
  assert.doesNotThrow(() => { result = summarizeStreamAccounting(input, options); });
  assert.equal(result.functional, 'passed');
  assert.ok(result.accounting.gaps.includes('accounting:incomplete-history'));
  assert.deepEqual(result.evidence[field].byteSeconds, { low: null, high: null });
});

test('an overflowed live-byte total remains unknown after verified cleanup', () => {
  const input = evidence();
  for (const field of ['storage', 'retainedStorage']) {
    input[field].status = 'unknown'; input[field].gaps = ['accounting:overflow'];
    input[field].byteSeconds = { low: null, high: null };
  }
  input.storage.objects.bytes = null; input.retainedStorage.initialBytes = null;
  const result = summarizeStreamAccounting(input, options);
  assert.equal(result.functional, 'passed'); assert.equal(result.receipt, null);
  assert.equal(result.accounting.publicationEligible, false);
  assert.ok(result.accounting.gaps.includes('accounting:overflow'));
  assert.equal(result.evidence.storage.objects.bytes, null);
  assert.equal(result.evidence.retainedStorage.initialBytes, null);
  assert.equal(result.evidence.cleanup.objects, 0);
});

for (const [name, change] of [
  ...['startupUpload', 'restore', 'bucketCreated', 'bucketRemoved'].map(key => [key, r => { r.functional[key] = false; }]),
  ['missing-witnesses', r => { delete r.functional; }],
  ['private-witness', r => { r.functional.key = 'PRIVATE_CANARY'; }],
  ['administration-in-workload', r => {
    for (const rows of [r.administration.accounting.requests, r.administration.observedRequests]) rows[0].phase = 'workload';
    r.administration.billing.find(row => row.phase === 'setup').phase = 'workload';
  }],
  ['missing-sale', r => { r.restored.sales = 1; }],
  ['invalid-sqlite', r => { r.restored.integrity = false; }],
  ['unsafe-inventory', r => { r.storage.objects.noncurrentVersions = 1; }],
  ['missing-stored-data', r => { r.storage.objects.bytes = 0; }],
  ['wrong-retained-inventory', r => { r.retainedStorage.initialBytes++; }],
  ['cleanup-residue', r => { r.cleanup.clients = 1; }],
  ['deadline', r => { r.phases[0].elapsedSeconds = 60; }],
  ['private-meter', r => { r.requests.endpoint = 'PRIVATE_CANARY'; }],
  ['private-billing', r => { r.administration.billing[0].key = 'PRIVATE_CANARY'; }],
  ['private-gap', r => { r.requests.gaps.push('PRIVATE_CANARY'); }],
  ['unsafe-number', r => { r.requests.accounting.producer.attempts = Number.MAX_SAFE_INTEGER + 1; }],
  ['bad-self-total', r => { r.requests.accounting.producer.attempts++; }],
  ['bad-row-arithmetic', r => { r.requests.accounting.requests[0].successful = 0; }],
  ['duplicate-row', r => { r.requests.accounting.requests.push(structuredClone(r.requests.accounting.requests[0])); }],
  ['accessor', r => { Object.defineProperty(r.functional, 'startupUpload', { get() { throw Error('PRIVATE_CANARY'); } }); }],
  ['proxy', r => { r.requests = new Proxy(r.requests, { ownKeys() { throw Error('PRIVATE_CANARY'); } }); }],
]) test(`unknownAccountingCannotMaskFunctionalOrMalformedWorkerEvidence_${name}`, () => {
  const input = evidence('missing-observer'); change(input);
  assert.throws(() => validateStreamAdmission(input, options), bad);
  assert.throws(() => summarizeStreamAccounting(input, options), bad);
});

test('workerAdmissionDoesNotExecuteNestedAccessorsOrProxyTraps', () => {
  let accessed = 0;
  for (const kind of ['accessor', 'proxy']) {
    const input = evidence();
    if (kind === 'accessor') Object.defineProperty(input.storage.objects, 'bytes', { get() { accessed++; return 4096; } });
    else input.functional = new Proxy(input.functional, { getPrototypeOf() { accessed++; return Object.prototype; } });
    assert.throws(() => validateStreamAdmission(input, options), bad);
    assert.equal(accessed, 0, 'inspect descriptors and reject proxies before reading values');
  }
});
