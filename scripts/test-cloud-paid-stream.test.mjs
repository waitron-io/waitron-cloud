import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

// A claimed stream without real uploaded LTX and a matching observed generation must fail.
test('the same paired paid source streams through native Waitron and Cloud observes its signed generation', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    paidSnapshot: true, paidAuthorisedRecovery: true, paidStream: true});
  const snapshot = receipt.paidSnapshot, stream = receipt.paidStream;
  assert.equal(stream?.status, 'observed', 'The real paired source must stream and Cloud must observe its signed pointer');
  assert.equal(stream.sourceNodeId, snapshot.sourceNodeId);
  assert.equal(stream.localVenueId, snapshot.localVenueId);
  assert.equal(stream.venueId, snapshot.venueId);
  assert.equal(stream.installationId, snapshot.installationId);
  assert.equal(stream.nativeStreaming, true);
  assert.equal(stream.independentObservation, true);
  assert.equal(stream.signedPointerVerified, true);
  assert.equal(stream.retainedSnapshotUnchanged, true);
  assert.equal(stream.noSupersession, true);
  assert.equal(stream.noActivation, true);
  assert.match(stream.generation, /^[A-Za-z0-9_-]+$/);
  assert.ok(Number.isFinite(Date.parse(stream.recoverableAt)));
  assert.ok(Date.parse(stream.checkedAt) >= Date.parse(stream.recoverableAt));
  assert.equal(receipt.completeIntegration, false);
  assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie', 'recoveryKey', 'secretAccessKey']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('PAID_STREAM_RECEIPT=' + JSON.stringify(receipt));
});
