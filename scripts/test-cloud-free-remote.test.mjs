import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

// A refusal must come from an authenticated paired client and leave no remote authority behind.
test('the paired free venue cannot provision remote access or obtain a staff certificate', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    freeRemote: true});
  const free = receipt.organisations.find(value => value.plan === 'free');
  assert.deepEqual(receipt.freeRemote, {organisationId: free.organisationId, installationId: free.installationId,
    provision: 'permission_denied', submit: {status: 403, error: 'permission_denied'},
    status: {status: 403, error: 'permission_denied'}, invalidProof: {status: 401, error: 'invalid_proof'},
    nativeStaffCsr: true, placements: 0, hostnames: 0, requests: 0, jobs: 0, configurationUnchanged: true, plan: 'free'});
  assert.equal(receipt.completeIntegration, false);
  assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('FREE_REMOTE_RECEIPT=' + JSON.stringify(receipt));
});
