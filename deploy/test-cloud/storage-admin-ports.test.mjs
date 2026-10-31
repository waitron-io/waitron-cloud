import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createServer, connect} from 'node:net';
import {access, readFile, rm} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';

async function readOwner(port) {
  return new Promise((resolve, reject) => {
    const socket = connect({host:'127.0.0.1', port});
    let body = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('competing listener did not reply')));
    socket.setEncoding('utf8');
    socket.on('data', bytes => { body += bytes; });
    socket.on('error', reject);
    socket.on('end', () => resolve(body));
  });
}

for (const {kinds, explicit} of [
  {kinds:['HTTP'], explicit:false},
  {kinds:['gRPC'], explicit:false},
  {kinds:['HTTP', 'gRPC'], explicit:false},
  {kinds:['HTTP'], explicit:true},
]) {
  test(`native storage ${explicit ? 'refuses explicit' : 'recovers from'} occupied admin ${kinds.join(' and ')} ports`, {timeout:90000}, async t => {
    const owners = [];
    const children = [];
    const roots = [];
    let storage;
    t.after(async () => {
      try { await storage?.stop(); }
      finally {
        for (const child of children) {
          if (child.exitCode !== null || child.signalCode !== null) continue;
          const exited = new Promise(resolve => child.once('exit', resolve));
          child.kill('SIGKILL');
          await exited;
        }
        await Promise.all(roots.map(root => rm(root, {recursive:true, force:true})));
        await Promise.all(owners.filter(owner => owner.server.listening).map(owner =>
          new Promise(resolve => owner.server.close(resolve))));
      }
    });
    for (const kind of kinds) {
      const marker = `owned-admin-${kind}`;
      const server = createServer(socket => socket.end(marker));
      owners.push({kind, marker, server});
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      owners.at(-1).port = server.address().port;
    }
    const spawn = childProcess.spawn;
    t.mock.method(childProcess, 'spawn', (binary, args, options) => {
      if (args[0] !== 'mini') return spawn(binary, args, options);
      const occupied = owners.map(owner =>
        `admin.port${owner.kind === 'gRPC' ? '.grpc' : ''}=${owner.port}`);
      // Saved settings retain automatic port selection. An explicit HTTP flag
      // instead requires that exact port and cannot reproduce default fallback.
      if (!explicit) writeFileSync(join(options.env.HOME, 'data', 'mini.options'), occupied.join('\n') + '\n');
      const child = spawn(binary, [...args, ...(explicit ? occupied.map(value => '-' + value) : [])], options);
      children.push(child);
      roots.push(options.env.HOME);
      return child;
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

    if (explicit) {
      const http = owners.find(owner => owner.kind === 'HTTP');
      await assert.rejects(startBackupStorage(), error => {
        assert.match(error.message, new RegExp(`^SeaweedFS exited: .*Port allocation failed: port ${http.port} for Admin \\(specified by flag admin.port\\)`));
        assert.equal(Object.values(error.storageStartup.ports).includes(http.port), false, 'admin refusal must not impersonate a reserved service collision');
        return true;
      });
      assert.equal(children.length, 1, 'an unreserved admin refusal must not trigger the service-port retry');
    } else {
      storage = await startBackupStorage({retryPortCollision:false});
      assert.equal(children.length, 1, 'admin fallback must not restart the storage fixture');
      assert.equal(children[0].exitCode, null, 'the real storage child must remain alive');
      const log = await readFile(join(storage.root, 'store.log'), 'utf8');
      for (const owner of owners) {
        const refusal = owner.kind === 'HTTP'
          ? `Port ${owner.port} for Admin is not available on 127.0.0.1, finding alternative port`
          : `gRPC port ${owner.port} for Admin is not available, finding alternative`;
        assert.ok(log.includes(refusal), `the native child must encounter the occupied ${owner.kind} port`);
        assert.equal(await readOwner(owner.port), owner.marker);
      }
      const location = await storage.bucket('admin-collision-ready');
      assert.equal(location.endpoint, storage.endpoint);
      assert.equal(location.bucket, 'admin-collision-ready');
      await storage.stop();
      storage = undefined;
    }
    assert.ok(children[0].exitCode !== null || children[0].signalCode !== null, 'owned storage child must exit');
    for (const root of roots) await assert.rejects(access(root), {code:'ENOENT'});
    for (const owner of owners) assert.equal(await readOwner(owner.port), owner.marker, 'cleanup must preserve the competing listener');
  });
}
