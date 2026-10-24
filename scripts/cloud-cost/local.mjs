
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { constants, openSync, closeSync, readSync, fstatSync, lstatSync, realpathSync, existsSync,
  mkdirSync, chmodSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, relative, isAbsolute, posix } from 'node:path';
import { assertOwnedRoot } from './schema.mjs';
import { recordOwnedResource as record } from './owned-journal.mjs';
import { readReplayBills } from './source-bills.mjs';
import { discoverReplayDay } from './source-days.mjs';
export { openFiscalMeasurement } from './fiscal.mjs';
export { openMailMeasurement } from './mail.mjs';
export { openRemoteMeasurement } from './remote.mjs';
export { replayScheduledSales } from './cadence.mjs';
export { prepareReplayDay } from './replay-day.mjs';
export { measureRemoteJourneys } from './remote-journey.mjs';
export { measureRemoteBrowser } from './browser.mjs';
export { replayPrivateDay } from './private-replay.mjs';
export { runLocal } from './run-local.mjs';

const fail = () => { throw new Error('Invalid cloud cost local run'); };
const requireThat = value => { if (!value) fail(); };
const commandFailures = new WeakMap();
function requireCommand(result, context = {}) {
  if (result.status === 0 && !result.error) return;
  const error = new Error('Invalid cloud cost local run');
  const code = result.error?.code;
  const diagnostic = { reason: ['EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EIO', 'ETIMEDOUT', 'ECANCELED'].includes(code) ? code : 'command-exit' };
  if (Number.isSafeInteger(result.status) && result.status >= 0 && result.status <= 255) diagnostic.exitCode = result.status;
  if (['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT'].includes(result.signal)) diagnostic.signal = result.signal;
  Object.assign(diagnostic, context);
  commandFailures.set(error, diagnostic);
  throw error;
}
function startupDiagnostic(stage, error, started) {
  const diagnostic = { stage, reason: 'unclassified', elapsedMs: Math.max(0, Math.round(performance.now() - started)) };
  // Even inspecting a thrown value can throw; diagnostics must not interrupt owned cleanup.
  try {
    const code = Object.getOwnPropertyDescriptor(error ?? {}, 'code')?.value;
    diagnostic.reason = ['EACCES', 'EPERM', 'ENOENT', 'EEXIST', 'ENOSPC', 'EIO', 'ETIMEDOUT', 'ECANCELED'].includes(code) ? code
      : error instanceof SyntaxError ? 'invalid-json'
      : error instanceof Error && ['Invalid cloud cost local run', 'Invalid cloud cost evidence', 'Invalid cloud cost replay configuration'].includes(error.message) ? 'validation' : 'unclassified';
    // Private paths, endpoint credentials and subprocess output never enter the public record.
    Object.assign(diagnostic, commandFailures.get(error));
  } catch { /* The fixed fallback also contains hostile cleanup exceptions. */ }
  return diagnostic;
}
function reportStartupFailure(diagnostic) {
  try { console.error('stack_startup=' + JSON.stringify(diagnostic)); }
  catch { /* Reporting cannot prevent owned-resource cleanup. */ }
}
const inside = (root, path) => { const r = relative(root, path); return r !== '' && r !== '..' && !r.startsWith('../') && !isAbsolute(r); };
const environment = () => ({ PATH: process.env.PATH, LANG: 'C', TZ: 'UTC' });
function owned(args) {
  assertOwnedRoot(args);
  return JSON.parse(readFileSync(args.journal.path, 'utf8'));
}
function canonicalFile(path) {
  requireThat(isAbsolute(path) && realpathSync(path) === path);
  const s = lstatSync(path);
  requireThat(s.isFile() && !s.isSymbolicLink() && s.nlink === 1);
  return s;
}
function removal(args, path, identity, recursive = false) {
  let closed = false;
  return async () => {
    try {
      if (closed) return;
      owned(args);
      requireThat(inside(args.root, path));
      if (existsSync(path)) {
        const s = lstatSync(path);
        requireThat(s.ino === identity.ino && s.dev === identity.dev && !s.isSymbolicLink());
        rmSync(path, { recursive });
      }
      closed = true;
    } catch { fail(); }
  };
}

const copyWorker = `
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { assertOwnedRoot } from ${JSON.stringify(new URL('./schema.mjs', import.meta.url).href)};
const args = JSON.parse(readFileSync(process.argv[1], 'utf8'));
assertOwnedRoot(args);
const reader = new DatabaseSync(args.database, { readOnly: true });
try { reader.exec('PRAGMA query_only=ON'); await backup(reader, args.destination); }
finally { reader.close(); }
`;

