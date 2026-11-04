import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

test('a cold matching-set restore removes a changed schema and preserves both genuine pairings', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'), schemaRollback: true});
  const rollback = receipt.schemaRollback;
  assert.ok(rollback, 'The matching database/configuration/storage rollback was not exercised');
  assert.equal(rollback.kind, 'controlled-schema-change');
  assert.equal(rollback.shippingQualification, false);
  assert.deepEqual(rollback.before, rollback.after);
  assert.notDeepEqual(rollback.changedSchema, rollback.before.schema);
  assert.equal(rollback.changedSchema.probe, true);
  assert.equal(rollback.changedSchema.migrations, rollback.before.schema.migrations + 1);
  assert.equal(rollback.after.schema.probe, false);
  assert.equal(rollback.consumerRefusedChangedSchema, true);
  assert.equal(rollback.oldBinaryOnNewSchema, false);
  assert.equal(rollback.ready, true);
  assert.deepEqual(rollback.backup.volumes.map(value => value.role), ['config', 'postgres', 'storage', 'gateway']);
  for (const volume of rollback.backup.volumes) {
    assert.match(volume.archiveSha256, /^[a-f0-9]{64}$/);
    assert.match(volume.contentSha256, /^[a-f0-9]{64}$/);
    assert.ok(volume.bytes > 0);
  }
  assert.equal(rollback.privateFilesChanged, true);
  assert.equal(rollback.pairedClientsPreserved, 2);
  for (const client of rollback.clients) {
    assert.ok(receipt.organisations.some(value => value.installationId === client.installationId));
    for (const key of ['renewals', 'configurations']) assert.ok(client.after[key] > client.before[key]);
    assert.equal(client.identityPreserved, true);
  }
  assert.deepEqual(receipt.freeSnapshot, {status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false});
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  assert.equal(receipt.completeIntegration, false);
  assert.throws(() => verifyTestCloudReceipt(receipt));
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('SCHEMA_ROLLBACK_RECEIPT=' + JSON.stringify(receipt));
});
