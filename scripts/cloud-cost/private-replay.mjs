import { DatabaseSync } from 'node:sqlite';
import { lstatSync, mkdirSync, rmSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertOwnedRoot } from './schema.mjs';
import { readPrivateReplayClock, discoverPrivateReplayDay, readPrivateReplayBills } from './local.mjs';
import { prepareReplayDay } from './replay-day.mjs';
import { replayScheduledSales } from './cadence.mjs';
import { openReplay } from './waitron-adapter.mjs';
import { openReplayStream } from './replay-stream.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const fail = () => { throw new Error('Invalid cloud cost private replay'); };
const requireThat = value => { if (!value) fail(); };
const inside = (root, path) => { const r = relative(root, path); return r !== '' && r !== '..' && !r.startsWith('../') && !isAbsolute(r); };
function record(args, entry) {
  assertOwnedRoot(args);
  const journal = JSON.parse(readFileSync(args.journal.path, 'utf8'));
  journal.localResources ??= [];
  journal.localResources.push({ kind: 'private-replay-state', path: args.stateRoot, ...entry });
  writeFileSync(args.journal.path, JSON.stringify(journal), { mode: 0o600 });
}
function inventory(database, locationId, expected) {
  requireThat(expected && Object.getPrototypeOf(expected) === Object.prototype
    && Reflect.ownKeys(expected).sort().join(',') === 'busiest,days,timeZone');
  requireThat(['days', 'busiest'].every(k => Number.isSafeInteger(expected[k]) && expected[k] > 0 && expected[k] <= 100000));
  requireThat(typeof expected.timeZone === 'string' && expected.timeZone.length <= 128 && !/^[+-]/.test(expected.timeZone));
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: expected.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const rows = db.prepare(`SELECT s.issued_at FROM sales s JOIN nodes n ON n.id=s.node_id
      WHERE n.location_id=? AND s.total>0 AND EXISTS(SELECT 1 FROM sale_settlements p WHERE p.sale_id=s.id)
      LIMIT 100001`).all(locationId);
    requireThat(rows.length <= 100000);
    const days = new Map();
    for (const row of rows) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(row.issued_at)).map(p => [p.type, p.value]));
      const day = `${parts.year}-${parts.month}-${parts.day}`;
      days.set(day, (days.get(day) ?? 0) + 1);
    }
    const counts = { days: days.size, busiest: Math.max(0, ...days.values()) };
    requireThat(counts.days === expected.days && counts.busiest === expected.busiest);
    return counts;
  } finally { db.close(); }
}
function logicalBytes(database) {
  // Logical pages include uncheckpointed writes; database-file length alone misses that growth.
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const bytes = db.prepare('PRAGMA page_count').get().page_count * db.prepare('PRAGMA page_size').get().page_size;
    requireThat(Number.isSafeInteger(bytes) && bytes > 0); return bytes;
  } finally { db.close(); }
}

async function observeFor(seconds, signal) {
  const until = performance.now() + seconds * 1000;
  let remaining;
  // Timer wakes do not establish elapsed observation; the monotonic clock does.
  while ((remaining = until - performance.now()) > 0)
    await delay(Math.ceil(remaining), undefined, { signal });
}

