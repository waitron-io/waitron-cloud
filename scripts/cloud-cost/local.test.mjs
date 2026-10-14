import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync,
  existsSync, statSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import * as local from './local.mjs';

function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-local-test-')));
  const source = join(parent, 'source'); const root = join(parent, 'owned');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const database = join(source, 'venue.db');
  const db = new DatabaseSync(database);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE sales (amount INTEGER); INSERT INTO sales VALUES (42)');
  const token = randomBytes(32).toString('hex'); const path = join(root, 'journal.json');
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  t.after(() => { db.close(); rmSync(parent, { recursive: true, force: true }); });
  return { parent, source, database, root, journal: { path, token }, db };
}
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const available = name => assert.equal(typeof local[name], 'function', `${name} must implement the private boundary`);

// Copying the .db file alone loses the uncheckpointed sale; a writable source changes its bytes.
test('activeSqliteBackupIncludesWal', async t => {
  available('preparePrivateCopy'); const f = fixture(t);
  assert.ok(statSync(`${f.database}-wal`).size > 0);
  const copy = await local.preparePrivateCopy(f);
  const db = new DatabaseSync(copy.database, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT sum(amount) AS total FROM sales').get().total, 42);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { db.close(); }
  assert.equal(statSync(copy.database).mode & 0o777, 0o600);
  await copy.close(); await copy.close();
  assert.equal(existsSync(copy.database), false);
});
test('sourceNeverWritten', async t => {
  available('preparePrivateCopy'); const f = fixture(t);
  const paths = [f.database, `${f.database}-wal`];
  const before = paths.map(p => ({ hash: digest(p), mtime: statSync(p).mtimeMs }));
  let copy; await assert.doesNotReject(async () => { copy = await local.preparePrivateCopy(f); });
  await copy.close();
  assert.deepEqual(paths.map(p => ({ hash: digest(p), mtime: statSync(p).mtimeMs })), before);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sales').get().n, 1);
});
test('copyCanBeOpenedForWritableReplayAfterIntegrityCheck', async t => {
  available('preparePrivateCopy'); const f = fixture(t); const copy = await local.preparePrivateCopy(f);
  const writer = new DatabaseSync(copy.database, { timeout: 200 });
  try { assert.doesNotThrow(() => writer.exec('INSERT INTO sales VALUES(7)')); }
  finally { writer.close(); await copy.close(); }
});
test('readOnlySourceCanBeBackedUp', async t => {
  available('preparePrivateCopy'); const f = fixture(t); chmodSync(f.database, 0o444);
  await assert.doesNotReject(async () => {
    const copy = await local.preparePrivateCopy(f); await copy.close();
  });
  assert.equal(statSync(f.database).mode & 0o777, 0o444);
});
test('copyRefusesOverlapLinksAndExistingDestination', async t => {
  available('preparePrivateCopy'); const f = fixture(t);
  await assert.rejects(local.preparePrivateCopy({ ...f, root: f.source }), /Invalid cloud cost local run/);
  const alias = join(f.source, 'alias.db'); symlinkSync(f.database, alias);
  await assert.rejects(local.preparePrivateCopy({ ...f, database: alias }), /Invalid cloud cost local run/);
  writeFileSync(join(f.root, 'venue-copy.db'), 'owned sentinel', { mode: 0o600 });
  await assert.rejects(local.preparePrivateCopy(f), /Invalid cloud cost local run/);
  assert.equal(readFileSync(join(f.root, 'venue-copy.db'), 'utf8'), 'owned sentinel');
});
test('copyCannotReadAFileOutsideItsRecordedSource', async t => {
  available('preparePrivateCopy'); const f = fixture(t);
  const foreignPath = join(f.parent, 'foreign.db'); const foreign = new DatabaseSync(foreignPath);
  foreign.exec('CREATE TABLE sales(amount); INSERT INTO sales VALUES(999)'); foreign.close();
  await assert.rejects(local.preparePrivateCopy({ ...f, database: foreignPath }), /Invalid cloud cost local run/);
  chmodSync(f.journal.path, 0o644);
  await assert.rejects(local.preparePrivateCopy(f), /Invalid cloud cost local run/);
  assert.equal(existsSync(join(f.root, 'venue-copy.db')), false);
});
test('cleanupRefusesChangedOwnershipAndPreservesForeignFiles', async t => {
  available('preparePrivateCopy'); const f = fixture(t); const copy = await local.preparePrivateCopy(f);
  writeFileSync(join(f.root, 'foreign.txt'), 'foreign', { mode: 0o600 });
  writeFileSync(join(f.root, '.cloud-cost-owner'), '0'.repeat(64));
  await assert.rejects(copy.close(), /Invalid cloud cost local run/);
  assert.equal(existsSync(copy.database), true);
  writeFileSync(join(f.root, '.cloud-cost-owner'), f.journal.token);
  await copy.close();
  assert.equal(readFileSync(join(f.root, 'foreign.txt'), 'utf8'), 'foreign');
  assert.ok(existsSync(f.database));
});
test('rawOutputNeverEscapes', async () => {
  available('runPrivate');
  const result = await local.runPrivate(process.execPath, ['-e', 'process.stdout.write("RAW_CANARY"); process.stderr.write("RAW_CANARY")']);
  assert.deepEqual(result, { exitCode: 0 });
  await assert.rejects(local.runPrivate(process.execPath, ['-e', 'throw Error("RAW_CANARY")']),
    e => e.message === 'Invalid cloud cost local run' && !e.stack.includes('RAW_CANARY'));
});
test('onlyOwnedCleanupOnSignal', async t => {
  available('runPrivate'); const f = fixture(t); const controller = new AbortController();
  const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(async () => { foreign.kill('SIGTERM'); await new Promise(r => foreign.once('close', r)); });
  const pidFile = join(f.root, 'child.pid');
  const running = local.runPrivate(process.execPath, ['-e',
    'require("node:fs").writeFileSync(process.argv[1],String(process.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},1000)', pidFile],
    { signal: controller.signal, ownership: f });
  const rejected = assert.rejects(running, /Invalid cloud cost local run/);
  for (let i = 0; !existsSync(pidFile) && i < 200; i++) await delay(10);
  assert.ok(existsSync(pidFile)); const pid = Number(readFileSync(pidFile, 'utf8'));
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } });
  controller.abort();
  const completed = await Promise.race([rejected.then(() => true), delay(2500).then(() => false)]);
  assert.equal(completed, true, 'signal cleanup must finish before returning');
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.doesNotThrow(() => process.kill(foreign.pid, 0));
  const recorded = JSON.parse(readFileSync(f.journal.path, 'utf8'));
  assert.ok(recorded.localResources.some(r => r.kind === 'process' && r.pid === pid));
});
test('codeCopyExcludesSecretsDependenciesRuntimeAndGit', async t => {
  available('prepareCodeCopy'); const f = fixture(t);
  const code = join(f.source, 'code'); mkdirSync(join(code, 'packages', 'engine', 'src'), { recursive: true });
  mkdirSync(join(code, 'packages', 'engine', 'node_modules'), { recursive: true });
  mkdirSync(join(code, 'apps', 'server', 'test'), { recursive: true });
  writeFileSync(join(code, 'apps/server/test/recorded-sale.ts'), 'RAW_CANARY');
  writeFileSync(join(code, 'packages', 'engine', 'src', 'sale.ts'), 'export const answer = 42;');
  writeFileSync(join(code, 'packages', 'engine', 'src', 'recorded.test.ts'), 'RAW_CANARY');
  writeFileSync(join(code, 'package.json'), '{"type":"module"}');
  for (const path of ['.env', 'credentials.json', 'venue.db', 'packages/engine/node_modules/secret.js'])
    writeFileSync(join(code, path), 'RAW_CANARY');
  execFileSync('git', ['init', '-q', code]); execFileSync('git', ['-C', code, 'add', '.']);
  execFileSync('git', ['-C', code, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qs', '-m', 'Synthetic source']);
  const journal = JSON.parse(readFileSync(f.journal.path, 'utf8')); journal.codeSource = code;
  writeFileSync(f.journal.path, JSON.stringify(journal));
  const copy = await local.prepareCodeCopy({ ...f, codeRoot: code });
  assert.equal(readFileSync(join(copy.codeRoot, 'packages/engine/src/sale.ts'), 'utf8'), 'export const answer = 42;');
  assert.equal(readFileSync(join(copy.codeRoot, 'package.json'), 'utf8'), '{"type":"module"}');
  for (const path of ['.git', '.env', 'credentials.json', 'venue.db', 'packages/engine/node_modules', 'apps/server/test/recorded-sale.ts', 'packages/engine/src/recorded.test.ts'])
    assert.equal(existsSync(join(copy.codeRoot, path)), false, path);
  assert.match(copy.revision, /^[0-9a-f]{40}$/);
  await copy.close(); assert.equal(existsSync(copy.codeRoot), false);
});
test('codeCopyRefusesAnUnrecordedRepositoryBeforeGit', async t => {
  available('prepareCodeCopy'); const f = fixture(t);
  const code = join(f.source, 'unrecorded'); mkdirSync(join(code, 'apps', 'server', 'src'), { recursive: true });
  writeFileSync(join(code, 'package.json'), '{}'); writeFileSync(join(code, 'apps/server/src/sale.ts'), 'export const sale = 42;');
  execFileSync('git', ['init', '-q', code]); execFileSync('git', ['-C', code, 'add', '.']);
  execFileSync('git', ['-C', code, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qs', '-m', 'Synthetic source']);
  await assert.rejects(local.prepareCodeCopy({ ...f, codeRoot: code }), /Invalid cloud cost local run/);
  assert.equal(existsSync(join(f.root, 'code-copy')), false);
  const value = JSON.parse(readFileSync(f.journal.path, 'utf8'));
  assert.equal(value.localResources, undefined);
});
test('largeCodeCopyStreamsWithoutAWholeArchiveBuffer', async t => {
  available('prepareCodeCopy'); const f = fixture(t); const code = join(f.source, 'code');
  mkdirSync(join(code, 'packages', 'engine', 'src'), { recursive: true });
  writeFileSync(join(code, 'package.json'), '{}');
  const payload = Buffer.alloc(33 * 1024 * 1024, 32);
  writeFileSync(join(code, 'packages/engine/src/large.ts'), payload);
  execFileSync('git', ['init', '-q', code]); execFileSync('git', ['-C', code, 'add', '.']);
  execFileSync('git', ['-C', code, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qs', '-m', 'Synthetic source']);
  const journal = JSON.parse(readFileSync(f.journal.path, 'utf8')); journal.codeSource = code;
  writeFileSync(f.journal.path, JSON.stringify(journal));
  await assert.doesNotReject(async () => {
    const copy = await local.prepareCodeCopy({ ...f, codeRoot: code });
    assert.equal(statSync(join(copy.codeRoot, 'packages/engine/src/large.ts')).size, 34603008);
    assert.equal(digest(join(copy.codeRoot, 'packages/engine/src/large.ts')), createHash('sha256').update(payload).digest('hex'));
    await copy.close();
  });
});
function isolatedInspect(f) {
  return { ...f, codeRoot: join(f.root, 'code-copy'), stateRoot: join(f.root, 'state'),
    network: { Id: 'a'.repeat(64), Name: 'cloud-cost-fixture', Internal: true, Driver: 'bridge',
      Labels: { 'io.waitron.cloud-cost.owner': f.journal.token } },
    containers: [{ Id: 'b'.repeat(64), Config: { Labels: { 'io.waitron.cloud-cost.owner': f.journal.token }, Env: ['NODE_VERSION=26.7.0'] },
      HostConfig: { Privileged: false, ExtraHosts: null, CapAdd: null, Dns: ['127.0.0.1'], NetworkMode: 'cloud-cost-fixture', PidMode: '', IpcMode: 'private' },
      NetworkSettings: { Networks: { 'cloud-cost-fixture': { NetworkID: 'a'.repeat(64) } },
        Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '49152' }] } }, Mounts: [] }] };
}
test('isolationRefusesExternalNetworksHostsPortsPrivilegesAndMounts', t => {
  available('validateIsolationInspect'); const f = fixture(t);
  mkdirSync(join(f.root, 'code-copy')); mkdirSync(join(f.root, 'state'));
  assert.doesNotThrow(() => local.validateIsolationInspect(isolatedInspect(f)));
  const mutations = [
    x => x.network.Internal = false,
    x => x.network.Labels['io.waitron.cloud-cost.owner'] = 'foreign',
    x => x.containers[0].Config.Labels['io.waitron.cloud-cost.owner'] = 'foreign',
    x => x.containers[0].NetworkSettings.Networks.internet = { NetworkID: 'other' },
    x => x.containers[0].HostConfig.NetworkMode = 'host',
    x => x.containers[0].HostConfig.ExtraHosts = ['host.docker.internal:host-gateway'],
    x => x.containers[0].HostConfig.Privileged = true,
    x => x.containers[0].HostConfig.CapAdd = ['SYS_ADMIN'],
    x => x.containers[0].HostConfig.Dns = ['8.8.8.8'],
    x => x.containers[0].HostConfig.PidMode = 'host',
    x => x.containers[0].HostConfig.IpcMode = 'host',
    x => x.containers[0].NetworkSettings.Ports['8080/tcp'][0].HostIp = '0.0.0.0',
    x => x.containers[0].Config.Env.push('AWS_ACCESS_KEY_ID=RAW_CANARY'),
    x => x.containers[0].Config.Env.push('HTTP_PROXY=http://example.com'),
    x => x.containers[0].Mounts.push({ Type: 'bind', Source: f.source, Destination: '/state', RW: true }),
    x => x.containers[0].Mounts.push({ Type: 'bind', Source: f.root, Destination: '/state', RW: true }),
    x => x.containers[0].Mounts.push({ Type: 'volume', Source: x.stateRoot, Destination: '/state', RW: true }),
  ];
  for (const mutate of mutations) {
    const x = isolatedInspect(f); mutate(x);
    assert.throws(() => local.validateIsolationInspect(x), /Invalid cloud cost local run/);
  }
});
test('copiedCodeMustBeReadOnlyAndStateWritableOnlyInsideOwnedRoot', t => {
  available('validateIsolationInspect'); const f = fixture(t);
  mkdirSync(join(f.root, 'code-copy')); mkdirSync(join(f.root, 'state'));
  const x = isolatedInspect(f);
  x.containers[0].Mounts = [
    { Type: 'bind', Source: x.codeRoot, Destination: '/code', RW: false },
    { Type: 'bind', Source: x.stateRoot, Destination: '/state', RW: true },
  ];
  assert.doesNotThrow(() => local.validateIsolationInspect(x));
  for (const target of ['/etc/resolv.conf', '/state/../../etc/resolv.conf']) {
    x.containers[0].Mounts[1].Destination = target;
    assert.throws(() => local.validateIsolationInspect(x), /Invalid cloud cost local run/);
  }
  x.containers[0].Mounts[1].Destination = '/state';
  x.containers[0].Mounts[0].RW = true;
  assert.throws(() => local.validateIsolationInspect(x), /Invalid cloud cost local run/);
});
test('realDockerCanaryDeniesInternetMetadataAndExternalDnsBeforeDataMounts', async t => {
  available('proveDockerIsolation'); const f = fixture(t);
  const name = 'd68-isolation-' + randomUUID(); let networkId, containerId;
  const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  t.after(() => { if (containerId) docker('rm', '-f', containerId); if (networkId) docker('network', 'rm', networkId); });
  networkId = docker('network', 'create', '--internal', '--label', 'io.waitron.cloud-cost.owner=' + f.journal.token, name);
  containerId = docker('run', '-d', '--network', name, '--dns', '127.0.0.1', '--label', 'io.waitron.cloud-cost.owner=' + f.journal.token,
    'node:26-slim', 'node', '-e', 'setInterval(()=>{},1000)');
  const proof = await local.proveDockerIsolation({ ...f, codeRoot: join(f.root, 'code-copy'), stateRoot: join(f.root, 'state'), networkId, containerIds: [containerId] });
  assert.deepEqual(proof, { isolated: true, containers: 1, blockedConnections: 3, blockedDns: 2, localControl: true });
  const journal = JSON.parse(readFileSync(f.journal.path, 'utf8'));
  assert.ok(journal.localResources.some(r => r.kind === 'outbound-proof' && r.state === 'ready' && r.containerIds[0] === containerId));
  docker('network', 'connect', 'bridge', containerId);
  await assert.rejects(local.proveDockerIsolation({ ...f, codeRoot: join(f.root, 'code-copy'), stateRoot: join(f.root, 'state'), networkId, containerIds: [containerId] }),
    /Invalid cloud cost local run/);
});
