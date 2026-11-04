import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('rollback drains the saved native request before queuing a fresh renewal', async t => {
  const {renewIntegrationAfterRollback} = await import('./test-fixtures/integration-renewal.mjs');
  assert.equal(typeof renewIntegrationAfterRollback, 'function', 'Pending rollback work is not drained');
  const root = await mkdtemp(join(tmpdir(), 'cloud-rollback-pending-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'cloud-connection.json');
  const pending = {action: 'configuration', operationId: 'original-operation', body: 'original-body'};
  const state = {environment: 'test', publicKey: 'original-key', lifecycle: {revoked: false, lease: {unchanged: true}, pending}};
  await writeFile(path, JSON.stringify(state), {mode: 0o600});
  const actions = [];
  // Only the native client's external exchange is substituted; preparation and saved state are real.
  const refresh = async () => {
    const current = JSON.parse(await readFile(path, 'utf8'));
    actions.push(current.lifecycle.pending);
    delete current.lifecycle.pending;
    await writeFile(path, JSON.stringify(current));
  };
  const renewal = {action: 'renew', operationId: 'fresh-operation', body: '{}'};
  assert.deepEqual(await renewIntegrationAfterRollback(root, () => renewal, refresh), {renewed: true});
  assert.deepEqual(actions, [pending, renewal]);
  const {pending: ignored, ...lifecycle} = state.lifecycle;
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {...state, lifecycle});
});

test('a refused saved request leaves its identity intact and prevents a forced renewal', async t => {
  const {renewIntegrationAfterRollback} = await import('./test-fixtures/integration-renewal.mjs');
  assert.equal(typeof renewIntegrationAfterRollback, 'function', 'Pending rollback work is not drained');
  const root = await mkdtemp(join(tmpdir(), 'cloud-rollback-refusal-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'cloud-connection.json'), saved = '{"lifecycle":{"pending":{"operationId":"keep-this"}}}';
  await writeFile(path, saved, {mode: 0o600});
  let queued = false;
  await assert.rejects(renewIntegrationAfterRollback(root, () => {queued = true;}, async () => {throw Error('offline');}), /offline/);
  assert.equal(queued, false);
  assert.equal(await readFile(path, 'utf8'), saved);
});
