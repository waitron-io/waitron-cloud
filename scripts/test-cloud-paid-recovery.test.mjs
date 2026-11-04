import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

// Skipping v2 delivery, substituting a capture or reporting a fiscal refusal as restored breaks this journey.
test('the paired paid archive reaches v2 recovery without granting fiscal authority', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({
    image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    paidRecovery: true,
  });
  const snapshot = receipt.paidSnapshot;
  assert.equal(snapshot?.recovery, 'fiscal-authority-required', 'The same paired archive did not reach the ordinary recovery boundary');
  assert.equal(snapshot.verification, 'verified');
  const target = JSON.parse(await readFile(new URL('../deploy/backup-verifier/target.json', import.meta.url), 'utf8'));
  const recovery = snapshot.ownerRecovery;
  assert.ok(recovery);
  assert.match(recovery.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(recovery.protocolVersion, 2);
  assert.equal(recovery.pointId, snapshot.pointId);
  assert.equal(recovery.attemptId, snapshot.workerVerification.attemptId);
  assert.equal(recovery.targetDigest, target.digest);
  assert.equal(recovery.sha256, snapshot.sha256);
  assert.equal(recovery.bytes, snapshot.bytes);
  assert.equal(recovery.client, 'pinned-compiled-waitron');
  assert.equal(recovery.independentDigest, true);
  assert.equal(recovery.prePlacement, true);
  assert.deepEqual(recovery.refusals, {alternateTargetRefused: true, damagedArchiveRefused: true, placementCalls: 0, restoredReports: 0, stateUnchanged: true});
  assert.equal(recovery.ordinaryRestore, 'FISCAL_RESTORE');
  assert.equal(recovery.activation, 'not_attempted');
  assert.equal(recovery.routeMoved, false);
  assert.equal(recovery.reportedRestored, false);
  assert.equal(recovery.cloudStatus, 'pending');
  assert.equal(recovery.noSupersession, true);
  assert.equal(recovery.sourceStoppedDuringRead, true);
  assert.equal(recovery.sourceIdentityPreserved, true);
  assert.equal(recovery.requestClosed, true);
  assert.equal(receipt.completeIntegration, false);
  assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.freeSnapshot, {status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false});
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie', 'privateDelivery']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('PAID_RECOVERY_RECEIPT=' + JSON.stringify(receipt));
});
