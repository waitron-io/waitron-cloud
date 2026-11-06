import assert from 'node:assert/strict';
import {mkdirSync, lstatSync, rmdirSync, mkdtempSync, rmSync, readFileSync, realpathSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {LocalLeases} from './leases.mjs';
import {runLocal} from './local.mjs';
import {SSHTransport, runProcess} from './transport.mjs';

// This provisional manual gate covers packaging too. A dead owner leaves it
// closed until an operator verifies the recorded lease absent; no age-based reset.
export async function withManualSlot(directory, work) {
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const info = lstatSync(directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o077) === 0, 'Manual state must be a private owned directory');
  const lock = join(directory, 'manual.lock');
  try { mkdirSync(lock, {mode: 0o700}); }
  catch (error) { if (error.code === 'EEXIST') return {code: 75, reason: 'manual-slot-busy-or-needs-recovery'}; throw error; }
  try { return await work(); }
  finally { rmdirSync(lock); }
}

export async function main(args) {
  assert.ok(args.length >= 5 && args[3] === '--', 'Usage: manual.mjs CONFIG LANE CLOUD_CHECKOUT -- COMMAND [ARGS]');
  const [configuration, lane, checkout, , ...argv] = args;
  assert.match(lane, /^[A-K]$/, 'Invalid campaign lane');
  assert.ok(argv.length > 0 && argv[0] && argv.every(v => !v.includes('\0')), 'A literal command argument list is required');
  const config = JSON.parse(readFileSync(configuration, 'utf8'));
  assert.deepEqual(Object.keys(config).sort(), ['host', 'hostGeneration', 'mode', 'recipe', 'repository', 'state', 'version']);
  assert.ok(config.version === 1 && config.mode === 'manual-one-slot', 'Only manual single-slot use is enabled');
  const common = execFileSync('git', ['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {encoding: 'utf8', timeout: 5000}).trim();
  assert.equal(realpathSync(common), realpathSync(config.repository), 'This manual helper accepts only the configured Cloud repository');
  console.log(`Disposable tests: ${config.mode}, generation ${config.hostGeneration}`);
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.on('SIGTERM', cancel);
  process.on('SIGINT', cancel);
  try {
    const result = await withManualSlot(resolve(config.state), async () => {
      const leases = new LocalLeases(join(config.state, 'ledger'), {hostGeneration: config.hostGeneration, slots: 1});
      const state = leases.inspect();
      if (!state.slots || state.slots.some(slot => slot.state !== 'free')) return {code: 75, reason: 'recorded-slot-busy-or-quarantined'};
      const transport = new SSHTransport({host: config.host, recipe: config.recipe});
      let healthy;
      try { healthy = await transport.healthy({signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(8000)])}); }
      catch { healthy = false; }
      if (!healthy) return {code: cancellation.signal.aborted ? 143 : 75, reason: 'host-unavailable'};
      const temporary = mkdtempSync(join(tmpdir(), 'disposable-manual-'));
      try {
        const source = join(temporary, 'source.tar');
        const copied = await runProcess('python3', ['-B', new URL('./snapshot.py', import.meta.url).pathname, 'create', resolve(checkout), source], {signal: cancellation.signal, capture: true});
        assert.equal(copied.code, 0, 'Source snapshot failed');
        const snapshot = JSON.parse(copied.stdout).sha256;
        const downloaded = await runProcess('python3', ['-B', new URL('./private-packages.py', import.meta.url).pathname, 'fetch', join(temporary, 'private')], {signal: cancellation.signal, capture: true});
        assert.equal(downloaded.code, 0, 'Reviewed private package preparation failed');
        transport.source = source;
        transport.privatePackage = join(temporary, 'private', 'ui-core-0.1.0.tgz');
        console.log(`Source ${snapshot}; command starts in a fresh VM, maximum 55 minutes.`);
        return await runLocal({leases, transport, signal: cancellation.signal,
          request: {lane, turn: 'manual-'+randomUUID(), snapshot, argv}});
      } finally { rmSync(temporary, {recursive: true, force: true}); }
    });
    console.log(JSON.stringify({code: result.code, reason: result.reason, cleanup: result.cleanup,
      resourceId: result.lease?.resourceId, snapshot: result.lease?.snapshot, error: result.error}));
    return result.code;
  } finally {
    process.off('SIGTERM', cancel);
    process.off('SIGINT', cancel);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 125; }
}
