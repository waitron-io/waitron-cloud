import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const marker = 'pnpm-setup-diagnostic ';
function setupOptions(file) {
  const workflow = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
  return [...workflow.matchAll(/      - run: node scripts\/ci-setup-pnpm\.mjs\n([\s\S]*?)(?=      - |^  [a-z]|$(?![\s\S]))/gm)]
    .map(([, step]) => (step.match(/NODE_OPTIONS: (.+)/)?.[1] ?? '')
      .replaceAll('${{ github.workspace }}', repository));
}
async function child(source, options = setupOptions('ci.yml')[0]) {
  const env = {...process.env, NODE_OPTIONS: options};
  delete env.NODE_TEST_CONTEXT;
  const processChild = spawn(process.execPath, ['--input-type=module', '-e', source], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  processChild.stdout.on('data', data => {stdout += data;});
  processChild.stderr.on('data', data => {stderr += data;});
  const stop = setTimeout(() => processChild.kill('SIGKILL'), 10_000);
  try {
    const result = await new Promise((resolve, reject) => {
      processChild.once('error', reject);
      processChild.once('close', (code, signal) => resolve({code, signal}));
    });
    assert.equal(result.signal, null, stdout + stderr);
    const records = stderr.split('\n').filter(line => line.startsWith(marker)).map(line => JSON.parse(line.slice(marker.length)));
    return {...result, stdout, stderr, records};
  } finally {clearTimeout(stop);}
}
async function registry(run) {
  const server = createServer((request, response) => {
    response.writeHead(request.url.includes('unavailable') ? 503 : 200, {'content-type': 'application/json'});
    if (request.url.includes('broken')) {
      response.write('{"secret":"body-secret",');
      response.flushHeaders();
      setTimeout(() => response.destroy(), 15);
    } else response.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {return await run(`http://127.0.0.1:${server.address().port}`);}
  finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
}

// Losing the response-error subscription would reduce the verifier's failed body read to "terminated" again.
test('setup names a cut-off metadata body without exposing its URL, headers or body', async () => {
  await registry(async base => {
    const result = await child(`try {
      await (await fetch(${JSON.stringify(base + '/@pnpm%2flinux-x64?broken=query-secret')},
        {headers: {authorization: 'Bearer header-secret'}})).text();
    } catch (error) {console.log(error.message); process.exitCode = 7;}`);
    assert.equal(result.code, 7);
    assert.match(result.stdout, /terminated/);
    const failure = result.records.find(row => row.event === 'http-error');
    assert.ok(failure, `Missing the cause behind terminated: ${result.stderr}`);
    assert.equal(failure.endpoint, '/@pnpm/linux-x64');
    assert.equal(failure.status, 200);
    assert.equal(failure.error.code, 'UND_ERR_SOCKET');
    assert.equal(failure.registry, 'other');
    assert.doesNotMatch(result.stderr, /query-secret|header-secret|body-secret|127\.0\.0\.1/);
    assert.ok(result.records.some(row => row.event === 'process-exit' && row.code === 7));
  });
});

test('setup reports an HTTP refusal separately from a completed metadata response', async () => {
  await registry(async base => {
    const result = await child(`
      console.log(await (await fetch(${JSON.stringify(base + '/pnpm')})).text());
      console.log((await fetch(${JSON.stringify(base + '/@pnpm%2fexe?unavailable')})).status);`);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /\{"ok":true\}\n503/);
    assert.ok(result.records.some(row => row.event === 'http-transfer-complete' && row.endpoint === '/pnpm' && row.status === 200));
    assert.ok(result.records.some(row => row.event === 'http-status' && row.endpoint === '/@pnpm/exe' && row.status === 503));
    assert.ok(result.records.some(row => row.event === 'process-start' && /^v\d+/.test(row.node)));
  });
});

test('setup preserves the first network failure and final exit after the normal log budget is full', async () => {
  await registry(async base => {
    const result = await child(`
      for (let i = 0; i < 50; i++) await (await fetch(${JSON.stringify(base + '/pnpm')})).text();
      for (let i = 0; i < 12; i++) {
        try {await (await fetch(${JSON.stringify(base + '/@pnpm%2flinux-x64?broken')})).text();} catch {}
      }
      process.exitCode = 9;`);
    assert.equal(result.code, 9);
    const errors = result.records.filter(row => row.event === 'http-error');
    assert.equal(errors.length, 8);
    assert.equal(errors[0].id, 51);
    assert.ok(result.records.some(row => row.event === 'process-exit' && row.code === 9));
    assert.ok(result.records.length <= 50, `Unbounded diagnostic output: ${result.records.length}`);
  });
});

test('setup reports a child process signal and spawn refusal without command arguments', async () => {
  const result = await child(`
    import {spawn} from 'node:child_process';
    const child = spawn(process.execPath, ['-e', "process.kill(process.pid, 'SIGTERM')", 'argument-secret']);
    await new Promise(resolve => child.once('close', resolve));
    const missing = spawn('/missing/path-secret', ['argument-secret']);
    await new Promise(resolve => missing.once('error', resolve));
    console.log('parent survived');`);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /parent survived/);
  assert.ok(result.records.some(row => row.event === 'child-exit' && row.signal === 'SIGTERM' && row.code === null));
  assert.ok(result.records.some(row => row.event === 'child-error' && row.error.code === 'ENOENT'));
  assert.doesNotMatch(result.stderr, /argument-secret|path-secret/);
});

test('every workflow setup invocation loads the observer in the installer process', async () => {
  for (const workflow of ['ci.yml', 'cloud-cost.yml', 'password-derivation-diagnostic.yml', 'relay-counter-diagnostic.yml', 'ui-release.yml']) {
    const configurations = setupOptions(workflow);
    assert.ok(configurations.length > 0, workflow);
    for (const options of configurations) {
      const result = await child('process.exitCode = 13;', options);
      assert.equal(result.code, 13);
      assert.ok(result.records.some(row => row.event === 'process-exit' && row.code === 13), `${workflow} setup missed diagnostics`);
    }
  }
});

test('observing a child spawn error preserves Node\'s unhandled-error failure', async () => {
  const result = await child(`
    import {spawn} from 'node:child_process';
    spawn('/missing/installer');`);
  assert.equal(result.code, 1, 'The observer must not turn an unhandled error into success');
  assert.ok(result.records.some(row => row.event === 'child-error' && row.error.code === 'ENOENT'));
});

test('unknown endpoints and unsafe error details never enter diagnostic records', async () => {
  const result = await child(`
    import {channel} from 'node:diagnostics_channel';
    for (const path of ['/secret-package?token=secret', '/pnpm/secret-path', '/%invalid', '/@pnpm%2flinux-x64?secret']) {
      const request = {path, origin: 'https://user:secret@private-secret.invalid'};
      channel('undici:request:create').publish({request});
      const error = new Error('secret'); error.name = 'name-secret'; error.code = 'code-secret';
      error.cause = {name: 'SocketError', code: 'UND_ERR_SOCKET', message: 'secret'};
      channel('undici:request:error').publish({request, error});
    }`);
  assert.equal(result.code, 0);
  const failures = result.records.filter(row => row.event === 'http-error');
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].error, {name: 'other', cause: {name: 'SocketError', code: 'UND_ERR_SOCKET'}});
  assert.doesNotMatch(result.stderr, /secret|invalid/);
});

