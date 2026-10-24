import assert from 'node:assert/strict';
import test from 'node:test';
import {Server} from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';

// Reproduce the observed S3 diagnostic after a real OS bind refusal. A child
// probe isolates port ownership from the separate native store's readiness.
async function collide(t, attempts) {
  const spawn = childProcess.spawn;
  const owners = [], children = [], allocations = [];
  let storage;
  t.after(() => Promise.all(owners.filter(owner => owner.listening).map(owner => new Promise(resolve => owner.close(resolve)))));
  t.after(() => storage?.stop());
  // Reserve probe ports before intercepting the synchronous child spawn.
  for (let index = 0; index < attempts; index++) {
    const owner = new Server();
    await new Promise((resolve, reject) => { owner.once('error', reject); owner.listen(0, '127.0.0.1', resolve); });
    owners.push(owner);
  }
  t.mock.method(childProcess, 'spawn', (binary, args, options) => {
    if (args[0] !== 'mini') return spawn(binary, args, options);
    const s3 = Number(args.find(arg => arg.startsWith('-s3.port=')).split('=')[1]);
    const grpcFlag = args.find(arg => arg.startsWith('-s3.port.grpc='));
    const grpc = grpcFlag ? Number(grpcFlag.split('=')[1]) : owners[children.length].address().port;
    allocations.push({s3, grpc});
    let child;
    if (children.length < attempts) {
      const owner = owners[children.length];
      if (grpcFlag) { owner.close(); owner.listen(grpc, '127.0.0.1'); }
      const source = `require('node:net').createServer().on('error', error => {
        if (error.code !== 'EADDRINUSE') throw error;
        process.stderr.write('W1024 15:20:26.678074 mini.go:1043 gRPC port 33646 for Admin is not available, finding alternative...\\nF1024 15:20:27.307292 s3.go:440 s3 failed to listen on grpc port ${grpc}: listen tcp 127.0.0.1:${grpc}: bind: address already in use\\n');
        process.exit(72);
      }).listen(${grpc}, '127.0.0.1');`;
      child = spawn(process.execPath, ['-e', source], options);
    } else child = spawn(binary, args, options);
    children.push(child);
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return {owners, children, allocations, async start(options) { storage = await startBackupStorage(options); return storage; }};
}

test('an S3 gRPC bind refusal retries once and starts a working store without stopping the competing owner', {timeout:90000}, async t => {
  const fixture = await collide(t, 1);
  const storage = await fixture.start();
  assert.equal(fixture.children.length, 2);
  assert.equal(fixture.children[0].exitCode, 72, 'the child must encounter the real occupied port');
  assert.notEqual(fixture.allocations[0].grpc, fixture.allocations[1].grpc, 'the retry must choose a fresh gRPC port');
  assert.equal(fixture.owners[0].listening, true, 'the competing listener is not owned by the fixture');
  await storage.bucket('ready-after-s3-grpc-collision');
});

test('two S3 gRPC bind refusals stop after the permitted retry and retain both competing listeners', {timeout:90000}, async t => {
  const fixture = await collide(t, 2);
  await assert.rejects(fixture.start(), error => {
    assert.match(error.message, /s3 failed to listen on grpc port/);
    assert.equal(fixture.children.length, 2, 'there must be exactly two failed attempts');
    assert.equal(error.storageStartup.ports.s3Grpc, fixture.allocations[1].grpc, 'diagnostics must include the actual S3 gRPC allocation');
    return true;
  });
  assert.equal(fixture.children.length, 2, 'there must be no third attempt');
  assert.ok(fixture.children.every(child => child.exitCode === 72));
  assert.equal(fixture.owners.filter(owner => owner.listening).length, 2);
});

test('disabled retries retain the first S3 gRPC failure and its competing listener', {timeout:90000}, async t => {
  const fixture = await collide(t, 1);
  await assert.rejects(fixture.start({retryPortCollision:false}), error => {
    assert.match(error.message, /s3 failed to listen on grpc port/);
    assert.equal(error.storageStartup.ports.s3Grpc, fixture.allocations[0].grpc);
    return true;
  });
  assert.equal(fixture.children.length, 1);
  assert.equal(fixture.children[0].exitCode, 72);
  assert.equal(fixture.owners[0].listening, true);
});
