import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import childProcess from 'node:child_process';
import {AsyncLocalStorage} from 'node:async_hooks';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';

// Rejecting a peer's claim must never temporarily occupy the first child's port.
test('an existing claim prevents binding throughout a native child handoff', {timeout:60000}, async t => {
  const context = new AsyncLocalStorage();
  const create = net.createServer, spawn = childProcess.spawn, claim = fs.symlink, choose = crypto.randomInt;
  const children = [], stores = [], pending = [], peerListeners = [];
  let originalPort, selected = false, legacySelected = false, announceSpawn, announceConflict, releaseConflict;
  const spawned = new Promise(resolve => announceSpawn = resolve);
  const conflicted = new Promise(resolve => announceConflict = resolve);
  const released = new Promise(resolve => releaseConflict = resolve);
  t.after(async () => {
    releaseConflict();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGCONT');
    for (const result of await Promise.allSettled(pending)) if (result.status === 'fulfilled') stores.push(result.value);
    try { await Promise.all([...new Set(stores)].map(store => store.stop())); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null));
  });
  t.mock.method(crypto, 'randomInt', (...args) => {
    if (context.getStore() === 'peer' && !selected) { selected = true; return originalPort; }
    return choose(...args);
  });
  t.mock.method(net, 'createServer', (...args) => {
    const server = create(...args), listen = server.listen;
    server.listen = function(port, ...rest) {
      if (context.getStore() === 'peer') {
        // Exercise the old kernel-selected allocator against the same candidate.
        if (port === 0 && !legacySelected) { legacySelected = true; port = originalPort; }
        if (port === originalPort) peerListeners.push(server);
      }
      return listen.call(this, port, ...rest);
    };
    return server;
  });
  t.mock.method(fs, 'symlink', async (target, path, ...rest) => {
    try { return await claim(target, path, ...rest); }
    catch (error) {
      if (context.getStore() === 'peer' && path.endsWith('/' + originalPort) && error.code === 'EEXIST') {
        announceConflict(); await released;
      }
      throw error;
    }
  });
  t.mock.method(childProcess, 'spawn', (binary, args, options) => {
    const first = context.getStore() === 'first';
    const child = first ? spawn('sh', ['-c', 'kill -STOP $$; exec "$@"', 'sh', binary, ...args], options) : spawn(binary, args, options);
    children.push(child);
    if (first) { originalPort = Number(args.find(arg => arg.startsWith('-filer.port=')).split('=')[1]); announceSpawn(); }
    return child;
  });
  syncBuiltinESMExports();
  const {startBackupStorage} = await import('./backup-storage-fixture.mjs');
  const first = context.run('first', () => startBackupStorage({retryPortCollision:false}));
  pending.push(first); first.catch(() => {});
  await spawned;
  const deadline = Date.now() + 5000;
  while (!childProcess.execFileSync('ps', ['-o', 'stat=', '-p', String(children[0].pid)], {encoding:'utf8'}).includes('T')) {
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5));
  }
  const peer = context.run('peer', () => startBackupStorage({retryPortCollision:false}));
  pending.push(peer); peer.catch(() => {});
  let conflictTimer;
  try {
    await Promise.race([conflicted, new Promise((_, reject) => { conflictTimer = setTimeout(() => reject(Error('peer did not encounter the existing claim')), 15000); })]);
  } finally { clearTimeout(conflictTimer); }
  assert.equal(peerListeners.length, 0, 'an existing claim must prevent even a temporary bind');
  children[0].kill('SIGCONT');
  const a = await first;
  assert.equal(await fs.readlink(join('/tmp', 'waitron-cloud-storage-ports-' + process.getuid(), String(originalPort))), a.root);
  await a.bucket('uninterrupted-claim-owner');
  releaseConflict();
  const b = await peer;
  await b.bucket('nonintrusive-claim-peer');
  assert.equal(peerListeners.length, 0, 'delivering the existing-claim refusal must not trigger a later bind');
  assert.equal(children.length, 2, 'neither native child may need a restart');
});

