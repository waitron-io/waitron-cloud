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
      for (const name of ['http.client.request.created', 'http.client.request.start']) channel(name).publish({request});
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

async function npmView(base, timeout = 1000) {
  const root = mkdtempSync(join(tmpdir(), 'pnpm-npm-connection-'));
  writeFileSync(join(root, 'npmrc'), '');
  try {
    return await run('npm', ['view', 'pnpm', 'version', '--registry=' + base, '--fetch-retries=0', '--fetch-timeout=' + timeout, '--cache=' + join(root, 'cache'), '--userconfig=' + join(root, 'npmrc')]);
  } finally {rmSync(root, {recursive: true, force: true});}
}

for (const protocol of ['http', 'https']) test('real npm connection reset is observed before a socket is assigned for ' + protocol, async () => {
  const {createServer} = await import('node:net');
  const server = createServer(socket => socket.resetAndDestroy());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await npmView(protocol + '://127.0.0.1:' + server.address().port);
    assert.notEqual(result.code, 0); assert.match(result.stderr, /ECONNRESET/);
    const error = result.records.find(row => row.event === 'http-error');
    assert.ok(error, 'connection setup must name its failed request');
    assert.equal(error.endpoint, '/pnpm'); assert.equal(error.stage, 'request');
    assert.equal(error.error.code, 'ECONNRESET'); assert.equal(error.registry, 'other');
  } finally {await new Promise(resolve => server.close(resolve));}
});

test('real npm connection refusal is observed before a socket is assigned', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  await new Promise(resolve => server.close(resolve));
  const result = await npmView(base);
  assert.notEqual(result.code, 0); assert.match(result.stderr, /ECONNREFUSED/);
  const error = result.records.find(row => row.event === 'http-error');
  assert.ok(error); assert.equal(error.endpoint, '/pnpm');
  assert.equal(error.stage, 'request'); assert.equal(error.error.code, 'ECONNREFUSED');
});

test('native observation preserves automatic response draining without a caller handler', async () => {
  await registry((request, response) => response.end('caller ignores this body'), async base => {
    const result = await node(`import {get} from 'node:http';
      await new Promise(resolve => {
        get(${JSON.stringify(base + '/pnpm')}).on('close', () => {console.log('request closed'); resolve();});
      });`);
    assert.equal(result.code, 0); assert.equal(result.stdout, 'request closed\n');
    assert.ok(result.records.some(row => row.event === 'http-transfer-complete'));
  });
});

test('real TCP reset during a native response emits one response-stage failure', async () => {
  await registry((request, response) => {
    response.writeHead(200, {'content-length': '1000'}); response.write('partial');
    setTimeout(() => request.socket.resetAndDestroy(), 20);
  }, async base => {
    const result = await node(get(base + '/pnpm'));
    assert.equal(result.code, 7);
    const errors = result.records.filter(row => row.event === 'http-error');
    assert.equal(errors.length, 1, 'one network failure must use only one failure record');
    assert.equal(errors[0].stage, 'response'); assert.equal(errors[0].status, 200);
    assert.equal(errors[0].error.code, 'ECONNRESET');
  });
});

test('real npm timeout records its client abort without declaring a network cause', async () => {
  await registry(() => {}, async base => {
    const result = await npmView(base, 100);
    assert.notEqual(result.code, 0); assert.match(result.stderr, /FETCH_ERROR.*|network timeout/);
    const error = result.records.find(row => row.event === 'http-error');
    assert.ok(error); assert.equal(error.stage, 'request');
    assert.equal(error.clientAborted, true);
  });
});

test('a server reset is not reported as a caller abort', async () => {
  await registry(request => request.socket.resetAndDestroy(), async base => {
    const result = await npmView(base);
    assert.notEqual(result.code, 0);
    const error = result.records.find(row => row.event === 'http-error');
    assert.ok(error); assert.equal(error.clientAborted, false);
  });
});

