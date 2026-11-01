import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

// Observing a pointer or restoring a snapshot cannot stand in for a native stream restore.
test('the same paired source restores from its Cloud-approved continuous copy before independent snapshot fallback', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    paidStream: true, paidContinuousRecovery: true});
  const restored = receipt.paidContinuousRecovery, snapshot = receipt.paidSnapshot;
  assert.equal(restored?.exit, 0, 'A real native continuous restore must complete with separate source authority');
  assert.equal(restored.sourceNodeId, snapshot.sourceNodeId);
  assert.equal(restored.localVenueId, snapshot.localVenueId);
  assert.equal(restored.generation, receipt.paidStream.generation);
  for (const key of ['nativeRestore', 'ownerApprovedKit', 'sourceStoppedDuringRead', 'sourceAuthorityVerified',
    'preparationBoundToStream', 'sourceRecordsPreserved', 'wrongAuthorityRefused', 'missingPreparationRefused',
    'noServerStarted', 'noSupersession', 'requestClosed']) assert.equal(restored[key], true, key);
  assert.equal(restored.integrity, 'ok');
  assert.equal(restored.cloudReportedRestored, false);
  assert.equal(snapshot.snapshotFallback.streamObjects, 0);
  assert.equal(snapshot.snapshotFallback.pointerRows, 0);
  assert.equal(snapshot.snapshotFallback.retainedSnapshotUnchanged, true);
  assert.equal(snapshot.authorisedRecovery.exit, 0);
  assert.equal(snapshot.ownerRecovery.sourceIdentityPreserved, true);
  assert.equal(receipt.completeIntegration, false);
  assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie', 'recoveryKit', 'secretAccessKey']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('PAID_CONTINUOUS_RECOVERY_RECEIPT=' + JSON.stringify(receipt));
});
