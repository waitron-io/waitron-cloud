import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {rm,readdir,readlink,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

async function ownedClaims(roots) {
  const directory = '/tmp/waitron-cloud-storage-ports-' + process.getuid();
  const paths = [];
  const entries = await readdir(directory).catch(error => {if (error.code === 'ENOENT') return []; throw error;});
  for (const name of entries) {
    const path = join(directory,name);
    try {if (roots.has(await readlink(path))) paths.push(path);}
    catch (error) {if (!['ENOENT','EINVAL'].includes(error.code)) throw error;}
  }
  return paths;
}

function launchControl(t, {cancel = false, beforeSpawn = false} = {}) {
  const probe = `
    import childProcess from 'node:child_process';
    import {syncBuiltinESMExports, createRequire} from 'node:module';
    import fs, {existsSync} from 'node:fs';
    import {releaseStorageControlClaims} from ${JSON.stringify(new URL('./storage-admin-control-cleanup.mjs', import.meta.url).href)};
    const require = createRequire(${JSON.stringify(new URL('../../packages/backups/package.json', import.meta.url).href)});
    const {S3Client} = require('@aws-sdk/client-s3');
    const originalSend = S3Client.prototype.send;
    S3Client.prototype.send = function(command, options) {
      if (command.constructor.name === 'CreateBucketCommand' && command.input.Bucket === 'admin-exhaustion-ready') {
        process.send({kind:'held'});
        return new Promise((resolve, reject) => {
          if (!${cancel}) setTimeout(() => reject(Error('controlled admin bucket refusal')), 5200);
        });
      }
      return originalSend.call(this, command, options);
    };
    const originalSpawn = childProcess.spawn, children = [], roots = new Set(), pendingRoots = [];
    let stopping = false;
    const makeRoot = fs.promises.mkdtemp;
    fs.promises.mkdtemp = function(prefix, options) {
      if (stopping) throw Error('admin control cancelled');
      const made = makeRoot(prefix, options);
      if (!prefix.endsWith('cloud-backup-storage-')) return made;
      const recorded = made.then(root => {roots.add(root); process.send({kind:'root',root}); return root;});
      pendingRoots.push(recorded);
      return ${beforeSpawn} ? recorded.then(() => {process.send({kind:'held'}); return new Promise(() => {});}) : recorded;
    };
    const cancelControl = async () => {
      stopping = true;
      try {
        await Promise.allSettled(pendingRoots);
        for (const child of children) {
          if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
          let timer;
          const exited = new Promise(resolve => child.once('exit', resolve));
          child.kill('SIGTERM');
          try {await Promise.race([exited, new Promise(resolve => {timer = setTimeout(resolve, 1000);})]);}
          finally {clearTimeout(timer);}
          if (child.exitCode === null && child.signalCode === null) {child.kill('SIGKILL'); await exited;}
        }
        await releaseStorageControlClaims(roots);
        await Promise.all([...roots].map(root => fs.promises.rm(root, {recursive:true,force:true})));
      } finally {process.exit(1);}
    };
    process.on('message', message => {if (message?.kind === 'cancel' && !stopping) void cancelControl();});
    process.channel.unref();
    childProcess.spawn = function(binary, args, options) {
      if (stopping) throw Error('admin control cancelled');
      const child = originalSpawn(binary, args, options);
      if (args[0] === 'mini') {
        children.push(child); roots.add(options.env.HOME);
        process.send({kind:'owned',pid:child.pid,root:options.env.HOME});
        child.once('exit', () => {try {process.send({kind:'collected',pid:child.pid});} catch {}});
      }
      return child;
    };
    syncBuiltinESMExports();
    process.on('exit', () => console.error('storage_admin_control_cleanup=' + JSON.stringify({
      children:children.length, allExited:children.every(child => child.exitCode !== null || child.signalCode !== null),
      rootsRemoved:[...roots].every(root => !existsSync(root))
    })));
  `;
  const environment = {...process.env};
  delete environment.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(probe),
    '--test-isolation=none', '--test', new URL('./storage-admin-exhaustion.test.mjs', import.meta.url).pathname],
    {env:environment, stdio:['ignore','pipe','pipe','ipc']});
  let output = '', held;
  const ready = new Promise(resolve => {held = resolve;}), owners = [], roots = new Set();
  child.on('message', message => {
    if (message.kind === 'owned') {owners.push(message); roots.add(message.root);}
    if (message.kind === 'root') roots.add(message.root);
    if (message.kind === 'collected') {const owner = owners.find(owner => owner.pid === message.pid); if (owner) owner.exited = true;}
    if (message.kind === 'held') held();
  });
  child.stdout.setEncoding('utf8').on('data', text => {output += text;});
  child.stderr.setEncoding('utf8').on('data', text => {output += text;});
  const finished = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const timer = setTimeout(() => child.kill('SIGTERM'), 5000);
      try {child.send({kind:'cancel'}); await finished;} finally {clearTimeout(timer);}
    }
    // Failed controls still own only the children and roots recorded by this invocation.
    for (const owner of owners) {
      if (owner.exited) continue;
      try {process.kill(owner.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
    }
    for (const path of await ownedClaims(roots)) await unlink(path).catch(error => {if (error.code !== 'ENOENT') throw error;});
    await Promise.all([...roots].map(root => rm(root, {recursive:true,force:true})));
  });
  return {child, ready, finished, owners, roots, output:() => output};
}

// Removing the installed operation wrapper must lose the waiting/refusal evidence.
test('the native admin case reports a held bucket request and then cleans its owned storage', {timeout:120000}, async t => {
  const control = launchControl(t);
  const [code, signal] = await control.finished, output = control.output();
  assert.equal(signal, null, output);
  assert.equal(code, 1, output);
  assert.match(output, /controlled admin bucket refusal/, output);
  const records = [...output.matchAll(/storage_admin_progress=(\{[^\r\n]*\})/g)].map(match => JSON.parse(match[1]));
  const bucket = records.filter(record => record.operation === 'bucket-exhausted');
  assert.equal(bucket[0]?.state, 'started', output);
  assert.ok(bucket.some(record => record.state === 'waiting'), output);
  assert.equal(bucket.at(-1)?.state, 'refused', output);
  assert.ok(bucket[1].operationElapsedMs > 0, output);
  assert.ok(bucket.at(-1).operationElapsedMs >= bucket[1].operationElapsedMs, output);
  assert.ok(records.some(record => record.operation === 'cleanup' && record.state === 'completed'), output);
  assert.match(output, /storage_admin_control_cleanup=\{"children":1,"allExited":true,"rootsRemoved":true\}/, output);
  assert.match(output, /(?:#|ℹ) fail 1\b/, output);
});

for (const beforeSpawn of [false, true]) test('cancelling the admin control collects owned resources ' + (beforeSpawn ? 'before spawn' : 'after spawn'), {timeout:120000}, async t => {
  const control = launchControl(t, {cancel:true,beforeSpawn});
  await Promise.race([control.ready, control.finished.then(() => {throw Error(control.output());})]);
  assert.equal(control.owners.length, beforeSpawn ? 0 : 1);
  assert.equal(control.roots.size, 1);
  control.child.send({kind:'cancel'});
  await control.finished;
  for (const owner of control.owners) {
    assert.throws(() => process.kill(owner.pid, 0), {code:'ESRCH'}, 'cancelled control must collect its native child: ' + control.output());
  }
  for (const root of control.roots) assert.equal(existsSync(root), false, 'cancelled control must remove its owned scratch');
  assert.deepEqual(await ownedClaims(control.roots), [], 'cancelled control must release its cooperative port claims');
});
