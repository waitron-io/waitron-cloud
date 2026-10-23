import assert from 'node:assert/strict';
import {Server} from 'node:net';
import test from 'node:test';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';

// Closing each allocation immediately lets later listeners reuse the same port.
test('storage holds the complete seven-port allocation until child startup', {timeout:90000}, async t => {
  const listen = Server.prototype.listen;
  const held = new Set();
  let maximumHeld = 0;
  t.mock.method(Server.prototype, 'listen', function (...args) {
    if (this.constructor === Server && args[0] === 0) {
      this.once('listening', () => {
        held.add(this);
        maximumHeld = Math.max(maximumHeld, held.size);
      });
      this.once('close', () => held.delete(this));
    }
    return Reflect.apply(listen, this, args);
  });
  const storage = await startBackupStorage();
  t.after(() => storage.stop());
  assert.equal(maximumHeld, 7, 'all seven child ports must remain reserved together');
  assert.equal(held.size, 0, 'temporary reservations must close before returning the storage client');
  await storage.bucket('allocated-ports-work');
});

// Failure partway through allocation must not leave the earlier sockets open.
test('failed storage port allocation releases every earlier owned listener', {timeout:90000}, async t => {
  const listen = Server.prototype.listen;
  const reservations = [];
  t.mock.method(Server.prototype, 'listen', function (...args) {
    if (this.constructor === Server && args[0] === 0) {
      reservations.push(this);
      if (reservations.length === 4) {
        queueMicrotask(() => this.emit('error', Object.assign(Error('injected allocation failure'), {code:'EADDRINUSE'})));
        return this;
      }
    }
    return Reflect.apply(listen, this, args);
  });
  t.after(() => Promise.all(reservations.filter(server => server.listening).map(server => new Promise(resolve => server.close(resolve)))));
  await assert.rejects(startBackupStorage(), /injected allocation failure/);
  assert.equal(reservations.filter(server => server.listening).length, 0, 'failed allocation must not leak earlier reservations');
});

