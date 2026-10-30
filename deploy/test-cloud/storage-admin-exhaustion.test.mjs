import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createServer, connect} from 'node:net';
import {access, readFile, rm} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomInt} from 'node:crypto';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';

async function close(servers) {
  await Promise.all(servers.filter(server => server.listening).map(server =>
    new Promise(resolve => server.close(resolve))));
}

async function occupyAdminRange() {
  // The native allocator tries the original port and its next 100 neighbours.
  // Keep every reservation open so another process cannot enter that range.
  for (let attempt = 0; attempt < 20; attempt++) {
    const servers = [];
    const firstPort = randomInt(10000, 65436);
    try {
      for (let index = 0; index < 101; index++) {
        const server = createServer(socket => {
          // Native readiness probes may reset their non-gRPC connection.
          socket.on('error', () => {});
          socket.end(`admin-owner-${index}`);
        });
        servers.push(server);
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(firstPort + index, '127.0.0.1', resolve);
        });
      }
      if (servers.length === 101) return servers;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') { await close(servers); throw error; }
    }
    await close(servers);
  }
  throw new Error('could not reserve an owned contiguous admin-port range');
}

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

test('native storage remains usable with exhausted admin gRPC ports and preserves every port owner on cleanup', {timeout:90000}, async t => {
  const owners = await occupyAdminRange();
  const firstPort = owners[0].address().port;
  const children = [], roots = [];
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
      await close(owners);
    }
  });
  const spawn = childProcess.spawn;
  t.mock.method(childProcess, 'spawn', (binary, args, options) => {
    if (args[0] !== 'mini') return spawn(binary, args, options);
    // Saved settings select the automatic fallback path without an explicit flag.
    writeFileSync(join(options.env.HOME, 'data', 'mini.options'), `admin.port.grpc=${firstPort}\n`);
    const child = spawn(binary, args, options);
    children.push(child);
    roots.push(options.env.HOME);
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  storage = await startBackupStorage({retryPortCollision:false});
  assert.equal(children.length, 1, 'admin exhaustion must not restart the storage fixture');
  assert.equal(children[0].exitCode, null, 'the storage child must remain alive');
  const log = await readFile(join(storage.root, 'store.log'), 'utf8');
  assert.ok(log.includes(`Could not find available gRPC port for Admin starting from ${firstPort + 1}`), 'the native child must exhaust every fallback port');
  const location = await storage.bucket('admin-exhaustion-ready');
  assert.equal(location.endpoint, storage.endpoint);
  assert.equal(location.bucket, 'admin-exhaustion-ready');
  await storage.stop();
  storage = undefined;
  assert.ok(children[0].exitCode !== null || children[0].signalCode !== null, 'cleanup must stop its owned child');
  for (const root of roots) await assert.rejects(access(root), {code:'ENOENT'});
  for (let index = 0; index < owners.length; index++) {
    assert.equal(await readOwner(firstPort + index), `admin-owner-${index}`, 'cleanup must preserve every competing listener');
  }

  t.mock.restoreAll();
  syncBuiltinESMExports();
  await close(owners);
  storage = await startBackupStorage({retryPortCollision:false});
  const recovered = await storage.bucket('admin-exhaustion-recovered');
  assert.equal(recovered.endpoint, storage.endpoint);
  assert.equal(recovered.bucket, 'admin-exhaustion-recovered');
  const recoveredRoot = storage.root;
  await storage.stop();
  storage = undefined;
  await assert.rejects(access(recoveredRoot), {code:'ENOENT'});
});
