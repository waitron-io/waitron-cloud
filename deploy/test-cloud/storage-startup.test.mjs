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
