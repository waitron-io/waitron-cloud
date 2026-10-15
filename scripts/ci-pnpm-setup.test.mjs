import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

// A setup action that inherits npm's long registry waits can consume the test budget.
test('every pnpm bootstrap refuses an unresponsive registry within its network budget', {timeout: 50_000}, async () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const steps = [...workflow.matchAll(/      - uses: pnpm\/action-setup@v6\n([\s\S]*?)(?=      - |^  [a-z]|$(?![\s\S]))/gm)];
  assert.equal(steps.length, 4, 'Every pnpm bootstrap must be exercised');
  const configurations = steps.map(([, source]) => Object.fromEntries([...source.matchAll(/          (npm_config_[a-z_]+): ['"]?([0-9]+)['"]?\s*$/gm)].map(([, key, value]) => [key, value])));
  // Each actual action receives the same policy; one npm child exercises that policy.
  for (const configuration of configurations) assert.deepEqual(configuration, configurations[0]);
  const root = mkdtempSync(join(tmpdir(), 'cloud-pnpm-network-'));
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/synthetic-ci-bootstrap.tgz') {requests++; return;}
    response.writeHead(200, {'content-type': 'application/json'}).end('{}');
  });
  let child;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const registry = `http://127.0.0.1:${server.address().port}`;
    const dependencies = {'synthetic-ci-bootstrap': '1.0.0'};
    writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'setup-fixture', version: '1.0.0', dependencies}));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({name: 'setup-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
      packages: {'': {name: 'setup-fixture', version: '1.0.0', dependencies}, 'node_modules/synthetic-ci-bootstrap': {
        version: '1.0.0', resolved: `${registry}/synthetic-ci-bootstrap.tgz`, integrity: 'sha512-YQ==',
      }}}));
    writeFileSync(join(root, 'npmrc'), '');
    let output = '';
    const started = performance.now();
    child = spawn('npm', ['ci', '--cache', join(root, 'cache'), '--registry', registry], {
      cwd: root, env: {...process.env, npm_config_userconfig: join(root, 'npmrc'), ...configurations[0]}, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => {output += data;});
    child.stderr.on('data', data => {output += data;});
    const stop = setTimeout(() => child.kill('SIGKILL'), 35_000);
    let result;
    try {
      result = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal}));});
    } finally {clearTimeout(stop);}
    assert.equal(result.signal, null, `Bootstrap exceeded 35 seconds:\n${output}`);
    assert.notEqual(result.code, 0, 'An unavailable bootstrap must fail CI');
    assert.match(output, /ETIMEDOUT|FETCH_ERROR/, output);
    assert.equal(requests, 2, 'One bounded retry must follow the first request');
    assert.ok(performance.now() - started < 35_000, 'Registry wait exceeded setup budget');
  } finally {
    child?.kill('SIGKILL');
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  }
});
