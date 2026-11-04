import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

// Omitting the delivered worker must leave the paired archive pending and fail this journey.
test('the delivered worker verifies the paired paid archive without activation', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({
    image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    paidSnapshot: true,
    paidVerification: true,
  });
  const snapshot = receipt.paidSnapshot;
  assert.equal(snapshot?.verification, 'verified', 'The paired paid archive did not reach delivered-worker verification');
  const target = JSON.parse(await readFile(new URL('../deploy/backup-verifier/target.json', import.meta.url), 'utf8'));
  const evidence = snapshot.workerVerification;
  assert.ok(evidence, 'Independent worker admission evidence is missing');
  assert.equal(evidence.pointId, snapshot.pointId);
  assert.equal(evidence.sha256, snapshot.sha256);
  assert.equal(evidence.bytes, snapshot.bytes);
  assert.equal(evidence.targetDigest, target.digest);
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.activation, 'not_attempted');
  assert.equal(evidence.modules, 15);
  assert.equal(evidence.cleanupConfirmed, true);
  assert.equal(evidence.childAbsent, true);
  assert.match(evidence.attemptId, /^[a-f0-9-]{36}$/);
  assert.match(evidence.childId, /^[a-f0-9]{64}$/);
  for (const records of [receipt.cleanup.created, receipt.cleanup.removed]) assert.ok(records.some(value => value.kind === 'container' && value.id === evidence.childId && value.owner === receipt.runId), 'The verifier child is missing from the owned cleanup record');
  assert.equal(evidence.workerStoppedNaturally, true);
  assert.equal(evidence.noSupersession, true);
  assert.equal(snapshot.recovery, 'not-run');
  assert.equal(receipt.completeIntegration, false);
  assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.freeSnapshot, {status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false});
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('PAID_VERIFICATION_RECEIPT=' + JSON.stringify(receipt));
});
