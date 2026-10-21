import { readFileSync, writeFileSync, lstatSync, realpathSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync, constants } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertOwnedRoot } from './schema.mjs';
import { recordOwnedResource as record } from './owned-journal.mjs';
import { validateStreamSettings, validateStreamAdmission, summarizeStreamAccounting } from './stream-admission.mjs';
import { validateReplayConfig } from './waitron-adapter.mjs';
import { prepareIsolatedPrivateCopy, proveDockerIsolation, runForegroundContainer } from './local.mjs';
import { workerFailureStage } from './worker-diagnostic.mjs';

const fail = () => { throw Error('Invalid isolated cloud cost replay'); };
const need = value => { if (!value) fail(); };
const inside = (root, path) => isAbsolute(path) && relative(root, path) !== ''
  && relative(root, path) !== '..' && !relative(root, path).startsWith('../') && !isAbsolute(relative(root, path));
const count = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const exact = (value, keys) => {
  need(value && Object.getPrototypeOf(value) === Object.prototype);
  const found = Reflect.ownKeys(value);
  need(found.length === keys.length && found.every(k => keys.includes(k) && !Object.getOwnPropertyDescriptor(value, k).get));
};
const sameCounts = (found, expected, keys) => {
  exact(found, keys);
  need(keys.every(k => count(found[k]) && found[k] === expected[k]));
};

// A worker result is private until every field and reconciliation has been checked here.
export function validateReplayAdmission(value, options) {
  try {
    need(options.archive === undefined || options.archive === true);
    exact(value, ['complete', 'source', 'replay', 'integrity', 'storage', 'cleanup', ...(options.archive ? ['archive'] : [])]); need(value.complete === true);
    exact(value.source, ['counts', 'originalInventory']);
    sameCounts(value.source.counts, options.expected, ['sales', 'paid', 'tradingDays', 'busiest']);
    sameCounts(value.source.originalInventory, options.originalInventory, ['days', 'busiest']);
    exact(value.replay, ['complete', 'cadence', 'counts', 'timing']); need(value.replay.complete === true);
    exact(value.replay.cadence, ['mode', 'factor', 'coveredSeconds']);
    const cadence = value.replay.cadence;
    need(cadence.mode === options.cadence.mode && cadence.factor === options.cadence.factor
      && finite(cadence.coveredSeconds) && cadence.coveredSeconds / cadence.factor < options.replayWindowSeconds);
    const n = options.expected.busiest;
    sameCounts(value.replay.counts, { expected: n, attempted: n, successful: n, failed: 0 }, ['expected', 'attempted', 'successful', 'failed']);
    exact(value.replay.timing, ['elapsedSeconds', 'maxLagSeconds']);
    need(Object.values(value.replay.timing).every(finite) && value.replay.timing.elapsedSeconds < options.replayWindowSeconds);
    exact(value.integrity, ['ok', 'issues']); need(value.integrity.ok === true && value.integrity.issues === 0);
    exact(value.storage, ['copiedDatabaseBytes', 'freshBeforeBytes', 'freshAfterBytes', 'freshGrowthBytes']);
    const s = value.storage;
    need(Object.values(s).every(count) && s.copiedDatabaseBytes > 0 && s.freshBeforeBytes > 0
      && s.freshAfterBytes >= s.freshBeforeBytes && s.freshGrowthBytes === s.freshAfterBytes - s.freshBeforeBytes);
    exact(value.cleanup, ['ownedReplayRoots']); need(value.cleanup.ownedReplayRoots === 0);
    if (options.archive) {
      const a = value.archive;
      exact(a, ['capturedBytes', 'captureSeconds', 'restoreSeconds', 'restored']);
      need(count(a.capturedBytes) && a.capturedBytes > 0
        && [a.captureSeconds, a.restoreSeconds].every(v => finite(v) && v > 0));
      const windowSeconds = options.windowSeconds ?? 7200;
      need(finite(windowSeconds) && windowSeconds > 0 && windowSeconds <= 7200
        && a.captureSeconds + a.restoreSeconds + value.replay.timing.elapsedSeconds < windowSeconds);
      exact(a.restored, ['ok', 'issues', 'sales']);
      need(a.restored.ok === true && a.restored.issues === 0 && a.restored.sales === n);
    }
    return structuredClone(value);
  } catch { fail(); }
}

