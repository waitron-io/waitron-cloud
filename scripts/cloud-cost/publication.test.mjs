import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, realpathSync, readFileSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const module = await import('./publication.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./publication.mjs', import.meta.url).href) return {};
  throw error;
});
const cli = new URL('./cli.mjs', import.meta.url).pathname;

test('a rejected standalone sample cannot bypass verification or replace public artifacts', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-standalone-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(fileURLToPath(new URL('./', import.meta.url)), join(root, 'scripts/cloud-cost'), {
    recursive: true, dereference: true, filter: path => !path.endsWith('.test.mjs') && !path.endsWith('/fixtures'),
  });
  cpSync(fileURLToPath(new URL('../../docs/cost-model', import.meta.url)), join(root, 'docs/cost-model'), { recursive: true });
  cpSync(new URL('../../tsconfig.json', import.meta.url), join(root, 'tsconfig.json'));
  cpSync(new URL('../../package.json', import.meta.url), join(root, 'package.json'));
  const artifacts = ['docs/cloud-cost-model.md', 'docs/cloud-cost-calculator.html', 'docs/cost-model/live-check.json'];
  for (const path of artifacts) cpSync(new URL('../../' + path, import.meta.url), join(root, path));
  const require = createRequire(new URL('../../packages/ui-smoke/package.json', import.meta.url));
  const esbuild = dirname(require.resolve('esbuild/package.json')), native = '@esbuild/' + process.platform + '-' + process.arch;
  const binary = dirname(createRequire(join(esbuild, 'package.json')).resolve(native + '/package.json'));
  mkdirSync(join(root, 'packages/ui-smoke'), { recursive: true });
  cpSync(new URL('../../packages/ui-smoke/package.json', import.meta.url), join(root, 'packages/ui-smoke/package.json'));
  cpSync(esbuild, join(root, 'packages/ui-smoke/node_modules/esbuild'), { recursive: true, dereference: true });
  cpSync(binary, join(root, 'packages/ui-smoke/node_modules', native), { recursive: true, dereference: true });
  const run = command => spawnSync(process.execPath, [join(root, 'scripts/cloud-cost/cli.mjs'), command], { encoding: 'utf8', timeout: 30000 });
  const baseline = run('verify'); assert.equal(baseline.status, 0, baseline.stderr);
  const before = artifacts.map(path => readFileSync(join(root, path)));
  const diagnostic = JSON.stringify({ functional: 'passed', costMeasured: false, receipt: null,
    accounting: { status: 'unknown', publicationEligible: false, gaps: ['accounting:incomplete-history'] }, evidence: {} });
  for (const name of ['measurements', 'archive-replay', 'archive-storage', 'usage-projection', 'remote-owner-browser', 'remote-owner-public-api',
    'service-mail-retry-fiscal-lifecycle', 'service-signup-recovery-fiscal-refusal']) {
    const path = join(root, 'docs/cost-model', name + '.json'), original = readFileSync(path);
    try {
      writeFileSync(path, diagnostic);
      for (const command of ['build', 'verify']) {
        const result = run(command); assert.equal(result.status, 1, name + '/' + command);
        assert.equal(result.stdout, ''); assert.equal(result.stderr, 'Cloud cost public command refused.\n');
        for (const [i, artifact] of artifacts.entries()) assert.deepEqual(readFileSync(join(root, artifact)), before[i], artifact);
        assert.equal(readFileSync(path, 'utf8'), diagnostic, 'rejection never repairs the candidate');
      }
    } finally { writeFileSync(path, original); }
  }
  assert.equal(run('verify').status, 0);
});

test('published cost model marks the retired registry as historical', async () => {
  const artifacts = await module.generatePublicArtifacts();
  const model = artifacts['docs/cloud-cost-model.md'];
  assert.match(model, /\| fiscal-api \| historical \|/);
  assert.doesNotMatch(model, /\| fiscal-api \| required \|/);
  assert.match(model, /service-mail-retry-fiscal-lifecycle\.json/);
  assert.match(model, /service-signup-recovery-fiscal-refusal\.json/);
});

// Publication compares the actual artifacts, not just their stored hashes.
test('verificationRefusesAnyChangedOrMissingArtifactWhileReportingCostGaps', async () => {
  assert.equal(typeof module.generatePublicArtifacts, 'function', 'build only the public offline deliverables');
  const expected = await module.generatePublicArtifacts();
  assert.deepEqual(Object.keys(expected).sort(), ['docs/cloud-cost-calculator.html', 'docs/cloud-cost-model.md', 'docs/cost-model/live-check.json']);
  assert.equal(typeof module.verifyArtifacts, 'function');
  assert.equal(module.verifyArtifacts(expected, expected).complete, false);
  for (const path of Object.keys(expected)) {
    const actual = { ...expected, [path]: expected[path] + '\nPRIVATE_CANARY' };
    assert.throws(() => module.verifyArtifacts(actual, expected), { message: 'Invalid cloud cost publication' });
    delete actual[path]; assert.throws(() => module.verifyArtifacts(actual, expected), { message: 'Invalid cloud cost publication' });
  }
});

// A build or verification must not turn into a measurement or spend money when
// private configuration and provider environment variables happen to be present.
test('buildAndVerifyNeverOpenPrivateSourcesOrContactAProvider', t => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-publication-'))); t.after(() => rmSync(scratch, { recursive: true }));
  const guard = join(scratch, 'guard.mjs');
  writeFileSync(guard, `import fs from 'node:fs'; import net from 'node:net'; import http from 'node:http'; import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const stop=()=>{process.stderr.write('FORBIDDEN_IO');process.exit(97)};
net.Socket.prototype.connect=stop; http.request=stop; https.request=stop; globalThis.fetch=stop;
const read=fs.readFileSync; fs.readFileSync=(path,...args)=>{
if(/PRIVATE_CANARY|\\/waitron-local-santet-data\\/|\\/waitron-cloud\\/aws\\//.test(String(path)))stop();return read(path,...args)};
syncBuiltinESMExports();`);
  for (const command of ['build', 'verify']) {
    const result = spawnSync(process.execPath, ['--import', guard, cli, command], { encoding: 'utf8', timeout: 30000,
      env: { ...process.env, AWS_SHARED_CREDENTIALS_FILE: '/PRIVATE_CANARY', AWS_CONFIG_FILE: '/PRIVATE_CANARY',
        COST_RUN_CONFIG: '/PRIVATE_CANARY', COST_PRIVATE_ROOT: '/PRIVATE_CANARY' } });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout); assert.equal(summary.complete, false); assert.equal(summary.artifacts, 3);
    assert.equal(summary.liveCheck, 'stopped-before-provision');
  }
});

test('publicCommandsRejectUnexpectedOptionsWithoutEchoingPrivateArguments', () => {
  for (const command of ['build', 'verify']) {
    const result = spawnSync(process.execPath, [cli, command, '--private-config', '/PRIVATE_CANARY'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'Cloud cost public command refused.\n');
  }
});
