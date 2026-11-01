import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const module = await import('./publication.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./publication.mjs', import.meta.url).href) return {};
  throw error;
});
const cli = new URL('./cli.mjs', import.meta.url).pathname;

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