function sourceCopyFiles(database) {
  canonicalFile(database);
  // Closing another descriptor in SQLite's process releases its file locks.
  const header = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {openSync,readSync,closeSync,constants} from 'node:fs';
    const fd=openSync(process.argv[1],constants.O_RDONLY|constants.O_NOFOLLOW),h=Buffer.alloc(20);
    try {
      if(readSync(fd,h,0,20,0)!==20 || !h.subarray(0,16).equals(Buffer.from('SQLite format 3\\0'))
        || ![1,2].includes(h[18]) || h[18]!==h[19]) process.exitCode=1;
      else process.stdout.write(String(h[18]));
    } finally {closeSync(fd);}
  `, database], { env: environment(), encoding: 'utf8', timeout: 1500,
    maxBuffer: 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  requireThat(header.status === 0 && !header.error && ['1', '2'].includes(header.stdout));
  const files = [database];
  // A dormant WAL database needs new sidecars; source access must never create them.
  if (header.stdout === '2') for (const suffix of ['-wal', '-shm']) {
    canonicalFile(database + suffix); files.push(database + suffix);
  }
  return files;
}

export async function preparePrivateCopy({ source, database, root, journal, signal, timeoutMs = 30000 }) {
  const args = { source, root, journal }; const destination = join(root, 'venue-copy.db');
  let copy, close, removeConfig;
  try {
    requireThat(!signal?.aborted);
    owned(args); requireThat(inside(source, database)); sourceCopyFiles(database);
    requireThat(!existsSync(destination));
    record(args, { kind: 'database-copy', path: destination, state: 'intent' });
    const fd = openSync(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    const identity = fstatSync(fd); closeSync(fd);
    close = removal(args, destination, identity);
    const config = join(root, `copy-${randomUUID()}.json`);
    writeFileSync(config, JSON.stringify({ ...args, database, destination }), { mode: 0o600, flag: 'wx' });
    removeConfig = removal(args, config, lstatSync(config));
    // A separate child bounds native SQLite work while keeping raw output private.
    await runPrivate(process.execPath, ['--input-type=module', '-e', copyWorker, config],
      { signal, timeoutMs, ownership: args });
    await removeConfig();
    chmodSync(destination, 0o600);
    copy = new DatabaseSync(destination);
    // The selection copy is self-contained; read-only WAL readers leave sidecars after closing.
    copy.exec('PRAGMA journal_mode=DELETE');
    requireThat(copy.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
    copy.close(); copy = null;
    record(args, { kind: 'database-copy', path: destination, state: 'ready', ino: identity.ino, dev: identity.dev });
    return { database: destination, close };
  } catch {
    copy?.close();
    await close?.();
    fail();
  } finally { await removeConfig?.(); }
}

function openPrivateSelection({ source, root, journal, database, locationId }) {
  let db, fd;
  try {
    const value = owned({ source, root, journal });
    requireThat(typeof locationId === 'string' && locationId.length > 0 && locationId.length <= 128);
    requireThat(inside(root, database));
    const identity = canonicalFile(database);
    requireThat((identity.mode & 0o777) === 0o600);
    requireThat(value.localResources?.some(entry => entry.kind === 'database-copy' && entry.state === 'ready'
      && entry.path === database && entry.ino === identity.ino && entry.dev === identity.dev));
    fd = openSync(database, constants.O_RDONLY | constants.O_NOFOLLOW);
    const header = Buffer.alloc(20);
    requireThat(readSync(fd, header, 0, header.length, 0) === header.length);
    // A read-only WAL connection can create sidecars; selection copies must be self-contained.
    requireThat(header.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')) && header[18] === 1 && header[19] === 1);
    closeSync(fd); fd = undefined;
    db = new DatabaseSync(database, { readOnly: true });
    db.exec('PRAGMA query_only=ON; BEGIN');
    return db;
  } catch { db?.close(); fail(); }
  finally { if (fd !== undefined) closeSync(fd); }
}

function readReplayClock(db, locationId) {
  const location = db.prepare('SELECT time_zone, day_cutover FROM locations WHERE id=?').get(locationId);
  requireThat(location && typeof location.time_zone === 'string' && location.time_zone.length <= 128);
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: location.time_zone }).resolvedOptions().timeZone;
  requireThat(!/^[+-]/.test(zone));
  const cutover = value => {
    requireThat(typeof value === 'string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]:00$/.test(value));
    return value.slice(0, 5);
  };
  const dayCutover = cutover(location.day_cutover);
  const rows = db.prepare(`SELECT effective_business_day, day_cutover FROM location_day_cutover_changes
    WHERE location_id=? ORDER BY effective_business_day LIMIT 10001`).all(locationId);
  requireThat(rows.length <= 10000);
  let previous = '';
  const cutoverChanges = rows.map(row => {
    const day = row.effective_business_day;
    requireThat(typeof day === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)
      && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day && day > previous);
    previous = day;
    return { effectiveBusinessDay: day, dayCutover: cutover(row.day_cutover) };
  });
  return { timeZone: location.time_zone, dayCutover, cutoverChanges };
}

// This clock is private input to Waitron's businessDayBounds, never a public cost receipt.
export function readPrivateReplayClock(args) {
  let db;
  try {
    db = openPrivateSelection(args);
    return readReplayClock(db, args.locationId);
  } catch { fail(); }
  finally { db?.close(); }
}

// Reconcile counts before releasing a private trading-day selection to the replay controller.
export function discoverPrivateReplayDay(args) {
  let db;
  try {
    db = openPrivateSelection(args);
    return discoverReplayDay(db, { ...args, clock: readReplayClock(db, args.locationId) });
  } catch { fail(); }
  finally { db?.close(); }
}

// Sale objects retain private data and can only feed the isolated replay writer.
export function readPrivateReplayBills(args) {
  let db;
  try {
    db = openPrivateSelection(args);
    return readReplayBills(db, args);
  } catch { fail(); }
  finally { db?.close(); }
}

function git(codeRoot, argv, input) {
  const result = spawnSync('git', ['-C', codeRoot, ...argv], { env: environment(), input,
    encoding: null, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  requireThat(result.status === 0 && !result.error);
  return result.stdout;
}
const sourceFile = path => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
  && !path.split('/').some((p, i) => p.startsWith('.') || ['node_modules', 'dist', 'build', 'runtime'].includes(p)
    || (p === 'credentials' && !(i === 1 && path.startsWith('packages/credentials/'))))
  && (['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json'].includes(path)
    || /^packages\/[a-z0-9-]+\/drizzle\/(?:[0-9]{4}_[a-z0-9_]+\.sql|meta\/_journal\.json)$/.test(path)
    || path === 'packages/migrations/migrations.manifest.json'
    || (/^(packages|apps|tooling)\//.test(path) && ((/\/(src|scripts|migrations)\//.test(path) && /\.(ts|tsx|js|mjs|cjs|sql|css|html)$/.test(path))
      || /\/(package|tsconfig(?:\.[a-z]+)?)\.json$/.test(path))));

export async function prepareCodeCopy({ source, codeRoot, root, journal }) {
  const args = { source, root, journal }; const destination = join(root, 'code-copy'); let close;
  try {
    const journalValue = owned(args);
    requireThat(journalValue.codeSource === codeRoot);
    requireThat(isAbsolute(codeRoot) && realpathSync(codeRoot) === codeRoot && !inside(root, codeRoot) && !inside(codeRoot, root) && codeRoot !== root);
    requireThat(!existsSync(destination));
    const revision = git(codeRoot, ['rev-parse', 'HEAD']).toString().trim();
    requireThat(/^[0-9a-f]{40}$/.test(revision));
    const entries = git(codeRoot, ['ls-tree', '-rz', '--full-tree', revision]).toString().split('\0').filter(Boolean);
    const paths = entries.flatMap(entry => {
      const [metadata, path] = entry.split('\t');
      if (!sourceFile(path)) return [];
      requireThat(/^100(644|755) blob [a-f0-9]{40}$/.test(metadata) && !path.split('/').includes('..'));
      return [path];
    });
    requireThat(paths.includes('package.json') && paths.length > 1);
    record(args, { kind: 'code-copy', path: destination, state: 'intent', revision });
    mkdirSync(destination, { mode: 0o700 }); const identity = lstatSync(destination);
    close = removal(args, destination, identity, true);
    record(args, { kind: 'code-archive-processes', state: 'intent' });
    const archive = spawn('git', ['-C', codeRoot, 'archive', '--format=tar', revision, '--', ...paths],
      { env: environment(), stdio: ['ignore', 'pipe', 'ignore'] });
    // Read archive padding through EOF so a full pipe cannot report a premature close.
    const extract = spawn('tar', ['--ignore-zeros', '-xf', '-', '-C', destination],
      { env: environment(), stdio: ['pipe', 'ignore', 'ignore'] });
    const exited = child => new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', code => resolve(code));
    });
    const archiveExit = exited(archive); const extractExit = exited(extract);
    try {
      record(args, { kind: 'code-archive-processes', state: 'started', pids: [archive.pid, extract.pid] });
      const [a, b] = await Promise.all([archiveExit, extractExit, pipeline(archive.stdout, extract.stdin)]);
      requireThat(a === 0 && b === 0);
    } finally {
      for (const child of [archive, extract]) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await Promise.allSettled([archiveExit, extractExit]);
    }
    owned(args);
    record(args, { kind: 'code-copy', path: destination, state: 'ready', revision, ino: identity.ino, dev: identity.dev });
    return { codeRoot: destination, revision, close };
  } catch { await close?.(); fail(); }
}

export async function runPrivate(command, argv, options = {}) {
  return runPrivateProcess(command, argv, options, 120000);
}

async function runPrivateProcess(command, argv, { signal, cwd, ownership, timeoutMs = 120000 }, maximumMs) {
  let child, closed, timer, deadline, aborted = false;
  const abort = () => {
    if (aborted) return;
    aborted = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1000);
    }
  };
  try {
    requireThat(isAbsolute(command) && Array.isArray(argv) && argv.every(v => typeof v === 'string'));
    requireThat(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= maximumMs);
    requireThat(!signal?.aborted);
    if (ownership) record(ownership, { kind: 'process', state: 'intent' });
    child = spawn(command, argv, { env: environment(), cwd, stdio: ['ignore', 'ignore', 'ignore'] });
    let spawnError;
    closed = new Promise(resolve => {
      child.once('error', error => { spawnError = error; }); child.once('close', code => resolve(code));
    });
    if (ownership) record(ownership, { kind: 'process', state: 'started', pid: child.pid });
    signal?.addEventListener('abort', abort, { once: true });
    deadline = setTimeout(abort, timeoutMs);
    if (signal?.aborted) abort();
    const exitCode = await closed;
    requireCommand({ status: exitCode, error: aborted ? { code: signal?.aborted ? 'ECANCELED' : 'ETIMEDOUT' } : spawnError, signal: child.signalCode });
    return { exitCode };
  } catch (error) { if (commandFailures.has(error)) throw error; fail(); }
  finally {
    signal?.removeEventListener('abort', abort); clearTimeout(timer); clearTimeout(deadline);
    if (child && child.exitCode === null && child.signalCode === null && child.pid) child.kill('SIGKILL');
    await closed;
  }
}

export function validateIsolationInspect({ source, root, journal, codeRoot, stateRoot, network, containers }) {
  try {
    owned({ source, root, journal });
    requireThat(inside(root, codeRoot) && inside(root, stateRoot) && !inside(codeRoot, stateRoot) && codeRoot !== stateRoot);
    requireThat(network.Internal === true && network.Driver === 'bridge' && /^[a-f0-9]{64}$/.test(network.Id));
    requireThat(network.Labels?.['io.waitron.cloud-cost.owner'] === journal.token);
    requireThat(Array.isArray(containers) && containers.length > 0);
    for (const c of containers) {
      requireThat(/^[a-f0-9]{64}$/.test(c.Id) && c.Config.Labels?.['io.waitron.cloud-cost.owner'] === journal.token);
      const h = c.HostConfig;
      requireThat(h.Privileged === false && (!h.ExtraHosts || h.ExtraHosts.length === 0));
      requireThat(h.NetworkMode === network.Name || h.NetworkMode === network.Id);
      requireThat(h.PidMode === '' && ['', 'private'].includes(h.IpcMode));
      requireThat(!h.Devices || h.Devices.length === 0);
      requireThat(!h.VolumesFrom || h.VolumesFrom.length === 0);
      requireThat(!h.CapAdd || h.CapAdd.length === 0 || (h.CapAdd.every(v => v === 'NET_ADMIN')
        && ['gateway', 'peer'].includes(c.Config.Labels['io.waitron.cloud-cost.role'])));
      requireThat(Array.isArray(h.Dns) && h.Dns.length === 1 && h.Dns[0] === '127.0.0.1');
      const networks = c.NetworkSettings.Networks;
      requireThat(Object.keys(networks).length === 1 && networks[network.Name]?.NetworkID === network.Id);
      for (const bindings of Object.values(c.NetworkSettings.Ports ?? {}))
        for (const port of bindings ?? []) requireThat(port.HostIp === '127.0.0.1'
          && /^[0-9]+$/.test(port.HostPort) && Number(port.HostPort) > 0 && Number(port.HostPort) <= 65535);
      const safeEnvironment = ['PATH', 'LANG', 'TZ', 'NODE_VERSION', 'YARN_VERSION', 'NODE_ENV', 'WAITRON_ENV', 'WAITRON_STATE_DIR'];
      requireThat(Array.isArray(c.Config.Env) && c.Config.Env.every(v => typeof v === 'string'
        && safeEnvironment.includes(v.slice(0, v.indexOf('=')))));
      requireThat(Array.isArray(c.Mounts));
      for (const m of c.Mounts) {
        requireThat(m.Type === 'bind' && realpathSync(m.Source) === m.Source);
        const code = m.Source === codeRoot || inside(codeRoot, m.Source);
        const state = m.Source === stateRoot || inside(stateRoot, m.Source);
        requireThat((code && m.RW === false) || (state && typeof m.RW === 'boolean'));
        const target = code ? '/code' : '/state';
        requireThat(typeof m.Destination === 'string' && posix.resolve(m.Destination) === m.Destination
          && (m.Destination === target || m.Destination.startsWith(target + '/')));
      }
    }
    return { isolated: true, containers: containers.length };
  } catch { fail(); }
}

const outboundCanary = `
const net = require('node:net'); const dns = require('node:dns').promises;
const connect = (host, port) => new Promise(resolve => {
  const socket = net.connect({host, port}); let finished = false;
  const done = ok => { if (!finished) { finished = true; clearTimeout(timer); socket.destroy(); resolve(ok); } };
  const timer = setTimeout(() => done(false), 2500);
  socket.once('connect', () => done(true)); socket.once('error', () => done(false));
});
const lookup = host => new Promise(resolve => {
  const timer = setTimeout(() => resolve(false), 2500);
  dns.lookup(host).then(() => {clearTimeout(timer); resolve(true);}, () => {clearTimeout(timer); resolve(false);});
});
(async () => {
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const localControl = await connect('127.0.0.1', server.address().port);
  await new Promise(resolve => server.close(resolve));
  const connections = await Promise.all([connect('1.1.1.1',443),connect('169.254.169.254',80),connect('host.docker.internal',443)]);
  const lookups = await Promise.all([lookup('example.com'),lookup('aws.amazon.com')]);
  const result = {blockedConnections:connections.filter(v=>!v).length,blockedDns:lookups.filter(v=>!v).length,localControl};
  process.stdout.write(JSON.stringify(result));
  process.exit(localControl && result.blockedConnections === 3 && result.blockedDns === 2 ? 0 : 1);
})().catch(()=>process.exit(1));`;

function gatewayRuntimeFailure(args) {
  let fd;
  try {
    requireThat(args && inside(args.root, args.stateRoot) && realpathSync(args.stateRoot) === args.stateRoot);
    fd = openSync(join(args.stateRoot, 'gateway-failure.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    requireThat(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600 && stat.size <= 1024);
    const buffer = Buffer.alloc(1025), length = readSync(fd, buffer, 0, buffer.length, 0);
    requireThat(length <= 1024);
    const value = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    requireThat(value && value.stage === 'binary' && ['dns-resolution', 'bind', 'tls', 'child-exit', 'spawn', 'signal'].includes(value.reason)
      && Object.keys(value).every(key => ['stage', 'reason', 'exitCode', 'signal', 'code'].includes(key))
      && (value.exitCode === undefined || Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255)
      && (value.signal === undefined || ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT'].includes(value.signal))
      && (value.code === undefined || ['ENOENT', 'EACCES', 'EPERM', 'EIO'].includes(value.code)));
    return value;
  } catch { /* Missing or invalid evidence cannot replace the original command refusal. */ }
  finally { if (fd !== undefined) closeSync(fd); }
}
function failedContainerState(container, ownership) {
  const role = container.Config.Labels['io.waitron.cloud-cost.role'];
  const diagnostic = { role: ['postgres', 's3', 'mailpit', 'waitron', 'fiscal', 'gateway'].includes(role) ? role : 'unknown', inspection: 'unavailable' };
  // Inspect the validated immutable ID before cleanup; raw state can contain private runtime errors.
  try {
    const result = spawnSync('docker', ['inspect', '--format', '{{json .State}}', container.Id], {
      env: environment(), encoding: 'utf8', timeout: 1500, maxBuffer: 8192, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error?.code === 'ETIMEDOUT') return { ...diagnostic, inspection: 'timeout' };
    if (result.status !== 0 || result.error) return { ...diagnostic,
      inspection: /No such (?:container|object)/.test(result.stderr ?? '') ? 'missing' : 'unavailable' };
    const state = JSON.parse(result.stdout);
    if (!['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(state?.Status)
      || !['Running', 'OOMKilled', 'Dead', 'Restarting'].every(key => typeof state[key] === 'boolean')
      || !Number.isInteger(state.ExitCode) || state.ExitCode < 0 || state.ExitCode > 255) return diagnostic;
    const runtime = diagnostic.role === 'gateway' ? gatewayRuntimeFailure(ownership) : undefined;
    return { role: diagnostic.role, status: state.Status, running: state.Running, exitCode: state.ExitCode,
      oomKilled: state.OOMKilled, dead: state.Dead, restarting: state.Restarting, ...(runtime ? { runtime } : {}) };
  } catch { return diagnostic; }
}

function dockerRead(argv, container, ownership) {
  const result = spawnSync('docker', argv, { env: environment(), encoding: 'utf8',
    timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0 || result.error) {
    // Command output may contain credentials; retain only the known probe and bounded result fields.
    const canary = argv[0] === 'exec' && argv[2] === 'node' && argv[3] === '-e' && argv[4] === outboundCanary;
    const context = { command: canary ? 'outbound-canary' : argv[0] === 'exec' ? 'readiness-check'
        : argv[0] === 'network' ? 'network-inspect' : 'container-inspect',
      argv: canary ? ['exec', '<container>', 'node', '-e', '<outbound-canary>']
        : argv[0] === 'exec' ? ['exec', '<container>', 'node', '<script>', 'check']
        : argv[0] === 'network' ? ['network', 'inspect', '<network>'] : ['inspect', '<containers>'],
      stderr: /Cannot find module|SyntaxError:|ReferenceError:|TypeError:/.test(result.stderr ?? '') ? 'node-runtime'
        : /No such container|is not running/.test(result.stderr ?? '') ? 'container-state'
        : /Cannot connect to the Docker daemon|Error response from daemon/.test(result.stderr ?? '') ? 'docker-daemon' : 'unclassified' };
    if (canary) {
      try {
        const value = JSON.parse(result.stdout);
        if (Number.isInteger(value.blockedConnections) && value.blockedConnections >= 0 && value.blockedConnections <= 3
          && Number.isInteger(value.blockedDns) && value.blockedDns >= 0 && value.blockedDns <= 2 && typeof value.localControl === 'boolean')
          context.canary = { blockedConnections: value.blockedConnections, blockedDns: value.blockedDns, localControl: value.localControl };
      } catch { /* Unknown command output stays private. */ }
    }
    if (canary && container) context.container = failedContainerState(container, ownership);
    requireCommand(result, context);
  }
  return JSON.parse(result.stdout);
}
export async function proveDockerIsolation(args) {
  try {
    owned(args);
    requireThat(/^[a-f0-9]{64}$/.test(args.networkId) && Array.isArray(args.containerIds) && args.containerIds.length > 0
      && args.containerIds.every(id => /^[a-f0-9]{64}$/.test(id)));
    const network = dockerRead(['network', 'inspect', args.networkId])[0];
    const containers = dockerRead(['inspect', ...args.containerIds]);
    const validated = validateIsolationInspect({ ...args, network, containers });
    let blockedConnections = 0, blockedDns = 0;
    for (const c of containers) {
      // Refuse a runtime without Node rather than infer its outbound behavior from another image.
      requireThat(c.Config.Env.some(v => v.startsWith('NODE_VERSION=')));
      record(args, { kind: 'outbound-proof', state: 'intent', containerIds: [c.Id] });
      const result = dockerRead(['exec', c.Id, 'node', '-e', outboundCanary], c, args);
      requireThat(Object.keys(result).length === 3 && result.blockedConnections === 3 && result.blockedDns === 2 && result.localControl === true);
      blockedConnections += result.blockedConnections; blockedDns += result.blockedDns;
      record(args, { kind: 'outbound-proof', state: 'ready', containerIds: [c.Id] });
    }
    // Re-read after the canary; a second network attached during the check invalidates it.
    validateIsolationInspect({ ...args, network: dockerRead(['network', 'inspect', args.networkId])[0],
      containers: dockerRead(['inspect', ...args.containerIds]) });
    return { ...validated, blockedConnections, blockedDns, localControl: true };
  } catch (error) { if (commandFailures.has(error)) throw error; fail(); }
}

export function prepareIsolatedStack(args) {
  try {
    const { source, root, journal, codeRoot, stateRoot, image } = args;
    owned({ source, root, journal });
    requireThat(/^sha256:[a-f0-9]{64}$/.test(image));
    for (const path of [codeRoot, stateRoot]) requireThat(isAbsolute(path) && inside(root, path)
      && realpathSync(path) === path && lstatSync(path).isDirectory());
    requireThat(codeRoot !== stateRoot && !inside(codeRoot, stateRoot) && !inside(stateRoot, codeRoot));
    const project = `cloud-cost-${randomUUID()}`;
    const plan = JSON.parse(readFileSync(new URL('./isolated.compose.yaml', import.meta.url), 'utf8'));
    const owner = { 'io.waitron.cloud-cost.owner': journal.token };
    plan.name = project;
    plan.networks.isolated.name = project;
    plan.networks.isolated.labels = owner;
    for (const [role, service] of Object.entries(plan.services)) {
      service.image = image;
      service.user = `${process.getuid()}:${process.getgid()}`;
      service.container_name = `${project}-${role}`;
      service.labels = { ...owner, 'io.waitron.cloud-cost.role': role };
      service.volumes = [{ type: 'bind', source: codeRoot, target: '/code', read_only: true },
        { type: 'bind', source: stateRoot, target: '/state', read_only: false }];
    }
    const file = join(root, `${project}.json`);
    record(args, { kind: 'compose-plan', state: 'intent', project, path: file });
    writeFileSync(file, JSON.stringify(plan), { flag: 'wx', mode: 0o600 });
    record(args, { kind: 'compose-plan', state: 'ready', project, path: file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
    return { project, file };
  } catch { fail(); }
}

function dockerCommand(argv, timeout = 15000) {
  const result = spawnSync('docker', argv, { env: environment(), encoding: 'utf8', timeout,
    maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  requireCommand(result);
  return result.stdout.trim();
}

const isolatedCopyWorker = `
import { DatabaseSync, backup } from 'node:sqlite';
import { openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
const source = '/source/venue.db';
const files = JSON.parse(process.argv[1]);
let sourceWritesBlocked = 0;
for (const suffix of files) {
  let fd;
  try { fd = openSync(source + suffix, 'r+'); }
  catch (error) { if (error.code !== 'EROFS') throw error; sourceWritesBlocked++; }
  finally { if (fd !== undefined) closeSync(fd); }
}
if (sourceWritesBlocked !== files.length) throw Error();
let sourceDirectoryBlocked = false;
try { writeFileSync('/source/new-sidecar', '', { flag: 'wx' }); }
catch (error) { if (error.code !== 'EROFS') throw error; sourceDirectoryBlocked = true; }
if (!sourceDirectoryBlocked) throw Error();
writeFileSync('/copy/control', 'control', { flag: 'wx', mode: 0o600 });
unlinkSync('/copy/control');
const reader = new DatabaseSync(source, { readOnly: true });
try { reader.exec('PRAGMA query_only=ON'); await backup(reader, '/copy/venue-copy.db'); }
finally { reader.close(); }
const copy = new DatabaseSync('/copy/venue-copy.db');
try {
  copy.exec('PRAGMA journal_mode=DELETE');
  if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error();
} finally { copy.close(); }
writeFileSync('/copy/proof.json', JSON.stringify({sourceWritesBlocked,sourceDirectoryBlocked,localControl:true}), {flag:'wx',mode:0o600});
`;

export function validateSourceCopyInspect({ container: c, id, name, image, command, mounts, ...args }) {
  try {
    owned(args);
    const h = c.HostConfig;
    requireThat(c.Id === id && c.Name === '/' + name && c.Config.Labels?.['io.waitron.cloud-cost.owner'] === args.journal.token
      && c.Config.Image === image && c.Config.User === `${process.getuid()}:${process.getgid()}`
      && JSON.stringify(c.Config.Entrypoint) === '["node"]' && JSON.stringify(c.Config.Cmd) === JSON.stringify(command));
    requireThat(h.NetworkMode === 'none' && h.ReadonlyRootfs === true && h.Privileged === false
      && h.CapDrop?.includes('ALL') && !h.CapAdd?.length && h.SecurityOpt?.includes('no-new-privileges:true')
      && h.LogConfig.Type === 'none' && h.Dns?.length === 1 && h.Dns[0] === '127.0.0.1'
      && !h.ExtraHosts?.length && !h.Devices?.length && !h.VolumesFrom?.length
      && h.PidMode === '' && ['', 'private'].includes(h.IpcMode)
      && !Object.keys(h.PortBindings ?? {}).length && !Object.keys(h.Tmpfs ?? {}).length);
    requireThat(c.Config.Env.every(v => ['PATH', 'LANG', 'TZ', 'NODE_VERSION', 'YARN_VERSION'].includes(v.split('=')[0])));
    requireThat(c.Mounts.length === mounts.length && c.Mounts.every(m => m.Type === 'bind'
      && mounts.some(expected => m.Source === expected.Source && m.Destination === expected.Destination && m.RW === expected.RW)));
  } catch { fail(); }
}

// Source access runs with individual read-only mounts, never a mount of its directory.
export async function prepareIsolatedPrivateCopy({ source, database, root, journal, image, signal, timeoutMs = 30000 }) {
  const args = { source, root, journal }, destination = join(root, 'venue-copy.db');
  let close, removeStage;
  const containers = new Map();
  const label = 'io.waitron.cloud-cost.owner';
  const cleanupContainers = () => {
    if (containers.size === 0) return;
    owned(args);
    for (const [name, id] of containers) {
      const rows = dockerRead(['inspect', id]);
      requireThat(rows.length === 1 && rows[0].Id === id && rows[0].Name === '/' + name
        && rows[0].Config.Labels?.[label] === journal.token);
      record(args, { kind: 'source-copy-container', state: 'cleanup-intent', id });
      dockerCommand(['rm', '-f', '-v', id]); containers.delete(name);
      requireThat(dockerCommand(['ps', '-aq', '--no-trunc', '--filter', 'id=' + id]) === '');
      record(args, { kind: 'source-copy-container', state: 'removed', id });
    }
  };
  const create = (command, mounts) => {
    requireThat(!signal?.aborted);
    const name = 'cloud-cost-copy-' + randomUUID();
    requireThat(dockerCommand(['ps', '-aq', '--filter', 'name=^/' + name + '$']) === '');
    record(args, { kind: 'source-copy-container', state: 'intent', name });
    let id;
    try {
      id = dockerCommand(['create', '--pull=never', '--name', name, '--label', `${label}=${journal.token}`,
        '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
        '--dns', '127.0.0.1', '--log-driver', 'none', '--user', `${process.getuid()}:${process.getgid()}`,
        '--entrypoint', 'node', ...mounts.flatMap(m => ['--mount', `type=bind,src=${m.Source},dst=${m.Destination}${m.RW ? '' : ',readonly'}`]),
        image, ...command]);
    } finally {
      // The exact fresh name and owner label recover an ambiguous create reply.
      const found = dockerCommand(['ps', '-aq', '--no-trunc', '--filter', 'name=^/' + name + '$',
        '--filter', `label=${label}=${journal.token}`]);
      if (found) { requireThat(/^[a-f0-9]{64}$/.test(found)); containers.set(name, found); }
    }
    requireThat(/^[a-f0-9]{64}$/.test(id) && containers.get(name) === id);
    record(args, { kind: 'source-copy-container', state: 'created', id });
    validateSourceCopyInspect({ ...args, container: dockerRead(['inspect', id])[0], id, name, image, command, mounts });
    return id;
  };
  try {
    owned(args);
    requireThat(!signal?.aborted && /^sha256:[a-f0-9]{64}$/.test(image)
      && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000);
    requireThat(inside(source, database) && !database.includes(',') && !root.includes(','));
    const files = sourceCopyFiles(database);
    requireThat(!existsSync(destination));
    // Prove the same image can run locally but cannot connect out before mounting data.
    const probe = create(['-e', outboundCanary], []);
    const result = JSON.parse(dockerCommand(['start', '--attach', probe], 15000));
    requireThat(result.localControl === true && result.blockedConnections === 3 && result.blockedDns === 2
      && dockerRead(['inspect', probe])[0].State.ExitCode === 0);
    cleanupContainers();
    requireThat(!signal?.aborted);
    const stage = join(root, 'source-copy-' + randomUUID());
    record(args, { kind: 'source-copy-stage', state: 'intent', path: stage });
    mkdirSync(stage, { mode: 0o700 }); removeStage = removal(args, stage, lstatSync(stage), true);
    record(args, { kind: 'database-copy', path: destination, state: 'intent' });
    const fd = openSync(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    const identity = fstatSync(fd); closeSync(fd); close = removal(args, destination, identity);
    const suffixes = files.map(path => path.slice(database.length));
    const mounts = files.map((path, i) => ({ Source: path, Destination: '/source/venue.db' + suffixes[i], RW: false }));
    mounts.push({ Source: stage, Destination: '/copy', RW: true });
    const worker = create(['--input-type=module', '-e', isolatedCopyWorker, JSON.stringify(suffixes)], mounts);
    // Use the resolved executable with runPrivate so cancellation reaps the attached client.
    const executable = spawnSync('/usr/bin/which', ['docker'], { env: environment(), encoding: 'utf8' });
    requireThat(executable.status === 0 && isAbsolute(executable.stdout.trim()));
    await runPrivate(executable.stdout.trim(), ['start', '--attach', worker], { signal, timeoutMs, ownership: args });
    requireThat(dockerRead(['inspect', worker])[0].State.ExitCode === 0);
    const proof = JSON.parse(readFileSync(join(stage, 'proof.json'), 'utf8'));
    requireThat(Object.keys(proof).length === 3 && proof.sourceWritesBlocked === files.length
      && proof.sourceDirectoryBlocked === true && proof.localControl === true);
    copyFileSync(join(stage, 'venue-copy.db'), destination);
    chmodSync(destination, 0o600);
    cleanupContainers(); await removeStage(); removeStage = undefined;
    record(args, { kind: 'source-copy-isolation', state: 'ready', checks: {
      networkBlocked: true, sourceWritesBlocked: files.length, sourceDirectoryBlocked: true, localControl: true } });
    record(args, { kind: 'database-copy', path: destination, state: 'ready', ino: identity.ino, dev: identity.dev });
    return { database: destination, close };
  } catch { await close?.(); fail(); }
  finally { cleanupContainers(); await removeStage?.(); }
}

export async function startIsolatedStack(args) {
  let close, abort, stage = 'ownership';
  const started = performance.now();
  try {
    const { root, journal, codeRoot, stateRoot, image, prepared, signal } = args;
    const value = owned(args);
    if (signal?.aborted) {
      stage = 'cancellation';
      requireCommand({ status: null, error: { code: 'ECANCELED' } });
    }
    stage = 'plan';
    requireThat(prepared && inside(root, prepared.file)); canonicalFile(prepared.file);
    const entry = value.localResources?.find(v => v.kind === 'compose-plan' && v.state === 'ready'
      && v.path === prepared.file && v.project === prepared.project);
    requireThat(entry && entry.sha256 === createHash('sha256').update(readFileSync(prepared.file)).digest('hex'));
    const plan = JSON.parse(readFileSync(prepared.file, 'utf8'));
    requireThat(plan.name === prepared.project && Object.values(plan.services).every(v => v.image === image
      && v.volumes[0].source === codeRoot && v.volumes[1].source === stateRoot));
    stage = 'configuration';
    const configFile = join(stateRoot, 'replay-config.json');
    requireThat((canonicalFile(configFile).mode & 0o777) === 0o600);
    const { validateReplayConfig } = await import('./waitron-adapter.mjs');
    const privateConfig = JSON.parse(readFileSync(configFile, 'utf8'));
    requireThat(Object.keys(privateConfig).sort().join(',') === 'config,initial');
    const replayConfig = validateReplayConfig(privateConfig.config);
    // Every endpoint must name the service this stack actually starts.
    for (const [key, host, port] of [['postgres', 'postgres', '5432'], ['s3', 's3', '8333'],
      ['smtp', 'mailpit', '1025'], ['fiscal', 'fiscal', '8080'], ['gateway', 'gateway', '8443']]) {
      const endpoint = new URL(replayConfig.localEndpoints[key]);
      requireThat(endpoint.hostname === host && endpoint.port === port
        && (key !== 'postgres' || endpoint.pathname === '/postgres'));
    }
    for (const name of ['gateway-key.pem', 'gateway-cert.pem', 'gateway.pem'])
      requireThat(!existsSync(join(stateRoot, name)));
    stage = 'runtime-files';
    for (const [from, to] of [['stack-runtime.mjs', 'cost-stack-runtime.mjs'], ['waitron-adapter.mjs', 'cost-waitron-adapter.mjs'], ['meter.mjs', 'meter.mjs']])
      copyFileSync(new URL(from, import.meta.url), join(codeRoot, to), constants.COPYFILE_EXCL);
    stage = 'certificate';
    await runPrivate('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=gateway', '-addext', 'subjectAltName=DNS:gateway', '-keyout', join(stateRoot, 'gateway-key.pem'),
      '-out', join(stateRoot, 'gateway-cert.pem')], { ownership: args, timeoutMs: 10000, signal });
    writeFileSync(join(stateRoot, 'gateway.pem'), readFileSync(join(stateRoot, 'gateway-cert.pem'))
      + readFileSync(join(stateRoot, 'gateway-key.pem')), { mode: 0o600, flag: 'wx' });
    const project = prepared.project;
    const filters = ['--filter', `label=io.waitron.cloud-cost.owner=${journal.token}`, '--filter', `label=com.docker.compose.project=${project}`];
    const discover = () => {
      const ids = dockerCommand(['ps', '-aq', ...filters]).split('\n').filter(Boolean);
      const networks = dockerCommand(['network', 'ls', '-q', ...filters]).split('\n').filter(Boolean);
      const containers = ids.length ? dockerRead(['inspect', ...ids]) : [];
      const networkRows = networks.length ? dockerRead(['network', 'inspect', ...networks]) : [];
      for (const c of containers) requireThat(c.Config.Labels['io.waitron.cloud-cost.owner'] === journal.token
        && c.Config.Labels['com.docker.compose.project'] === project
        && c.Name === '/' + plan.services[c.Config.Labels['io.waitron.cloud-cost.role']]?.container_name);
      for (const n of networkRows) requireThat(n.Labels['io.waitron.cloud-cost.owner'] === journal.token && n.Name === project);
      return { containers, networks: networkRows };
    };
    // Matching labels alone do not establish that this invocation created a resource.
    stage = 'preexisting-resources';
    const before = discover();
    requireThat(before.containers.length === 0 && before.networks.length === 0);
    let closed = false;
    close = async () => {
      if (closed) return;
      owned(args);
      const current = discover();
      for (const c of current.containers) {
        record(args, { kind: 'container', state: 'cleanup-intent', id: c.Id });
        dockerCommand(['rm', '-f', '-v', c.Id]);
      }
      for (const n of current.networks) {
        record(args, { kind: 'network', state: 'cleanup-intent', id: n.Id });
        dockerCommand(['network', 'rm', n.Id]);
      }
      const remaining = discover();
      requireThat(remaining.containers.length === 0 && remaining.networks.length === 0);
      record(args, { kind: 'stack', state: 'removed', project });
      signal?.removeEventListener('abort', abort);
      closed = true;
    };
    // Intent precedes Compose so a lost create reply can be reconciled by exact labels and names.
    stage = 'compose-up';
    record(args, { kind: 'stack', state: 'intent', project });
    dockerCommand(['compose', '-f', prepared.file, 'up', '--detach', '--no-build', '--pull', 'never'], 120000);
    stage = 'created-resources';
    const current = discover();
    requireThat(current.containers.length === 6 && current.networks.length === 1);
    for (const c of current.containers) record(args, { kind: 'container', state: 'started', id: c.Id });
    record(args, { kind: 'network', state: 'started', id: current.networks[0].Id });
    const networkId = current.networks[0].Id, containerIds = current.containers.map(c => c.Id);
    stage = 'container-policy';
    for (const c of current.containers) requireThat(c.HostConfig.ReadonlyRootfs === true
      && c.HostConfig.CapDrop?.includes('ALL') && c.HostConfig.LogConfig.Type === 'none'
      && c.Config.Image === image && c.Config.User === `${process.getuid()}:${process.getgid()}`);
    stage = 'isolation';
    const isolation = await proveDockerIsolation({ ...args, networkId, containerIds });
    stage = 'readiness';
    const waitron = current.containers.find(c => c.Config.Labels['io.waitron.cloud-cost.role'] === 'waitron');
    let ready;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      requireThat(!signal?.aborted);
      ready = dockerRead(['exec', waitron.Id, 'node', '/code/cost-stack-runtime.mjs', 'check']);
      requireThat(Object.keys(ready).length === 6 && Object.values(ready).every(v => typeof v === 'boolean'));
      if (Object.values(ready).every(v => v)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    requireThat(Object.values(ready).every(v => v));
    stage = 'cancellation-handoff';
    abort = () => { close().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) fail();
    return { ready, isolation, networkId, containerIds, close };
  } catch (error) {
    const diagnostic = startupDiagnostic(stage, error, started);
    reportStartupFailure(diagnostic);
    try { await close?.(); }
    catch (cleanupError) {
      diagnostic.cleanupFailed = true;
      reportStartupFailure(startupDiagnostic('cleanup', cleanupError, started));
    }
    throw Object.assign(new Error(`Invalid cloud cost local run (startup=${diagnostic.stage}, reason=${diagnostic.reason})`), { diagnostic });
  }
}

// This stage consumes one recorded worker; shared stack resources remain with their creator.
// Killing an attached Docker client does not terminate its exec process inside the container.
export async function runForegroundContainer(args) {
  let selected, result;
  try {
    const { containerId, networkId, argv, windowSeconds, signal } = args;
    const value = owned(args);
    requireThat(Number.isFinite(windowSeconds) && windowSeconds > 0 && windowSeconds <= 7200);
    requireThat(signal === undefined || signal instanceof AbortSignal);
    requireThat(/^[a-f0-9]{64}$/.test(containerId) && /^[a-f0-9]{64}$/.test(networkId));
    requireThat(Array.isArray(argv) && argv.length > 0 && argv.length <= 64
      && argv.every(v => typeof v === 'string' && v.length <= 16384 && !v.includes('\0')));
    const command = [...argv];
    const active = (kind, id) => {
      const events = value.localResources?.filter(e => e.kind === kind && e.id === id);
      return events?.length && ['started', 'ready'].includes(events.at(-1).state);
    };
    requireThat(active('container', containerId) && active('network', networkId));
    const container = dockerRead(['inspect', containerId])[0];
    requireThat(container.Id === containerId && container.Config.Labels?.['io.waitron.cloud-cost.owner'] === args.journal.token);
    selected = containerId;
    requireThat(/^sha256:[a-f0-9]{64}$/.test(container.Config.Image)
      && container.Config.User === `${process.getuid()}:${process.getgid()}`
      && JSON.stringify(container.HostConfig.Tmpfs) === JSON.stringify({ '/tmp': 'rw,noexec,nosuid,size=64m' }));
    requireThat(container.State.Running === true && container.HostConfig.ReadonlyRootfs === true
      && container.HostConfig.CapDrop?.includes('ALL') && container.HostConfig.LogConfig.Type === 'none'
      && container.HostConfig.SecurityOpt?.includes('no-new-privileges:true'));
    requireThat(!signal?.aborted);
    await proveDockerIsolation({ ...args, containerIds: [containerId] });
    const executable = spawnSync('/usr/bin/which', ['docker'], { env: environment(), encoding: 'utf8' });
    requireThat(executable.status === 0 && isAbsolute(executable.stdout.trim()));
    result = await runPrivateProcess(executable.stdout.trim(), ['exec', containerId, ...command],
      { signal, ownership: args, timeoutMs: Math.ceil(windowSeconds * 1000) }, 7200000);
  } catch { fail(); }
  finally {
    if (selected) {
      try {
        owned(args);
        const current = dockerRead(['inspect', selected])[0];
        requireThat(current.Id === selected && current.Config.Labels?.['io.waitron.cloud-cost.owner'] === args.journal.token);
        record(args, { kind: 'container', state: 'cleanup-intent', id: selected });
        dockerCommand(['rm', '-f', '-v', selected]);
        requireThat(dockerCommand(['ps', '-aq', '--no-trunc', '--filter', 'id=' + selected]) === '');
        record(args, { kind: 'container', state: 'removed', id: selected });
      } catch { fail(); }
    }
  }
  return { ...result, cleanup: { workerContainers: 0 } };
}
