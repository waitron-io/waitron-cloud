import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, readFile, rm, copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as renewal from './test-fixtures/integration-renewal.mjs';
import {renewIntegrationAfterRollback} from './test-fixtures/integration-renewal.mjs';

// Omitting the stage notification hides which real operation refused; forwarding error text exposes private state.
for (const [failedStage, code, expected] of [
  ['drain', 'cloud.busy', 'integration.rollback_refused:drain:cloud.busy'],
  ['prepare', 'ERR_ASSERTION', 'integration.rollback_refused:prepare:ERR_ASSERTION'],
  ['renew', 'cloud.unavailable', 'integration.rollback_refused:renew:cloud.unavailable'],
  ['drain', 'private-credential', 'integration.rollback_refused:drain:unknown'],
]) test('rollback diagnostic identifies ' + failedStage + '/' + code + ' without private error text', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-rollback-diagnostic-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'cloud/connection.json');
  const state = {environment: 'test', lifecycle: {revoked: false}};
  if (failedStage === 'prepare') state.lifecycle.pending = {operationId: 'preserve-this'};
  await mkdir(join(root,'cloud'),{recursive:true});await writeFile(path, JSON.stringify(state), {mode: 0o600});
  const failure = Object.assign(Error('private-password and private-key'), {code});
  let calls = 0, diagnostic;
  await assert.rejects(renewIntegrationAfterRollback(root, () => ({action: 'renew'}), async () => {
    calls++;
    if (failedStage === 'drain' || (failedStage === 'renew' && calls === 2)) throw failure;
  }, value => {diagnostic = value;}));
  assert.equal(diagnostic, expected);
  if (failedStage === 'prepare') assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), state);
});

// Raw assertion messages append comparisons even when a fixed label was supplied.
test('fixture errors retain fixed labels and codes while redacting private comparisons', () => {
  assert.equal(typeof renewal.fixtureFailureDiagnostic, 'function');
  const failure = (message, code = 'ERR_ASSERTION') => {
    try {assert.equal('private-password /private/path', 'private-key', message);}
    catch (error) {return Object.assign(error, {code});}
  };
  for (const [error, expected] of [
    [failure('integration.remote_replay_status'), 'ERR_ASSERTION:integration.remote_replay_status'],
    [failure('integration.remote_certificate_refusal_status'), 'ERR_ASSERTION:integration.remote_certificate_refusal_status'],
    [failure('integration.remote_configuration_status'), 'ERR_ASSERTION:integration.remote_configuration_status'],
    [failure('integration.remote_upstream_status'), 'ERR_ASSERTION:integration.remote_upstream_status'],
    [failure(), 'ERR_ASSERTION:redacted'],
    [Object.assign(failure('integration.remote_replay_status'), {generatedMessage: true}), 'ERR_ASSERTION:redacted'],
    [failure('private-password\nprivate-key'), 'ERR_ASSERTION:redacted'],
    [Object.assign(Error('private-key'), {code: 'ENOENT'}), 'ENOENT:redacted'],
    [Object.assign(Error('private-key'), {code: 'private-credential'}), 'unknown:redacted'],
  ]) {
    const detail = renewal.fixtureFailureDiagnostic(error);
    assert.equal(detail, 'integration.fixture_error:' + expected);
    assert.equal(renewal.fixtureRefusalDiagnostic(JSON.stringify({diagnostic: detail, privateKey: 'private-key'})), ':' + detail);
  }
  for (const text of ['integration.fixture_error:private-key:redacted',
    'integration.fixture_error:ERR_ASSERTION:integration.remote_replay_status-private-key',
    'integration.fixture_error:ERR_ASSERTION:private-password']) assert.equal(renewal.fixtureRefusalDiagnostic(text), '');
});

// The image relocates the venue script away from /proof, where its helpers live.
test('the relocated venue handler loads and reports its actual masked refusal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'private-key-venue-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const scripts = join(root, 'waitron/apps/server/scripts');
  await mkdir(scripts, {recursive: true}); await mkdir(join(root, 'proof'));
  await copyFile(new URL('./test-fixtures/integration-venue.mjs', import.meta.url), join(scripts, 'cloud-test-integration.mjs'));
  for (const name of ['integration-renewal.mjs', 'integration-paid-remote-client.mjs', 'integration-venue-request.mjs'])
    await copyFile(new URL('./test-fixtures/' + name, import.meta.url), join(root, 'proof', name));
  await writeFile(join(root, 'ready.json'), JSON.stringify({origin: 'http://127.0.0.1:1'}));
  await writeFile(join(root, 'db.cjs'), 'module.exports = {};');
  await writeFile(join(root, 'native.mjs'), `export const pendingRequest = () => ({});
    export const createCloudConnection = () => ({refresh() {throw Object.assign(Error('private-password'), {code: 'cloud.unavailable'});}});`);
  const base = pathToFileURL(root + '/').href;
  const program = `import {registerHooks} from 'node:module'; import {request} from 'node:http';
    const base = ${JSON.stringify(base)};
    registerHooks({resolve(s,c,next) {
      if (s.startsWith('/proof/')) return {url: new URL('proof/' + s.slice(7), base).href, shortCircuit: true};
      if (s.startsWith('/waitron/')) return {url: new URL('native.mjs', base).href, shortCircuit: true};
      if (s === '@waitron/db') return {url: new URL('db.cjs', base).href, shortCircuit: true};
      return next(s,c);
    }});
    await import(new URL('waitron/apps/server/scripts/cloud-test-integration.mjs', base));
    for (const phase of ['paid-remote', 'rollback-refresh']) {
      const reply = await new Promise((resolve,reject) => {
        const req = request({socketPath: process.env.CLOUD_TEST_ROOT + '/proof.sock', path: '/' + phase, method: 'POST'}, res => {
          let body = ''; res.on('data', part => body += part);
          res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(body)}));
        }); req.on('error', reject); req.end(JSON.stringify({phase: 'withdrawn'}));
      }); console.log(JSON.stringify(reply));
    } process.exit(0);`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    env: {...process.env, CLOUD_TEST_ROOT: root, CLOUD_TEST_STREAM: '0'}, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(run.status, 0, run.stderr);
  const replies = run.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(replies, [
    {status: 500, body: {error: 'fixture_refused', diagnostic: 'integration.fixture_error:ENOENT:redacted'}},
    {status: 500, body: {error: 'fixture_refused', diagnostic: 'integration.rollback_refused:drain:cloud.unavailable:integration.fixture_error:cloud.unavailable:redacted'}},
  ]);
  assert.doesNotMatch(run.stdout, /private-key|private-password/);
});
