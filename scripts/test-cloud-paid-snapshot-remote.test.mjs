import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

// Both observations must come from the same paired venue, including its HTTPS backup-state server.
test('one paid HTTPS venue publishes its snapshot and serves isolated remote routes', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    paidSnapshot: true, freeRemote: true, paidRemote: true});
  const paid = receipt.organisations.find(value => value.plan === 'paid');
  const snapshot = receipt.paidSnapshot, remote = receipt.paidRemote;
  assert.ok(snapshot); assert.ok(remote);
  for (const key of ['organisationId', 'venueId', 'installationId']) {
    assert.equal(snapshot[key], paid[key], key); assert.equal(remote[key], paid[key], key);
  }
  assert.equal(snapshot.localVenueId, paid.localVenueId);
  assert.equal(snapshot.status, 'published'); assert.equal(snapshot.verification, 'pending'); assert.equal(snapshot.recovery, 'not-run');
  assert.match(snapshot.sha256, /^[a-f0-9]{64}$/); assert.ok(Number.isSafeInteger(snapshot.bytes) && snapshot.bytes > 0);
  assert.equal(snapshot.independentStoredDigest, true); assert.equal(snapshot.networkDeniedDuringCapture, true);
  assert.equal(snapshot.signedPublication, true);
  assert.deepEqual(remote.routes, {staffAvailability: 200, staffPrivateWithoutLogin: 401,
    publicBeforeChallenge: 403, publicAfterChallenge: 200, publicPrivatePath: 404, freeNeighbourRefused: true,
    untrustedRefused: true, wrongHostnameRefused: true, sameNativeAvailability: true, staffCertificateMatches: true});
  assert.deepEqual(remote.client, {nativeStaffCsr: true, nativeCertificateInstalled: true, pairedSignedExchange: true, keysStayedInVenue: true});
  const {durationMs, ...withdrawal} = remote.withdrawal;
  assert.deepEqual(withdrawal, {staffRefused: true, publicRefused: true, peerRemoved: true,
    cachedConfigurationMasked: true, installationPreserved: true, restartObserved: true, plan: 'free'});
  assert.ok(Number.isSafeInteger(durationMs) && durationMs >= 0 && durationMs < 30000);
  assert.deepEqual(receipt.freeSnapshot, {status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false});
  assert.equal(receipt.completeIntegration, false); assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed); assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('PAID_SNAPSHOT_REMOTE_RECEIPT=' + JSON.stringify(receipt));
});
