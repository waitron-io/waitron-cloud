import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer, connect} from 'node:net';
import test from 'node:test';

const helper = await import('./storage-control-diagnostics.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

// Removing live forwarding hides the active operation when the outer test times out.
for (const throwing of [false, true]) test('admin progress is visible before its child exits' + (throwing ? ' when reporting throws' : ''), {timeout:5000}, async t => {
  assert.equal(typeof helper.storageControlOutput, 'function');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    process.stderr.write('storage_admin_progress={"operation":"bucket-exhausted","state":"started"}\\n');
    process.on('message', () => process.exit(7));
  `], {stdio:['ignore','pipe','pipe','ipc']});
  const finished = once(child, 'exit');
  t.after(async () => {if (child.exitCode === null) {child.kill('SIGTERM'); await finished;}});
  let observed;
  const live = new Promise(resolve => {observed = resolve;});
  const output = helper.storageControlOutput(child, text => {observed(text); if (throwing) throw Error('sink refused');});
  assert.match(await live, /bucket-exhausted/);
  assert.equal(child.exitCode, null, 'progress must arrive while the child is held');
  child.send('finish');
  assert.deepEqual(await finished, [7,null]);
  assert.match(output(), /storage_admin_progress=/, 'forwarding must retain the failure transcript');
});

// Removing bind attribution loses the exact failed phase and competing owner.
test('an unexpected control bind refusal identifies its stage, socket and live owner', {timeout:10000}, async t => {
  assert.equal(typeof helper.listenStorageControl, 'function');
  const owner = createServer(socket => socket.end('outside owner'));
  await new Promise(resolve => owner.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => owner.close(resolve)));
  const port = owner.address().port;
  let original;
  const replacement = createServer();
  replacement.once('error', error => {original = error;});
  await assert.rejects(helper.listenStorageControl(replacement, port, 'cleanup-rebind'), error => {
    assert.equal(error, original, 'diagnostics must retain the original socket error');
    assert.equal(error.code, 'EADDRINUSE');
    assert.equal(error.storageControl.stage, 'cleanup-rebind');
    assert.equal(error.storageControl.port, port);
    assert.equal(error.storageControl.socketOwners.source, 'lsof');
    assert.match(error.storageControl.socketOwners.output, new RegExp('p' + process.pid + '\\b'));
    assert.match(error.storageControl.socketOwners.output, new RegExp(':' + port + '\\b'));
    return true;
  });
  const socket = connect(port, '127.0.0.1');
  let body = '';
  socket.on('data', bytes => {body += bytes;});
  await once(socket, 'end');
  assert.equal(body, 'outside owner', 'diagnostics must leave the competing listener alive');
});

// A missing diagnostic tool must not replace the bind refusal.
test('a missing socket inspector reports its own limit and keeps the bind failure', {timeout:5000}, async t => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {createServer} from 'node:net';
    import {listenStorageControl} from ${JSON.stringify(new URL('./storage-control-diagnostics.mjs', import.meta.url).href)};
    const owner = createServer();
    await listenStorageControl(owner, 0, 'owner');
    try {
      const replacement = createServer();
      let original;
      replacement.once('error', error => {original = error;});
      await assert.rejects(listenStorageControl(replacement, owner.address().port, 'cleanup-rebind'), error => {
        assert.equal(error, original);
        assert.equal(error.code, 'EADDRINUSE');
        assert.deepEqual(error.storageControl.socketOwners, {source:'unavailable',reason:'ENOENT'});
        return true;
      });
    } finally {await new Promise(resolve => owner.close(resolve));}
  `], {env:{...process.env,PATH:''},stdio:['ignore','pipe','pipe']});
  const finished = once(child, 'exit');
  t.after(async () => {if (child.exitCode === null && child.signalCode === null) {child.kill('SIGTERM'); await finished;}});
  let output = '';
  child.stderr.on('data', bytes => {output += bytes;});
  assert.deepEqual(await finished, [0,null], output);
});
