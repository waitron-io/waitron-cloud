import { isDeepStrictEqual } from 'node:util';

const fail = () => { throw Error('Invalid cloud cost service receipt'); };
const need = value => { if (!value) fail(); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) => need(value && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
const sum = (rows, key) => rows.reduce((total, row) => { const next = total + row[key]; need(count(next)); return next; }, 0);
const counters = (value, keys) => { exact(value, keys); need(keys.every(key => count(value[key]))); };
const unknownBilling = value => { exact(value, ['quantity', 'status']); need(value.quantity === null && value.status === 'unknown'); };

// Inspect descriptors before reading values. Private producers cannot run getters
// or hide unrecognised fields in arrays at the publication boundary.
function plain(value, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { need(Number.isFinite(value)); return; }
  if (typeof value === 'string') { need(value.length <= 128); return; }
  need(value && typeof value === 'object' && ancestors.size < 12 && !ancestors.has(value));
  const array = Array.isArray(value), keys = Reflect.ownKeys(value);
  need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype));
  if (array) need(value.length <= 10000 && keys.length === value.length + 1
    && keys.every(key => key === 'length' || typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length));
  ancestors.add(value);
  for (const key of keys) {
    need(typeof key === 'string'); const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(Object.hasOwn(descriptor, 'value')); plain(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}
function metadata(value) {
  exact(value, ['runId', 'cloudRevision', 'window']);
  need(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.runId)
    && /^[0-9a-f]{40}$/.test(value.cloudRevision));
  exact(value.window, ['startedAt', 'endedAt', 'elapsedSeconds']);
  for (const key of ['startedAt', 'endedAt']) {
    const at = value.window[key];
    need(typeof at === 'string' && Number.isFinite(Date.parse(at)) && new Date(at).toISOString() === at);
  }
  const seconds = (Date.parse(value.window.endedAt) - Date.parse(value.window.startedAt)) / 1000;
  need(seconds > 0 && seconds <= 7200 && value.window.elapsedSeconds === seconds);
}
function mailSummary(mail) {
  exact(mail, ['scope', 'status', 'reconciled', 'producer', 'observer', 'discrepancy', 'operations', 'billing']);
  need(mail.scope === 'captured-mail-operations' && mail.status === 'measured' && mail.reconciled === true);
  counters(mail.producer, ['attempts', 'accepted', 'refused', 'retried']);
  for (const key of ['observer', 'discrepancy']) counters(mail[key], ['attempts', 'accepted', 'refused']);
  need(mail.producer.attempts > 0 && mail.producer.attempts <= 10000);
  need(Array.isArray(mail.operations) && mail.operations.length > 0);
  const groups = new Set(); let attempts = 0, accepted = 0, refused = 0, retried = 0;
  for (const row of mail.operations) {
    exact(row, ['action', 'outcome', 'retryOrdinal', 'attempts']);
    need(['verification', 'password_reset', 'password_changed', 'service_alert'].includes(row.action)
      && ['accepted', 'refused'].includes(row.outcome) && count(row.retryOrdinal) && row.retryOrdinal < 10000
      && count(row.attempts) && row.attempts > 0);
    const key = [row.action, row.outcome, row.retryOrdinal].join(':'); need(!groups.has(key)); groups.add(key);
    attempts += row.attempts;
    if (row.outcome === 'accepted') accepted += row.attempts; else refused += row.attempts;
    if (row.retryOrdinal > 0) retried += row.attempts;
  }
  const result = { attempts, accepted, refused, retried };
  need(Object.values(result).every(count) && isDeepStrictEqual(result, mail.producer));
  for (const key of ['attempts', 'accepted', 'refused']) need(mail.observer[key] === result[key] && mail.discrepancy[key] === 0);
  unknownBilling(mail.billing);
  return { ...result, bytes: null };
}
function fiscalSummary(fiscal) {
  exact(fiscal, ['status', 'reconciled', 'gaps', 'billing', 'observedRequests', 'accounting']);
  need(fiscal.status === 'measured' && fiscal.reconciled === true
    && isDeepStrictEqual(fiscal.gaps, ['request-billing:unknown']));
  need(Array.isArray(fiscal.billing) && fiscal.billing.length === 1);
  const billing = fiscal.billing[0]; exact(billing, ['phase', 'requestClass', 'quantity', 'status']);
  need(billing.phase === 'workload' && billing.requestClass === 'fiscal');
  unknownBilling({ quantity: billing.quantity, status: billing.status });
  const a = fiscal.accounting; exact(a, ['requests', 'objects', 'producer', 'observer', 'discrepancy']);
  need(isDeepStrictEqual(a.objects, []));
  for (const key of ['producer', 'observer', 'discrepancy']) counters(a[key], ['attempts', 'bytesIn', 'bytesOut']);
  const numeric = ['retryOrdinal', 'attempts', 'successful', 'failed', 'retried', 'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'];
  const checked = rows => {
    need(Array.isArray(rows) && rows.length > 0); const groups = new Map();
    for (const row of rows) {
      exact(row, ['phase', 'operation', 'requestClass', 'outcome', ...numeric]);
      need(row.phase === 'workload' && row.operation === 'fiscal' && row.requestClass === 'fiscal'
        && ['success', 'client-error', 'server-error'].includes(row.outcome) && numeric.every(key => count(row[key]))
        && row.attempts > 0 && row.retryOrdinal <= 2
        && row.successful === (row.outcome === 'success' ? row.attempts : 0)
        && row.failed === (row.outcome === 'success' ? 0 : row.attempts)
        && row.retried === (row.retryOrdinal > 0 ? row.attempts : 0)
        && row.bytesIn <= row.attemptedBytesIn && row.bytesOut <= row.attemptedBytesOut);
      const key = row.outcome + ':' + row.retryOrdinal; need(!groups.has(key)); groups.set(key, row);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  };
  need(isDeepStrictEqual(checked(a.requests), checked(fiscal.observedRequests)));
  for (const key of ['attempts', 'bytesIn', 'bytesOut']) {
    need(sum(a.requests, key) === a.producer[key] && a.observer[key] === a.producer[key] && a.discrepancy[key] === 0);
  }
  return { attempts: a.producer.attempts, successful: sum(a.requests, 'successful'), failed: sum(a.requests, 'failed'),
    retried: sum(a.requests, 'retried'), bodyBytesIn: a.producer.bytesIn, bodyBytesOut: a.producer.bytesOut };
}

// These operations belong to one local scenario. Neither a monthly frequency nor
// an email byte count follows from observed SMTP acceptance and HTTP body counts.
export function buildServiceReceipt(input) {
  try {
    plain(input); exact(input, ['metadata', 'mail', 'fiscal', 'cleanup']); metadata(input.metadata);
    exact(input.cleanup, ['listeners', 'clients', 'schemas']); need(Object.values(input.cleanup).every(value => value === 0));
    const summary = { mail: mailSummary(input.mail), fiscal: fiscalSummary(input.fiscal) };
    return structuredClone({ schemaVersion: 1, kind: 'local-service-aggregate',
      dataBoundary: { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 },
      scope: 'local-scenario', costMeasured: false, metadata: input.metadata, mail: input.mail, fiscal: input.fiscal,
      summary, frequency: { mailScenariosPerMonth: null, fiscalScenariosPerMonth: null }, cleanup: input.cleanup });
  } catch { fail(); }
}

export function validateServiceReceipt(receipt) {
  try {
    plain(receipt);
    exact(receipt, ['schemaVersion', 'kind', 'dataBoundary', 'scope', 'costMeasured', 'metadata', 'mail', 'fiscal', 'summary', 'frequency', 'cleanup']);
    exact(receipt.dataBoundary, ['classification', 'rawIncluded', 'exportSchema']);
    exact(receipt.summary, ['mail', 'fiscal']);
    exact(receipt.summary.mail, ['attempts', 'accepted', 'refused', 'retried', 'bytes']);
    exact(receipt.summary.fiscal, ['attempts', 'successful', 'failed', 'retried', 'bodyBytesIn', 'bodyBytesOut']);
    exact(receipt.frequency, ['mailScenariosPerMonth', 'fiscalScenariosPerMonth']);
    const rebuilt = buildServiceReceipt({ metadata: receipt.metadata, mail: receipt.mail, fiscal: receipt.fiscal, cleanup: receipt.cleanup });
    need(isDeepStrictEqual(receipt, rebuilt)); return rebuilt;
  } catch { fail(); }
}
