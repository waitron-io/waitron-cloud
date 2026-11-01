import assert from 'node:assert/strict';
import {readFile, writeFile, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// Queue the native request in an idle disposable venue; the native client still signs, exchanges and saves it.
export async function prepareIntegrationRenewal(root, pendingRequest) {
  const path = join(root, 'cloud-connection.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(state.environment, 'test');
  assert.equal(state.lifecycle.revoked, false);
  assert.equal(state.lifecycle.pending, undefined);
  state.lifecycle.pending = pendingRequest('renew');
  const temporary = join(root, 'rollback-renewal-' + randomUUID() + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify(state), {mode: 0o600, flag: 'wx'});
    await rename(temporary, path);
  } finally {await rm(temporary, {force: true});}
}

export async function renewIntegrationAfterRollback(root, pendingRequest, refresh) {
  // The ordinary worker can leave an exact pending request during the Cloud outage.
  await refresh();
  await prepareIntegrationRenewal(root, pendingRequest);
  await refresh();
  return {renewed: true};
}
