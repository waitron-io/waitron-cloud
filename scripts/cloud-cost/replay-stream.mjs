import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync, realpathSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { assertOwnedRoot } from './schema.mjs';
import { openStreamMeasurement } from './stream-measurement.mjs';

const fail = () => { throw Error('Invalid cloud cost replay stream'); };
const need = value => { if (!value) fail(); };
const inside = (root, path) => isAbsolute(path) && relative(root, path) !== ''
  && relative(root, path) !== '..' && !relative(root, path).startsWith('../') && !isAbsolute(relative(root, path));
const file = path => { const s = lstatSync(path); need(s.isFile() && s.nlink === 1 && realpathSync(path) === path); return s; };

// Call only in the audited isolated worker. The caller owns the database and empty bucket.
// This lifecycle owns its native children, configuration, restore copy and measurement session.
export async function openReplayStream(input) {
  let args, identity, session, openingSession, writer, disposal, evidence, finishing, deadlineTimer, busy = false;
  let invalid = false, closed = false, starts = 0, phase = 'startup';
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
      stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'] });
    const item = { child, stopping: false, text: '', bad: false };
    children.add(item);
    if (capture) child.stdout.on('data', bytes => {
      if (item.text.length + bytes.length > 128) { item.bad = true; child.kill('SIGKILL'); }
      else item.text += bytes.toString('utf8');
    });
    item.done = new Promise(resolve => {
      child.once('error', () => { item.bad = true; });
      child.once('close', (code, signal) => {
        children.delete(item);
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
    for (const child of [...children]) { try { await stop(child); } catch { failures.push(true); } }
    // Cancellation can arrive while the listener is being acquired, before session is assigned.
    try { await (session ?? await openingSession)?.close(); } catch { failures.push(true); }
    if (identity) try {
      assertOwnedRoot(args); const s = lstatSync(args.workRoot);
      need(realpathSync(args.workRoot) === args.workRoot && s.ino === identity.ino && s.dev === identity.dev);
      record({ kind: 'stream-root', state: 'cleanup-intent', path: args.workRoot });
      rmSync(args.workRoot, { recursive: true }); need(!existsSync(args.workRoot));
      record({ kind: 'stream-root', state: 'removed', path: args.workRoot });
    } catch { failures.push(true); }
    if (failures.length) fail();
  })();
  const abort = () => { invalid = true; dispose().catch(() => {}); };
  const quiesce = async () => {
    healthy(); await session.whenIdle(() => { writer.stopping = true; writer.child.kill('SIGTERM'); });
    successful(await stop(writer)); writer = undefined; healthy();
    return session.checkpoint();
  };
  const start = async () => {
    const before = session.activity();
    writer = launch(['replicate', '-config', join(args.workRoot, 'stream.json')]); starts++;
    // A completed native transfer proves readiness; observer polling and elapsed time do not.
    await Promise.race([session.waitForActivity(before), writer.done.then(() => fail())]); healthy();
  };
  try {
    assertOwnedRoot(input);
    const { source, root, journal, database, binary, binarySha256, target, sdk, bucket, versioned,
      signal: callerSignal, windowSeconds = 7200 } = input;
    need(callerSignal === undefined || callerSignal instanceof AbortSignal); need(!callerSignal?.aborted);
    need(typeof windowSeconds === 'number' && Number.isFinite(windowSeconds) && windowSeconds > 0 && windowSeconds <= 7200);
    need(inside(root, database) && file(database).size > 0);
    need(isAbsolute(binary) && typeof binarySha256 === 'string' && /^[a-f0-9]{64}$/.test(binarySha256));
    need(file(binary).size <= 100 * 1024 * 1024
      && createHash('sha256').update(readFileSync(binary)).digest('hex') === binarySha256);
    const workRoot = join(root, 'native-stream'); need(!existsSync(workRoot));
    // lstat also rejects dangling links, which existsSync deliberately does not see.
    try { lstatSync(workRoot); fail(); } catch (error) { need(error.code === 'ENOENT'); }
    const controller = new AbortController(), signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
    args = { source, root, journal: structuredClone(journal), database, binary, binarySha256, target, sdk, bucket, versioned, signal, workRoot };
    signal.addEventListener('abort', abort, { once: true });
    deadlineTimer = setTimeout(() => controller.abort(), windowSeconds * 1000);
    // The replay owns cancellation order: collect its writer before closing the transport it drains through.
    openingSession = openStreamMeasurement({ target, sdk, bucket, versioned, clock: () => performance.now() / 1000,
      allowBulkDeletes: true, allowMultipart: true, resolveMultipartReplies: true });
    session = await openingSession;
    healthy(); record({ kind: 'stream-root', state: 'intent', path: workRoot });
    mkdirSync(workRoot, { mode: 0o700 }); identity = lstatSync(workRoot);
    record({ kind: 'stream-root', state: 'ready', path: workRoot, ino: identity.ino, dev: identity.dev });
    const version = launch(['version'], true), versionTimer = setTimeout(() => { version.bad = true; version.child.kill('SIGKILL'); }, 2000);
    try { const result = await version.done; successful(result); need(result.text.trim() === '0.5.17'); }
    finally { clearTimeout(versionTimer); }
    healthy();
    writeFileSync(join(workRoot, 'stream.json'), JSON.stringify({ snapshot: { interval: '24h', retention: '168h' },
      dbs: [{ path: database, 'monitor-interval': '1s', replica: { type: 's3', bucket, path: 'stream', endpoint: session.url,
        region: 'eu-north-1', 'force-path-style': true, 'sync-interval': '1s' } }] }), { mode: 0o600, flag: 'wx' });
    await start();
  } catch { invalid = true; await dispose().catch(() => {}); fail(); }
  return {
    setPhase: async next => {
      try {
        healthy(); need(!busy && !finishing && ['workload', 'idle', 'verification'].includes(next)
          && (phase === 'startup' && next === 'workload' || phase === 'workload' && next === 'idle'
            || phase === 'idle' && next === 'verification'));
        busy = true; await session.changePhase(next);
        healthy(); phase = next; return { phase };
      } catch { invalid = true; await dispose().catch(() => {}); fail(); }
      finally { busy = false; }
    },
    finish: async ({ expectedSales } = {}) => {
      if (evidence) { need(expectedSales === evidence.restored.sales); return structuredClone(evidence); }
      if (!finishing) finishing = (async () => {
        try {
          healthy(); need(!busy && Number.isSafeInteger(expectedSales) && expectedSales > 0 && expectedSales <= 100000);
          await quiesce(); healthy(); session.setPhase('restore');
          const output = join(args.workRoot, 'restored.db'); need(!existsSync(output));
          const restore = launch(['restore', '-config', join(args.workRoot, 'stream.json'), '-o', output, args.database]);
          const timeout = setTimeout(() => { restore.bad = true; restore.child.kill('SIGKILL'); }, 30000);
          try { successful(await restore.done); } finally { clearTimeout(timeout); }
          healthy(); need(file(output).size > 0);
          // This is an owned restore copy. A read-only SQLite handle skips CHECK validation.
          const db = new DatabaseSync(output);
          try {
            db.exec('PRAGMA query_only=ON');
            need(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok'
              && db.prepare('SELECT count(*) AS n FROM sales').get().n === expectedSales);
          } finally { db.close(); }
          const stream = await session.finish(); healthy();
          const result = { stream, restored: { sales: expectedSales, integrity: true },
            native: { version: '0.5.17', writerStarts: starts, phaseRestarts: starts - 1 },
            cleanup: { processes: 0, privateRoots: 0 } };
          await dispose(); evidence = result; return result;
        } catch { invalid = true; await dispose().catch(() => {}); fail(); }
      })();
      try { const result = await finishing; need(result.restored.sales === expectedSales); return structuredClone(result); }
      catch { fail(); }
    },
    close: async () => { await dispose(); },
  };
}
