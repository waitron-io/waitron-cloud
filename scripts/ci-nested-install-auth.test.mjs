import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const packages = workflow.match(/^  packages:\n([\s\S]*?)(?=^  [\w-]+:)/m)[1];
const steps = packages.split(/^      - /m).filter(step => /run: node scripts\/test-postgres.mjs/.test(step));
const receipts = workflow.match(/^  receipts:\n([\s\S]*?)(?=^  [\w-]+:)/m)[1];
const receiptSteps = receipts.split(/^      - /m).filter(step => /run: node scripts\/ci-run-receipts.mjs/.test(step));

// Removing authentication from any test entry point must break a cold descendant install.
test('all package test entry points are exercised', () => assert.equal(steps.length, 3));
test('the receipt test entry point is exercised', () => assert.equal(receiptSteps.length, 1));
for (const step of [...steps, ...receiptSteps]) {
  const command = step.match(/run: (.+)/)[1];
  test(`cold descendant install receives package authentication: ${command}`, {timeout: 30_000}, async () => {
    const root = await mkdtemp(join(tmpdir(), 'cloud-nested-auth-'));
    const token = 'synthetic-loopback-package-token';
    let archive;
    const server = createServer((request, response) => {
      if (request.url !== '/fixture.tgz') return response.writeHead(404).end();
      if (request.headers.authorization !== `Bearer ${token}`) return response.writeHead(401).end('unauthorised');
      response.writeHead(200, {'content-type': 'application/octet-stream'}).end(archive);
    });
    try {
      await mkdir(join(root, 'package'));
      await writeFile(join(root, 'package/package.json'), JSON.stringify({name: 'synthetic-private-package', version: '1.0.0', main: 'index.cjs'}));
      await writeFile(join(root, 'package/index.cjs'), 'module.exports = 42;\n');
      await exec('tar', ['-czf', join(root, 'fixture.tgz'), '-C', root, 'package']);
      archive = await readFile(join(root, 'fixture.tgz'));
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const registry = `127.0.0.1:${server.address().port}`;
      const url = `http://${registry}/fixture.tgz`;
      const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64');
      await writeFile(join(root, 'npmrc'), `//${registry}/:_authToken=\${NODE_AUTH_TOKEN}\n`);
      // A separate checkout/store forces the fetch that a warm runner can conceal.
      const checkout = join(root, 'checkout');
      await mkdir(checkout);
      await writeFile(join(checkout, 'package.json'), JSON.stringify({name: 'nested-install-fixture', private: true, dependencies: {'synthetic-private-package': url}}));
      await writeFile(join(checkout, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .:\n    dependencies:\n      synthetic-private-package:\n        specifier: ${url}\n        version: ${url}\npackages:\n  synthetic-private-package@${url}:\n    resolution: {integrity: ${integrity}, tarball: ${url}}\nsnapshots:\n  synthetic-private-package@${url}: {}\n`);
      const baseEnv = {...process.env, NODE_AUTH_TOKEN: 'XXXXX-XXXXX-XXXXX-XXXXX', NPM_CONFIG_USERCONFIG: join(root, 'npmrc')};
      delete baseEnv.NODE_TEST_CONTEXT;
      delete baseEnv.npm_config_userconfig;
      // Interpret the checked-in step's credential binding with a synthetic Actions secret.
      const bindings = [...step.matchAll(/^          (NODE_AUTH_TOKEN): (.+)$/gm)];
      const stepEnv = Object.fromEntries(bindings.map(([, key, value]) => [key, value === '${{ secrets.GITHUB_TOKEN }}' ? token : value]));
      const install = env => exec('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', '--store-dir', join(root, 'store'), '--fetch-retries=0'], {cwd: checkout, env, timeout: 20_000, maxBuffer: 1024 * 1024});
      await assert.rejects(install(baseEnv), error => /ERR_PNPM_FETCH_401/.test(error.stdout));
      const installed = await install({...baseEnv, ...stepEnv}).catch(error => {
        assert.fail(`Nested install failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
      });
      assert.doesNotMatch(installed.stdout + installed.stderr, /ERR_PNPM_FETCH/);
      const loaded = await exec(process.execPath, ['-e', "console.log(require('synthetic-private-package'))"], {cwd: checkout, env: baseEnv});
      assert.equal(loaded.stdout.trim(), '42');
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await rm(root, {recursive: true, force: true});
    }
  });
}
