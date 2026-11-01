import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {checkCapacitySamples} from '../deploy/test-cloud/test-fixtures/integration-capacity.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

// Removing the settled wait, cgroup measurement or real worker breaks the capacity proof.
test('paired Cloud stays within measured budgets through a settled minute and actual verification', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    paidSnapshot: true, paidVerification: true, measureCapacity: true});
  assert.ok(receipt.capacity, 'Settled and active-verifier capacity was not measured');
  assert.equal(checkCapacitySamples(receipt.capacity.samples), true);
  assert.equal(receipt.capacity.measurement, 'linux-cgroup-v2-including-tmpfs');
  assert.equal(receipt.capacity.shippingQualification, false);
  const child = receipt.paidSnapshot.workerVerification.childId;
  assert.ok(receipt.capacity.samples.some(value => value.phase === 'verification' && value.verifierIds.includes(child) && value.verifierMiB > 0));
  assert.equal(receipt.paidSnapshot.verification, 'verified');
  assert.equal(receipt.paidSnapshot.workerVerification.workerStoppedNaturally, true);
  assert.deepEqual(receipt.organisations.map(value => value.plan), ['free', 'paid']);
  assert.deepEqual(receipt.freeSnapshot, {status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false});
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed); assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  assert.equal(receipt.completeIntegration, false); assert.throws(() => verifyTestCloudReceipt(receipt));
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('CAPACITY_RECEIPT=' + JSON.stringify(receipt));
});
