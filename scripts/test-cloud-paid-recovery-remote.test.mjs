import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';

// Separate successful journeys cannot prove that recovery leaves the paired remote client usable.
test('one paired source restores its stream and independent snapshot before remote access and withdrawal', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    paidContinuousRecovery: true, freeRemote: true, paidRemote: true});
  const paid = receipt.organisations.find(value => value.plan === 'paid');
  const free = receipt.organisations.find(value => value.plan === 'free');
  const snapshot = receipt.paidSnapshot, stream = receipt.paidStream;
  const restored = receipt.paidContinuousRecovery, remote = receipt.paidRemote;
  for (const value of [snapshot, remote]) {
    assert.ok(value);
    for (const key of ['organisationId', 'venueId', 'installationId']) assert.equal(value[key], paid[key], key);
  }
  for (const key of ['venueId', 'installationId']) assert.equal(stream[key], paid[key], key);
  assert.equal(snapshot.localVenueId, paid.localVenueId);
  assert.equal(stream.sourceNodeId, snapshot.sourceNodeId);
  assert.equal(stream.localVenueId, paid.localVenueId);
  assert.equal(snapshot.verification, 'verified');
  assert.equal(snapshot.workerVerification.childAbsent, true);
  assert.equal(snapshot.workerVerification.workerStoppedNaturally, true);
  assert.equal(restored.exit, 0);
  assert.equal(restored.sourceNodeId, snapshot.sourceNodeId);
  assert.equal(restored.localVenueId, paid.localVenueId);
  assert.equal(restored.generation, stream.generation);
  for (const key of ['nativeRestore', 'ownerApprovedKit', 'sourceStoppedDuringRead', 'sourceAuthorityVerified',
    'preparationBoundToStream', 'sourceRecordsPreserved', 'wrongAuthorityRefused', 'missingPreparationRefused',
    'noServerStarted', 'noSupersession', 'requestClosed']) assert.equal(restored[key], true, key);
  assert.equal(restored.integrity, 'ok'); assert.equal(restored.cloudReportedRestored, false);
  assert.deepEqual(snapshot.snapshotFallback, {streamObjects: 0, pointerRows: 0, retainedSnapshotUnchanged: true,
    observations: ['before-snapshot-request', 'after-snapshot-read', 'after-snapshot-restore-and-close']});
  assert.equal(snapshot.authorisedRecovery.exit, 0);
  assert.equal(snapshot.ownerRecovery.sourceIdentityPreserved, true);
  assert.equal(snapshot.ownerRecovery.sourceStoppedDuringRead, true);
  assert.equal(snapshot.ownerRecovery.requestClosed, true);
  assert.equal(snapshot.ownerRecovery.reportedRestored, false);
  assert.equal(snapshot.ownerRecovery.activation, 'not_attempted');
  assert.deepEqual(remote.routes, {staffAvailability: 200, staffPrivateWithoutLogin: 401,
    publicBeforeChallenge: 403, publicAfterChallenge: 200, publicPrivatePath: 404, freeNeighbourRefused: true,
    untrustedRefused: true, wrongHostnameRefused: true, sameNativeAvailability: true, staffCertificateMatches: true});
  assert.deepEqual(remote.client, {nativeStaffCsr: true, nativeCertificateInstalled: true, pairedSignedExchange: true, keysStayedInVenue: true});
  const {durationMs, ...withdrawal} = remote.withdrawal;
  assert.deepEqual(withdrawal, {staffRefused: true, publicRefused: true, peerRemoved: true,
    cachedConfigurationMasked: true, installationPreserved: true, restartObserved: true, plan: 'free'});
  assert.ok(Number.isSafeInteger(durationMs) && durationMs >= 0 && durationMs < 30000);
  assert.deepEqual(receipt.freeRemote, {organisationId: free.organisationId, installationId: free.installationId,
    provision: 'permission_denied', submit: {status: 403, error: 'permission_denied'},
    status: {status: 403, error: 'permission_denied'}, invalidProof: {status: 401, error: 'invalid_proof'},
    nativeStaffCsr: true, placements: 0, hostnames: 0, requests: 0, jobs: 0, configurationUnchanged: true, plan: 'free'});
  assert.deepEqual(receipt.freeSnapshot, {status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false});
  assert.equal(receipt.completeIntegration, false); assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed); assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie', 'recoveryKit', 'secretAccessKey']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('PAID_RECOVERY_REMOTE_RECEIPT=' + JSON.stringify(receipt));
});
