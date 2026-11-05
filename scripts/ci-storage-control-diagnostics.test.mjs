import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
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

// Listening-only queries miss a socket bound before its owner calls listen.
test('a refused bind identifies a process that holds the port without listening', {timeout:10000}, async t => {
  const owner = spawn('python3', ['-u','-c',
    "import socket,sys; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1],flush=True); sys.stdin.readline()"],
    {stdio:['pipe','pipe','pipe']});
  const finished = once(owner, 'exit');
  t.after(async () => {if (owner.exitCode === null && owner.signalCode === null) {owner.kill('SIGTERM'); await finished;}});
  const lines = createInterface({input:owner.stdout});
  t.after(() => lines.close());
  const [line] = await once(lines, 'line'), port = Number(line);
  await assert.rejects(helper.listenStorageControl(createServer(), port, 'cleanup-rebind'), error => {
    assert.equal(error.code, 'EADDRINUSE');
    const snapshot = process.platform === 'linux'
      ? error.storageControl.socketOwners.boundInactive : error.storageControl.socketOwners;
    assert.equal(snapshot?.source, process.platform === 'linux' ? 'ss' : 'lsof');
    assert.match(snapshot.output, new RegExp((process.platform === 'linux' ? 'pid=' : 'p') + owner.pid + '\\b'));
    assert.match(snapshot.output, new RegExp(':' + port + '\\b'));
    return true;
  });
  assert.equal(owner.exitCode, null, 'inspection must preserve the non-listening owner');
});

// Inspector refusal, truncation and termination must not erase partial socket evidence.
for (const mode of ['refused','slow','ignores-term','oversized','signal']) test('socket inspection retains evidence: ' + mode, {timeout:12000}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'storage-inspector-control-'));
  t.after(() => rm(directory, {recursive:true,force:true}));
  const body = mode === 'refused' ? "print('p4242'); print('controlled inspector refusal',file=sys.stderr); sys.exit(1)"
    : mode === 'slow' ? "time.sleep(2.2); print('p4242')"
    : mode === 'oversized' ? "print('p4242',flush=True); print('x' * 100000)"
    : mode === 'signal' ? "import os; print('p4242',flush=True); os.kill(os.getpid(),signal.SIGHUP)"
    : "signal.signal(signal.SIGTERM,signal.SIG_IGN); print('p4242',flush=True); time.sleep(10)";
  const python = await new Promise((resolve,reject) => {
    const child = spawn('python3',['-c','import sys; print(sys.executable)']);
    let output = ''; child.stdout.on('data', data => {output += data;});
    child.once('error',reject); child.once('exit', code => code === 0 ? resolve(output.trim()) : reject(Error('python lookup failed')));
  });
  await writeFile(join(directory,'lsof'), '#!' + python + '\nimport sys,time,signal\n' + body + '\n', {mode:0o700});
  const child = spawn(process.execPath, ['--input-type=module','-e', `
    import assert from 'node:assert/strict';
    import {createServer} from 'node:net';
    import {listenStorageControl} from ${JSON.stringify(new URL('./storage-control-diagnostics.mjs', import.meta.url).href)};
    const owner = createServer();
    await listenStorageControl(owner,0,'owner');
    try {
      const replacement = createServer(); let original;
      replacement.once('error',error => {original = error;});
      const started = performance.now();
      await assert.rejects(listenStorageControl(replacement,owner.address().port,'cleanup-rebind'),error => {
        assert.equal(error,original);
        const snapshot = error.storageControl.socketOwners;
        assert.equal(snapshot.source,'lsof');
        assert.match(snapshot.output,/p4242/);
        if (${JSON.stringify(mode)} === 'refused') {
          assert.equal(snapshot.status,1);
          assert.match(snapshot.stderr,/controlled inspector refusal/);
        }
        if (${JSON.stringify(mode)} === 'oversized') assert.equal(snapshot.reason,'ENOBUFS');
        if (${JSON.stringify(mode)} === 'signal') {
          assert.equal(snapshot.signal,'SIGHUP');
          assert.equal(snapshot.reason,'signal_SIGHUP');
        }
        if (${JSON.stringify(mode)} === 'ignores-term') {
          assert.equal(snapshot.signal,'SIGKILL');
          assert.equal(snapshot.reason,'ETIMEDOUT');
          assert.ok(performance.now() - started < 8000, 'inspection must terminate its own unresponsive command');
        }
        return true;
      });
    } finally {await new Promise(resolve => owner.close(resolve));}
  `], {env:{...process.env,PATH:directory},stdio:['ignore','pipe','pipe']});
  const finished = once(child,'exit');
  t.after(async () => {if (child.exitCode === null && child.signalCode === null) {child.kill('SIGTERM'); await finished;}});
  let output = ''; child.stderr.on('data', data => {output += data;});
  assert.deepEqual(await finished,[0,null],output);
});


// Linux can refuse a server bind while an outgoing connection owns its local port.
if (process.platform === 'linux') test('socket attribution includes an outgoing connection owner', {timeout:10000}, async t => {
  const sockets = [], server = createServer(socket => sockets.push(socket));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const client = connect(server.address().port,'127.0.0.1');
  t.after(async () => {
    client.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  await once(client,'connect');
  const port = client.localPort;
  await assert.rejects(helper.listenStorageControl(createServer(),port,'cleanup-rebind'), error => {
    assert.equal(error.code,'EADDRINUSE');
    assert.equal(error.storageControl.socketOwners.source,'lsof');
    assert.match(error.storageControl.socketOwners.output,new RegExp('p' + process.pid + '\\b'));
    assert.match(error.storageControl.socketOwners.output,new RegExp(':' + port + '\\b'));
    return true;
  });
});
