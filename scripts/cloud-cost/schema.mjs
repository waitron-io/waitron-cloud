import { validateInput } from './input.mjs';
export { validateInput } from './input.mjs';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const fail = () => { throw new Error('Invalid cloud cost evidence'); };
const requireThat = condition => { if (!condition) fail(); };
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const count = n => Number.isSafeInteger(n) && n >= 0;
const oneOf = (v, values) => requireThat(values.includes(v));
const measurementIds = ['orders-per-day', 'database-bytes', 'database-growth-bytes', 'successful-sales',
  'stream-bytes', 'stream-uploads', 'archive-bytes', 'snapshot-bytes', 'idle-bytes', 'startup-bytes',
  'remote-session-bytes-in', 'remote-session-bytes-out', 'remote-sessions-per-month', 'public-bytes',
  'email-operations', 'fiscal-operations', 'restore-bytes', 'verification-bytes', 'retention-months',
  'stream-snapshot-seconds', 'stream-retention-seconds', 'bill-count', 'replay-seconds',
  'stream-byte-seconds-low', 'stream-byte-seconds-high', 'stream-storage-seconds'];
const phases = ['setup', 'startup', 'workload', 'idle', 'verification', 'restore', 'observer', 'cleanup'];
const totalsKeys = ['attempts', 'bytesIn', 'bytesOut'];
const objectKeys = ['class', 'bytes', 'byteSeconds', 'currentVersions', 'noncurrentVersions', 'deleteMarkers', 'unfinishedMultipart'];
const requestKeys = ['phase', 'operation', 'requestClass', 'outcome', 'retryOrdinal', 'attempts', 'successful', 'failed',
  'retried', 'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'];

function closed(value, keys) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireThat(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const actual = Reflect.ownKeys(value);
  requireThat(actual.length === keys.length && actual.every(k => keys.includes(k)));
  requireThat(actual.every(k => Object.getOwnPropertyDescriptor(value, k).get === undefined));
}
function date(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value));
  requireThat(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
}
function boundedArray(value, visit) {
  requireThat(Array.isArray(value) && value.length <= 10000);
  for (let i = 0; i < value.length; i++) { requireThat(Object.hasOwn(value, i)); visit(value[i]); }
  requireThat(Reflect.ownKeys(value).length === value.length + 1);
}
function totals(value, signed = false) {
  closed(value, totalsKeys);
  requireThat(totalsKeys.every(k => signed ? Number.isSafeInteger(value[k]) : count(value[k])));
}
function schedule(value) {
  if (value === null) return;
  closed(value, ['snapshotSeconds', 'retentionSeconds']);
  requireThat(Object.values(value).every(v => v === null || (count(v) && v > 0)));
}
function receiptUnchecked(receipt) {
  closed(receipt, ['schemaVersion', 'runId', 'cloudRevision', 'waitronRevision', 'kind', 'dataBoundary',
    'window', 'cadence', 'inputs', 'accounting', 'checks', 'cleanup']);
  requireThat(receipt.schemaVersion === 1);
  requireThat(typeof receipt.runId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receipt.runId));
  for (const k of ['cloudRevision', 'waitronRevision']) requireThat(typeof receipt[k] === 'string' && /^[0-9a-f]{40}$/.test(receipt[k]));
  oneOf(receipt.kind, ['local-aggregate', 'synthetic-live-aggregate']);
  closed(receipt.dataBoundary, ['classification', 'rawIncluded', 'exportSchema']);
  requireThat(receipt.dataBoundary.classification === 'anonymous-aggregate' && receipt.dataBoundary.rawIncluded === false && receipt.dataBoundary.exportSchema === 1);
  closed(receipt.window, ['startedAt', 'endedAt', 'elapsedSeconds']);
  date(receipt.window.startedAt); date(receipt.window.endedAt);
  const elapsed = (Date.parse(receipt.window.endedAt) - Date.parse(receipt.window.startedAt)) / 1000;
  requireThat(finite(receipt.window.elapsedSeconds) && elapsed > 0 && Math.abs(receipt.window.elapsedSeconds - elapsed) < 0.001);
  closed(receipt.cadence, ['mode', 'factor', 'coveredSeconds', 'configuredSchedule', 'observedSchedule']);
  oneOf(receipt.cadence.mode, ['original', 'accelerated', 'synthetic-accelerated']);
  requireThat(finite(receipt.cadence.factor) && receipt.cadence.factor >= 1 && finite(receipt.cadence.coveredSeconds));
  if (receipt.cadence.mode === 'original') requireThat(receipt.cadence.factor === 1);
  schedule(receipt.cadence.configuredSchedule); schedule(receipt.cadence.observedSchedule);
  boundedArray(receipt.inputs, v => { validateInput(v); oneOf(v.id, measurementIds); requireThat(v.status !== 'list-priced'); });
  requireThat(new Set(receipt.inputs.map(v => v.id)).size === receipt.inputs.length);
  const a = receipt.accounting;
  closed(a, ['requests', 'objects', 'producer', 'observer', 'discrepancy']);
  boundedArray(a.requests, r => {
    closed(r, requestKeys); oneOf(r.phase, phases);
    oneOf(r.operation, ['put', 'get', 'head', 'list', 'delete', 'delete-many', 'multipart-create', 'multipart-upload',
      'multipart-complete', 'multipart-abort', 'bucket-create', 'bucket-delete', 'bucket-inspect', 'bucket-configure', 'remote', 'email', 'fiscal', 'kms']);
    oneOf(r.requestClass, ['s3-write', 's3-read', 's3-list', 's3-delete', 's3-multipart', 's3-control', 'kms-symmetric', 'network', 'smtp', 'fiscal']);
    oneOf(r.outcome, ['success', 'client-error', 'server-error', 'transport-error']);
    requireThat(requestKeys.slice(4).every(k => count(r[k])));
    requireThat(r.successful + r.failed === r.attempts && r.retried <= r.attempts);
    requireThat(r.bytesIn <= r.attemptedBytesIn && r.bytesOut <= r.attemptedBytesOut);
  });
  boundedArray(a.objects, o => {
    closed(o, objectKeys); oneOf(o.class, ['stream', 'snapshot', 'daily-archive', 'monthly-archive', 'protected', 'scratch']);
    requireThat(objectKeys.slice(1).every(k => finite(o[k])));
    requireThat(objectKeys.slice(3).every(k => count(o[k])));
  });
  totals(a.producer); totals(a.observer); totals(a.discrepancy, true);
  for (const k of totalsKeys) requireThat(a.producer[k] === a.requests.reduce((sum, r) => sum + r[k], 0));
  for (const k of totalsKeys) requireThat(a.discrepancy[k] === a.observer[k] - a.producer[k]);
  boundedArray(receipt.checks, c => {
    closed(c, ['code', 'passed', 'count']); oneOf(c.code, ['no-raw-data', 'source-unchanged', 'outbound-denied',
      'all-sales-replayed', 'accounting-reconciled', 'cleanup-complete', 'synthetic-only', 'caps-respected', 'billing-matched']);
    requireThat(typeof c.passed === 'boolean' && count(c.count));
  });
  const cleanupKeys = ['ownedProcesses', 'ownedContainers', 'ownedNetworks', 'ownedVolumes', 'ownedObjects', 'residualKinds'];
  closed(receipt.cleanup, cleanupKeys);
  requireThat(cleanupKeys.slice(0, -1).every(k => count(receipt.cleanup[k])));
  boundedArray(receipt.cleanup.residualKinds, v => oneOf(v, ['kms-pending-deletion', 'process', 'container', 'network', 'volume', 'object', 'role', 'bucket']));
  return structuredClone(receipt);
}
export function validateReceipt(receipt) {
  try { return receiptUnchecked(receipt); } catch { fail(); }
}
export function exportAggregate(privateResult) {
  // Reject instead of dropping unrecognised data so new producer fields cannot leak silently.
  return validateReceipt(privateResult);
}