test('installer worker threads have distinct identities even when they share a process', async () => {
  const result = await child(`
    import {Worker} from 'node:worker_threads';
    const worker = new Worker('process.exitCode = 0;', {eval: true});
    await new Promise(resolve => worker.once('exit', resolve));`);
  assert.equal(result.code, 0);
  const starts = result.records.filter(row => row.event === 'process-start');
  assert.equal(starts.length, 2);
  assert.equal(new Set(starts.map(row => row.pid)).size, 1);
  assert.deepEqual(starts.map(row => row.thread).sort(), [0, 1]);
  assert.ok(starts.every(row => Number.isSafeInteger(row.time)));
});

test('setup observes both published macOS metadata endpoints', async () => {
  await registry(async base => {
    const result = await child(`
      for (const name of ['macos-arm64', 'macos-x64']) {
        try {await (await fetch(${JSON.stringify(base)} + '/@pnpm%2f' + name + '?broken')).text();} catch {}
      }`);
    assert.equal(result.code, 0);
    assert.deepEqual(result.records.filter(row => row.event === 'http-error').map(row => row.endpoint),
      ['/@pnpm/macos-arm64', '/@pnpm/macos-x64']);
  });
});

test('malformed diagnostic events cannot change the installer outcome', async () => {
  const result = await child(`
    import {channel} from 'node:diagnostics_channel';
    const request = {path: '/pnpm', origin: 'https://registry.npmjs.org'};
    channel('undici:request:create').publish({request});
    for (const event of ['undici:request:create', 'undici:request:headers', 'undici:request:trailers', 'undici:request:error', 'child_process']) {
      channel(event).publish(null);
      channel(event).publish({});
    }
    channel('undici:request:headers').publish({request});
    console.log('installer continued');`);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /installer continued/);
});

