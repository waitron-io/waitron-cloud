import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import test from 'node:test';

// Removing the installed operation wrapper must lose the waiting/refusal evidence.
test('the native admin case reports a held bucket request and then cleans its owned storage', {timeout:120000}, async t => {
  const probe = `
    import childProcess from 'node:child_process';
    import {syncBuiltinESMExports, createRequire} from 'node:module';
    import {existsSync} from 'node:fs';
    const require = createRequire(${JSON.stringify(new URL('../../packages/backups/package.json', import.meta.url).href)});
    const {S3Client} = require('@aws-sdk/client-s3');
    const originalSend = S3Client.prototype.send;
    S3Client.prototype.send = function(command, options) {
      if (command.constructor.name === 'CreateBucketCommand' && command.input.Bucket === 'admin-exhaustion-ready')
        return new Promise((resolve, reject) => setTimeout(() => reject(Error('controlled admin bucket refusal')), 5200));
      return originalSend.call(this, command, options);
    };
    const originalSpawn = childProcess.spawn, children = [], roots = [];
    childProcess.spawn = function(binary, args, options) {
      const child = originalSpawn(binary, args, options);
      if (args[0] === 'mini') {children.push(child); roots.push(options.env.HOME);}
      return child;
    };
    syncBuiltinESMExports();
    process.on('exit', () => console.error('storage_admin_control_cleanup=' + JSON.stringify({
      children:children.length, allExited:children.every(child => child.exitCode !== null || child.signalCode !== null),
      rootsRemoved:roots.every(root => !existsSync(root))
    })));
  `;
  const environment = {...process.env};
  delete environment.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(probe),
    '--test', new URL('./storage-admin-exhaustion.test.mjs', import.meta.url).pathname],
    {env:environment, stdio:['ignore','pipe','pipe']});
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {child.kill('SIGTERM'); await once(child, 'exit');}
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', text => {output += text;});
  child.stderr.setEncoding('utf8').on('data', text => {output += text;});
  const [code, signal] = await once(child, 'exit');
  assert.equal(signal, null, output);
  assert.equal(code, 1, output);
  assert.match(output, /controlled admin bucket refusal/, output);
  const records = [...output.matchAll(/storage_admin_progress=(\{[^\r\n]*\})/g)].map(match => JSON.parse(match[1]));
  const bucket = records.filter(record => record.operation === 'bucket-exhausted');
  assert.equal(bucket[0]?.state, 'started', output);
  assert.ok(bucket.some(record => record.state === 'waiting'), output);
  assert.equal(bucket.at(-1)?.state, 'refused', output);
  assert.ok(bucket[1].operationElapsedMs >= 5000, output);
  assert.ok(records.some(record => record.operation === 'cleanup' && record.state === 'completed'), output);
  assert.match(output, /storage_admin_control_cleanup=\{"children":1,"allExited":true,"rootsRemoved":true\}/, output);
  assert.match(output, /(?:#|ℹ) fail 1\b/, output);
});