// Call only inside the audited isolated worker: this stage neither starts isolation nor qualifies cost accounting.
// State belongs to this invocation; an admitted sale settles before the adapter closes and cleanup begins.
export async function replayPrivateDay(args) {
  let replay, identity, result, stream, streamTimer;
  try {
    const { source, root, journal, database, locationId, codeRoot, stateRoot, signal: callerSignal, onProgress } = args;
    let signal = callerSignal, streamOptions;
    assertOwnedRoot({ source, root, journal });
    requireThat(signal === undefined || signal instanceof AbortSignal);
    requireThat(!signal?.aborted && (onProgress === undefined || typeof onProgress === 'function'));
    if (args.stream !== undefined) {
      const keys = ['binary', 'binarySha256', 'target', 'sdk', 'bucket', 'versioned', 'startupSeconds', 'idleSeconds', 'windowSeconds'];
      requireThat(args.stream && Object.getPrototypeOf(args.stream) === Object.prototype
        && Reflect.ownKeys(args.stream).length === keys.length && keys.every(k => Object.hasOwn(args.stream, k)
          && !Object.getOwnPropertyDescriptor(args.stream, k).get));
      const { sdk, ...settings } = args.stream;
      streamOptions = { ...structuredClone(settings), sdk };
      const { startupSeconds, idleSeconds, windowSeconds } = streamOptions;
      requireThat([startupSeconds, idleSeconds, windowSeconds].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)
        && startupSeconds <= 300 && idleSeconds <= 3600 && windowSeconds <= 7200
        && startupSeconds + idleSeconds < windowSeconds);
      const controller = new AbortController();
      signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      streamTimer = setTimeout(() => controller.abort(), windowSeconds * 1000);
    }
    requireThat(isAbsolute(stateRoot) && resolve(stateRoot) === stateRoot && inside(root, stateRoot) && !inside(codeRoot, stateRoot));
    requireThat(realpathSync(join(stateRoot, '..')) === join(stateRoot, '..'));
    const cadence = structuredClone(args.cadence), windowSeconds = args.windowSeconds;
    requireThat(cadence && Reflect.ownKeys(cadence).sort().join(',') === 'factor,mode'
      && ['original', 'accelerated'].includes(cadence.mode) && Number.isFinite(cadence.factor) && cadence.factor >= 1
      && (cadence.mode !== 'original' || cadence.factor === 1));
    requireThat(Number.isFinite(windowSeconds) && windowSeconds > 0 && windowSeconds <= 3600);
    // The validated copy is a standalone database; this read must precede every direct SQLite open.
    const clock = readPrivateReplayClock({ source, root, journal, database, locationId });
    record(args, { state: 'intent' });
    mkdirSync(stateRoot, { mode: 0o700 }); identity = lstatSync(stateRoot);
    record(args, { state: 'ready', ino: identity.ino, dev: identity.dev });
    const initial = { ...args.initial, location: { ...args.initial.location,
      timeZone: clock.timeZone, dayCutover: clock.dayCutover + ':00' } };
    replay = await openReplay({ codeRoot, stateRoot, config: args.config, initial });
    // openReplay has checked the pinned manifest and runtime hash before this import.
    const runtime = await import(pathToFileURL(join(codeRoot, 'runtime.mjs')).href);
    const selectionArgs = { source, root, journal, database, locationId,
      calendar: { businessDayAt: runtime.businessDayAt, businessDayBounds: runtime.businessDayBounds }, expected: args.expected };
    const discovered = discoverPrivateReplayDay(selectionArgs);
    requireThat(discovered.selection !== null);
    const originalInventory = inventory(database, locationId, args.originalInventory);
    const bills = readPrivateReplayBills({ ...selectionArgs, ...discovered.selection });
    const prepared = prepareReplayDay({ bounds: discovered.selection.bounds,
      expectedSales: discovered.selection.expectedSales, events: bills.events });
    const freshDatabase = join(stateRoot, 'venue/venue.db'), freshBeforeBytes = logicalBytes(freshDatabase);
    if (streamOptions) {
      stream = await openReplayStream({ ...streamOptions, source, root, journal, database: freshDatabase, signal });
      await observeFor(streamOptions.startupSeconds, signal);
      await stream.setPhase('workload');
    }
    let successfulSales = 0;
    const progress = async phase => {
      requireThat(!signal?.aborted); await onProgress?.({ phase, successfulSales }); requireThat(!signal?.aborted);
    };
    await progress('workload');
    const scheduled = await replayScheduledSales({ ...prepared, cadence, windowSeconds, signal,
      recordSale: async sale => { await replay.recordSale(sale); successfulSales++; await progress('workload'); } });
    const counts = replay.counts();
    requireThat(counts.attempted === prepared.expectedSales && counts.successful === prepared.expectedSales && counts.failed === 0);
    if (stream) {
      await stream.setPhase('idle'); await progress('idle');
      await observeFor(streamOptions.idleSeconds, signal);
      await stream.setPhase('verification');
    }
    await progress('verification');
    const integrity = await replay.verify();
    requireThat(!signal?.aborted && integrity.ok === true && integrity.issues === 0);
    const freshAfterBytes = logicalBytes(freshDatabase);
    requireThat(freshAfterBytes >= freshBeforeBytes);
    result = { complete: true, source: { counts: discovered.counts, originalInventory }, replay: scheduled,
      integrity: { ok: true, issues: 0 }, storage: { copiedDatabaseBytes: lstatSync(database).size,
        freshBeforeBytes, freshAfterBytes, freshGrowthBytes: freshAfterBytes - freshBeforeBytes } };
    if (stream) result.stream = await stream.finish({ expectedSales: prepared.expectedSales });
  } catch { fail(); }
  finally {
    clearTimeout(streamTimer);
    try {
      try { await stream?.close(); } finally { await replay?.close(); }
      if (identity) {
        assertOwnedRoot(args);
        const s = lstatSync(args.stateRoot);
        requireThat(realpathSync(args.stateRoot) === args.stateRoot && s.ino === identity.ino && s.dev === identity.dev);
        record(args, { state: 'cleanup-intent', ino: identity.ino, dev: identity.dev });
        rmSync(args.stateRoot, { recursive: true });
        record(args, { state: 'removed' });
      }
    } catch { fail(); }
  }
  return { ...result, cleanup: { ownedReplayRoots: 0 } };
}
