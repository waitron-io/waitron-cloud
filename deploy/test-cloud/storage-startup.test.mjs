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
  t.mock.method(childProcess.default, 'spawn', function (binary, args, options) {
    if (args[0] === 'mini') {
      allocated = Number(args.find(arg => arg.startsWith('-filer.port=')).split('=')[1]);
      owner = new Server();
      owner.listen(allocated, '127.0.0.1');
    }
    return originalSpawn(binary, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.after(() => owner?.listening ? new Promise(resolve => owner.close(resolve)) : undefined);
  await assert.rejects(startBackupStorage(), error => {
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
