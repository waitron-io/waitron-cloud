import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as integration from './test-cloud-integration.mjs';
import {checkCapacitySamples} from '../deploy/test-cloud/test-fixtures/integration-capacity.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';
import {execFileSync} from 'node:child_process';

test('the combined journey refuses mutable images before creating resources', async () => {
  assert.equal(typeof integration.runTestCloudCombined, 'function', 'The combined journey is not implemented');
  await assert.rejects(integration.runTestCloudCombined({image: 'cloud:latest', waitronImage: 'waitron:latest'}), /integration\.image_invalid/);
});

// Omitting any journey must fail here, even when every separately run proof passed.
test('one project recovers both copies, withdraws remote access, measures capacity and restores its matching backup', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 600000,
}, async () => {
  const receipt = await integration.runTestCloudCombined({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]')});
  const paid = receipt.organisations.find(value => value.plan === 'paid');
  const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
  assert.equal(receipt.cloudSource?.head, git('rev-parse', 'HEAD'));
  assert.equal(receipt.cloudSource.tree, git('rev-parse', 'HEAD^{tree}'));
  assert.equal(receipt.cloudSource.image, process.env.TEST_CLOUD_INTEGRATION_IMAGE);
  assert.equal(receipt.cloudSource.dirty, false);
  assert.ok(receipt.cloudSource.files > 1000);
  assert.match(receipt.cloudSource.runtimeSha256, /^[a-f0-9]{64}$/);
  const free = receipt.organisations.find(value => value.plan === 'free');
  const direct = receipt.paidStorageWithdrawal;
  assert.ok(direct, 'The paired direct-storage withdrawal proof is missing');
  for (const key of ['organisationId', 'venueId', 'installationId']) assert.equal(direct[key], paid[key], key);
  assert.deepEqual(direct.before, {writeStatus: 200, readStatus: 200, outsidePrefixRefused: true, neighbourRefused: true});
  assert.equal(direct.after.writeStatus, 403); assert.equal(direct.after.readStatus, 403);
  assert.ok(Number.isSafeInteger(direct.after.durationMs) && direct.after.durationMs >= 0 && direct.after.durationMs < 30000);
  assert.equal(direct.retainedData, true); assert.equal(direct.readerPreserved, true);
  assert.equal(direct.installationPreserved, true); assert.equal(direct.plan, 'free');

  const snapshot = receipt.paidSnapshot, stream = receipt.paidStream, remote = receipt.paidRemote;
  for (const value of [snapshot, remote]) for (const key of ['organisationId', 'venueId', 'installationId']) assert.equal(value?.[key], paid[key], key);
  for (const key of ['venueId', 'installationId']) assert.equal(stream?.[key], paid[key], key);
  assert.equal(snapshot.verification, 'verified');
  assert.equal(snapshot.workerVerification.childAbsent, true);
  assert.equal(snapshot.workerVerification.workerStoppedNaturally, true);
  const recovered = receipt.paidContinuousRecovery;
  assert.equal(recovered?.sourceNodeId, snapshot.sourceNodeId);
  assert.equal(recovered?.localVenueId, paid.localVenueId);
  assert.equal(recovered?.generation, stream.generation);
  assert.equal(recovered?.exit, 0); assert.equal(recovered.integrity, 'ok');
  for (const key of ['nativeRestore', 'ownerApprovedKit', 'sourceStoppedDuringRead', 'sourceAuthorityVerified',
    'preparationBoundToStream', 'sourceRecordsPreserved', 'wrongAuthorityRefused', 'missingPreparationRefused',
    'noServerStarted', 'noSupersession', 'requestClosed']) assert.equal(recovered[key], true, key);
  assert.equal(recovered.cloudReportedRestored, false);
  assert.deepEqual(snapshot.snapshotFallback, {streamObjects: 0, pointerRows: 0, retainedSnapshotUnchanged: true,
    observations: ['before-snapshot-request', 'after-snapshot-read', 'after-snapshot-restore-and-close']});
  assert.equal(snapshot.authorisedRecovery.exit, 0);
  for (const key of ['preparationBoundToDeliveredArchive', 'sourceAuthorityVerified', 'wrongAuthorityRefused',
    'missingPreparationRefused', 'sourceRecordsPreserved', 'noServerStarted', 'noCloudCredentials']) assert.equal(snapshot.authorisedRecovery[key], true, key);
  for (const key of ['sha256', 'bytes', 'sourceNodeId', 'localVenueId']) assert.equal(snapshot.authorisedRecovery[key], snapshot[key], key);
  assert.equal(snapshot.authorisedRecovery.integrity, 'ok');
  assert.equal(snapshot.authorisedRecovery.cloudReportedRestored, false);
  for (const key of ['sourceIdentityPreserved', 'sourceStoppedDuringRead', 'requestClosed']) assert.equal(snapshot.ownerRecovery[key], true, key);
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
  assert.equal(checkCapacitySamples(receipt.capacity?.samples), true);
  assert.equal(receipt.capacity.measurement, 'linux-cgroup-v2-including-tmpfs');
  assert.equal(receipt.capacity.shippingQualification, false);
  assert.ok(receipt.capacity.samples.some(value => value.phase === 'verification' &&
    value.verifierIds.includes(snapshot.workerVerification.childId) && value.verifierMiB > 0));
  const journeySamples = receipt.capacity.integration?.samples;
  assert.ok(journeySamples?.length > 2, 'Resources must be sampled throughout the same integration');
  assert.equal(journeySamples[0].stage, 'clients'); assert.equal(journeySamples.at(-1).stage, 'rollback');
  for (const stage of ['verification', 'continuous-recovery', 'snapshot-recovery', 'remote-withdrawal', 'rollback']) {
    assert.ok(journeySamples.some(value => value.stage === stage), stage);
  }
  let previous = -1;
  for (const value of journeySamples) {
    assert.equal(value.phase, 'integration');
    assert.ok(value.elapsedMs > previous && value.elapsedMs - Math.max(0, previous) <= 5000);
    assert.ok(Number.isFinite(value.freeGiB) && value.freeGiB >= 0);
    assert.ok(value.availableMiB >= 0 && value.cloudMiB <= 2048 && value.verifierMiB <= 1024);
    assert.ok(value.scratchMiB <= 256 && value.fixtureBytes <= 1073741824);
    assert.equal(value.oom, false); assert.equal(value.protectedUnchanged, true);
    previous = value.elapsedMs;
  }
  assert.ok(journeySamples.some(value => value.verifierIds.includes(snapshot.workerVerification.childId) && value.verifierMiB > 0));
  const rollback = receipt.schemaRollback;
  assert.equal(rollback?.kind, 'controlled-schema-change'); assert.equal(rollback.shippingQualification, false);
  assert.deepEqual(rollback.before, rollback.after);
  assert.equal(rollback.changedSchema.probe, true); assert.equal(rollback.after.schema.probe, false);
  assert.equal(rollback.changedSchema.migrations, rollback.before.schema.migrations + 1);
  assert.equal(rollback.consumerRefusedChangedSchema, true); assert.equal(rollback.oldBinaryOnNewSchema, false);
  assert.equal(rollback.privateFilesChanged, true); assert.equal(rollback.ready, true);
  assert.deepEqual(rollback.backup.volumes.map(value => value.role), ['config', 'postgres', 'storage', 'gateway']);
  for (const volume of rollback.backup.volumes) {
    assert.match(volume.archiveSha256, /^[a-f0-9]{64}$/); assert.match(volume.contentSha256, /^[a-f0-9]{64}$/); assert.ok(volume.bytes > 0);
  }
  assert.equal(rollback.pairedClientsPreserved, 2);
  assert.deepEqual(rollback.clients.map(value => value.installationId).sort(), receipt.organisations.map(value => value.installationId).sort());
  for (const client of rollback.clients) {
    assert.equal(client.identityPreserved, true);
    for (const key of ['renewals', 'configurations']) assert.ok(client.after[key] > client.before[key]);
  }
  assert.equal(receipt.completeIntegration, false); assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed); assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie', 'recoveryKit', 'secretAccessKey']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('COMBINED_INTEGRATION_RECEIPT=' + JSON.stringify(receipt));
});
