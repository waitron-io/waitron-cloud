import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { runIsolatedReplay } from './isolated-replay.mjs';

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
      'expected', 'originalInventory', 'cadence', 'replayWindowSeconds', 'windowSeconds', 'initial', 'config'];
    need(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length
      && keys.every(k => Object.hasOwn(value, k)) && value.stage === 'replay-admission');
    return value;
  } catch { fail(); }
  finally { if (fd !== undefined) closeSync(fd); }
}

// Admission is an explicit partial experiment; it cannot stand in for stream or cost measurement.
export async function runLocal({ privateConfig, cadence, windowSeconds, signal }) {
  try {
    need(signal === undefined || signal instanceof AbortSignal); need(!signal?.aborted);
    const input = readLocalConfig(privateConfig);
    need(['original', 'accelerated'].includes(cadence) && input.cadence?.mode === cadence
      && typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)
      && windowSeconds > 0 && windowSeconds <= 7200 && input.windowSeconds === windowSeconds);
    const { stage, ...args } = input;
    const result = await runIsolatedReplay({ ...args, signal });
    return { stage, ...result };
  } catch { fail(); }
}
