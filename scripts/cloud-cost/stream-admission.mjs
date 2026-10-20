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

// Validate before returning worker aggregates to the host; no private identifiers cross this boundary.
// This checks a partial stream experiment, not a complete venue cost receipt.
export function validateStreamAdmission(value, options) {
  try {
    exact(value, ['phases', 'requests', 'administration', 'storage', 'native', 'restored', 'cleanup']);
    const order = ['startup', 'workload', 'idle', 'verification', 'restore'];
    array(value.phases); need(value.phases.length === order.length);
    value.phases.forEach((p, i) => { exact(p, ['phase', 'elapsedSeconds']); need(p.phase === order[i] && finite(p.elapsedSeconds)); });
    need(value.phases[0].elapsedSeconds >= options.startupSeconds && value.phases[2].elapsedSeconds >= options.idleSeconds
      && value.phases.reduce((n, p) => n + p.elapsedSeconds, 0) < options.windowSeconds);
    counters(value.requests); counters(value.administration);
    const nativeRequests = value.requests.accounting.requests, adminRequests = value.administration.accounting.requests;
    const successful = (rows, phase, operation) => rows.filter(r => r.phase === phase && r.operation === operation).reduce((n, r) => n + r.successful, 0);
    need(successful(nativeRequests, 'startup', 'put') > 0 && successful(nativeRequests, 'restore', 'get') > 0
      && successful(adminRequests, 'setup', 'bucket-create') === 1 && successful(adminRequests, 'cleanup', 'bucket-delete') === 1
      && adminRequests.every(r => ['setup', 'cleanup'].includes(r.phase)));
    exact(value.native, ['version', 'writerStarts', 'phaseRestarts']);
    need(value.native.version === '0.5.17' && value.native.writerStarts === 1 && value.native.phaseRestarts === 0);
    exact(value.restored, ['sales', 'integrity']); need(value.restored.sales === options.expectedSales && value.restored.integrity === true);
    const s = value.storage; exact(s, ['status', 'scope', 'windowSeconds', 'objects', 'byteSeconds']);
    need(s.status === 'measured' && s.scope === 'unversioned-object-history' && finite(s.windowSeconds)
      && s.windowSeconds > 0 && s.windowSeconds < options.windowSeconds);
    const keys = ['class', 'bytes', 'currentVersions', 'noncurrentVersions', 'deleteMarkers', 'unfinishedMultipart'];
    exact(s.objects, keys); need(s.objects.class === 'stream' && keys.slice(1).every(k => count(s.objects[k]))
      && s.objects.bytes > 0 && s.objects.currentVersions > 0 && s.objects.noncurrentVersions === 0
      && s.objects.deleteMarkers === 0 && s.objects.unfinishedMultipart === 0);
    exact(s.byteSeconds, ['low', 'high']); need(finite(s.byteSeconds.low) && finite(s.byteSeconds.high) && s.byteSeconds.high >= s.byteSeconds.low);
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
