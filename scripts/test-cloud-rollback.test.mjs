import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

test('owned Cloud rollback preserves the same image, schema, private state and both real pairings', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'), cloudRollback: true});
  const rollback = receipt.cloudRollback;
  assert.ok(rollback, 'The project rollback was not exercised');
  assert.deepEqual(rollback.before, rollback.after);
  assert.equal(rollback.before.image, receipt.image);
  assert.equal(rollback.before.project, 'waitron-cloud-test-integration-' + receipt.runId.slice(0, 8));
  for (const key of ['runtimeSha256', 'caSha256', 'schemaSha256']) assert.match(rollback.before.identity[key], /^[a-f0-9]{64}$/);
  assert.ok(rollback.stoppedContainers >= 5);
  assert.equal(rollback.restartedContainers, rollback.stoppedContainers);
  assert.equal(rollback.ready, true); assert.equal(rollback.pairedClientsPreserved, 2);
  assert.equal(rollback.clients.length, 2);
  for (const client of rollback.clients) {
    assert.ok(receipt.organisations.some(value => value.installationId === client.installationId));
    for (const key of ['renewals', 'configurations']) assert.ok(client.after[key] > client.before[key], key);
    assert.equal(client.identityPreserved, true);
  }
  assert.equal(rollback.oldBinaryOnNewSchema, false);
  assert.deepEqual(receipt.organisations.map(value => value.plan), ['free', 'paid']);
  assert.deepEqual(receipt.freeSnapshot, {status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false});
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed); assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  assert.equal(receipt.completeIntegration, false); assert.throws(() => verifyTestCloudReceipt(receipt));
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('CLOUD_ROLLBACK_RECEIPT=' + JSON.stringify(receipt));
});