for (const [exhausted, position] of [[false, 1], [false, 4], [true, 1]]) test(exhausted
  ? 'occupied candidates stop after 256 selections and release only their own claims'
  : `an occupied candidate at selection ${position} is released before another candidate starts`, {timeout:60000}, async t => {
  const competitor = net.createServer(socket => socket.end('outside listener'));
  await new Promise(resolve => competitor.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => competitor.close(resolve)));
  const port = competitor.address().port;
  const path = join('/tmp', 'waitron-cloud-storage-ports-' + process.getuid(), String(port));
  assert.equal(existsSync(path), false, 'the controlled outside listener must have no existing fixture claim');
  const choose = crypto.randomInt, spawn = childProcess.spawn, create = net.createServer, allocate = fs.mkdtemp, unlink = fs.unlink;
  const claimed = [];
  let selections = 0, children = 0, storage, legacySelection = false, fixtureRoot;
  t.after(async () => {
    await storage?.stop();
    // A deliberately broken occupied-candidate cleanup must not leave this test's claim behind.
    if (fixtureRoot && !existsSync(fixtureRoot)) {
      try { if (await fs.readlink(path) === fixtureRoot) await unlink(path); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  });
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.method(fs, 'mkdtemp', async (...args) => {
    const root = await allocate(...args);
    if (String(args[0]).includes('cloud-backup-storage-')) fixtureRoot = root;
    return root;
  });
  t.mock.method(crypto, 'randomInt', (...args) => {
    selections++;
    if (exhausted) assert.ok(selections <= 256, 'occupied selection must remain bounded');
    if (selections > 1) assert.equal(existsSync(path), false, 'an occupied candidate must release its claim before selecting again');
    return exhausted || selections === position ? port : choose(...args);
  });
  t.mock.method(net, 'createServer', (...args) => {
    const server = create(...args), listen = server.listen;
    server.listen = function(candidate, ...rest) {
      if (candidate === 0 && (exhausted || !legacySelection)) { legacySelection = true; candidate = port; }
      return listen.call(this, candidate, ...rest);
    };
    return server;
  });
  t.mock.method(childProcess, 'spawn', (binary, args, options) => {
    children++;
    for (const arg of args) if (/^-(s3|master|volume|filer)\.port(?:\.grpc)?=/.test(arg)) claimed.push(arg.split('=')[1]);
    return spawn(binary, args, options);
  });
  syncBuiltinESMExports();
  const {startBackupStorage} = await import('./backup-storage-fixture.mjs');
  if (exhausted) {
    await assert.rejects(async () => { storage = await startBackupStorage({retryPortCollision:false}); }, /Could not reserve unclaimed storage ports/);
    assert.equal(selections, 256); assert.equal(children, 0);
  } else {
    storage = await startBackupStorage({retryPortCollision:false});
    assert.ok(selections >= 9); assert.equal(children, 1);
    assert.equal(claimed.length, 8);
    for (const candidate of claimed) assert.equal(await fs.readlink(join('/tmp', 'waitron-cloud-storage-ports-' + process.getuid(), candidate)), storage.root);
    await storage.bucket('occupied-candidate-recovered');
  }
  assert.equal(existsSync(path), false);
  assert.equal(competitor.listening, true, 'the occupied listener belongs to someone else');
});

test('an unreadable bind error code preserves its original nonretryable refusal', {timeout:30000}, async t => {
  const original = Error('opaque bind refusal');
  Object.defineProperty(original, 'code', {get() { throw Error('code accessor refused'); }});
  const create = net.createServer;
  let binds = 0;
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.method(net, 'createServer', (...args) => {
    const server = create(...args);
    server.listen = function() { binds++; queueMicrotask(() => this.emit('error', original)); return this; };
    return server;
  });
  t.mock.method(childProcess, 'spawn', () => assert.fail('a nonretryable bind error must precede native startup'));
  syncBuiltinESMExports();
  const {startBackupStorage} = await import('./backup-storage-fixture.mjs');
  await assert.rejects(startBackupStorage({retryPortCollision:false}), error => error === original);
  assert.equal(binds, 1);
});