test('setup labels only the canonical public registry as npm', async () => {
  const result = await child(`
    import {channel} from 'node:diagnostics_channel';
    for (const origin of ['https://registry.npmjs.org', 'https://registry.npmjs.org.private-secret.invalid', 'https://user:secret@registry.npmjs.org']) {
      channel('undici:request:create').publish({request: {path: '/pnpm', origin}});
    }`);
  assert.equal(result.code, 0);
  assert.deepEqual(result.records.filter(row => row.event === 'http-start').map(row => row.registry), ['npm', 'other', 'other']);
  assert.doesNotMatch(result.stderr, /secret/);
});

test('an HTTP refusal remains visible after successful requests exhaust the normal budget', async () => {
  await registry(async base => {
    const result = await child(`
      for (let i = 0; i < 20; i++) await (await fetch(${JSON.stringify(base + '/pnpm')})).text();
      await (await fetch(${JSON.stringify(base + '/@pnpm%2fexe?unavailable')})).text();`);
    assert.equal(result.code, 0);
    assert.ok(result.records.some(row => row.event === 'http-status' && row.status === 503 && row.id === 21));
  });
});

test('the parent limits child lifecycle records separately from process exit', async () => {
  const result = await child(`
    import {spawn} from 'node:child_process';
    for (let i = 0; i < 12; i++) {
      const worker = spawn(process.execPath, ['-e', ''], {env: {...process.env, NODE_OPTIONS: ''}});
      await new Promise(resolve => worker.once('close', resolve));
    }`);
  assert.equal(result.code, 0);
  assert.equal(result.records.filter(row => row.event === 'child-exit').length, 8);
  assert.ok(result.records.some(row => row.event === 'process-exit' && row.code === 0));
  assert.equal(result.records.length, 10);
});

test('a closed diagnostic destination cannot fail setup or its exit handler', async () => {
  const result = await child(`
    import {closeSync} from 'node:fs';
    import {channel} from 'node:diagnostics_channel';
    closeSync(2);
    channel('undici:request:create').publish({request: {path: '/pnpm', origin: 'https://registry.npmjs.org'}});
    console.log('setup continued');`);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /setup continued/);
});

test('a cyclic error cause remains bounded and does not hide its first code', async () => {
  const result = await child(`
    import {channel} from 'node:diagnostics_channel';
    const request = {path: '/pnpm', origin: 'https://registry.npmjs.org'};
    const error = new Error('not logged'); error.code = 'UND_ERR_SOCKET'; error.cause = error;
    channel('undici:request:create').publish({request});
    channel('undici:request:error').publish({request, error});`);
  assert.equal(result.code, 0);
  let cause = result.records.find(row => row.event === 'http-error')?.error;
  for (let i = 0; i < 4; i++) {assert.equal(cause?.code, 'UND_ERR_SOCKET'); cause = cause.cause;}
  assert.equal(cause, undefined);
});
