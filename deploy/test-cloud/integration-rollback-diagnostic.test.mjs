import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
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
