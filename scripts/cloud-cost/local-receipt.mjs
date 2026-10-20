import { isDeepStrictEqual } from 'node:util';
import { exportAggregate } from './schema.mjs';
import { validateReplayAdmission } from './isolated-replay.mjs';
import { summarizeStreamAccounting } from './stream-admission.mjs';

const fail = () => { throw Error('Invalid cloud cost local receipt'); };
const need = value => { if (!value) fail(); };
const count = value => Number.isSafeInteger(value) && value > 0;
const seconds = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const exact = (value, keys) => need(value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === keys.length && Reflect.ownKeys(value).every(key => keys.includes(key)
    && Object.getOwnPropertyDescriptor(value, key).get === undefined));
const units = {
  'orders-per-day': 'count', 'database-bytes': 'bytes', 'database-growth-bytes': 'bytes', 'successful-sales': 'count',
  'stream-bytes': 'bytes', 'stream-uploads': 'count', 'archive-bytes': 'bytes', 'snapshot-bytes': 'bytes',
  'idle-bytes': 'bytes', 'startup-bytes': 'bytes', 'remote-session-bytes-in': 'bytes', 'remote-session-bytes-out': 'bytes',
  'remote-sessions-per-month': 'count', 'public-bytes': 'bytes', 'email-operations': 'count', 'fiscal-operations': 'count',
  'restore-bytes': 'bytes', 'verification-bytes': 'bytes', 'retention-months': 'months',
  'stream-snapshot-seconds': 'seconds', 'stream-retention-seconds': 'seconds', 'bill-count': 'count', 'replay-seconds': 'seconds',
  'stream-byte-seconds-low': 'byte-seconds', 'stream-byte-seconds-high': 'byte-seconds', 'stream-storage-seconds': 'seconds',
};

// This receipt records one experiment. Missing drivers and daily projections stay unknown.
// Exact object lifetimes remain separate from the measured lower and upper storage bounds.
export function buildLocalReceipt(input) {
  try {
    exact(input, ['result', 'options', 'metadata']);
    const { result, options, metadata } = input;
    exact(metadata, ['runId', 'cloudRevision', 'waitronRevision', 'window']);
    need(metadata.waitronRevision === 'fbadd15785464e59747e697c11048bfbc6e4938f');
    exact(options, ['expected', 'originalInventory', 'cadence', 'replayWindowSeconds', 'stream']);
    exact(options.expected, ['sales', 'paid', 'tradingDays', 'busiest']);
    need(Object.values(options.expected).every(count) && options.expected.sales <= 100000
      && options.expected.paid <= options.expected.sales && options.expected.busiest <= options.expected.paid);
    exact(options.originalInventory, ['days', 'busiest']); need(Object.values(options.originalInventory).every(count));
    exact(options.cadence, ['mode', 'factor']);
    exact(options.stream, ['startupSeconds', 'idleSeconds', 'windowSeconds']);
    need(seconds(options.replayWindowSeconds) && options.replayWindowSeconds <= 3600
      && Object.values(options.stream).every(seconds) && options.stream.startupSeconds <= 300
      && options.stream.idleSeconds <= 3600 && options.stream.windowSeconds <= 7200
      && options.stream.startupSeconds + options.stream.idleSeconds + options.replayWindowSeconds < options.stream.windowSeconds);
    exact(result, ['costMeasured', 'admission', 'streamAccounting', 'isolation', 'cleanup']); need(result.costMeasured === false);
    exact(result.admission, ['complete', 'source', 'replay', 'integrity', 'storage', 'cleanup', 'stream']);
    const { stream, ...replay } = result.admission;
    const admitted = validateReplayAdmission(replay, options);
    const accounting = summarizeStreamAccounting(stream, { ...options.stream, expectedSales: options.expected.busiest });
    need(isDeepStrictEqual(accounting, result.streamAccounting));
    exact(result.isolation, ['blockedConnections', 'blockedDns', 'localControl']);
    need(result.isolation.blockedConnections === 3 && result.isolation.blockedDns === 2 && result.isolation.localControl === true);
    exact(result.cleanup, ['workerContainers', 'networks', 'privateCopies']); need(Object.values(result.cleanup).every(n => n === 0));
    need(metadata.window?.elapsedSeconds >= accounting.storage.windowSeconds
      && metadata.window.elapsedSeconds >= stream.phases.reduce((n, p) => n + p.elapsedSeconds, 0) + stream.retainedStorage.windowSeconds);
    const values = { 'orders-per-day': admitted.replay.counts.successful, 'bill-count': admitted.replay.counts.successful,
      'successful-sales': admitted.replay.counts.successful, 'database-bytes': admitted.storage.copiedDatabaseBytes,
      'database-growth-bytes': admitted.storage.freshGrowthBytes, 'replay-seconds': admitted.replay.timing.elapsedSeconds,
      'stream-byte-seconds-low': accounting.storage.byteSeconds.low, 'stream-byte-seconds-high': accounting.storage.byteSeconds.high,
      'stream-storage-seconds': accounting.storage.windowSeconds };
    const inputs = Object.entries(units).map(([id, unit]) => {
      const measured = Object.hasOwn(values, id);
      return { id, unit, value: measured ? values[id] : null, status: measured ? 'measured' : 'unknown',
        source: measured ? 'receipt:' + metadata.runId : null, scope: 'venue', region: 'local',
        observedAt: measured ? metadata.window.endedAt : null, effectiveAt: null, bounds: null,
        reason: measured ? null : 'not-measured' };
    });
    const { storage, ...requests } = accounting;
    return exportAggregate({ schemaVersion: 1, ...metadata, kind: 'local-aggregate',
      dataBoundary: { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 },
      cadence: { ...admitted.replay.cadence, configuredSchedule: null, observedSchedule: null }, inputs,
      accounting: { ...requests, objects: [] },
      checks: [['no-raw-data', 1], ['outbound-denied', 5], ['all-sales-replayed', admitted.replay.counts.successful],
        ['accounting-reconciled', accounting.producer.attempts], ['cleanup-complete', 0]]
        .map(([code, count]) => ({ code, passed: true, count })),
      cleanup: { ownedProcesses: 0, ownedContainers: 0, ownedNetworks: 0, ownedVolumes: 0, ownedObjects: 0, residualKinds: [] } });
  } catch { fail(); }
}