const label = 'io.waitron.cloud-cost.owner';
function docker(argv, timeout = 15000) {
  const result = spawnSync('docker', argv, { env: { PATH: process.env.PATH, LANG: 'C', TZ: 'UTC' }, encoding: 'utf8',
    timeout, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  need(result.status === 0 && !result.error); return result.stdout.trim();
}
function file(path) {
  const stat = lstatSync(path);
  need(realpathSync(path) === path && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  return stat;
}
function admit(args) {
  assertOwnedRoot(args);
  const { source, root, database, codeRoot, image, signal, windowSeconds, replayWindowSeconds } = args;
  need(signal === undefined || signal instanceof AbortSignal); need(!signal?.aborted);
  need(finite(windowSeconds) && windowSeconds > 0 && windowSeconds <= 7200
    && finite(replayWindowSeconds) && replayWindowSeconds > 0 && replayWindowSeconds <= 3600);
  need(inside(source, database) && file(database));
  need(inside(root, codeRoot) && realpathSync(codeRoot) === codeRoot && lstatSync(codeRoot).isDirectory());
  need(![root, codeRoot].some(p => p.includes(',')) && /^sha256:[a-f0-9]{64}$/.test(image));
  const manifest = JSON.parse(readFileSync(join(codeRoot, 'runtime-manifest.json'), 'utf8'));
  exact(manifest, ['schemaVersion', 'revision', 'sha256']);
  file(join(codeRoot, 'runtime.mjs')); file(join(codeRoot, 'runtime-manifest.json'));
  need(manifest.schemaVersion === 1 && manifest.revision === 'fbadd15785464e59747e697c11048bfbc6e4938f'
    && manifest.sha256 === createHash('sha256').update(readFileSync(join(codeRoot, 'runtime.mjs'))).digest('hex'));
  need(typeof args.locationId === 'string' && args.locationId.length > 0 && args.locationId.length <= 128);
  exact(args.expected, ['sales', 'paid', 'tradingDays', 'busiest']);
  need(Object.values(args.expected).every(v => count(v) && v > 0 && v <= 100000)
    && args.expected.paid <= args.expected.sales && args.expected.busiest <= args.expected.paid);
  exact(args.originalInventory, ['timeZone', 'days', 'busiest']);
  need(['days', 'busiest'].every(k => count(args.originalInventory[k]) && args.originalInventory[k] > 0));
  need(typeof args.originalInventory.timeZone === 'string' && args.originalInventory.timeZone.length <= 128
    && !/^[+-]/.test(args.originalInventory.timeZone));
  new Intl.DateTimeFormat('en', { timeZone: args.originalInventory.timeZone });
  exact(args.cadence, ['mode', 'factor']);
  need(['original', 'accelerated'].includes(args.cadence.mode) && finite(args.cadence.factor) && args.cadence.factor >= 1
    && (args.cadence.mode !== 'original' || args.cadence.factor === 1));
  const config = validateReplayConfig(args.config);
  need(args.archive === undefined || (args.archive === true && args.stream === undefined));
  const stream = args.stream === undefined ? undefined : validateStreamSettings(args.stream, args);
  if (stream) need(file(join(codeRoot, 'litestream')).size <= 100 * 1024 * 1024
    && createHash('sha256').update(readFileSync(join(codeRoot, 'litestream'))).digest('hex') === stream.binarySha256);
  const selected = structuredClone({ source, root, database, codeRoot, image, windowSeconds, replayWindowSeconds,
    journal: args.journal, locationId: args.locationId, expected: args.expected, originalInventory: args.originalInventory,
    cadence: args.cadence, initial: args.initial, config, ...(stream ? { stream } : {}), ...(args.archive ? { archive: true } : {}) });
  return { ...selected, signal };
}

// This controller proves writer admission and an optional stream experiment; complete venue cost remains unqualified.
// The caller owns the prepared runtime/root; only this invocation's added resources are removed.
export async function runIsolatedReplay(input) {
  let args, copy, networkId, containerId, networkName, containerName, stageIdentity, harnessIdentity, timer, abort;
  let admission, isolation, stageRoot, harness;
  try {
    args = admit(input);
    const { root, codeRoot, journal, source, database, image } = args;
    stageRoot = join(root, 'isolated-replay'); harness = join(codeRoot, 'cloud-cost-runner');
    need(!existsSync(stageRoot) && !existsSync(harness) && !existsSync(join(root, 'venue-copy.db')));
    const controller = new AbortController(), deadline = performance.now() + args.windowSeconds * 1000;
    abort = () => controller.abort(); args.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(abort, args.windowSeconds * 1000);
    const remaining = () => { need(!controller.signal.aborted); const ms = Math.ceil(deadline - performance.now()); need(ms > 0); return ms; };
    const command = argv => docker(argv, Math.min(15000, remaining()));
    command(['image', 'inspect', image]);
    record(args, { kind: 'isolated-replay', state: 'intent', path: stageRoot });
    mkdirSync(stageRoot, { mode: 0o700 }); stageIdentity = lstatSync(stageRoot);
    mkdirSync(harness, { mode: 0o700 }); harnessIdentity = lstatSync(harness);
    for (const name of readdirSync(new URL('.', import.meta.url))) if (name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
      copyFileSync(new URL(name, import.meta.url), join(harness, name), constants.COPYFILE_EXCL);
    record(args, { kind: 'isolated-replay', state: 'ready', path: stageRoot, ino: stageIdentity.ino, dev: stageIdentity.dev });
    networkName = 'cloud-cost-replay-' + randomUUID(); containerName = networkName + '-worker';
    const networkQuery = ['network', 'ls', '-q', '--no-trunc', '--filter', 'name=^' + networkName + '$', '--filter', `label=${label}=${journal.token}`];
    need(command(networkQuery) === '');
    record(args, { kind: 'network', state: 'intent', name: networkName });
    try { command(['network', 'create', '--internal', '--label', `${label}=${journal.token}`, networkName]); }
    finally { networkId = docker(networkQuery) || undefined; }
    need(/^[a-f0-9]{64}$/.test(networkId)); record(args, { kind: 'network', state: 'started', id: networkId });
    const containerQuery = ['ps', '-aq', '--no-trunc', '--filter', 'name=^/' + containerName + '$', '--filter', `label=${label}=${journal.token}`];
    need(command(containerQuery) === ''); record(args, { kind: 'container', state: 'intent', name: containerName });
    try {
      command(['create', '--pull=never', '--name', containerName, '--user', `${process.getuid()}:${process.getgid()}`,
        '--network', networkId, '--label', `${label}=${journal.token}`, '--label', 'io.waitron.cloud-cost.role=replay',
        '--dns', '127.0.0.1', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--log-driver', 'none', '--entrypoint', 'node',
        '--mount', `type=bind,src=${codeRoot},dst=/code,readonly`, '--mount', `type=bind,src=${stageRoot},dst=/state`,
        image, '-e', 'setInterval(()=>{},1000)']);
    } finally { containerId = docker(containerQuery) || undefined; }
    need(/^[a-f0-9]{64}$/.test(containerId)); record(args, { kind: 'container', state: 'started', id: containerId });
    command(['start', containerId]);
    const worker = { ...args, stateRoot: stageRoot, networkId, containerId, signal: controller.signal };
    isolation = await proveDockerIsolation({ ...worker, containerIds: [containerId] });
    remaining(); record(args, { kind: 'replay-isolation', state: 'ready' });
    // No original files are mounted in the replay worker; its input is a separate, validated backup.
    copy = await prepareIsolatedPrivateCopy({ source, root, journal, database, image: args.stream?.copyImage ?? image, signal: controller.signal,
      timeoutMs: Math.min(120000, remaining()) });
    remaining(); copyFileSync(copy.database, join(stageRoot, 'input.db'), constants.COPYFILE_EXCL);
    writeFileSync(join(stageRoot, 'config.json'), JSON.stringify({ locationId: args.locationId,
      expected: args.expected, originalInventory: args.originalInventory, cadence: args.cadence,
      windowSeconds: args.replayWindowSeconds, initial: args.initial, config: args.config, ...(args.stream ? { stream: args.stream } : {}),
      ...(args.archive ? { archive: true } : {}) }), { mode: 0o600, flag: 'wx' });
    record(args, { kind: 'replay-worker', state: 'started', id: containerId });
    try {
      await runForegroundContainer({ ...worker, argv: ['node', '/code/cloud-cost-runner/replay-worker.mjs'],
        windowSeconds: Math.min(7200, remaining() / 1000) });
    } catch {
      let stage = 'unknown';
      try {
        assertOwnedRoot(args); const identity = lstatSync(stageRoot);
        need(realpathSync(stageRoot) === stageRoot && identity.ino === stageIdentity.ino && identity.dev === stageIdentity.dev);
        const diagnostic = join(stageRoot, 'worker-failure.json');
        if (existsSync(diagnostic)) {
          const stat = file(diagnostic);
          need(stat.size <= 256 && (stat.mode & 0o7777) === 0o600);
          stage = workerFailureStage(JSON.parse(readFileSync(diagnostic, 'utf8')));
        }
      } catch { stage = 'worker-diagnostic-invalid'; }
      record(args, { kind: 'worker-refusal', state: 'recorded', stage });
      fail();
    }
    containerId = undefined;
    remaining(); need(!args.signal?.aborted);
    const output = join(stageRoot, 'result.json'); need(file(output).size <= (args.stream ? 1024 * 1024 : 16384) && (lstatSync(output).mode & 0o777) === 0o600);
    const result = JSON.parse(readFileSync(output, 'utf8'));
    if (args.stream) {
      const { stream, ...replay } = result;
      admission = { ...validateReplayAdmission(replay, args), stream: validateStreamAdmission(stream,
        { ...args.stream, expectedSales: args.expected.busiest }) };
    } else admission = validateReplayAdmission(result, args);
  } catch { fail(); }
  finally {
    clearTimeout(timer); args?.signal?.removeEventListener('abort', abort);
    if (args) {
      const attempts = [];
      const attempt = async fn => { try { await fn(); } catch { attempts.push(false); } };
      await attempt(async () => {
        if (!containerId) return;
        assertOwnedRoot(args);
        // The foreground supervisor may already have removed this exact worker after a refusal.
        if (docker(['ps', '-aq', '--no-trunc', '--filter', 'id=' + containerId]) === '') return;
        const c = JSON.parse(docker(['inspect', containerId]))[0];
        need(c.Id === containerId && c.Name === '/' + containerName && c.Config.Labels?.[label] === args.journal.token);
        record(args, { kind: 'container', state: 'cleanup-intent', id: containerId });
        docker(['rm', '-f', '-v', containerId]);
        need(docker(['ps', '-aq', '--no-trunc', '--filter', 'id=' + containerId]) === '');
        record(args, { kind: 'container', state: 'removed', id: containerId });
      });
      await attempt(async () => {
        if (!networkId) return;
        assertOwnedRoot(args); const n = JSON.parse(docker(['network', 'inspect', networkId]))[0];
        need(n.Id === networkId && n.Name === networkName && n.Labels?.[label] === args.journal.token);
        record(args, { kind: 'network', state: 'cleanup-intent', id: networkId }); docker(['network', 'rm', networkId]);
        need(docker(['network', 'ls', '-q', '--no-trunc', '--filter', 'id=' + networkId]) === '');
        record(args, { kind: 'network', state: 'removed', id: networkId });
      });
      await attempt(async () => { await copy?.close(); });
      // Preserve private recovery state if an owned worker could not be collected.
      if (attempts.length === 0) for (const [path, identity] of [[stageRoot, stageIdentity], [harness, harnessIdentity]]) {
        if (!identity) continue;
        await attempt(async () => {
          assertOwnedRoot(args); const current = lstatSync(path);
          need(realpathSync(path) === path && current.ino === identity.ino && current.dev === identity.dev);
          record(args, { kind: 'isolated-replay', state: 'cleanup-intent', path }); rmSync(path, { recursive: true });
          need(!existsSync(path)); record(args, { kind: 'isolated-replay', state: 'removed', path });
        });
      }
      if (attempts.length) fail();
    }
  }
  return { costMeasured: false, admission,
    ...(args.stream ? { streamAccounting: summarizeStreamAccounting(admission.stream,
      { ...args.stream, expectedSales: args.expected.busiest }) } : {}),
    isolation: { blockedConnections: isolation.blockedConnections,
    blockedDns: isolation.blockedDns, localControl: isolation.localControl }, cleanup: { workerContainers: 0, networks: 0, privateCopies: 0 } };
}
