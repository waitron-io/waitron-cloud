import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
  const path = join(root, 'cloud-connection.json');
  const state = {environment: 'test', lifecycle: {revoked: false}};
  if (failedStage === 'prepare') state.lifecycle.pending = {operationId: 'preserve-this'};
  await writeFile(path, JSON.stringify(state), {mode: 0o600});
  const failure = Object.assign(Error('private-password and private-key'), {code});
  let calls = 0, diagnostic;
  await assert.rejects(renewIntegrationAfterRollback(root, () => ({action: 'renew'}), async () => {
    calls++;
    if (failedStage === 'drain' || (failedStage === 'renew' && calls === 2)) throw failure;
  }, value => {diagnostic = value;}));
  assert.equal(diagnostic, expected);
  if (failedStage === 'prepare') assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), state);
});
