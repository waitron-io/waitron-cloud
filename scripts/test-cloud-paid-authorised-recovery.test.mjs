import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

// Restoring another source or accepting a refusal as success cannot satisfy this journey.
test('the paired paid archive restores with separately prepared source authority', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({
    image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    paidRecovery: true, paidAuthorisedRecovery: true,
  });
  const snapshot = receipt.paidSnapshot, restored = snapshot.authorisedRecovery;
  assert.equal(restored?.exit, 0, 'The actual paired capture needs a successful separately authorised ordinary restore');
  assert.equal(snapshot.verification, 'verified');
  assert.equal(snapshot.recovery, 'fiscal-authority-required');
  assert.equal(restored.sha256, snapshot.sha256);
  assert.equal(restored.bytes, snapshot.bytes);
  assert.equal(restored.sourceNodeId, snapshot.sourceNodeId);
  assert.equal(restored.localVenueId, snapshot.localVenueId);
  assert.equal(restored.preparationBoundToDeliveredArchive, true);
  assert.equal(restored.sourceAuthorityVerified, true);
  assert.equal(restored.wrongAuthorityRefused, true);
  assert.equal(restored.missingPreparationRefused, true);
  assert.equal(restored.integrity, 'ok');
  assert.equal(restored.sourceRecordsPreserved, true);
  assert.equal(restored.noServerStarted, true);
  assert.equal(restored.noCloudCredentials, true);
  assert.equal(restored.cloudReportedRestored, false);
  assert.equal(snapshot.ownerRecovery.requestClosed, true);
  assert.equal(snapshot.ownerRecovery.sourceStoppedDuringRead, true);
  assert.equal(snapshot.ownerRecovery.sourceIdentityPreserved, true);
  assert.equal(snapshot.ownerRecovery.noSupersession, true);
  assert.equal(receipt.completeIntegration, false);
  assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie', 'privateDelivery', 'nodeRecoverySecret']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('PAID_AUTHORISED_RECOVERY_RECEIPT=' + JSON.stringify(receipt));
});
