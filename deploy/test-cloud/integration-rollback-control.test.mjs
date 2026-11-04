import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Removing the refusal reader loses the code between the venue socket and the Docker child's stderr.
test('the private control process reports a rollback code without its response body', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-rollback-control-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const login = createServer((req, res) => {
    assert.equal(req.url, '/management-api/session');
    res.setHeader('set-cookie', 'session=local');
    res.end('{}');
  });
  await new Promise(resolve => login.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => login.close(resolve)));
  await writeFile(join(root, 'ready.json'), JSON.stringify({origin: 'http://127.0.0.1:' + login.address().port}));
  const proof = createServer((req, res) => {
    assert.equal(req.url, '/rollback-refresh');
    res.statusCode = 500;
    res.end(JSON.stringify({error: 'private-password', diagnostic: 'integration.rollback_refused:drain:cloud.busy', privateKey: 'private-key'}));
  });
  await new Promise(resolve => proof.listen(join(root, 'proof.sock'), resolve));
  t.after(() => new Promise(resolve => proof.close(resolve)));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./test-fixtures/integration-control.mjs', import.meta.url))], {
    env: {...process.env, CLOUD_TEST_ROOT: root}, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '', error = '';
  child.stdout.on('data', part => {output += part;});
  child.stderr.on('data', part => {error += part;});
  const closed = new Promise((resolve, reject) => {child.once('error', reject); child.once('close', resolve);});
  child.stdin.end(JSON.stringify({phase: 'rollback-refresh'}));
  assert.equal(await closed, 1);
  assert.equal(output, '');
  assert.match(error, /integration\.rollback_refused:drain:cloud\.busy/);
  assert.doesNotMatch(error, /private-password|private-key/);
});
