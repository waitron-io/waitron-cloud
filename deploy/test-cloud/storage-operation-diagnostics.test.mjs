import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import test from 'node:test';

const helper = await import('./storage-operation-diagnostics.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

// Dropping a failed operation's label makes an aborted request untraceable again.
for (const operation of ['startup', 'authority-open', 'bucket-create', 'provision',
  'identity-reload', 'writer-put', 'reader-get']) {
  test('storage refusal identifies only the fixed operation: ' + operation, async () => {
    assert.equal(typeof helper.storageOperations, 'function');
    const messages = [], refusal = Object.freeze(Error('PRIVATE_CREDENTIAL_CANARY'));
    const run = helper.storageOperations(message => messages.push(message));
    await assert.rejects(run(operation, async () => {throw refusal;}), error => error === refusal);
    assert.deepEqual(messages, ['storage_authority_operation=' + operation]);
  });
}

test('storage operation returns the original result without reporting success', async () => {
  assert.equal(typeof helper.storageOperations, 'function');
  const messages = [], result = {ready: true};
  assert.equal(await helper.storageOperations(message => messages.push(message))('provision', async () => result), result);
  assert.deepEqual(messages, []);
});

test('diagnostic output cannot replace a synchronous operation refusal', async () => {
  assert.equal(typeof helper.storageOperations, 'function');
  const refusal = Error('PRIVATE_OPERATION'), messages = [];
  const run = helper.storageOperations(message => {messages.push(message); throw Error('PRIVATE_REPORTER');});
  await assert.rejects(run('reader-get', () => {throw refusal;}), error => error === refusal);
  assert.deepEqual(messages, ['storage_authority_operation=reader-get']);
});

test('diagnostics neither inspect rejected values nor coerce unknown operation labels', async () => {
  assert.equal(typeof helper.storageOperations, 'function');
  let inspections = 0;
  const trapped = new Proxy({}, {get() {inspections++; throw Error('PRIVATE_ACCESSOR');}});
  const messages = [], run = helper.storageOperations(message => messages.push(message));
  for (const operation of ['PRIVATE_ENDPOINT', trapped, null]) {
    const result = await run(operation, () => {throw trapped;})
      .then(() => ({rejected: false}), error => ({rejected: true, error}));
    assert.equal(result.rejected, true);
    assert.equal(result.error, trapped);
  }
  assert.equal(inspections, 0);
  assert.deepEqual(messages, []);
});

// Removing a wrapper from the real delayed-reload case must lose this evidence.
for (const [command, bucket, operation] of [
  ['CreateBucketCommand', 'managed-delayed-reload', 'bucket-create'],
  ['ListObjectsV2Command', 'managed-delayed-reload', 'provision'],
  ['PutObjectCommand', 'managed-delayed-reload', 'writer-put'],
  ['GetObjectCommand', 'managed-delayed-reload', 'reader-get'],
]) test('real authority case retains an aborted ' + operation, {timeout:90000}, async t => {
  const probe = `
    import {createRequire} from 'node:module';
    const require = createRequire(${JSON.stringify(new URL('../../packages/backups/package.json', import.meta.url).href)});
    const {S3Client} = require('@aws-sdk/client-s3');
    const send = S3Client.prototype.send;
    S3Client.prototype.send = function(command, options) {
      if (command.constructor.name === ${JSON.stringify(command)} && command.input.Bucket === ${JSON.stringify(bucket)})
        return send.call(this, command, {...options, abortSignal: AbortSignal.abort(new DOMException('controlled transport deadline', 'TimeoutError'))});
      return send.call(this, command, options);
    };
  `;
  const environment = {...process.env};
  delete environment.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(probe),
    '--test', '--test-name-pattern=^provision waits until the provider has applied both writer and reader identities$',
    new URL('./storage-authority.test.mjs', import.meta.url).pathname], {env: environment, stdio: ['ignore', 'pipe', 'pipe']});
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {child.kill('SIGTERM'); await once(child, 'exit');}
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', text => {output += text;});
  child.stderr.setEncoding('utf8').on('data', text => {output += text;});
  const [code, signal] = await once(child, 'exit');
  assert.equal(signal, null, output);
  assert.equal(code, 1, output);
  assert.match(output, /test_cloud.storage_withdrawal_unverified|AbortError/, output);
  assert.match(output, new RegExp('storage_authority_operation=' + operation + '(?:\\r?\\n|$)'), output);
  assert.match(output, /(?:#|ℹ) fail 1\b/, output);
});
