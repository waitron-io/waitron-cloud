import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as integration from './test-cloud-integration.mjs';
import {verifyTestCloudWithdrawalReceipt} from '../deploy/test-cloud/test-fixtures/integration-withdrawal-receipt.mjs';
import {createTestCloudResourceEvidence} from '../deploy/test-cloud/test-fixtures/integration-resource-evidence.mjs';

test('fixed-project proof refuses mutable images before admission', async () => {
  assert.equal(typeof integration.runTestCloudFixedProject, 'function', 'The fixed-project journey is missing');
  await assert.rejects(integration.runTestCloudFixedProject({image: 'cloud:latest', waitronImage: 'waitron:latest'}), /integration.image_invalid/);
});

test('the actual fixed Compose project preserves both paired clients through matching schema rollback', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 600000,
}, async () => {
  const receipt = await integration.runTestCloudFixedProject({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]')});
  assert.equal(receipt.project, 'waitron-cloud-test');
  assert.equal(receipt.schemaRollback.before.project, 'waitron-cloud-test');
  assert.deepEqual(receipt.schemaRollback.before, receipt.schemaRollback.after);
  assert.equal(receipt.schemaRollback.pairedClientsPreserved, 2);
  assert.deepEqual(receipt.schemaRollback.clients.map(value => value.installationId).sort(), receipt.organisations.map(value => value.installationId).sort());
  for (const client of receipt.schemaRollback.clients) {
    assert.equal(client.identityPreserved, true);
    for (const key of ['renewals', 'configurations']) assert.ok(client.after[key] > client.before[key]);
  }
  assert.equal(receipt.paidSnapshot.verification, 'verified');
  assert.equal(receipt.paidContinuousRecovery.integrity, 'ok');
  assert.deepEqual(receipt.freeSnapshot, {status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false});
  assert.equal(verifyTestCloudWithdrawalReceipt(receipt.withdrawal), true);
  assert.equal(receipt.withdrawal.runId, receipt.runId);
  assert.ok(createTestCloudResourceEvidence(receipt.capacity.observations).samples.length > 0);
  assert.equal(receipt.protectedContainersUnchanged, true);
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.ok(receipt.cleanup.created.some(value => value.kind === 'volume' && value.id === 'waitron-cloud-test_local-stack-config'));
  assert.equal(receipt.completeIntegration, false);
  assert.equal(receipt.schemaRollback.shippingQualification, false);
  console.log('FIXED_PROJECT_INTEGRATION_RECEIPT=' + JSON.stringify(receipt));
});