// A listener can still claim a released port before the separate process binds it.
test('a child port collision reports the allocation and current socket owners without hiding the failure', {timeout:90000}, async t => {
  const childProcess = await import('node:child_process');
  const {syncBuiltinESMExports} = await import('node:module');
  const originalSpawn = childProcess.default.spawn;
  let owner, allocated;
  const owners = [];
  t.mock.method(childProcess.default, 'spawn', function (binary, args, options) {
    if (args[0] === 'mini') {
      allocated = Number(args.find(arg => arg.startsWith('-filer.port=')).split('=')[1]);
      owner = new Server();
      owners.push(owner);
      owner.listen(allocated, '127.0.0.1');
    }
    return originalSpawn(binary, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.after(() => Promise.all(owners.filter(server => server.listening).map(server => new Promise(resolve => server.close(resolve)))));
  await assert.rejects(startBackupStorage({retryPortCollision:false}), error => {
    assert.match(error.message, /SeaweedFS exited:/);
    assert.equal(error.storageStartup?.ports?.filer, allocated, 'failure must identify the allocated filer port');
    assert.equal(Object.keys(error.storageStartup.ports).length, 7);
    assert.ok(error.storageStartup.socketOwners, 'failure must record socket ownership or an explicit collection failure');
    if (error.storageStartup.socketOwners.source === 'lsof') {
      assert.match(error.storageStartup.socketOwners.output, new RegExp('p' + process.pid + '\\b'));
    }
    return true;
  });
  assert.equal(owner.listening, true, 'fixture cleanup must leave the competing listener alone');
  assert.equal(owners.length, 1, 'the first-failure diagnostic fixture must not retry');
});

// A connection accepted by a temporary reservation must not block its release.
test('storage reservations close promptly when another client connects', {timeout:90000}, async t => {
  const {connect} = await import('node:net');
  const listen = Server.prototype.listen;
  let allocations = 0, client, released, connected;
  const connectionObserved = new Promise(resolve => connected = resolve);
  const releaseObserved = new Promise(resolve => released = resolve);
  t.mock.method(Server.prototype, 'listen', function (...args) {
    if (this.constructor === Server && args[0] === 0 && ++allocations === 2) {
      const ready = args.pop();
      this.once('close', () => released(true));
      args.push(() => {
        client = connect(this.address().port, '127.0.0.1');
        client.on('error', () => {});
        client.once('connect', () => { connected(); setTimeout(ready, 10); });
      });
    }
    return Reflect.apply(listen, this, args);
  });
  t.after(() => client?.destroy());
  const starting = startBackupStorage();
  await Promise.race([connectionObserved, starting]);
  const prompt = await Promise.race([releaseObserved, new Promise(resolve => setTimeout(() => resolve(false), 1500))]);
  client?.destroy();
  const storage = await starting;
  t.after(() => storage.stop());
  assert.equal(prompt, true, 'an accepted connection must not keep a temporary reservation open');
});

// A lost creation reply must not turn the next owned-bucket response into a permanent startup failure.
test('storage startup recovers when the readiness bucket is created but its reply is lost', {timeout:90000}, async t => {
  const {createRequire} = await import('node:module');
  const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
  const {S3Client} = require('@aws-sdk/client-s3');
  const send = S3Client.prototype.send;
  let lostReply = false, ownedBucketResponse = false;
  t.mock.method(S3Client.prototype, 'send', async function (command, ...args) {
    let response;
    try { response = await Reflect.apply(send, this, [command, ...args]); }
    catch (error) {
      if (command.constructor.name === 'CreateBucketCommand' && command.input.Bucket === 'readiness-probe' && error.name === 'BucketAlreadyOwnedByYou') ownedBucketResponse = true;
      throw error;
    }
    if (command.constructor.name === 'CreateBucketCommand' && command.input.Bucket === 'readiness-probe' && !lostReply) {
      lostReply = true;
      throw Object.assign(new Error('readiness creation reply lost after commit'), {name:'TimeoutError'});
    }
    return response;
  });
  const storage = await startBackupStorage();
  t.after(() => storage.stop());
  assert.equal(lostReply, true, 'the real store must create the bucket before its reply is discarded');
  assert.equal(ownedBucketResponse, true, 'the real duplicate response must exercise recovery');
  await storage.bucket('ready-after-lost-reply');
});

test('an owned readiness bucket still refuses startup when its accessibility check fails', {timeout:90000}, async t => {
  const {createRequire} = await import('node:module');
  const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
  const {S3Client} = require('@aws-sdk/client-s3');
  const send = S3Client.prototype.send;
  let lostReply = false;
  t.mock.method(S3Client.prototype, 'send', async function (command, ...args) {
    if (command.constructor.name === 'HeadBucketCommand' && command.input.Bucket === 'readiness-probe') {
      throw Object.assign(new Error('readiness bucket is inaccessible'), {name:'AccessDenied'});
    }
    const response = await Reflect.apply(send, this, [command, ...args]);
    if (command.constructor.name === 'CreateBucketCommand' && command.input.Bucket === 'readiness-probe' && !lostReply) {
      lostReply = true;
      throw Object.assign(new Error('readiness creation reply lost after commit'), {name:'TimeoutError'});
    }
    return response;
  });
  // Register cleanup even if a broken guard returns an unexpected success.
  let storage;
  t.after(() => storage?.stop());
  await assert.rejects(async () => { storage = await startBackupStorage(); }, {name:'AccessDenied', message:'readiness bucket is inaccessible'});
  assert.equal(lostReply, true);
});

test('a transient child port collision retries once with fresh ports and leaves the competing owner alone', {timeout:90000}, async t => {
  const childProcess = await import('node:child_process');
  const {syncBuiltinESMExports} = await import('node:module');
  const spawn = childProcess.default.spawn;
  const children = [], ports = [];
  let owner, storage;
  t.mock.method(childProcess.default, 'spawn', function (binary, args, options) {
    if (args[0] === 'mini') {
      ports.push(Number(args.find(arg => arg.startsWith('-filer.port=')).split('=')[1]));
      if (ports.length === 1) { owner = new Server(); owner.listen(ports[0], '127.0.0.1'); }
      const child = spawn(binary, args, options); children.push(child); return child;
    }
    return spawn(binary, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.after(() => owner?.listening ? new Promise(resolve => owner.close(resolve)) : undefined);
  t.after(() => storage?.stop());
  storage = await startBackupStorage();
  assert.equal(ports.length, 2, 'one failed handoff must cause one new start');
  assert.notEqual(ports[0], ports[1], 'the retry must allocate a new filer port');
  assert.equal(owner.listening, true, 'retry cleanup must leave the competing listener alone');
  assert.ok(children[0].exitCode !== null || children[0].signalCode !== null, 'the failed child must have exited');
  await storage.bucket('ready-after-port-handoff');
});

test('two port-collision failures stop after the one permitted retry and keep both competing listeners', {timeout:90000}, async t => {
  const childProcess = await import('node:child_process');
  const {syncBuiltinESMExports} = await import('node:module');
  const spawn = childProcess.default.spawn;
  const owners = [], children = [];
  let storage;
  t.mock.method(childProcess.default, 'spawn', function (binary, args, options) {
    if (args[0] === 'mini') {
      const port = Number(args.find(arg => arg.startsWith('-filer.port=')).split('=')[1]);
      const owner = new Server(); owner.listen(port, '127.0.0.1'); owners.push(owner);
      const child = spawn(binary, args, options); children.push(child); return child;
    }
    return spawn(binary, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.after(() => Promise.all(owners.filter(owner => owner.listening).map(owner => new Promise(resolve => owner.close(resolve)))));
  t.after(() => storage?.stop());
  await assert.rejects(async () => { storage = await startBackupStorage(); }, /SeaweedFS exited:/);
  assert.equal(children.length, 2, 'there must be no third attempt');
  assert.equal(owners.filter(owner => owner.listening).length, 2, 'neither competing listener belongs to the fixture');
  assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null), 'both failed children must have exited');
});

test('an unrelated child startup failure is reported without retrying it', {timeout:90000}, async t => {
  const childProcess = await import('node:child_process');
  const {syncBuiltinESMExports} = await import('node:module');
  const spawn = childProcess.default.spawn;
  const children = [];
  let storage;
  t.mock.method(childProcess.default, 'spawn', function (binary, args, options) {
    if (args[0] === 'mini') {
      const child = spawn(process.execPath, ['-e', 'process.stderr.write("unrelated storage startup failure");process.exit(1)'], options);
      children.push(child); return child;
    }
    return spawn(binary, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.after(() => storage?.stop());
  await assert.rejects(async () => { storage = await startBackupStorage(); }, /SeaweedFS exited: unrelated storage startup failure/);
  assert.equal(children.length, 1, 'only an explicit port-allocation refusal may retry');
  assert.ok(children[0].exitCode !== null || children[0].signalCode !== null);
});

test('a port lost after child preflight also retries only the allocated port', {timeout:90000}, async t => {
  const childProcess = await import('node:child_process');
  const {syncBuiltinESMExports} = await import('node:module');
  const spawn = childProcess.default.spawn;
  const children = [];
  let owner, storage, collidedPort;
  t.mock.method(childProcess.default, 'spawn', function (binary, args, options) {
    if (args[0] === 'mini') {
      let child;
      if (children.length === 0) {
        collidedPort = Number(args.find(arg => arg.startsWith('-volume.port=')).split('=')[1]);
        owner = new Server(); owner.listen(collidedPort, '127.0.0.1');
        // Reproduce SeaweedFS's observed late-bind diagnostic with a real OS bind refusal.
        const source = `require('node:net').createServer().on('error', error => { if(error.code !== 'EADDRINUSE') throw error; process.stderr.write('Volume server listener error:listen tcp 127.0.0.1:${collidedPort}: bind: address already in use\\n'); process.exit(72); }).listen(${collidedPort},'127.0.0.1');`;
        child = spawn(process.execPath, ['-e', source], options);
      } else child = spawn(binary, args, options);
      children.push(child); return child;
    }
    return spawn(binary, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.after(() => owner?.listening ? new Promise(resolve => owner.close(resolve)) : undefined);
  t.after(() => storage?.stop());
  storage = await startBackupStorage();
  assert.equal(children.length, 2);
  assert.equal(children[0].exitCode, 72, 'the first child must encounter the real occupied socket');
  assert.equal(owner.listening, true);
  await storage.bucket('ready-after-late-bind');
});

test('a bind error for an unallocated port does not qualify for the fixture retry', {timeout:90000}, async t => {
  const childProcess = await import('node:child_process');
  const {syncBuiltinESMExports} = await import('node:module');
  const spawn = childProcess.default.spawn;
  const children = [];
  let storage;
  t.mock.method(childProcess.default, 'spawn', function (binary, args, options) {
    if (args[0] === 'mini') {
      assert.ok(!args.some(arg => /^-(s3|master|volume|filer)\.port(\.grpc)?=1$/.test(arg)));
      const child = spawn(process.execPath, ['-e', 'process.stderr.write("Volume server listener error:listen tcp 127.0.0.1:1: bind: address already in use");process.exit(1)'], options);
      children.push(child); return child;
    }
    return spawn(binary, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.after(() => storage?.stop());
  await assert.rejects(async () => { storage = await startBackupStorage(); }, /SeaweedFS exited: Volume server listener error:listen tcp 127\.0\.0\.1:1: bind: address already in use/);
  assert.equal(children.length, 1, 'an auxiliary or unknown port failure must remain visible');
});

test('startup preserves thrown values that have no error message', {timeout:90000}, async t => {
  const childProcess = await import('node:child_process');
  const {syncBuiltinESMExports} = await import('node:module');
  const spawn = childProcess.default.spawn;
  let failure, calls = 0;
  t.mock.method(childProcess.default, 'spawn', function (binary, args, options) {
    if (args[0] === 'mini') { calls++; throw failure; }
    return spawn(binary, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  for (failure of [{code:'EPROBE', detail:'plain spawn rejection'}, null, 'plain rejection']) {
    await assert.rejects(startBackupStorage(), error => error === failure);
  }
  assert.equal(calls, 3, 'unclassified rejections must never retry');
});

test('a port-shaped upstream error is not treated as a child exit', {timeout:90000}, async t => {
  const childProcess = await import('node:child_process');
  const {syncBuiltinESMExports} = await import('node:module');
  const spawn = childProcess.default.spawn;
  let first, calls = 0;
  t.mock.method(childProcess.default, 'spawn', function (binary, args, options) {
    if (args[0] === 'mini') {
      calls++;
      const port = Number(args.find(arg => arg.startsWith('-filer.port=')).split('=')[1]);
      const error = Object.assign(new Error(`listen tcp 127.0.0.1:${port}: bind: address already in use`), {storageStartup:{ports:{filer:port}}});
      first ??= error;
      throw error;
    }
    return spawn(binary, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(startBackupStorage(), error => error === first);
  assert.equal(calls, 1, 'port-shaped text without a child exit must remain the original error');
});

test('a retry waits for failed fixture cleanup to finish before creating its next directory', {timeout:90000}, async t => {
  const childProcess = await import('node:child_process');
  const fs = await import('node:fs/promises');
  const {dirname} = await import('node:path');
  const {syncBuiltinESMExports} = await import('node:module');
  const spawn = childProcess.default.spawn, remove = fs.default.rm, temporary = fs.default.mkdtemp;
  let firstRoot, owner, storage, directories = 0, cleanupCompleted = false, cleanupAtSecondStart;
  let reachedCleanup, releaseCleanup;
  const cleanupEntered = new Promise(resolve => reachedCleanup = resolve);
  const cleanupAllowed = new Promise(resolve => releaseCleanup = resolve);
  t.mock.method(fs.default, 'mkdtemp', async function (prefix, ...args) {
    if (String(prefix).endsWith('cloud-backup-storage-') && ++directories === 2) cleanupAtSecondStart = cleanupCompleted;
    return Reflect.apply(temporary, this, [prefix, ...args]);
  });
  t.mock.method(fs.default, 'rm', async function (path, ...args) {
    if (path === firstRoot) {
      reachedCleanup(); await cleanupAllowed;
      const result = await Reflect.apply(remove, this, [path, ...args]);
      cleanupCompleted = true; return result;
    }
    return Reflect.apply(remove, this, [path, ...args]);
  });
  t.mock.method(childProcess.default, 'spawn', function (binary, args, options) {
    if (args[0] === 'mini' && !firstRoot) {
      firstRoot = dirname(args.find(arg => arg.startsWith('-dir=')).slice(5));
      const port = Number(args.find(arg => arg.startsWith('-filer.port=')).split('=')[1]);
      owner = new Server(); owner.listen(port, '127.0.0.1');
    }
    return spawn(binary, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.after(() => releaseCleanup());
  t.after(() => owner?.listening ? new Promise(resolve => owner.close(resolve)) : undefined);
  t.after(() => storage?.stop());
  const starting = startBackupStorage().then(value => { storage = value; return value; });
  starting.catch(() => {});
  try {
    await Promise.race([cleanupEntered, starting.then(() => { throw new Error('failed fixture cleanup was not observed'); })]);
  } finally { releaseCleanup(); }
  await starting;
  assert.equal(cleanupAtSecondStart, true, 'the failed directory must be removed before the next attempt begins');
  assert.equal(directories, 2);
  assert.equal(owner.listening, true);
});
