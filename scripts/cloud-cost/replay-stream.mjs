import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync, realpathSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { assertOwnedRoot } from './schema.mjs';
import { openStreamMeasurement } from './stream-measurement.mjs';
import { nativeFailureSignal } from './worker-diagnostic.mjs';

const fail = () => { throw Error('Invalid cloud cost replay stream'); };
const need = value => { if (!value) fail(); };
const inside = (root, path) => isAbsolute(path) && relative(root, path) !== ''
  && relative(root, path) !== '..' && !relative(root, path).startsWith('../') && !isAbsolute(relative(root, path));
const file = path => { const s = lstatSync(path); need(s.isFile() && s.nlink === 1 && realpathSync(path) === path); return s; };

// Call only in the audited isolated worker. The caller owns the database and empty bucket.
// This lifecycle owns its native children, configuration, restore copy and measurement session.
export async function openReplayStream(input) {
  let args, identity, session, openingSession, writer, disposal, evidence, finishing, deadlineTimer, busy = false;
  let diagnosticStage = 'admission';
  const diagnose = event => {
    try { Promise.resolve(input.onDiagnostic?.(event)).catch(() => {}); } catch { /* Diagnostics cannot interrupt owned resource collection. */ }
  };
  const at = stage => { diagnosticStage = stage; diagnose({ kind: 'stream', stage }); };
  const refused = () => diagnose({ kind: 'stream-refusal', stage: diagnosticStage });
  let invalid = false, closed = false, resourcesCollected = false, starts = 0, phase = 'startup';
  const children = new Set();
  const record = entry => {
    assertOwnedRoot(args);
    const value = JSON.parse(readFileSync(args.journal.path, 'utf8'));
    (value.localResources ??= []).push(entry);
    writeFileSync(args.journal.path, JSON.stringify(value), { mode: 0o600 });
  };
  const healthy = () => { need(!closed && !invalid && !args.signal?.aborted); if (writer) need(children.has(writer)); };
  const launch = (argv, capture = false) => {
    assertOwnedRoot(args); need(!args.signal?.aborted);
    // Identity and contents are checked on every launch, including restore.
    need(file(args.binary).size <= 100 * 1024 * 1024
      && createHash('sha256').update(readFileSync(args.binary)).digest('hex') === args.binarySha256);
    record({ kind: 'stream-process', state: 'intent', operation: argv[0] });
    const child = spawn(args.binary, argv, { env: { PATH: process.env.PATH, HOME: args.workRoot,
      AWS_ACCESS_KEY_ID: 'SYNTHETIC', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC', AWS_EC2_METADATA_DISABLED: 'true' },
      stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] });
    const item = { child, stopping: false, text: '', bad: false };
    let stderrBytes = 0, tail = ''; const flags = new Set();
    child.stderr.on('data', bytes => {
      stderrBytes = Math.min(1000000000, stderrBytes + bytes.length);
      const text = tail + bytes.toString('utf8').toLowerCase();
      for (const flag of ['error', 'checksum', 'sqlite', 'wal', 'snapshot', 'compaction']) if (text.includes(flag)) flags.add(flag);
      tail = text.slice(-16);
    });
    children.add(item);
    if (capture) child.stdout.on('data', bytes => {
      if (item.text.length + bytes.length > 128) { item.bad = true; child.kill('SIGKILL'); }
      else item.text += bytes.toString('utf8');
    });
    item.done = new Promise(resolve => {
      child.once('error', () => { item.bad = true; });
      child.once('close', (code, signal) => {
        children.delete(item);
        diagnose({ kind: 'native', operation: argv[0], code, signal: nativeFailureSignal(signal), stderrBytes, stderrFlags: [...flags].sort() });
        try {
          if (child.pid) record({ kind: 'stream-process', state: 'collected', pid: child.pid, operation: argv[0] });
        } catch { item.bad = true; }
        if (argv[0] === 'replicate' && !item.stopping) invalid = true;
        resolve({ code, signal, bad: item.bad, text: item.text });
      });
    });
    if (child.pid) {
      try { record({ kind: 'stream-process', state: 'started', pid: child.pid, operation: argv[0] }); }
      catch { item.bad = true; child.kill('SIGKILL'); throw Error(); }
    }
    return item;
  };
  const stop = async item => {
    if (!item) return;
    if (children.has(item) && !item.stopping) { item.stopping = true; item.child.kill('SIGTERM'); }
    const timer = setTimeout(() => { item.bad = true; item.child.kill('SIGKILL'); }, 2000);
    try { return await item.done; } finally { clearTimeout(timer); }
  };
  const successful = result => need(result && result.code === 0 && !result.signal && !result.bad);
  const dispose = () => disposal ??= (async () => {
    closed = true; clearTimeout(deadlineTimer); args?.signal?.removeEventListener('abort', abort);
    const failures = [];
    // A fast native exit can interrupt its admitted upload. Drain before signalling,
    // while bounding this handoff so an unresponsive backend cannot prevent collection.
    if (writer && children.has(writer) && session) {
      let drainTimer;
      try {
        await Promise.race([session.whenIdle(() => {
          writer.stopping = true; writer.child.kill('SIGTERM');
        }), new Promise((_, reject) => { drainTimer = setTimeout(() => reject(Error()), 2000); })]);
      } catch { /* Collection below still stops the owned child and refuses invalid evidence. */ }
      finally { clearTimeout(drainTimer); }
    }
    for (const child of [...children]) { try { await stop(child); } catch { failures.push(true); } }
    // Cancellation can arrive while the listener is being acquired, before session is assigned.
    try { await (session ?? await openingSession)?.close(); } catch { failures.push(true); }
    if (identity) try {
      assertOwnedRoot(args); const s = lstatSync(args.workRoot);
      need(realpathSync(args.workRoot) === args.workRoot && s.ino === identity.ino && s.dev === identity.dev);
      record({ kind: 'stream-root', state: 'cleanup-intent', path: args.workRoot });
      rmSync(args.workRoot, { recursive: true }); need(!existsSync(args.workRoot));
      record({ kind: 'stream-root', state: 'removed', path: args.workRoot });
      need(children.size === 0); resourcesCollected = true;
    } catch { failures.push(true); }
    if (failures.length) fail();
  })();
  const abort = () => { invalid = true; dispose().catch(() => {}); };
  const quiesce = async () => {
    healthy();
    at('quiesce-idle'); await session.whenIdle(() => { writer.stopping = true; writer.child.kill('SIGTERM'); });
    at('quiesce-stop'); const result = await stop(writer);
    at('quiesce-stop-result'); successful(result); writer = undefined;
    at('quiesce-health'); healthy();
    at('quiesce-checkpoint'); return session.checkpoint();
  };
  const start = async () => {
    const before = session.activity(), observation = new AbortController();
    at('replicate'); writer = launch(['replicate', '-config', join(args.workRoot, 'stream.json')]); starts++;
    const exited = writer.done.then(() => fail());
    try {
      await Promise.race([session.waitForActivity(before), exited]); healthy();
      // Observation starts at the first native transfer; upload readiness shares that window.
      const until = performance.now() + args.startupSeconds * 1000;
      const observe = async () => {
        let remaining;
        while ((remaining = until - performance.now()) > 0)
          await delay(Math.ceil(remaining), undefined, { signal: observation.signal });
      };
      // A completed read cannot release startup without a successful ordinary upload.
      await Promise.race([Promise.all([observe(), session.waitForUpload()]), exited]); healthy();
    } finally { observation.abort(); }
  };
  try {
    assertOwnedRoot(input);
    const { source, root, journal, database, binary, binarySha256, target, sdk, bucket, versioned,
      signal: callerSignal, windowSeconds = 7200, startupSeconds = 0 } = input;
    need(callerSignal === undefined || callerSignal instanceof AbortSignal); need(!callerSignal?.aborted);
    need(typeof windowSeconds === 'number' && Number.isFinite(windowSeconds) && windowSeconds > 0 && windowSeconds <= 7200);
    need(typeof startupSeconds === 'number' && Number.isFinite(startupSeconds) && startupSeconds >= 0 && startupSeconds <= 300);
    need(inside(root, database) && file(database).size > 0);
    need(isAbsolute(binary) && typeof binarySha256 === 'string' && /^[a-f0-9]{64}$/.test(binarySha256));
    need(file(binary).size <= 100 * 1024 * 1024
      && createHash('sha256').update(readFileSync(binary)).digest('hex') === binarySha256);
    const workRoot = join(root, 'native-stream'); need(!existsSync(workRoot));
    // lstat also rejects dangling links, which existsSync deliberately does not see.
    try { lstatSync(workRoot); fail(); } catch (error) { need(error.code === 'ENOENT'); }
    const controller = new AbortController(), signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
    args = { source, root, journal: structuredClone(journal), database, binary, binarySha256, target, sdk, bucket, versioned, signal, workRoot, startupSeconds };
    signal.addEventListener('abort', abort, { once: true });
    deadlineTimer = setTimeout(() => controller.abort(), windowSeconds * 1000);
    // The replay owns cancellation order: collect its writer before closing the transport it drains through.
    at('measurement-open');
    openingSession = openStreamMeasurement({ target, sdk, bucket, versioned, clock: () => performance.now() / 1000,
      allowBulkDeletes: true, allowMultipart: true, resolveMultipartReplies: true, onDiagnostic: diagnose });
    session = await openingSession;
    healthy(); record({ kind: 'stream-root', state: 'intent', path: workRoot });
    mkdirSync(workRoot, { mode: 0o700 }); identity = lstatSync(workRoot);
    record({ kind: 'stream-root', state: 'ready', path: workRoot, ino: identity.ino, dev: identity.dev });
    at('version');
    const version = launch(['version'], true), versionTimer = setTimeout(() => { version.bad = true; version.child.kill('SIGKILL'); }, 2000);
    try { const result = await version.done; successful(result); need(result.text.trim() === '0.5.17'); }
    finally { clearTimeout(versionTimer); }
    healthy();
    writeFileSync(join(workRoot, 'stream.json'), JSON.stringify({ snapshot: { interval: '24h', retention: '168h' },
      dbs: [{ path: database, 'monitor-interval': '1s', replica: { type: 's3', bucket, path: 'stream', endpoint: session.url,
        region: 'eu-north-1', 'force-path-style': true, 'sync-interval': '1s' } }] }), { mode: 0o600, flag: 'wx' });
    await start();
  } catch { refused(); invalid = true; await dispose().catch(() => {}); fail(); }
  return {
    setPhase: async next => {
      try {
        healthy(); need(!busy && !finishing && ['workload', 'idle', 'verification'].includes(next)
          && (phase === 'startup' && next === 'workload' || phase === 'workload' && next === 'idle'
            || phase === 'idle' && next === 'verification'));
        at('phase'); busy = true; await session.changePhase(next);
        healthy(); phase = next; return { phase };
      } catch { refused(); invalid = true; await dispose().catch(() => {}); fail(); }
      finally { busy = false; }
    },
    finish: async ({ expectedSales } = {}) => {
      if (evidence) { need(expectedSales === evidence.restored.sales); return structuredClone(evidence); }
      if (!finishing) finishing = (async () => {
        try {
          healthy(); need(!busy && Number.isSafeInteger(expectedSales) && expectedSales > 0 && expectedSales <= 100000);
          at('quiesce'); await quiesce();
          at('restore-admission'); healthy(); session.setPhase('restore');
          const output = join(args.workRoot, 'restored.db'); need(!existsSync(output));
          at('restore'); const restore = launch(['restore', '-config', join(args.workRoot, 'stream.json'), '-o', output, args.database]);
          const timeout = setTimeout(() => { restore.bad = true; restore.child.kill('SIGKILL'); }, 30000);
          try { successful(await restore.done); } finally { clearTimeout(timeout); }
          at('restore-file'); healthy(); need(file(output).size > 0);
          // This is an owned restore copy. A read-only SQLite handle skips CHECK validation.
          const db = new DatabaseSync(output);
          try {
            db.exec('PRAGMA query_only=ON');
            at('restore-integrity'); need(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
            at('restore-sales'); need(db.prepare('SELECT count(*) AS n FROM sales').get().n === expectedSales);
          } finally { db.close(); }
          at('accounting'); const stream = await session.finish(); healthy();
          const result = { stream, restored: { sales: expectedSales, integrity: true },
            native: { version: '0.5.17', writerStarts: starts, phaseRestarts: starts - 1 },
            cleanup: { processes: 0, privateRoots: 0 } };
          at('cleanup'); await dispose(); evidence = result; return result;
        } catch { refused(); invalid = true; await dispose().catch(() => {}); fail(); }
      })();
      try { const result = await finishing; need(result.restored.sales === expectedSales); return structuredClone(result); }
      catch { fail(); }
    },
    // Refused accounting and completed resource collection are separate facts.
    // Callers may collect their own scratch while retaining the measurement refusal.
    closeResources: async () => {
      let failed = false;
      try { await dispose(); } catch { failed = true; }
      need(resourcesCollected);
      return { measurementValid: !failed && !invalid };
    },
    close: async () => { await dispose(); },
  };
}
