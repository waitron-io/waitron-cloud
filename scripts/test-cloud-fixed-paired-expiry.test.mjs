import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as integration from './test-cloud-integration.mjs';
import {verifyTestCloudWithdrawalReceipt} from '../deploy/test-cloud/test-fixtures/integration-withdrawal-receipt.mjs';

test('fixed-project paired expiry refuses mutable images before allocating a project', async () => {
  assert.equal(typeof integration.runTestCloudFixedPairedExpiry, 'function', 'The same-paired operator journey is missing');
  await assert.rejects(integration.runTestCloudFixedPairedExpiry({image: 'cloud:latest', waitronImage: 'waitron:latest'}), /integration\.image_invalid/);
});

test('the fixed-project paired grant really expires before rollback and owned cleanup', {
  skip: !process.env.TEST_CLOUD_PAIRED_EXPIRY || !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 1200000,
}, async () => {
  const result = await integration.runTestCloudFixedPairedExpiry({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]')});
  assert.equal(result.project, 'waitron-cloud-test');
  assert.equal(result.schemaRollback.before.project, 'waitron-cloud-test');
  assert.equal(verifyTestCloudWithdrawalReceipt(result.withdrawal), true);
  assert.equal(result.withdrawal.runId, result.runId);
  assert.deepEqual(result.withdrawal.cloud, result.cloudSource);
  const paid = result.organisations.find(value => value.plan === 'paid');
  for (const key of ['organisationId', 'venueId', 'installationId']) assert.equal(result.withdrawal.installation[key], paid[key]);
  assert.equal(result.withdrawal.snapshot.pointId, result.paidSnapshot.pointId);
  assert.equal(result.withdrawal.snapshot.expiryObserved, true);
  assert.equal(result.withdrawal.snapshot.writeStatus, 403);
  assert.equal(result.withdrawal.snapshot.remainingMs, 0);
  assert.equal(result.withdrawal.snapshot.newGrantRefused, true);
  assert.ok(result.withdrawal.snapshot.observedAt >= Date.parse(result.withdrawal.snapshot.expiresAt));
  assert.ok(result.withdrawal.snapshot.observedAt - result.withdrawal.snapshot.downgradedAt < 901000);
  assert.equal(result.schemaRollback.pairedClientsPreserved, 2);
  assert.deepEqual(result.schemaRollback.before, result.schemaRollback.after);
  assert.equal(result.schemaRollback.oldBinaryOnNewSchema, false);
  assert.ok(result.capacity.integration.samples.some(value => value.stage === 'snapshot-expiry'));
  assert.equal(result.capacity.integration.samples.at(-1).stage, 'rollback');
  assert.equal(result.capacity.shippingQualification, false);
  assert.deepEqual(result.cleanup.created, result.cleanup.removed);
  assert.deepEqual(result.cleanup.remaining, []);
  assert.equal(result.protectedContainersUnchanged, true);
  assert.equal(result.completeIntegration, false);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie', 'recoveryKit', 'secretAccessKey']) assert.equal(JSON.stringify(result).includes(word), false, word);
  console.log('FIXED_EXPIRY_INTEGRATION_RECEIPT=' + JSON.stringify(result));
});
