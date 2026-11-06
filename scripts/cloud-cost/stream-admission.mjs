import { types } from 'node:util';
import { assessAccounting, isAccountingGap } from './accounting-policy.mjs';

const fail = () => { throw Error('Invalid cloud cost stream admission'); };
const need = value => { if (!value) fail(); };
const exact = (value, keys) => need(value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === keys.length && Reflect.ownKeys(value).every(k => keys.includes(k)
    && Object.getOwnPropertyDescriptor(value, k).get === undefined));
const count = n => Number.isSafeInteger(n) && n >= 0;
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const array = value => need(Array.isArray(value) && value.length <= 10000
  && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean));
const phases = ['setup', 'startup', 'workload', 'idle', 'verification', 'restore', 'observer', 'cleanup'];
const classes = { put: 's3-write', get: 's3-read', head: 's3-read', list: 's3-list', delete: 's3-delete', 'delete-many': 's3-delete',
  'bucket-create': 's3-control', 'bucket-delete': 's3-control', 'bucket-inspect': 's3-control', 'bucket-configure': 's3-control',
  'multipart-create': 's3-multipart', 'multipart-upload': 's3-multipart', 'multipart-complete': 's3-multipart', 'multipart-abort': 's3-delete' };
const totals = ['attempts', 'bytesIn', 'bytesOut'];
const numbers = ['retryOrdinal', 'attempts', 'successful', 'failed', 'retried', 'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'];
const rowKeys = ['phase', 'operation', 'requestClass', 'outcome', ...numbers];
const identity = r => JSON.stringify([r.phase, r.operation, r.outcome, r.retryOrdinal]);
function rows(value) {
  array(value); const seen = new Set();
  for (const row of value) {
    exact(row, rowKeys); need(phases.includes(row.phase) && Object.hasOwn(classes, row.operation)
      && row.requestClass === classes[row.operation] && ['success', 'client-error', 'server-error', 'transport-error'].includes(row.outcome));
    need(numbers.every(k => count(row[k])) && row.attempts > 0 && row.successful + row.failed === row.attempts
      && row.retried === (row.retryOrdinal > 0 ? row.attempts : 0)
      && row.successful === (row.outcome === 'success' ? row.attempts : 0)
      && row.bytesIn <= row.attemptedBytesIn && row.bytesOut <= row.attemptedBytesOut);
    const key = identity(row); need(!seen.has(key)); seen.add(key);
  }
}
function counters(value) {
  exact(value, ['reconciled', 'accounting', 'observedRequests']); need(value.reconciled === true);
  const a = value.accounting; exact(a, ['requests', 'objects', 'producer', 'observer', 'discrepancy']);
  array(a.objects); need(a.objects.length === 0); rows(a.requests); rows(value.observedRequests);
  for (const name of ['producer', 'observer', 'discrepancy']) exact(a[name], totals);
  for (const k of totals) {
    need(count(a.producer[k]) && count(a.observer[k]) && a.discrepancy[k] === 0
      && a.producer[k] === a.observer[k] && a.producer[k] === a.requests.reduce((n, r) => n + r[k], 0));
  }
  need(value.observedRequests.length === a.requests.length);
  const observed = new Map(value.observedRequests.map(r => [identity(r), r]));
  for (const row of a.requests) need(rowKeys.every(k => observed.get(identity(row))?.[k] === row[k]));
}

function data(value, ancestors = new Set(), budget = { remaining: 250000 }) {
  need(--budget.remaining >= 0);
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  need(value && typeof value === 'object' && !types.isProxy(value) && !ancestors.has(value) && ancestors.size < 12);
  need(Object.getPrototypeOf(value) === (Array.isArray(value) ? Array.prototype : Object.prototype));
  if (Array.isArray(value)) array(value);
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    need(typeof key === 'string');
    const descriptor = Object.getOwnPropertyDescriptor(value, key); need(Object.hasOwn(descriptor, 'value'));
    data(descriptor.value, ancestors, budget);
  }
  ancestors.delete(value);
}

