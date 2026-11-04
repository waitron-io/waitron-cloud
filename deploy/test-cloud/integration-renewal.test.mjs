import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('the private rollback fixture queues a native renewal without changing its pairing or lease', async () => {
  const {prepareIntegrationRenewal} = await import('./test-fixtures/integration-renewal.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof prepareIntegrationRenewal, 'function', 'Explicit native renewal preparation is missing');
  const root = await mkdtemp(join(tmpdir(), 'cloud-rollback-renewal-'));
  const state = {origin: 'https://waitron.local:3000', environment: 'test', localVenueId: 'venue', publicKey: 'same-key',
    view: {registration: {installationId: 'same-installation'}}, lifecycle: {revoked: false, lease: {payload: 'untouched', signature: 'untouched'}}};
  const pending = {action: 'renew', operationId: '12345678-1234-4234-8234-123456789012', lease: '', body: '{}'};
  try {
    await writeFile(join(root, 'cloud-connection.json'), JSON.stringify(state), {mode: 0o600});
    await prepareIntegrationRenewal(root, action => {assert.equal(action, 'renew'); return pending;});
    assert.deepEqual(JSON.parse(await readFile(join(root, 'cloud-connection.json'), 'utf8')), {...state, lifecycle: {...state.lifecycle, pending}});
    await assert.rejects(prepareIntegrationRenewal(root, () => pending));
    for (const changed of [{...state, environment: 'production'}, {...state, lifecycle: {...state.lifecycle, revoked: true}}]) {
      await writeFile(join(root, 'cloud-connection.json'), JSON.stringify(changed));
      await assert.rejects(prepareIntegrationRenewal(root, () => pending));
      assert.deepEqual(JSON.parse(await readFile(join(root, 'cloud-connection.json'), 'utf8')), changed);
    }
  } finally {await rm(root, {recursive: true, force: true});}
});
