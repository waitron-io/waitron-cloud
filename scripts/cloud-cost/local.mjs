
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { constants, openSync, closeSync, fstatSync, lstatSync, realpathSync, existsSync,
  mkdirSync, chmodSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, isAbsolute, posix } from 'node:path';
import { assertOwnedRoot } from './schema.mjs';

const fail = () => { throw new Error('Invalid cloud cost local run'); };
const requireThat = value => { if (!value) fail(); };
const inside = (root, path) => { const r = relative(root, path); return r !== '' && r !== '..' && !r.startsWith('../') && !isAbsolute(r); };
const environment = () => ({ PATH: process.env.PATH, LANG: 'C', TZ: 'UTC' });
function owned(args) {
  assertOwnedRoot(args);
  return JSON.parse(readFileSync(args.journal.path, 'utf8'));
}
function record(args, entry) {
  const value = owned(args);
  value.localResources ??= [];
  value.localResources.push(entry);
  writeFileSync(args.journal.path, JSON.stringify(value), { mode: 0o600 });
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

export async function preparePrivateCopy({ source, database, root, journal, signal, timeoutMs = 30000 }) {
  const args = { source, root, journal }; const destination = join(root, 'venue-copy.db');
  let copy, close, removeConfig;
  try {
    requireThat(!signal?.aborted);
    owned(args); canonicalFile(database);
    requireThat(inside(source, database));
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

export async function runPrivate(command, argv, { signal, cwd, ownership, timeoutMs = 120000 } = {}) {
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
    requireThat(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000);
    requireThat(!signal?.aborted);
    if (ownership) record(ownership, { kind: 'process', state: 'intent' });
    child = spawn(command, argv, { env: environment(), cwd, stdio: ['ignore', 'ignore', 'ignore'] });
    let spawnError = false;
    closed = new Promise(resolve => {
      child.once('error', () => { spawnError = true; }); child.once('close', code => resolve(code));
    });
    if (ownership) record(ownership, { kind: 'process', state: 'started', pid: child.pid });
    signal?.addEventListener('abort', abort, { once: true });
    deadline = setTimeout(abort, timeoutMs);
    if (signal?.aborted) abort();
    const exitCode = await closed;
    requireThat(exitCode === 0 && !spawnError && !aborted);
    return { exitCode };
  } catch { fail(); }
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

function dockerRead(argv) {
  const result = spawnSync('docker', argv, { env: environment(), encoding: 'utf8',
    timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  requireThat(result.status === 0 && !result.error);
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
      const result = dockerRead(['exec', c.Id, 'node', '-e', outboundCanary]);
      requireThat(Object.keys(result).length === 3 && result.blockedConnections === 3 && result.blockedDns === 2 && result.localControl === true);
      blockedConnections += result.blockedConnections; blockedDns += result.blockedDns;
      record(args, { kind: 'outbound-proof', state: 'ready', containerIds: [c.Id] });
    }
    // Re-read after the canary; a second network attached during the check invalidates it.
    validateIsolationInspect({ ...args, network: dockerRead(['network', 'inspect', args.networkId])[0],
      containers: dockerRead(['inspect', ...args.containerIds]) });
    return { ...validated, blockedConnections, blockedDns, localControl: true };
  } catch { fail(); }
}
