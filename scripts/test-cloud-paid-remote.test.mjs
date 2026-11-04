import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

// Certificates bind the routed peer; the public hostname must never expose staff paths.
test('the paired paid venue serves its own staff and public routes through the LAN gateway', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    freeRemote: true, paidRemote: true});
  const paid = receipt.organisations.find(value => value.plan === 'paid');
  assert.ok(receipt.paidRemote, 'The genuine paired paid remote proof is missing');
  assert.equal(receipt.paidRemote.organisationId, paid.organisationId);
  assert.equal(receipt.paidRemote.installationId, paid.installationId);
  assert.equal(receipt.paidRemote.venueId, paid.venueId);
  assert.deepEqual(receipt.paidRemote.client, {nativeStaffCsr: true, nativeCertificateInstalled: true,
    pairedSignedExchange: true, keysStayedInVenue: true});
  assert.deepEqual(receipt.paidRemote.routes, {staffAvailability: 200, staffPrivateWithoutLogin: 401,
    publicBeforeChallenge: 403, publicAfterChallenge: 200, publicPrivatePath: 404,
    freeNeighbourRefused: true, untrustedRefused: true, wrongHostnameRefused: true,
    sameNativeAvailability: true, staffCertificateMatches: true});
  assert.equal(receipt.paidRemote.peerPresent, true);
  assert.ok(receipt.paidRemote.withdrawal, 'The paired paid-to-free withdrawal and worker restart proof is missing');
  const {durationMs, ...withdrawal} = receipt.paidRemote.withdrawal;
  assert.deepEqual(withdrawal, {staffRefused: true, publicRefused: true, peerRemoved: true,
    cachedConfigurationMasked: true, installationPreserved: true, restartObserved: true, plan: 'free'});
  assert.ok(Number.isSafeInteger(durationMs) && durationMs >= 0 && durationMs < 30000);
  assert.equal(receipt.completeIntegration, false);
  assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('PAID_REMOTE_RECEIPT=' + JSON.stringify(receipt));
});
