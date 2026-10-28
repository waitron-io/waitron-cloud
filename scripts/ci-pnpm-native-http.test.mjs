import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const observer = new URL('./ci-pnpm-diagnostics.cjs', import.meta.url).pathname;
const marker = 'pnpm-setup-diagnostic ';
async function run(command, args, extra = {}) {
  const env = {...process.env, NODE_OPTIONS: `--require=${observer}`, ...extra};
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(command, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  child.stdout.on('data', data => {stdout += data;});
  child.stderr.on('data', data => {stderr += data;});
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({code, signal}));
    });
    assert.equal(result.signal, null, stdout + stderr);
    return {...result, stdout, stderr, records: stderr.split('\n').filter(line => line.startsWith(marker)).map(line => JSON.parse(line.slice(marker.length)))};
  } finally {clearTimeout(timer);}
}
const node = source => run(process.execPath, ['--input-type=module', '-e', source]);
async function registry(handler, check) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {await check(`http://127.0.0.1:${server.address().port}`);}
  finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
}
function get(url) {
  return `import {get} from 'node:http';
    await new Promise(resolve => {
      const request = get(${JSON.stringify(url)}, {headers: {authorization: 'Bearer header-secret'}}, response => {
        response.resume(); response.on('error', error => {console.log(error.code); process.exitCode = 7; resolve();});
        response.on('end', resolve);
      });
      request.on('error', error => {console.log(error.code); process.exitCode = 7; resolve();});
    });`;
}

// Removing native request observation must hide this real npm failure, even though
// Undici observation still works. npm uses Node's HTTP client during self-install.
test('real npm metadata reset identifies the missing native HTTP boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pnpm-npm-observer-'));
  writeFileSync(join(root, 'npmrc'), '');
  try {
    await registry((request, response) => {
      response.writeHead(200, {'content-type': 'application/json', 'content-length': '1000'});
      response.write('{"secret":"body-secret",');
      setTimeout(() => response.destroy(), 15);
    }, async base => {
      const result = await run('npm', ['view', 'pnpm', 'version', '--registry=' + base, '--fetch-retries=0', '--fetch-timeout=1000', '--cache=' + join(root, 'cache'), '--userconfig=' + join(root, 'npmrc')]);
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /ECONNRESET/);
      const error = result.records.find(row => row.event === 'http-error' && row.client === 'node');
      assert.ok(error, 'npm exits without naming its failed metadata transfer');
      assert.equal(error.endpoint, '/pnpm'); assert.equal(error.status, 200);
      assert.equal(error.error.code, 'ECONNRESET'); assert.equal(error.stage, 'response');
      assert.equal(error.registry, 'other');
      assert.doesNotMatch(JSON.stringify(result.records), /body-secret|127\.0\.0\.1|npmrc|cache/);
    });
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('native cut-off package tarball reports its stage without URL details', async () => {
  await registry((request, response) => {
    response.writeHead(200, {'content-length': '1000'}); response.write('body-secret');
    setTimeout(() => response.destroy(), 15);
  }, async base => {
    const result = await node(get(base + '/pnpm/-/pnpm-11.19.0.tgz?query-secret'));
    assert.equal(result.code, 7); assert.match(result.stdout, /ECONNRESET/);
    const error = result.records.find(row => row.event === 'http-error');
    assert.ok(error); assert.equal(error.endpoint, '/pnpm/-/tarball');
    assert.equal(error.status, 200); assert.equal(error.stage, 'response');
    assert.equal(error.error.code, 'ECONNRESET');
    assert.equal(result.records.some(row => row.event === 'http-transfer-complete'), false);
    assert.doesNotMatch(result.stderr, /query-secret|header-secret|body-secret|127\.0\.0\.1|11\.19\.0/);
  });
});

test('native reset before headers names the request stage and preserves its failure', async () => {
  await registry(request => request.socket.destroy(), async base => {
    const result = await node(get(base + '/@pnpm%2fexe?query-secret'));
    assert.equal(result.code, 7);
    const error = result.records.find(row => row.event === 'http-error');
    assert.ok(error); assert.equal(error.endpoint, '/@pnpm/exe');
    assert.equal(error.stage, 'request'); assert.equal(error.error.code, 'ECONNRESET');
    assert.equal(error.status, undefined);
  });
});

