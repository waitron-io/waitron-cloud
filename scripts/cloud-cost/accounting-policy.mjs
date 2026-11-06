import { isDeepStrictEqual, types } from 'node:util';

// Only fixed accounting labels may cross the anonymous result boundary.
const gapCodes = new Set([
  'litestream:requests-unreconciled', 'litestream:body-bytes-unpaired', 'litestream:object-lifetimes-unpaired',
  'after-stop:list-response-interrupted', 'after-stop:put-response-interrupted', 'after-stop:body-bytes-unpaired',
  'accounting:unreconciled', 'request-billing:unknown', 'accounting:request-cutoff',
  'accounting:meter-disagreement', 'accounting:incomplete-total', 'accounting:incomplete-history', 'accounting:overflow',
]);

export const isAccountingGap = code => typeof code === 'string' && gapCodes.has(code);

const fail = () => { throw Error('Invalid cloud cost accounting evidence'); };
const need = value => { if (!value) fail(); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const scopes = {
  'local-stream': ['requests', 'restore', 'administration', 'storage'],
  archive: ['requests', 'restore', 'administration', 'storage'],
  service: ['requests', 'restore', 'administration', 'storage', 'mail', 'fiscal'],
  remote: ['remote'],
};
const phases = ['setup', 'startup', 'workload', 'idle', 'verification', 'restore', 'observer', 'cleanup'];
const classes = { put: 's3-write', get: 's3-read', head: 's3-read', list: 's3-list', delete: 's3-delete', 'delete-many': 's3-delete',
  'bucket-create': 's3-control', 'bucket-delete': 's3-control', 'bucket-inspect': 's3-control', 'bucket-configure': 's3-control',
  'multipart-create': 's3-multipart', 'multipart-upload': 's3-multipart', 'multipart-complete': 's3-multipart',
  'multipart-abort': 's3-delete', remote: 'network', email: 'smtp', fiscal: 'fiscal', kms: 'kms-symmetric' };
const totalKeys = ['attempts', 'bytesIn', 'bytesOut'];
const rowNumbers = ['retryOrdinal', 'attempts', 'successful', 'failed', 'retried'];
const byteKeys = ['bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'];
const rowKeys = ['phase', 'operation', 'requestClass', 'outcome', ...rowNumbers, ...byteKeys];
const objectClasses = ['stream', 'snapshot', 'daily-archive', 'monthly-archive', 'protected', 'scratch'];
const objectCounts = ['currentVersions', 'noncurrentVersions', 'deleteMarkers', 'unfinishedMultipart'];
const identity = row => [row.phase, row.operation, row.outcome, row.retryOrdinal].join(':');
const billingIdentity = row => row.phase + ':' + row.requestClass;

// Inspect data descriptors before values; even reflective operations on a proxy can run private code.
function plain(value, ancestors = new Set(), budget = { remaining: 250000 }) {
  need(--budget.remaining >= 0);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { need(Number.isFinite(value)); return; }
  if (typeof value === 'string') { need(value.length <= 128); return; }
  need(value && typeof value === 'object' && !types.isProxy(value) && !ancestors.has(value) && ancestors.size < 12);
  const array = Array.isArray(value);
  need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype) || (!array && Object.getPrototypeOf(value) === null));
  const keys = Reflect.ownKeys(value);
  if (array) need(value.length <= 10000 && keys.length === value.length + 1
    && keys.every(key => key === 'length' || typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length));
  ancestors.add(value);
  for (const key of keys) {
    need(typeof key === 'string');
    const descriptor = Object.getOwnPropertyDescriptor(value, key); need(Object.hasOwn(descriptor, 'value'));
    plain(descriptor.value, ancestors, budget);
  }
  ancestors.delete(value);
}
const exact = (value, keys) => need(value && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
const array = value => need(Array.isArray(value));
const state = value => need(['measured', 'unknown'].includes(value));
function quantity(value, gaps) {
  if (value === null) { gaps.add('accounting:incomplete-total'); return; }
  need(count(value));
}
function sum(rows, key) {
  let total = 0;
  for (const row of rows) {
    if (row[key] === null) return null;
    total += row[key]; if (!count(total)) return null;
  }
  return total;
}
function requestRows(rows, gaps) {
  array(rows); const groups = new Map();
  for (const row of rows) {
    exact(row, rowKeys);
    need(phases.includes(row.phase) && Object.hasOwn(classes, row.operation) && row.requestClass === classes[row.operation]
      && ['success', 'client-error', 'server-error', 'transport-error'].includes(row.outcome));
    need(rowNumbers.every(key => count(row[key])) && row.attempts > 0
      && row.successful === (row.outcome === 'success' ? row.attempts : 0)
      && row.failed === (row.outcome === 'success' ? 0 : row.attempts)
      && row.retried === (row.retryOrdinal > 0 ? row.attempts : 0));
    for (const key of byteKeys) quantity(row[key], gaps);
    need((row.bytesIn === null || row.attemptedBytesIn === null || row.bytesIn <= row.attemptedBytesIn)
      && (row.bytesOut === null || row.attemptedBytesOut === null || row.bytesOut <= row.attemptedBytesOut));
    const key = identity(row); need(!groups.has(key)); groups.set(key, row);
    // Reconstruct uncertainty from the original outcome, even if summary labels were removed.
    if (row.outcome === 'transport-error') {
      gaps.add('accounting:request-cutoff'); gaps.add('request-billing:unknown');
    }
  }
  return groups;
}
function originalGaps(record, gaps) {
  array(record.gaps);
  for (const code of record.gaps) { need(isAccountingGap(code)); gaps.add(code); }
}
function meter(record, gaps, scope) {
  exact(record, ['status', 'reconciled', 'gaps', 'billing', 'observedRequests', 'accounting']);
  state(record.status); need(typeof record.reconciled === 'boolean'); originalGaps(record, gaps);
  const a = record.accounting; exact(a, ['requests', 'objects', 'producer', 'observer', 'discrepancy']);
  const produced = requestRows(a.requests, gaps), observed = requestRows(record.observedRequests, gaps);
  need([...a.requests, ...record.observedRequests].every(row => scope === 'fiscal'
    ? row.operation === 'fiscal' : row.requestClass.startsWith('s3-')));
  for (const name of ['producer', 'observer', 'discrepancy']) exact(a[name], totalKeys);
  for (const key of totalKeys) {
    for (const [name, rows] of [['producer', a.requests], ['observer', record.observedRequests]]) {
      quantity(a[name][key], gaps);
      const expected = sum(rows, key);
      if (a[name][key] !== null) need(a[name][key] === expected);
    }
    const expected = a.producer[key] === null || a.observer[key] === null ? null : a.observer[key] - a.producer[key];
    need(a.discrepancy[key] === expected);
  }
  const matching = produced.size === observed.size && [...produced].every(([key, row]) => isDeepStrictEqual(row, observed.get(key)));
  if (!record.reconciled || !matching) gaps.add('accounting:meter-disagreement');
  array(a.objects); const objectGroups = new Set();
  for (const row of a.objects) {
    exact(row, ['class', 'bytes', 'byteSeconds', ...objectCounts]);
    need(objectClasses.includes(row.class) && !objectGroups.has(row.class)); objectGroups.add(row.class);
    quantity(row.bytes, gaps);
    if (row.byteSeconds === null) gaps.add('accounting:incomplete-history');
    else need(typeof row.byteSeconds === 'number' && row.byteSeconds >= 0 && row.byteSeconds <= Number.MAX_SAFE_INTEGER);
    need(objectCounts.every(key => count(row[key])));
  }
  array(record.billing); const billed = new Set(), required = new Set([...a.requests, ...record.observedRequests].map(billingIdentity));
  for (const row of record.billing) {
    exact(row, ['phase', 'requestClass', 'quantity', 'status']); state(row.status);
    const key = billingIdentity(row);
    need(phases.includes(row.phase) && Object.values(classes).includes(row.requestClass) && !billed.has(key) && required.has(key));
    billed.add(key);
    need(row.status === 'unknown' ? row.quantity === null : count(row.quantity));
    const rows = a.requests.filter(r => billingIdentity(r) === key);
    if (row.quantity !== null) need(row.quantity <= sum(rows, 'attempts') && (row.requestClass !== 's3-delete' || row.quantity === 0));
    if (row.status === 'unknown' || rows.some(r => !isDeepStrictEqual(r, observed.get(identity(r))))
      || record.observedRequests.some(r => billingIdentity(r) === key && !produced.has(identity(r)))) gaps.add('request-billing:unknown');
  }
  if ([...required].some(key => !billed.has(key))) gaps.add('request-billing:unknown');
  if (record.status === 'unknown' && gaps.size === 0) gaps.add('accounting:incomplete-total');
}

function domainState(record, keys, gaps) {
  exact(record, [...keys, ...(Object.hasOwn(record, 'gaps') ? ['gaps'] : [])]);
  state(record.status);
  if (Object.hasOwn(record, 'gaps')) originalGaps(record, gaps);
  if (record.status === 'unknown' && !record.gaps?.length) gaps.add('accounting:incomplete-total');
}
function history(record, gaps) {
  domainState(record, ['status', 'scope', 'windowSeconds', 'objects', 'byteSeconds'], gaps);
  need(['unversioned-put-only', 'unversioned-object-history', 'versioned-object-history'].includes(record.scope)
    && typeof record.windowSeconds === 'number' && record.windowSeconds >= 0 && record.windowSeconds <= Number.MAX_SAFE_INTEGER);
  const o = record.objects; exact(o, ['class', 'bytes', ...objectCounts]);
  need(o.class === 'stream' && objectCounts.every(key => count(o[key]))); quantity(o.bytes, gaps);
  exact(record.byteSeconds, ['low', 'high']);
  for (const value of Object.values(record.byteSeconds)) {
    if (value === null) gaps.add('accounting:incomplete-history');
    else need(typeof value === 'number' && value >= 0 && value <= Number.MAX_SAFE_INTEGER);
  }
  const { low, high } = record.byteSeconds; need(low === null || high === null || low <= high);
}
function pairedTotals(record, keys, gaps) {
  need(typeof record.reconciled === 'boolean');
  for (const name of ['producer', 'observer', 'discrepancy']) exact(record[name], keys);
  let matching = true;
  for (const key of keys) {
    quantity(record.producer[key], gaps); quantity(record.observer[key], gaps);
    const p = record.producer[key], o = record.observer[key];
    need(record.discrepancy[key] === (p === null || o === null ? null : o - p));
    if (p === null || o === null || p !== o) matching = false;
  }
  if (!matching || !record.reconciled) gaps.add('accounting:meter-disagreement');
}
function mail(record, gaps) {
  domainState(record, ['scope', 'status', 'reconciled', 'producer', 'observer', 'discrepancy', 'operations', 'billing'], gaps);
  need(record.scope === 'captured-mail-operations' && typeof record.reconciled === 'boolean');
  exact(record.producer, ['attempts', 'accepted', 'refused', 'retried']);
  array(record.operations); const groups = new Set();
  const totals = { attempts: 0, accepted: 0, refused: 0, retried: 0 };
  for (const row of record.operations) {
    exact(row, ['action', 'outcome', 'retryOrdinal', 'attempts']);
    need(['verification', 'password_reset', 'password_changed', 'service_alert'].includes(row.action)
      && ['accepted', 'refused'].includes(row.outcome) && count(row.retryOrdinal) && count(row.attempts) && row.attempts > 0);
    const key = [row.action, row.outcome, row.retryOrdinal].join(':'); need(!groups.has(key)); groups.add(key);
    totals.attempts += row.attempts; totals[row.outcome] += row.attempts;
    if (row.retryOrdinal > 0) totals.retried += row.attempts;
  }
  for (const key of Object.keys(totals)) {
    quantity(record.producer[key], gaps);
    const expected = count(totals[key]) ? totals[key] : null;
    if (record.producer[key] !== null) need(record.producer[key] === expected);
  }
  pairedTotals({ ...record, producer: { attempts: record.producer.attempts, accepted: record.producer.accepted,
    refused: record.producer.refused } }, ['attempts', 'accepted', 'refused'], gaps);
  if (record.observer.accepted !== null && record.observer.refused !== null && record.observer.attempts !== null)
    need(record.observer.accepted + record.observer.refused === record.observer.attempts);
  exact(record.billing, ['quantity', 'status']); state(record.billing.status);
  if (record.billing.status === 'unknown') { need(record.billing.quantity === null); gaps.add('request-billing:unknown'); }
  else need(count(record.billing.quantity) && record.producer.attempts !== null && record.billing.quantity <= record.producer.attempts);
}
function remote(record, gaps) {
  domainState(record, ['scope', 'audience', 'status', 'reconciled', 'producer', 'observer', 'discrepancy', 'excludedOverhead'], gaps);
  need(record.scope === 'gateway-tcp-stream' && ['staff', 'public'].includes(record.audience)
    && isDeepStrictEqual(record.excludedOverhead, ['ip', 'tcp', 'wireguard']));
  pairedTotals(record, ['connections', 'bytesToGateway', 'bytesFromGateway'], gaps);
}

export function assessAccounting(input) {
  try {
    plain(input); exact(input, ['producer', 'sources']);
    need(Object.hasOwn(scopes, input.producer)); array(input.sources); need(input.sources.length <= 6);
    const required = scopes[input.producer], seen = new Set(), gaps = new Set();
    for (const source of input.sources) {
      exact(source, ['scope', 'record']); need(required.includes(source.scope) && !seen.has(source.scope)); seen.add(source.scope);
      if (source.scope === 'mail') mail(source.record, gaps);
      else if (source.scope === 'remote') remote(source.record, gaps);
      else if (source.scope === 'storage' && !Object.hasOwn(source.record, 'accounting')) history(source.record, gaps);
      else meter(source.record, gaps, source.scope);
    }
    if (required.some(scope => !seen.has(scope))) gaps.add('accounting:incomplete-total');
    const publicationEligible = gaps.size === 0;
    return { status: publicationEligible ? 'measured' : 'unknown', gaps: [...gaps].sort(), publicationEligible };
  } catch { fail(); }
}
