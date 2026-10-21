import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync,
  readdirSync, statSync, existsSync, chmodSync, symlinkSync, linkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import * as local from './local.mjs';

const invalid = { message: 'Invalid cloud cost local run' };
const docker = (...argv) => execFileSync('docker', argv, { encoding: 'utf8',
  env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t, mode = 'active') {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-source-copy-')));
  const source = join(parent, 'source'), root = join(parent, 'owned');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const database = join(source, 'venue.db'); let db = new DatabaseSync(database);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE sales(amount); INSERT INTO sales VALUES(42)');
  if (mode !== 'active') { if (mode === 'delete') db.exec('PRAGMA journal_mode=DELETE'); db.close(); db = null; }
  const token = randomBytes(32).toString('hex'), path = join(root, 'journal.json');
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  writeFileSync(join(source, 'unrelated-private.txt'), 'SYNTHETIC_PRIVATE_SOURCE', { mode: 0o600 });
  t.after(() => { db?.close(); rmSync(parent, { recursive: true, force: true }); });
  return { parent, source, root, database, journal: { path, token }, db };
}
const fingerprint = directory => readdirSync(directory).sort().map(name => {
  const path = join(directory, name), s = statSync(path);
  return { name, ino: s.ino, mode: s.mode, mtime: s.mtimeMs,
    hash: createHash('sha256').update(readFileSync(path)).digest('hex') };
});
const image = () => docker('image', 'inspect', 'node:26-slim', '--format', '{{.Id}}');
function ready(f) { return JSON.parse(readFileSync(f.journal.path)).localResources ?? []; }
function noContainers(f) {
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
}

// A dormant WAL source must be refused before SQLite creates files beside it.
test('hostCopyRefusesDormantWalWithoutChangingTheSourceDirectory', async t => {
  const f = fixture(t, 'dormant'), before = fingerprint(f.source); let unexpected;
  try { await assert.rejects(async () => { unexpected = await local.preparePrivateCopy(f); }, invalid); }
  finally { await unexpected?.close(); }
  assert.deepEqual(fingerprint(f.source), before);
  assert.deepEqual(readdirSync(f.root).sort(), ['.cloud-cost-owner', 'journal.json']);
});

// Removing a source read-only mount or omitting WAL loses either isolation or committed sales.
test('isolatedCopyIncludesActiveWalAndEnforcesSourceReadOnlyAtTheOperatingSystem', async t => {
  assert.equal(typeof local.prepareIsolatedPrivateCopy, 'function');
  const f = fixture(t), before = fingerprint(f.source);
  const copy = await local.prepareIsolatedPrivateCopy({ ...f, image: image() });
  try {
    const db = new DatabaseSync(copy.database);
    try {
      assert.equal(db.prepare('SELECT sum(amount) AS n FROM sales').get().n, 42);
      db.exec('INSERT INTO sales VALUES(7)');
      assert.equal(db.prepare('SELECT sum(amount) AS n FROM sales').get().n, 49);
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally { db.close(); }
    assert.deepEqual(fingerprint(f.source), before);
    assert.equal(statSync(copy.database).mode & 0o777, 0o600);
    const proof = ready(f).find(v => v.kind === 'source-copy-isolation' && v.state === 'ready');
    assert.deepEqual(proof?.checks, { networkBlocked: true, sourceWritesBlocked: 3,
      sourceDirectoryBlocked: true, localControl: true });
    assert.ok(ready(f).some(v => v.kind === 'database-copy' && v.state === 'ready' && v.path === copy.database));
    noContainers(f);
  } finally { await copy.close(); await copy.close(); }
  assert.deepEqual(readdirSync(f.root).sort(), ['.cloud-cost-owner', 'journal.json']);
});

test('isolatedCopySupportsAClosedRollbackDatabaseAndRefusesDormantWal', async t => {
  assert.equal(typeof local.prepareIsolatedPrivateCopy, 'function');
  for (const mode of ['delete', 'dormant']) {
    const f = fixture(t, mode), before = fingerprint(f.source); let copy;
    try {
      if (mode === 'dormant') await assert.rejects(local.prepareIsolatedPrivateCopy({ ...f, image: image() }), invalid);
      else {
        copy = await local.prepareIsolatedPrivateCopy({ ...f, image: image() });
        const db = new DatabaseSync(copy.database, { readOnly: true });
        try { assert.equal(db.prepare('SELECT sum(amount) AS n FROM sales').get().n, 42); } finally { db.close(); }
      }
    } finally { await copy?.close(); }
    assert.deepEqual(fingerprint(f.source), before); noContainers(f);
    assert.deepEqual(readdirSync(f.root).sort(), ['.cloud-cost-owner', 'journal.json']);
  }
});

// An abort after creation must remove both the worker and partial output, preserving foreign state.
test('isolatedCopyCancellationReapsOnlyItsRecordedContainersAndPartialFiles', async t => {
  const f = fixture(t), before = fingerprint(f.source), controller = new AbortController();
  writeFileSync(join(f.root, 'foreign.txt'), 'preserve', { mode: 0o600 });
  const abort = setImmediate(() => controller.abort());
  try { await assert.rejects(local.prepareIsolatedPrivateCopy({ ...f, image: image(), signal: controller.signal }), invalid); }
  finally { clearImmediate(abort); }
  assert.ok(ready(f).filter(v => v.kind === 'source-copy-container' && v.state === 'created').length >= 2);
  assert.deepEqual(fingerprint(f.source), before); noContainers(f);
  assert.deepEqual(readdirSync(f.root).sort(), ['.cloud-cost-owner', 'foreign.txt', 'journal.json']);
  for (const child of ready(f).filter(v => v.kind === 'process' && v.state === 'started'))
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
});

test('isolatedCopyRejectsUnsafeSourcesAndConfigBeforeStartingAnyContainer', async t => {
  const f = fixture(t), pinned = image(), controller = new AbortController(); controller.abort();
  const foreign = new DatabaseSync(join(f.parent, 'foreign.db'));
  try { foreign.exec('CREATE TABLE sales(amount); INSERT INTO sales VALUES(999)'); } finally { foreign.close(); }
  for (const change of [{ image: 'node:26-slim' }, { image: 'sha256:bad' }, { signal: controller.signal },
    { root: f.source }, { database: join(f.parent, 'foreign.db') }, { timeoutMs: 0 }, { timeoutMs: 120001 }])
    await assert.rejects(local.prepareIsolatedPrivateCopy({ ...f, image: pinned, ...change }), invalid);
  const linked = join(f.source, 'alias.db'); symlinkSync(f.database, linked);
  await assert.rejects(local.prepareIsolatedPrivateCopy({ ...f, database: linked, image: pinned }), invalid);
  rmSync(linked); linkSync(f.database, linked);
  await assert.rejects(local.prepareIsolatedPrivateCopy({ ...f, image: pinned }), invalid); rmSync(linked);
  for (const path of [f.journal.path, join(f.root, '.cloud-cost-owner')]) {
    chmodSync(path, 0o644);
    await assert.rejects(local.prepareIsolatedPrivateCopy({ ...f, image: pinned }), invalid); chmodSync(path, 0o600);
  }
  assert.deepEqual(ready(f), []); noContainers(f);
  assert.deepEqual(readdirSync(f.root).sort(), ['.cloud-cost-owner', 'journal.json']);
});

test('linkedOrMissingTransactionLogsCannotExtendTheRecordedSource', async t => {
  const f = fixture(t), pinned = image();
  for (const suffix of ['-wal', '-shm']) {
    const path = f.database + suffix, saved = join(f.source, 'saved' + suffix); renameSync(path, saved);
    try {
      await assert.rejects(local.prepareIsolatedPrivateCopy({ ...f, image: pinned }), invalid);
      symlinkSync(saved, path);
      await assert.rejects(local.prepareIsolatedPrivateCopy({ ...f, image: pinned }), invalid); rmSync(path);
      linkSync(saved, path);
      await assert.rejects(local.prepareIsolatedPrivateCopy({ ...f, image: pinned }), invalid); rmSync(path);
    } finally { if (existsSync(path)) rmSync(path); renameSync(saved, path); }
  }
  assert.deepEqual(ready(f), []); noContainers(f);
});

test('isolatedCopyCleanupRefusesChangedOwnershipOrFileIdentity', async t => {
  const f = fixture(t), copy = await local.prepareIsolatedPrivateCopy({ ...f, image: image() });
  try {
    writeFileSync(join(f.root, '.cloud-cost-owner'), '0'.repeat(64));
    await assert.rejects(copy.close(), invalid); assert.ok(existsSync(copy.database));
    writeFileSync(join(f.root, '.cloud-cost-owner'), f.journal.token);
    const saved = join(f.root, 'saved.db'); renameSync(copy.database, saved);
    writeFileSync(copy.database, 'foreign', { mode: 0o600 });
    try { await assert.rejects(copy.close(), invalid); assert.equal(readFileSync(copy.database, 'utf8'), 'foreign'); }
    finally { rmSync(copy.database); renameSync(saved, copy.database); }
  } finally { await copy.close(); }
  noContainers(f);
});

// Docker must report the requested boundary before a source-reading process can start.
test('sourceCopyInspectionRefusesAChangedContainerBeforeReadingData', t => {
  assert.equal(typeof local.validateSourceCopyInspect, 'function');
  const f = fixture(t), name = 'owned-copy', pinned = 'sha256:' + 'a'.repeat(64);
  const command = ['--input-type=module', '-e', 'public-worker'];
  const mounts = [{ Type: 'bind', Source: f.database, Destination: '/source/venue.db', RW: false },
    { Type: 'bind', Source: f.root, Destination: '/copy', RW: true }];
  const container = { Id: 'b'.repeat(64), Name: '/' + name,
    Config: { Labels: { 'io.waitron.cloud-cost.owner': f.journal.token }, Image: pinned,
      User: `${process.getuid()}:${process.getgid()}`, Entrypoint: ['node'], Cmd: command, Env: ['NODE_VERSION=26'] },
    HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], CapAdd: null,
      SecurityOpt: ['no-new-privileges:true'], LogConfig: { Type: 'none' }, Dns: ['127.0.0.1'], ExtraHosts: null,
      Devices: [], VolumesFrom: null, PidMode: '', IpcMode: 'private', PortBindings: {}, Tmpfs: {} }, Mounts: mounts };
  const check = value => local.validateSourceCopyInspect({ ...f, container: value, name, image: pinned,
    id: container.Id, command, mounts });
  assert.doesNotThrow(() => check(container));
  for (const mutate of [
    c => c.Id = 'c'.repeat(64), c => c.Name = '/foreign',
    c => c.Config.Labels['io.waitron.cloud-cost.owner'] = 'foreign',
    c => c.Config.Image = 'node:latest', c => c.Config.User = '0:0',
    c => c.Config.Entrypoint = ['sh'], c => c.Config.Cmd = ['foreign'],
    c => c.Config.Env.push('AWS_ACCESS_KEY_ID=SYNTHETIC_PRIVATE'),
    c => c.HostConfig.NetworkMode = 'bridge', c => c.HostConfig.ReadonlyRootfs = false,
    c => c.HostConfig.Privileged = true, c => c.HostConfig.CapDrop = [], c => c.HostConfig.CapAdd = ['SYS_ADMIN'],
    c => c.HostConfig.SecurityOpt = [], c => c.HostConfig.LogConfig.Type = 'json-file',
    c => c.HostConfig.Dns = ['8.8.8.8'], c => c.HostConfig.ExtraHosts = ['host.docker.internal:host-gateway'],
    c => c.HostConfig.Devices = [{}], c => c.HostConfig.VolumesFrom = ['foreign'],
    c => c.HostConfig.PidMode = 'host', c => c.HostConfig.IpcMode = 'host',
    c => c.HostConfig.PortBindings = { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '80' }] },
    c => c.HostConfig.Tmpfs = { '/source': 'rw' },
    c => c.Mounts[0].RW = true, c => c.Mounts[0].Source = f.source,
    c => c.Mounts[0].Destination = '/source', c => c.Mounts[0].Type = 'volume',
    c => c.Mounts.push({ Type: 'bind', Source: '/var/run/docker.sock', Destination: '/docker.sock', RW: true }),
  ]) {
    const changed = structuredClone(container); mutate(changed);
    assert.throws(() => check(changed), invalid);
  }
});
