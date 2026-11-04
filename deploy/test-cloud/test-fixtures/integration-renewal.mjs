import assert from 'node:assert/strict';
import {readFile, writeFile, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

export function rollbackRefusalDiagnostic(text) {
  const found = /integration\.rollback_refused:(drain|prepare|renew):(cloud\.(?:busy|unavailable|binding_conflict)|ERR_ASSERTION|ENOENT|EACCES|unknown)(?![A-Za-z0-9_.-])/.exec(text);
  return found ? ':' + found[0] : '';
}

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

export async function renewIntegrationAfterRollback(root, pendingRequest, refresh, onFailure = () => {}) {
  const refreshWhenIdle = async () => {
    const deadline = performance.now() + 2000;
    for (;;) {
      try {return await refresh();}
      catch (error) {
        // The native worker owns saved state while its exchange runs; only its busy refusal is transient here.
        if (error?.code !== 'cloud.busy' || performance.now() >= deadline) throw error;
        await delay(25);
      }
    }
  };
  let stage = 'drain';
  try {
    // The ordinary worker can leave an exact pending request during the Cloud outage.
    await refreshWhenIdle();
    stage = 'prepare';
    await prepareIntegrationRenewal(root, pendingRequest);
    stage = 'renew';
    await refreshWhenIdle();
    return {renewed: true};
  } catch (error) {
    const known = ['cloud.busy', 'cloud.unavailable', 'cloud.binding_conflict', 'ERR_ASSERTION', 'ENOENT', 'EACCES'];
    const code = known.includes(error?.code) ? error.code : 'unknown';
    onFailure('integration.rollback_refused:' + stage + ':' + code);
    throw error;
  }
}