const within = (parent, child) => child === parent || (relative(parent, child) !== '..'
  && !relative(parent, child).startsWith('../') && !isAbsolute(relative(parent, child)));
export function assertOwnedRoot({ source, root, journal }) {
  try {
    requireThat(isAbsolute(source) && isAbsolute(root) && isAbsolute(journal.path));
    requireThat(root === realpathSync(root) && source === realpathSync(source) && journal.path === realpathSync(journal.path));
    requireThat(!within(source, root) && !within(root, source));
    requireThat(within(root, journal.path) && root !== journal.path);
    requireThat(typeof journal.token === 'string' && /^[a-f0-9]{64}$/.test(journal.token));
    for (let ancestor = root; ; ancestor = dirname(ancestor)) {
      requireThat(!existsSync(join(ancestor, '.git')));
      if (dirname(ancestor) === ancestor) break;
    }
    const rootStat = lstatSync(root);
    requireThat(rootStat.isDirectory() && rootStat.uid === process.getuid() && (rootStat.mode & 0o777) === 0o700);
    const privateFile = path => {
      const stat = lstatSync(path);
      requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600);
      return readFileSync(path, 'utf8');
    };
    requireThat(privateFile(join(root, '.cloud-cost-owner')) === journal.token);
    const recorded = JSON.parse(privateFile(journal.path));
    requireThat(recorded.schemaVersion === 1 && recorded.root === root && recorded.source === source && recorded.ownershipToken === journal.token);
    // Reject all links, including internal ones, to keep later cleanup independent of targets.
    const scan = path => {
      for (const entry of readdirSync(path)) {
        const child = join(path, entry); const stat = lstatSync(child);
        requireThat(!stat.isSymbolicLink() && (stat.isDirectory() || (stat.isFile() && stat.nlink === 1)));
        if (stat.isDirectory()) scan(child);
      }
    };
    scan(root);
    requireThat(resolve(root) === root);
  } catch { fail(); }
}
