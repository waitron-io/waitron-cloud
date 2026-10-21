import { isDeepStrictEqual } from 'node:util';

const fail = () => { throw Error('Invalid cloud cost archive evidence'); };
const need = value => { if (!value) fail(); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const exact = (value, keys) => need(value && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
const equal = (value, expected) => need(isDeepStrictEqual(value, expected));
const boundary = { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 };
const keys = ['cloudRevision', 'waitronRevision', 'runtimeSha256', 'image', 'startedAt', 'endedAt',
  'experimentSeconds', 'costMeasured', 'replay', 'isolation', 'cleanup', 'scope', 'privateState', 'unknown'];
const unknown = ['production-private-state-shape', 'representative-venue-database', 'archive-storage-http-traffic',
  'monthly-frequency', 'aws-capacity', 'daily-cost', 'monthly-cost'];

// Validate descriptors before reading any producer value: refusal must not execute
// private accessors or silently drop hidden fields while copying the result.
function plain(value, seen = new Set(), budget = { remaining: 1000 }) {
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
function check(value) {
  need(/^[a-f0-9]{40}$/.test(value.cloudRevision)
    && value.waitronRevision === 'fbadd15785464e59747e697c11048bfbc6e4938f'
    && /^[a-f0-9]{64}$/.test(value.runtimeSha256) && /^sha256:[a-f0-9]{64}$/.test(value.image));
  for (const key of ['startedAt', 'endedAt']) need(typeof value[key] === 'string'
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value[key])
    && Number.isFinite(Date.parse(value[key])) && new Date(value[key]).toISOString() === value[key]);
  const seconds = (Date.parse(value.endedAt) - Date.parse(value.startedAt)) / 1000;
  need(finite(value.experimentSeconds) && value.experimentSeconds > 0 && value.experimentSeconds <= 7200
    && seconds > 0 && Math.abs(seconds - value.experimentSeconds) < 0.01);
  need(value.costMeasured === false && value.scope === 'selected-day-sales-replayed-into-fresh-venue'
    && value.privateState === 'generated-32-byte-stand-ins');
  equal(value.unknown, unknown);
  const r = value.replay;
  exact(r, ['complete', 'source', 'replay', 'integrity', 'storage', 'archive', 'cleanup']); need(r.complete === true);
  exact(r.source, ['counts', 'originalInventory']);
  exact(r.source.counts, ['sales', 'paid', 'tradingDays', 'busiest']);
  exact(r.source.originalInventory, ['days', 'busiest']);
  need([...Object.values(r.source.counts), ...Object.values(r.source.originalInventory)].every(n => count(n) && n > 0));
  need(r.source.counts.paid <= r.source.counts.sales && r.source.counts.tradingDays <= r.source.counts.paid
    && r.source.counts.busiest <= r.source.counts.paid);
  exact(r.replay, ['complete', 'cadence', 'counts', 'timing']); need(r.replay.complete === true);
  exact(r.replay.cadence, ['mode', 'factor', 'coveredSeconds']);
  const cadence = r.replay.cadence;
  need(['original', 'accelerated'].includes(cadence.mode) && finite(cadence.factor) && cadence.factor >= 1
    && (cadence.mode !== 'original' || cadence.factor === 1) && finite(cadence.coveredSeconds));
  exact(r.replay.counts, ['expected', 'attempted', 'successful', 'failed']);
  const sales = r.replay.counts.expected;
  need(count(sales) && sales > 0 && sales === r.source.counts.busiest);
  equal(r.replay.counts, { expected: sales, attempted: sales, successful: sales, failed: 0 });
  exact(r.replay.timing, ['elapsedSeconds', 'maxLagSeconds']);
  need(finite(r.replay.timing.elapsedSeconds) && finite(r.replay.timing.maxLagSeconds));
  equal(r.integrity, { ok: true, issues: 0 });
  exact(r.storage, ['copiedDatabaseBytes', 'freshBeforeBytes', 'freshAfterBytes', 'freshGrowthBytes']);
  need(Object.values(r.storage).every(count) && r.storage.copiedDatabaseBytes > 0 && r.storage.freshBeforeBytes > 0
    && r.storage.freshAfterBytes - r.storage.freshBeforeBytes === r.storage.freshGrowthBytes);
  exact(r.archive, ['capturedBytes', 'captureSeconds', 'restoreSeconds', 'restored']);
  need(count(r.archive.capturedBytes) && r.archive.capturedBytes > 0
    && finite(r.archive.captureSeconds) && finite(r.archive.restoreSeconds)
    && r.replay.timing.elapsedSeconds + r.archive.captureSeconds + r.archive.restoreSeconds <= value.experimentSeconds);
  equal(r.archive.restored, { ok: true, issues: 0, sales });
  equal(r.cleanup, { ownedReplayRoots: 0 });
  equal(value.isolation, { blockedConnections: 3, blockedDns: 2, localControl: true });
  equal(value.cleanup, { workerContainers: 0, networks: 0, privateCopies: 0 });
}

export function buildArchiveEvidence(input) {
  try {
    plain(input); exact(input, keys); check(input);
    return structuredClone({ schemaVersion: 1, kind: 'local-archive-aggregate', dataBoundary: boundary, ...input });
  } catch { fail(); }
}

export function validateArchiveEvidence(input) {
  try {
    plain(input); exact(input, ['schemaVersion', 'kind', 'dataBoundary', ...keys]);
    need(input.schemaVersion === 1 && input.kind === 'local-archive-aggregate'); equal(input.dataBoundary, boundary);
    check(input); return true;
  } catch { fail(); }
}