function originalAccounting(value) {
  const assessment = assessAccounting({ producer: 'local-stream', sources: [
    { scope: 'requests', record: value.requests }, { scope: 'restore', record: value.requests },
    { scope: 'administration', record: value.administration }, { scope: 'storage', record: value.storage },
  ] });
  const gaps = new Set(assessment.gaps);
  for (const code of value.retainedStorage.gaps ?? []) { need(isAccountingGap(code)); gaps.add(code); }
  if (value.retainedStorage.status === 'unknown') gaps.add('accounting:incomplete-history');
  return { status: gaps.size ? 'unknown' : 'measured', gaps: [...gaps].sort(), publicationEligible: gaps.size === 0 };
}

// Validate before returning worker aggregates to the host; no private identifiers cross this boundary.
// This checks a partial stream experiment, not a complete venue cost receipt.
export function validateStreamAdmission(value, options) {
  try {
    data(value);
    const original = Object.hasOwn(value, 'functional');
    exact(value, ['phases', 'requests', 'administration', 'storage', 'retainedStorage', 'native', 'restored', 'cleanup',
      ...(original ? ['functional'] : [])]);
    const order = ['startup', 'workload', 'idle', 'verification', 'restore'];
    array(value.phases); need(value.phases.length === order.length);
    value.phases.forEach((p, i) => { exact(p, ['phase', 'elapsedSeconds']); need(p.phase === order[i] && finite(p.elapsedSeconds)); });
    need(value.phases[0].elapsedSeconds >= options.startupSeconds && value.phases[2].elapsedSeconds >= options.idleSeconds
      && value.phases.reduce((n, p) => n + p.elapsedSeconds, 0) < options.windowSeconds);
    if (original) {
      exact(value.functional, ['startupUpload', 'restore', 'bucketCreated', 'bucketRemoved']);
      need(Object.values(value.functional).every(value => value === true));
      originalAccounting(value);
      need(value.requests.accounting.objects.length === 0 && value.administration.accounting.objects.length === 0);
    } else { counters(value.requests); counters(value.administration); }
    const nativeRequests = value.requests.accounting.requests, adminRequests = value.administration.accounting.requests;
    const successful = (rows, phase, operation) => rows.filter(r => r.phase === phase && r.operation === operation).reduce((n, r) => n + r.successful, 0);
    if (!original) need(successful(nativeRequests, 'startup', 'put') > 0 && successful(nativeRequests, 'restore', 'get') > 0
      && successful(adminRequests, 'setup', 'bucket-create') === 1 && successful(adminRequests, 'cleanup', 'bucket-delete') === 1
      && adminRequests.every(r => ['setup', 'cleanup'].includes(r.phase)));
    need([...adminRequests, ...value.administration.observedRequests].every(r => ['setup', 'cleanup'].includes(r.phase)));
    exact(value.native, ['version', 'writerStarts', 'phaseRestarts']);
    need(value.native.version === '0.5.17' && value.native.writerStarts === 1 && value.native.phaseRestarts === 0);
    exact(value.restored, ['sales', 'integrity']); need(value.restored.sales === options.expectedSales && value.restored.integrity === true);
    const s = value.storage; exact(s, ['status', 'scope', 'windowSeconds', 'objects', 'byteSeconds',
      ...(original && Object.hasOwn(s, 'gaps') ? ['gaps'] : [])]);
    need((s.status === 'measured' || original && s.status === 'unknown') && s.scope === 'unversioned-object-history' && finite(s.windowSeconds)
      && s.windowSeconds > 0 && s.windowSeconds < options.windowSeconds);
    const keys = ['class', 'bytes', 'currentVersions', 'noncurrentVersions', 'deleteMarkers', 'unfinishedMultipart'];
    exact(s.objects, keys); need(s.objects.class === 'stream' && keys.slice(1).every(k => count(s.objects[k]))
      && s.objects.bytes > 0 && s.objects.currentVersions > 0 && s.objects.noncurrentVersions === 0
      && s.objects.deleteMarkers === 0 && s.objects.unfinishedMultipart === 0);
    const bounds = record => {
      exact(record.byteSeconds, ['low', 'high']);
      const { low, high } = record.byteSeconds;
      need((finite(low) && low <= Number.MAX_SAFE_INTEGER || original && record.status === 'unknown' && low === null)
        && (finite(high) && high <= Number.MAX_SAFE_INTEGER || original && record.status === 'unknown' && high === null)
        && (low === null || high === null || high >= low));
    };
    bounds(s);
    const tail = value.retainedStorage;
    exact(tail, ['status', 'scope', 'windowSeconds', 'initialBytes', 'deletedObjects', 'remainingBytes', 'remainingObjects', 'byteSeconds',
      ...(original && Object.hasOwn(tail, 'gaps') ? ['gaps'] : [])]);
    if (original && Object.hasOwn(tail, 'gaps')) { array(tail.gaps); need(tail.gaps.every(isAccountingGap)); }
    need((tail.status === 'measured' || original && tail.status === 'unknown') && tail.scope === 'unversioned-cleanup-tail'
      && finite(tail.windowSeconds) && tail.windowSeconds > 0
      && value.phases.reduce((n, p) => n + p.elapsedSeconds, 0) + tail.windowSeconds < options.windowSeconds
      && tail.initialBytes === s.objects.bytes && tail.deletedObjects === s.objects.currentVersions
      && tail.remainingBytes === 0 && tail.remainingObjects === 0);
    bounds(tail);
    need(tail.byteSeconds.high === null || tail.byteSeconds.high <= tail.initialBytes * tail.windowSeconds);
    const cleanup = ['processes', 'privateRoots', 'listeners', 'clients', 'buckets', 'objects', 'multipartUploads'];
    exact(value.cleanup, cleanup); need(cleanup.every(k => value.cleanup[k] === 0));
    return structuredClone(value);
  } catch { fail(); }
}