test('a caller abort queued behind an occupied native socket retains its diagnostic', async () => {
  await registry(() => {}, async base => {
    const result = await node(`import assert from 'node:assert/strict'; import {Agent, get} from 'node:http';
      const agent = new Agent({maxSockets: 1});
      const occupied = get(${JSON.stringify(base + '/private-secret')}, {agent});
      occupied.on('error', () => {});
      await new Promise(resolve => occupied.once('finish', resolve));
      const request = get(${JSON.stringify(base + '/pnpm?query-secret')}, {agent, headers: {authorization: 'header-secret'}});
      request.on('error', () => {});
      assert.equal(request.socket, null);
      await new Promise(resolve => {request.once('abort', resolve); request.abort();});
      console.log('cancelled before socket');
      occupied.destroy(); agent.destroy(); process.exitCode = 7;`);
    assert.equal(result.code, 7); assert.equal(result.stdout, 'cancelled before socket\n');
    const errors = result.records.filter(row => row.event === 'http-error');
    assert.equal(errors.length, 1, 'a caller cancellation must not depend on a later request error');
    assert.equal(errors[0].endpoint, '/pnpm'); assert.equal(errors[0].stage, 'request');
    assert.equal(errors[0].clientAborted, true); assert.equal(errors[0].error.name, 'AbortError');
    assert.equal(errors[0].error.code, undefined);
    assert.doesNotMatch(result.stderr, /private-secret|query-secret|header-secret|127\.0\.0\.1/);
  });
});

test('a caller exiting on native abort retains one diagnostic before socket close', async () => {
  await registry(() => {}, async base => {
    const result = await node(`import {get} from 'node:http';
      const request = get(${JSON.stringify(base + '/pnpm')});
      request.on('error', () => {});
      request.once('abort', () => process.exit(7));
      request.once('finish', () => request.abort());`);
    assert.equal(result.code, 7);
    const errors = result.records.filter(row => row.event === 'http-error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].stage, 'request'); assert.equal(errors[0].clientAborted, true);
    assert.equal(errors[0].error.name, 'AbortError'); assert.equal(errors[0].error.code, undefined);
    assert.equal(result.records.some(row => row.event === 'process-exit' && row.code === 7), true);
  });
});

test('aborting native cleanup after a completed response does not invent a failure', async () => {
  await registry((request, response) => response.end('complete caller body'), async base => {
    const result = await node(`import {get} from 'node:http';
      await new Promise(resolve => {
        const request = get(${JSON.stringify(base + '/pnpm')}, response => {
          let body = ''; response.on('data', data => {body += data;});
          response.once('end', () => {request.abort(); console.log(body); resolve();});
        }); request.on('error', () => {});
      });`);
    assert.equal(result.code, 0); assert.equal(result.stdout, 'complete caller body\n');
    assert.equal(result.records.filter(row => row.event === 'http-error').length, 0);
    assert.equal(result.records.filter(row => row.event === 'http-transfer-complete').length, 1);
  });
});

test('aborting a partial native response emits one cancellation despite its later reset', async () => {
  await registry((request, response) => {
    response.writeHead(200, {'content-length': '1000'}); response.write('body-secret');
  }, async base => {
    const result = await node(`import {get} from 'node:http';
      await new Promise(resolve => {
        const request = get(${JSON.stringify(base + '/pnpm')}, response => {
          response.once('error', error => {console.log(error.code); resolve();});
          response.once('data', () => request.abort());
        }); request.on('error', () => {});
      }); process.exitCode = 7;`);
    assert.equal(result.code, 7); assert.equal(result.stdout, 'ECONNRESET\n');
    const errors = result.records.filter(row => row.event === 'http-error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].stage, 'response'); assert.equal(errors[0].status, 200);
    assert.equal(errors[0].clientAborted, true);
    assert.equal(errors[0].error.name, 'AbortError'); assert.equal(errors[0].error.code, undefined);
    assert.equal(result.records.some(row => row.event === 'http-transfer-complete'), false);
    assert.doesNotMatch(result.stderr, /body-secret|127\.0\.0\.1/);
  });
});
