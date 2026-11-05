import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess from 'node:child_process';
import {once} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {readlink, access, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer, connect} from 'node:net';
import {randomInt} from 'node:crypto';
import crypto from 'node:crypto';
import {startBackupStorage} from './backup-storage-fixture.mjs';
import {releaseStorageControlClaims} from '../deploy/test-cloud/storage-admin-control-cleanup.mjs';

// Admin test listeners must not occupy a service port while its owner is between
// releasing its reservation socket and starting the native listener.
for (const {exhausted, occupied, http = false} of [
  {exhausted:false, occupied:false}, {exhausted:false, occupied:true}, {exhausted:true, occupied:false},
  {exhausted:false, occupied:false, http:true},
]) test(`admin ${exhausted ? 'exhaustion' : http ? 'HTTP fallback' : 'fallback'} listeners preserve a paused native service handoff${occupied ? ' after an occupied candidate' : ''}`, {timeout:120000}, async t => {
  const spawn = childProcess.spawn, choose = crypto.randomInt;
  let native, announceSpawn, store, control, output = '';
  let port, root;
  const controlChildren = [], controlRoots = new Set();
  const spawned = new Promise(resolve => { announceSpawn = resolve; });
  if (http) t.mock.method(crypto, 'randomInt', (min, max, ...rest) =>
    min === 32768 && max === 61000 ? choose(32768, 42668) : choose(min, max, ...rest));
  t.mock.method(childProcess, 'spawn', (binary, args, options) => {
    if (args[0] !== 'mini') return spawn(binary, args, options);
    native = spawn('sh', ['-c', 'kill -STOP $$; exec "$@"', 'sh', binary, ...args], options);
    port = Number(args.find(arg => arg.startsWith('-s3.port=')).split('=')[1]);
    root = options.env.HOME;
    announceSpawn();
    return native;
  });
  syncBuiltinESMExports();
  const starting = startBackupStorage({retryPortCollision:false});
  starting.catch(() => {});
  t.after(async () => {
    if (native?.exitCode === null && native.signalCode === null) native.kill('SIGCONT');
    if (control?.exitCode === null && control.signalCode === null) {
      const exited = once(control, 'close');
      control.kill('SIGTERM');
      await exited;
    }
    for (const child of controlChildren) {
      if (child.exited) continue;
      try { process.kill(child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await releaseStorageControlClaims(controlRoots);
    await Promise.all([...controlRoots].map(path => rm(path, {recursive:true, force:true})));
    const result = await Promise.allSettled([starting]);
    if (result[0].status === 'fulfilled') store = result[0].value;
    try { await store?.stop(); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    if (root) await assert.rejects(access(root), {code:'ENOENT'});
    if (native) assert.ok(native.exitCode !== null || native.signalCode !== null, 'collect the owned native child');
  });
  await spawned;
  const deadline = Date.now() + 5000;
  while (!childProcess.execFileSync('ps', ['-o', 'stat=', '-p', String(native.pid)], {encoding:'utf8'}).includes('T')) {
    assert.ok(Date.now() < deadline, 'pause the owned native child before creating admin listeners');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const claim = join('/tmp', 'waitron-cloud-storage-ports-' + process.getuid(), String(port));
  assert.equal(await readlink(claim), root);
  let competingPort;
  if (occupied) {
    const competitor = createServer(socket => socket.end('outside-admin-owner'));
    t.after(() => competitor.listening ? new Promise(resolve => competitor.close(resolve)) : undefined);
    for (let attempt = 0; ; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          competitor.once('error', reject);
          competitor.listen(randomInt(10000, 22668), '127.0.0.1', resolve);
        });
        break;
      } catch (error) { if (error.code !== 'EADDRINUSE' || attempt === 19) throw error; }
    }
    competingPort = competitor.address().port;
  }
  const probe = `
    import crypto from 'node:crypto';
    import net from 'node:net';
    import childProcess from 'node:child_process';
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const choose = crypto.randomInt, create = net.createServer, spawn = childProcess.spawn;
    const report = record => console.error('admin_handoff=' + JSON.stringify(record));
    const allocate = fs.mkdtemp;
    fs.mkdtemp = async (...args) => {
      const root = await allocate(...args);
      if (String(args[0]).endsWith('cloud-backup-storage-')) report({kind:'root', root});
      return root;
    };
    let selected = false, servers = 0;
    let selectedOccupied = false;
    crypto.randomInt = (min, max, ...rest) => {
      if (${occupied} && !selectedOccupied && min <= ${competingPort ?? 0} && max > ${competingPort ?? 0}) {
        selectedOccupied = true;
        report({kind:'occupied-selected'});
        return ${competingPort ?? 0};
      }
      if (${http} && !selected && min <= ${port - 10001} && max > ${port - 10001}) {
        selected = true;
        report({kind:'derived-collision'});
        return ${port - 10001};
      }
      if (${exhausted} && !selected && min <= ${port - 50} && max > ${port - 50}) {
        selected = true;
        return ${port} - 50;
      }
      // Probe an unsafe interval at its upper edge so a widened range cannot
      // escape the ownership check merely because its random draw was lucky.
      if (min < 32768 && max - 1 + ${exhausted ? 200 : 10100} >= 32768) return max - 1;
      return choose(min, max, ...rest);
    };
    net.createServer = (...args) => {
      const server = create(...args), listen = server.listen;
      const admin = servers++ < ${exhausted ? 101 : 1};
      server.listen = function(candidate, ...rest) {
        if (!${exhausted} && !selected && candidate === 0) {selected = true; candidate = ${port};}
        if (admin) report({kind:'candidate', port:candidate});
        return listen.call(this, candidate, ...rest);
      };
      return server;
    };
    childProcess.spawn = (binary, args, options) => {
      if (args[0] === 'mini') report({kind:'admin-ready'});
      const child = spawn(binary, args, options);
      if (args[0] === 'mini') {
        report({kind:'owned', pid:child.pid, root:options.env.HOME});
        child.once('exit', () => report({kind:'collected', pid:child.pid}));
      }
      return child;
    };
    syncBuiltinESMExports();
  `;
  const environment = {...process.env};
  delete environment.NODE_TEST_CONTEXT;
  const file = exhausted ? 'storage-admin-exhaustion.test.mjs' : 'storage-admin-ports.test.mjs';
  const pattern = exhausted ? 'native storage remains usable' : '^native storage recovers from occupied admin ' + (http ? 'HTTP' : 'gRPC') + ' ports$';
  control = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(probe),
    '--test-isolation=none', '--test', '--test-name-pattern=' + pattern,
    new URL('../deploy/test-cloud/' + file, import.meta.url).pathname],
  {env:environment, stdio:['ignore','pipe','pipe']});
  let announceReady, diagnostic = '', derivedCollision = false, occupiedSelected = false;
  const adminCandidates = [];
  const ready = new Promise(resolve => { announceReady = resolve; });
  control.stdout.setEncoding('utf8').on('data', text => { output += text; });
  control.stderr.setEncoding('utf8').on('data', text => {
    output += text;
    diagnostic += text;
    const lines = diagnostic.split('\n');
    diagnostic = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('admin_handoff=')) continue;
      const message = JSON.parse(line.slice('admin_handoff='.length));
      if (message.kind === 'derived-collision') derivedCollision = true;
      if (message.kind === 'occupied-selected') occupiedSelected = true;
      if (message.kind === 'candidate') adminCandidates.push(message.port);
      if (message.kind === 'admin-ready') announceReady();
      if (message.kind === 'root') controlRoots.add(message.root);
      if (message.kind === 'owned') controlChildren.push({pid:message.pid});
      if (message.kind === 'collected') {
        const child = controlChildren.find(child => child.pid === message.pid);
        if (child) child.exited = true;
      }
    }
  });
  const finished = once(control, 'close');
  await Promise.race([ready, finished.then(() => { throw Error(output); })]);
  if (derivedCollision) {
    const deadline = Date.now() + 5000;
    while (true) {
      const listening = await new Promise(resolve => {
        const socket = connect({host:'127.0.0.1', port});
        socket.setTimeout(100, () => socket.destroy());
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
        socket.once('close', () => resolve(false));
      });
      if (listening) break;
      assert.ok(Date.now() < deadline, 'the controlled derived gRPC listener must bind before resuming its peer');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  native.kill('SIGCONT');
  store = await starting;
  assert.equal((await store.bucket('admin-peer-handoff')).endpoint, store.endpoint);
  assert.equal(await readlink(claim), root, 'the original peer keeps its claim');
  const [code, signal] = await finished;
  assert.equal(signal, null, output);
  assert.equal(code, 0, output);
  assert.match(output, /(?:#|ℹ) pass 1\b/, output);
  assert.match(output, /(?:#|ℹ) fail 0\b/, output);
  assert.ok(adminCandidates.length >= (exhausted ? 101 : 1), 'observe the real admin listener attempts');
  for (const candidate of adminCandidates) assert.ok(candidate + (exhausted ? 100 : 10100) < 32768,
    'admin listeners and their derived fallback ports must remain below the service range' +
    ` (port=${candidate}, firstAttempted=${adminCandidates[0]})`);
  assert.ok(controlChildren.every(child => child.exited), 'the original admin case collects its native child');
  for (const path of controlRoots) await assert.rejects(access(path), {code:'ENOENT'});
  if (occupied) {
    assert.equal(occupiedSelected, true, 'the occupied candidate must actually be selected');
    assert.ok(adminCandidates.includes(competingPort), 'the occupied candidate must reach the real bind');
    const marker = await new Promise((resolve, reject) => {
      const socket = connect({host:'127.0.0.1', port:competingPort});
      let body = '';
      socket.setTimeout(2000, () => socket.destroy(Error('competing owner did not reply')));
      socket.setEncoding('utf8');
      socket.on('data', text => { body += text; });
      socket.on('error', reject);
      socket.on('end', () => resolve(body));
    });
    assert.equal(marker, 'outside-admin-owner', 'the occupied admin candidate must retain its owner');
  }
});
