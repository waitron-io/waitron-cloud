import assert from 'node:assert/strict';
import {readFile, lstat} from 'node:fs/promises';
import {createPrivateKey, randomUUID, sign} from 'node:crypto';

// Requests use the actual paired installation and its current lease; no issuer key enters the venue.
export async function proveIntegrationFreeRemote(root, {hostname, revision}) {
  const state = JSON.parse(await readFile(root + '/cloud-connection.json', 'utf8'));
  assert.equal(state.environment, 'test');
  assert.equal(state.origin, 'https://waitron.local:3000');
  assert.equal(state.lifecycle.view.revision, revision);
  const {createStaffCsr} = await import('/waitron/apps/server/src/cloud-remote.ts');
  const csr = await createStaffCsr(root, hostname);
  const staffKey = await lstat(root + '/cloud-staff.key');
  assert.equal(staffKey.isFile(), true);
  assert.equal(staffKey.mode & 0o077, 0);
  const key = createPrivateKey({key: Buffer.from(state.privateKey, 'base64url'), format: 'der', type: 'pkcs8'});
  const installationId = state.view.registration.installationId;
  const send = async (action, body, invalid = false) => {
    const payload = Buffer.from(JSON.stringify(['waitron-cloud-machine-v1', state.origin, action,
      installationId, randomUUID(), Date.now(), JSON.stringify(state.lifecycle.lease), JSON.stringify(body)]));
    const signature = sign(null, payload, key);
    if (invalid) signature[0] ^= 1;
    const response = await fetch(state.origin + '/api/installations/' + action, {method: 'POST',
      headers: {'content-type': 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(10000),
      body: JSON.stringify({payload: payload.toString('base64url'), signature: signature.toString('base64url')})});
    const reply = await response.json();
    assert.deepEqual(reply, {error: invalid ? 'invalid_proof' : 'permission_denied'});
    assert.equal(response.status, invalid ? 401 : 403);
    return {status: response.status, error: reply.error};
  };
  const requestId = randomUUID();
  const invalidProof = await send('staff-certificate-status', {version: 1, requestId}, true);
  const submit = await send('staff-certificate-submit', {version: 1, hostname, revision, csr, previousRequestId: null});
  const status = await send('staff-certificate-status', {version: 1, requestId});
  return {installationId, submit, status, invalidProof, csr, nativeStaffCsr: true};
}
