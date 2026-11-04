import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

// A fabricated capture, another venue's archive or an omitted upload cannot satisfy this journey.
test('the paired paid venue publishes its own genuine encrypted snapshot', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({
    image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    paidSnapshot: true,
  });
  const snapshot = receipt.paidSnapshot;
  assert.ok(snapshot, 'The genuine paired paid snapshot journey is missing');
  assert.equal(snapshot.status, 'published');
  assert.equal(snapshot.verification, 'pending');
  assert.equal(snapshot.recovery, 'not-run');
  const paid = receipt.organisations.find(value => value.plan === 'paid');
  for (const key of ['organisationId', 'venueId', 'installationId', 'localVenueId']) assert.equal(snapshot[key], paid[key], key);
  assert.match(snapshot.pointId, /^[a-f0-9-]{36}$/);
  assert.match(snapshot.sourceNodeId, /^[a-f0-9-]{36}$/);
  assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(snapshot.bytes) && snapshot.bytes > 0);
  assert.equal(snapshot.networkDeniedDuringCapture, true);
  assert.equal(snapshot.independentStoredDigest, true);
  assert.equal(snapshot.signedPublication, true);
  assert.equal(receipt.completeIntegration, false);
  assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.freeSnapshot, {status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false});
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  // The caller can save only redacted observations, never the archive or its grant.
  console.log('PAID_SNAPSHOT_RECEIPT=' + JSON.stringify(receipt));
});