for (const status of [200, 503]) test('native completed metadata response remains usable with HTTP ' + status, async () => {
  await registry((request, response) => {response.writeHead(status); response.end('body-secret');}, async base => {
    const result = await node(get(base + '/@pnpm%2flinux-x64'));
    assert.equal(result.code, 0);
    const headers = result.records.find(row => row.event === (status === 503 ? 'http-status' : 'http-headers'));
    assert.ok(headers); assert.equal(headers.status, status);
    assert.ok(result.records.some(row => row.event === 'http-transfer-complete' && row.id === headers.id && row.status === status));
    assert.equal(result.records.some(row => row.event === 'http-error'), false);
    assert.doesNotMatch(result.stderr, /body-secret|header-secret|127\.0\.0\.1/);
  });
});

test('native diagnostics leave an unhandled request error unhandled', async () => {
  await registry(request => request.socket.destroy(), async base => {
    const result = await node(`import {get} from 'node:http'; get(${JSON.stringify(base + '/pnpm')});`);
    assert.equal(result.code, 1);
    assert.ok(result.records.some(row => row.event === 'http-error' && row.stage === 'request'));
  });
});

test('unknown native metadata and tarball paths stay outside the allowlist', async () => {
  await registry((request, response) => response.end('ok'), async base => {
    for (const path of ['/private-secret', '/private-secret/-/private-secret-1.0.0.tgz', '/pnpm/-/secret.tgz', '/@pnpm/exe/-/not-exe-9.15.0.tgz']) {
      const result = await node(get(base + path));
      assert.equal(result.code, 0);
      assert.equal(result.records.some(row => row.event.startsWith('http-')), false);
      assert.doesNotMatch(result.stderr, /private-secret|secret\.tgz/);
    }
  });
});

test('native successful traffic cannot exhaust failure and lifecycle records', async () => {
  await registry((request, response) => {
    if (request.url.includes('broken')) request.socket.destroy(); else response.end('ok');
  }, async base => {
    const result = await node(`import {get} from 'node:http';
      for (let i = 0; i < 60; i++) await new Promise(resolve => {
        const request = get(${JSON.stringify(base)} + '/pnpm' + (i >= 45 ? '?broken' : ''), response => {response.resume(); response.on('end', resolve);});
        request.on('error', resolve);
      }); process.exitCode = 9;`);
    assert.equal(result.code, 9);
    assert.equal(result.records.filter(row => row.event === 'http-error').length, 8);
    assert.ok(result.records.some(row => row.event === 'process-exit' && row.code === 9));
    assert.ok(result.records.length <= 42);
  });
});

test('native public-registry label requires both the destination and Host header', async () => {
  const result = await node(`
    import {channel} from 'node:diagnostics_channel'; import {EventEmitter} from 'node:events';
    for (const [protocol, host, header] of [
      ['https:', 'registry.npmjs.org', 'registry.npmjs.org'],
      ['https:', 'private-secret.invalid', 'registry.npmjs.org'],
      ['http:', 'registry.npmjs.org', 'registry.npmjs.org'],
      ['https:', 'registry.npmjs.org', 'private-secret.invalid'],
    ]) {
      const request = Object.assign(new EventEmitter(), {path: '/pnpm', protocol, host, getHeader: () => header});
      channel('http.client.request.start').publish({request});
    }`);
  assert.equal(result.code, 0);
  assert.deepEqual(result.records.filter(row => row.event === 'http-start').map(row => row.registry), ['npm', 'other', 'other', 'other']);
  assert.doesNotMatch(result.stderr, /private-secret/);
});

test('native observation leaves the response paused until the caller consumes it', async () => {
  await registry((request, response) => response.end('complete caller body'), async base => {
    const result = await node(`import {get} from 'node:http';
      await new Promise((resolve, reject) => get(${JSON.stringify(base + '/pnpm')}, response => {
        setTimeout(() => {
          console.log(response.readableFlowing);
          let body = ''; response.on('data', data => {body += data;});
          response.on('end', () => {console.log(body); resolve();});
          response.on('error', reject);
        }, 20);
      }).on('error', reject));`);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'null\ncomplete caller body\n');
    assert.ok(result.records.some(row => row.event === 'http-transfer-complete'));
  });
});
