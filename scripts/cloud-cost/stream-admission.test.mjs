import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeter } from './meter.mjs';
const module = await import('./stream-admission.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./stream-admission.mjs', import.meta.url).href) return {};
  throw error;
});
const options = { expectedSales: 3, startupSeconds: 2, idleSeconds: 2, windowSeconds: 60 };
const counters = (kind = 'administration') => {
  const meter = createMeter({ phase: 'setup', clock: () => 0 });
  const events = kind === 'requests' ? [['startup', 'put', 0, 4096], ['restore', 'get', 4096, 0]]
    : [['setup', 'bucket-create', 0, 0], ['cleanup', 'bucket-delete', 0, 0], ['cleanup', 'list', 10, 0]];
  for (const [i, [phase, operation, bytesIn, bytesOut]] of events.entries()) for (const channel of ['producer', 'observer']) meter.observeAttempt({ token: 'synthetic:' + i, channel,
    phase, operation, retryOrdinal: 0, outcome: 'success', statusCode: 200,
    errorCode: null, sameAccount: null, bytesIn, bytesOut, attemptedBytesIn: bytesIn, attemptedBytesOut: bytesOut });
  const { reconciled, accounting, observedRequests } = meter.snapshot();
  return { reconciled, accounting, observedRequests };
};
const evidence = () => ({ phases: ['startup', 'workload', 'idle', 'verification', 'restore'].map(phase => ({ phase, elapsedSeconds: 2 })),
  requests: counters('requests'), administration: counters(),
  storage: { status: 'measured', scope: 'unversioned-object-history', windowSeconds: 10,
    objects: { class: 'stream', bytes: 4096, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
    byteSeconds: { low: 5000, high: 6000 } },
  native: { version: '0.5.17', writerStarts: 1, phaseRestarts: 0 }, restored: { sales: 3, integrity: true },
  cleanup: { processes: 0, privateRoots: 0, listeners: 0, clients: 0, buckets: 0, objects: 0, multipartUploads: 0 } });

test('streamAdmissionAcceptsClosedReconciledEvidenceAndReturnsAnIndependentCopy', () => {
  assert.equal(typeof module.validateStreamAdmission, 'function', 'validate the stream worker boundary');
  const input = evidence(), result = module.validateStreamAdmission(input, options);
  assert.deepEqual(result, input); input.storage.objects.bytes = 99; assert.equal(result.storage.objects.bytes, 4096);
});
for (const [name, change] of [
  ['root-private-data', r => { r.raw = 'PRIVATE_CANARY'; }],
  ['phase-private-data', r => { r.phases[0].name = 'PRIVATE_CANARY'; }],
  ['reordered-phases', r => { r.phases.reverse(); }],
  ['missing-idle', r => { r.phases.splice(2, 1); }],
  ['short-startup', r => { r.phases[0].elapsedSeconds = 1; }],
  ['short-idle', r => { r.phases[2].elapsedSeconds = 1; }],
  ['nonfinite-time', r => { r.phases[1].elapsedSeconds = Infinity; }],
  ['over-budget', r => { r.phases[1].elapsedSeconds = 60; }],
  ['unverified-restore', r => { r.restored.integrity = false; }],
  ['lost-restored-sale', r => { r.restored.sales = 2; }],
  ['restore-private-data', r => { r.restored.path = '/PRIVATE_CANARY'; }],
  ['wrong-native-version', r => { r.native.version = '0.5.16'; }],
  ['writer-restarted', r => { r.native.writerStarts = 2; r.native.phaseRestarts = 1; }],
  ['native-private-data', r => { r.native.binary = '/PRIVATE_CANARY'; }],
  ['unverified-storage', r => { r.storage.status = 'unknown'; }],
  ['wrong-storage-mode', r => { r.storage.scope = 'versioned-object-history'; }],
  ['storage-private-data', r => { r.storage.keys = ['PRIVATE_CANARY']; }],
  ['storage-object-private-data', r => { r.storage.objects.key = 'PRIVATE_CANARY'; }],
  ['fractional-bytes', r => { r.storage.objects.bytes = 1.5; }],
  ['missing-stored-data', r => { r.storage.objects.bytes = 0; }],
  ['noncurrent-objects', r => { r.storage.objects.noncurrentVersions = 1; }],
  ['delete-markers', r => { r.storage.objects.deleteMarkers = 1; }],
  ['unfinished-parts', r => { r.storage.objects.unfinishedMultipart = 1; }],
  ['negative-byte-seconds', r => { r.storage.byteSeconds.low = -1; }],
  ['reversed-bounds', r => { r.storage.byteSeconds.low = 7000; }],
  ['unbounded-storage-window', r => { r.storage.windowSeconds = 61; }],
  ['stored-private-bounds', r => { r.storage.byteSeconds.key = 'PRIVATE_CANARY'; }],
  ...['processes', 'privateRoots', 'listeners', 'clients', 'buckets', 'objects', 'multipartUploads'].map(k => ['residual-' + k, r => { r.cleanup[k] = 1; }]),
  ['cleanup-private-data', r => { r.cleanup.path = '/PRIVATE_CANARY'; }],
  ...['requests', 'administration'].flatMap(field => [
    [field + '-unreconciled', r => { r[field].reconciled = false; }],
    [field + '-private-data', r => { r[field].key = 'PRIVATE_CANARY'; }],
    [field + '-extra-accounting', r => { r[field].accounting.raw = 'PRIVATE_CANARY'; }],
    [field + '-extra-request', r => { r[field].accounting.requests[0].key = 'PRIVATE_CANARY'; }],
    [field + '-private-operation', r => { r[field].accounting.requests[0].operation = 'PRIVATE_CANARY'; }],
    [field + '-private-phase', r => { r[field].accounting.requests[0].phase = 'PRIVATE_CANARY'; }],
    [field + '-private-class', r => { r[field].accounting.requests[0].requestClass = 'PRIVATE_CANARY'; }],
    [field + '-wrong-attempts', r => { r[field].accounting.requests[0].attempts = 2; }],
    [field + '-wrong-success', r => { r[field].accounting.requests[0].successful = 0; }],
    [field + '-wrong-bytes', r => { r[field].accounting.producer.bytesIn = 1; }],
    [field + '-wrong-observer', r => { r[field].accounting.observer.attempts++; }],
    [field + '-wrong-discrepancy', r => { r[field].accounting.discrepancy.attempts = 1; }],
    [field + '-missing-observed', r => { r[field].observedRequests.length = 0; }],
    [field + '-mismatched-observed', r => { r[field].observedRequests[0].bytesIn = 1; }],
    [field + '-mismatched-observed-phase', r => { r[field].observedRequests[0].phase = 'idle'; }],
    [field + '-duplicate-row', r => { r[field].accounting.requests.push(structuredClone(r[field].accounting.requests[0])); }],
    [field + '-unexpected-objects', r => { r[field].accounting.objects.push({ key: 'PRIVATE_CANARY' }); }],
  ]),
]) test('streamAdmissionRefuses_' + name, () => {
  assert.equal(typeof module.validateStreamAdmission, 'function', 'refuse unsafe stream evidence');
  const input = evidence(); change(input);
  assert.throws(() => module.validateStreamAdmission(input, options), { message: 'Invalid cloud cost stream admission' });
});

const settings = () => ({ binarySha256: 'a'.repeat(64), copyImage: 'sha256:' + 'b'.repeat(64), startupSeconds: 2, idleSeconds: 2, windowSeconds: 60 });
test('streamSettingsAdmitOnlyPinnedArtifactsAndBoundedSeparateWindows', () => {
  assert.equal(typeof module.validateStreamSettings, 'function', 'admit stream settings before resources or source access');
  assert.deepEqual(module.validateStreamSettings(settings(), { windowSeconds: 120, replayWindowSeconds: 10 }), settings());
});
for (const [name, change] of [
  ['private-field', r => { r.target = 'https://PRIVATE_CANARY'; }],
  ['missing-field', r => { delete r.binarySha256; }],
  ['unpinned-binary', r => { r.binarySha256 = 'bad'; }],
  ['unpinned-copy-image', r => { r.copyImage = 'node:26'; }],
  ['zero-startup', r => { r.startupSeconds = 0; }],
  ['long-startup', r => { r.startupSeconds = 301; }],
  ['zero-idle', r => { r.idleSeconds = 0; }],
  ['long-idle', r => { r.idleSeconds = 3601; }],
  ['nonfinite-window', r => { r.windowSeconds = Infinity; }],
  ['over-host-budget', r => { r.windowSeconds = 121; }],
  ['no-workload-budget', r => { r.windowSeconds = 14; }],
]) test('streamSettingsRefuse_' + name, () => {
  assert.equal(typeof module.validateStreamSettings, 'function'); const input = settings(); change(input);
  assert.throws(() => module.validateStreamSettings(input, { windowSeconds: 120, replayWindowSeconds: 10 }), { message: 'Invalid cloud cost stream admission' });
});

for (const [name, change] of [
  ['no-native-work', r => { r.requests.accounting.requests = []; r.requests.observedRequests = []; for (const k of ['producer', 'observer', 'discrepancy']) r.requests.accounting[k] = { attempts: 0, bytesIn: 0, bytesOut: 0 }; }],
  ['no-bucket-creation', r => { for(const row of [r.administration.accounting.requests[0],r.administration.observedRequests[0]]) {row.operation='bucket-inspect';} }],
  ['no-bucket-deletion', r => { for(const row of [r.administration.accounting.requests[1],r.administration.observedRequests[1]]) {row.operation='bucket-inspect';} }],
  ['no-native-write', r => { for(const row of [r.requests.accounting.requests[0],r.requests.observedRequests[0]]) {row.operation='get';row.requestClass='s3-read';} }],
  ['no-restore-read', r => { for(const row of [r.requests.accounting.requests[1],r.requests.observedRequests[1]]) {row.phase='idle';} }],
  ['wrong-administration-phase', r => { for(const row of [r.administration.accounting.requests[0],r.administration.observedRequests[0]]) row.phase='workload'; }],
]) test('streamAdmissionRequiresCompletedWork_' + name, () => {
  const input=evidence();change(input);
  assert.throws(()=>module.validateStreamAdmission(input,options), {message:'Invalid cloud cost stream admission'});
});
