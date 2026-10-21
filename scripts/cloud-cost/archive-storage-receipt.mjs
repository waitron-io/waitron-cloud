import { isDeepStrictEqual } from 'node:util';
import { validateReceipt } from './schema.mjs';

const fail = () => { throw Error('Invalid cloud cost archive storage evidence'); };
const need = value => { if (!value) fail(); };
const equal = (value, expected) => need(isDeepStrictEqual(value, expected));
const exact = (value, keys) => need(value && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
const boundary = { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 };
const cleanup = { ownedProcesses: 0, ownedContainers: 0, ownedNetworks: 0, ownedVolumes: 0, ownedObjects: 0, residualKinds: [] };
const operations = [['setup', 'bucket-create', 's3-control', 1], ['workload', 'put', 's3-write', 1],
  ['workload', 'head', 's3-read', 1], ['workload', 'get', 's3-read', 2], ['workload', 'multipart-create', 's3-multipart', 1],
  ['workload', 'multipart-upload', 's3-multipart', 1], ['workload', 'list', 's3-list', 1],
  ['cleanup', 'multipart-abort', 's3-delete', 1], ['cleanup', 'delete', 's3-delete', 1], ['cleanup', 'bucket-delete', 's3-control', 1]];
const billing = [
  { phase: 'setup', requestClass: 's3-control', quantity: null, status: 'unknown' },
  { phase: 'workload', requestClass: 's3-write', quantity: 1, status: 'measured' },
  { phase: 'workload', requestClass: 's3-read', quantity: 3, status: 'measured' },
  { phase: 'workload', requestClass: 's3-multipart', quantity: 2, status: 'measured' },
  { phase: 'workload', requestClass: 's3-list', quantity: 1, status: 'measured' },
  { phase: 'cleanup', requestClass: 's3-delete', quantity: 0, status: 'measured' },
  { phase: 'cleanup', requestClass: 's3-control', quantity: null, status: 'unknown' },
];
function plain(value, seen = new Set(), budget = { remaining: 10000 }) {
  need(--budget.remaining >= 0);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { need(Number.isFinite(value)); return; }
  if (typeof value === 'string') { need(value.length <= 512); return; }
  need(value && typeof value === 'object' && seen.size < 16 && !seen.has(value));
  const array = Array.isArray(value), fields = Reflect.ownKeys(value);
  need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype));
  if (array) need(value.length <= 100 && fields.length === value.length + 1
    && fields.every(key => key === 'length' || typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length));
  seen.add(value);
  for (const key of fields) {
    need(typeof key === 'string'); const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(Object.hasOwn(descriptor, 'value')); plain(descriptor.value, seen, budget);
  }
  seen.delete(value);
}

// This contract admits the generated one-sale archive journey only. Its body-byte
// counts and request vector cannot establish production size, storage time or cost.
export function buildArchiveStorageReceipt(input) {
  try {
    plain(input); exact(input, ['metadata', 'result', 'cleanup']);
    exact(input.metadata, ['runId', 'cloudRevision', 'waitronRevision', 'window']);
    need(input.metadata.waitronRevision === 'fbadd15785464e59747e697c11048bfbc6e4938f');
    const r = input.result;
    exact(r, ['accounting', 'capturedBytes', 'headBytes', 'downloadedBytes', 'rangeBytes', 'parts', 'restored', 'integrity', 'sales', 'leaked']);
    need(Number.isSafeInteger(r.capturedBytes) && r.capturedBytes > 0 && r.headBytes === r.capturedBytes
      && r.downloadedBytes === r.capturedBytes && r.rangeBytes === 11 && r.parts === 1 && r.leaked === false);
    equal(r.restored, { ok: true, issues: 0, sales: 1 }); equal(r.integrity, { ok: true, issues: 0 });
    equal(r.sales, { attempted: 1, successful: 1, failed: 0 }); equal(input.cleanup, cleanup);
    const m = r.accounting;
    exact(m, ['status', 'reconciled', 'gaps', 'billing', 'observedRequests', 'accounting']);
    need(m.status === 'measured' && m.reconciled === true); equal(m.gaps, ['request-billing:unknown']); equal(m.billing, billing);
    equal(m.accounting.producer, m.accounting.observer); equal(m.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
    equal(m.observedRequests, m.accounting.requests); equal(m.accounting.objects, []);
    equal(m.accounting.requests.map(row => [row.phase, row.operation, row.requestClass, row.attempts]), operations);
    need(m.accounting.requests.every(row => row.outcome === 'success' && row.retryOrdinal === 0 && row.failed === 0 && row.retried === 0
      && row.bytesIn === row.attemptedBytesIn && row.bytesOut === row.attemptedBytesOut));
    const rows = Object.fromEntries(m.accounting.requests.map(row => [row.operation, row]));
    need(rows.put.bytesOut === r.capturedBytes && rows.get.bytesIn === r.capturedBytes + 11
      && rows.head.bytesIn === 0 && rows['multipart-upload'].bytesOut === 4);
    need(m.accounting.requests.filter(row => !['bucket-create', 'put', 'multipart-upload'].includes(row.operation)).every(row => row.bytesOut === 0));
    const { runId, cloudRevision, waitronRevision, window } = input.metadata;
    const measured = (id, value, unit) => ({ id, value, unit, status: 'measured', source: 'receipt:' + runId,
      scope: 'venue', region: 'local', observedAt: window.endedAt, effectiveAt: null, bounds: null, reason: null });
    return validateReceipt({ schemaVersion: 1, runId, cloudRevision, waitronRevision, kind: 'local-aggregate', dataBoundary: boundary,
      window, cadence: { mode: 'original', factor: 1, coveredSeconds: window.elapsedSeconds, configuredSchedule: null, observedSchedule: null },
      inputs: [measured('archive-bytes', r.capturedBytes, 'bytes'), measured('restore-bytes', r.downloadedBytes, 'bytes'),
        measured('successful-sales', 1, 'count')], accounting: m.accounting,
      checks: [{ code: 'synthetic-only', passed: true, count: 1 }, { code: 'all-sales-replayed', passed: true, count: 1 },
        { code: 'accounting-reconciled', passed: true, count: 11 }, { code: 'cleanup-complete', passed: true, count: 0 }], cleanup });
  } catch { fail(); }
}
