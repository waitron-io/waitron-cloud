import { constants, openSync, closeSync, fstatSync, readSync, realpathSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runIsolatedReplay } from './isolated-replay.mjs';
import { buildLocalReceipt } from './local-receipt.mjs';

const fail = () => { throw Error('Invalid cloud cost local command'); };
const need = value => { if (!value) fail(); };

// Private configuration is a file, never a command-line payload or a published receipt.
export function readLocalConfig(path) {
  let fd;
  try {
    need(typeof path === 'string' && isAbsolute(path) && realpathSync(path) === path);
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    need(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid()
      && (stat.mode & 0o7777) === 0o600 && stat.size > 0 && stat.size <= 65536);
    const buffer = Buffer.alloc(stat.size + 1); let length = 0, n;
    while (length < buffer.length && (n = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += n;
    const after = fstatSync(fd);
    need(length === stat.size && after.size === stat.size && after.mtimeMs === stat.mtimeMs
      && after.ctimeMs === stat.ctimeMs);
    const value = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    const keys = ['stage', 'source', 'root', 'journal', 'database', 'codeRoot', 'image', 'locationId',
      'expected', 'originalInventory', 'cadence', 'replayWindowSeconds', 'windowSeconds', 'initial', 'config',
      ...(['stream-replay', 'stream-receipt'].includes(value?.stage) ? ['stream'] : [])];
    need(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length
      && keys.every(k => Object.hasOwn(value, k)) && ['replay-admission', 'stream-replay', 'stream-receipt'].includes(value.stage));
    return value;
  } catch { fail(); }
  finally { if (fd !== undefined) closeSync(fd); }
}

// All named stages are partial experiments; full venue cost still needs every measured driver.
export async function runLocal({ privateConfig, cadence, windowSeconds, signal }) {
  try {
    need(signal === undefined || signal instanceof AbortSignal); need(!signal?.aborted);
    const input = readLocalConfig(privateConfig);
    need(['original', 'accelerated'].includes(cadence) && input.cadence?.mode === cadence
      && typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)
      && windowSeconds > 0 && windowSeconds <= 7200 && input.windowSeconds === windowSeconds);
    const { stage, ...args } = input;
    let cloudRevision;
    if (stage === 'stream-receipt') {
      const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../..', import.meta.url),
        timeout: 5000, maxBuffer: 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      need(revision.status === 0 && /^[a-f0-9]{40}\n$/.test(revision.stdout)); cloudRevision = revision.stdout.trim();
    }
    const started = Date.now(), monotonicStart = performance.now();
    const result = await runIsolatedReplay({ ...args, signal });
    if (stage === 'stream-receipt') {
      const ended = Date.now(), elapsedSeconds = (ended - started) / 1000;
      need(Math.abs(elapsedSeconds - (performance.now() - monotonicStart) / 1000) < 0.25);
      const { expected, cadence, replayWindowSeconds, originalInventory: { days, busiest },
        stream: { startupSeconds, idleSeconds, windowSeconds: streamWindow } } = input;
      const receipt = buildLocalReceipt({ result,
        options: { expected, cadence, replayWindowSeconds, originalInventory: { days, busiest },
          stream: { startupSeconds, idleSeconds, windowSeconds: streamWindow } },
        metadata: { runId: randomUUID(), cloudRevision,
          waitronRevision: JSON.parse(readFileSync(join(input.codeRoot, 'runtime-manifest.json'), 'utf8')).revision,
          window: { startedAt: new Date(started).toISOString(), endedAt: new Date(ended).toISOString(), elapsedSeconds } } });
      return { stage, costMeasured: false, receipt };
    }
    return { stage, ...result };
  } catch { fail(); }
}