export function validateStreamSettings(value, budget) {
  try {
    exact(value, ['binarySha256', 'copyImage', 'startupSeconds', 'idleSeconds', 'windowSeconds']);
    need(typeof value.binarySha256 === 'string' && /^[a-f0-9]{64}$/.test(value.binarySha256)
      && typeof value.copyImage === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.copyImage));
    need(['startupSeconds', 'idleSeconds', 'windowSeconds'].every(k => finite(value[k]) && value[k] > 0)
      && value.startupSeconds <= 300 && value.idleSeconds <= 3600 && value.windowSeconds <= 7200
      && value.windowSeconds < budget.windowSeconds
      && value.startupSeconds + value.idleSeconds + budget.replayWindowSeconds < value.windowSeconds);
    return structuredClone(value);
  } catch { fail(); }
}

// Setup, cleanup and verification requests must survive consolidation with the native traffic.
// Keep uncertain storage lifetimes as bounds rather than inventing an exact byte-second value.
export function summarizeStreamAccounting(value, options) {
  const admitted = validateStreamAdmission(value, options);
  const original = Object.hasOwn(admitted, 'functional');
  if (original) {
    const accounting = originalAccounting(admitted);
    if (!accounting.publicationEligible) return { functional: 'passed', costMeasured: false, accounting, receipt: null, evidence: admitted };
  }
  let overflow = false;
  const combinedCount = (left, right) => {
    const total = left + right;
    if (original && !count(total)) { overflow = true; return null; }
    need(count(total)); return total;
  };
  const meters = [admitted.requests.accounting, admitted.administration.accounting];
  const requests = new Map();
  for (const meter of meters) for (const row of meter.requests) {
    const key = identity(row), existing = requests.get(key);
    if (!existing) requests.set(key, { ...row });
    else for (const k of numbers.slice(1)) {
      existing[k] = combinedCount(existing[k], row[k]);
    }
  }
  const total = channel => Object.fromEntries(totals.map(k => {
    return [k, combinedCount(meters[0][channel][k], meters[1][channel][k])];
  }));
  const producer = total('producer'), observer = total('observer');
  const { storage, retainedStorage: tail } = admitted;
  const byteSeconds = { low: storage.byteSeconds.low + tail.byteSeconds.low, high: storage.byteSeconds.high + tail.byteSeconds.high };
  // Valid independent meters can still exceed the safe range when combined.
  if (original && (overflow || Object.values(byteSeconds).some(value => !finite(value) || value > Number.MAX_SAFE_INTEGER))) {
    return { functional: 'passed', costMeasured: false,
      accounting: { status: 'unknown', gaps: ['accounting:overflow'], publicationEligible: false }, receipt: null, evidence: admitted };
  }
  return { requests: [...requests.values()], producer, observer,
    discrepancy: Object.fromEntries(totals.map(k => [k, observer[k] - producer[k]])),
    storage: { status: 'measured', scope: 'unversioned-stream-and-cleanup',
      windowSeconds: storage.windowSeconds + tail.windowSeconds,
      remainingBytes: tail.remainingBytes, remainingObjects: tail.remainingObjects,
      byteSeconds } };
}
