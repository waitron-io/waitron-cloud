import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validateFreeServiceReceipt} from './test-cloud-free-services.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';
import {createTestCloudWithdrawalReceipt} from '../deploy/test-cloud/test-fixtures/integration-withdrawal-receipt.mjs';
import {createTestCloudResourceEvidence} from '../deploy/test-cloud/test-fixtures/integration-resource-evidence.mjs';
import {inspectIntegrationAuthorisedRecovery} from '../deploy/test-cloud/test-fixtures/integration-recovery-evidence.mjs';
import {inspectIntegrationContinuousRecovery} from '../deploy/test-cloud/test-fixtures/integration-continuous-recovery-evidence.mjs';
import {inspectIntegrationStream} from '../deploy/test-cloud/test-fixtures/integration-stream-evidence.mjs';

const hash = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/, image = /^sha256:[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
function exact(value, names) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), names.split(',').sort());
}
function positive(value) {assert.ok(Number.isSafeInteger(value) && value > 0);}
function yes(value, names) {for (const name of names.split(',')) assert.equal(value[name], true, name);}
function bind(value, selected, names = 'organisationId,venueId,installationId') {
  for (const name of names.split(',')) assert.equal(value[name], selected[name], name);
}
function waitronSource(value) {
  exact(value, 'image,head,tree,dirty,files,sourceSha256');
  assert.match(value.image, image); assert.match(value.head, commit); assert.match(value.tree, commit);
  assert.equal(value.dirty, false); positive(value.files); assert.match(value.sourceSha256, hash);
}
function asset(value, kind, selectedImage) {
  exact(value, kind === 'cloud' ? 'image,kind,files,bytes,manifestSha256' : 'image,kind,files,bytes,manifestSha256,baseImage');
  assert.equal(value.kind, kind); assert.equal(value.image, selectedImage);
  positive(value.files); positive(value.bytes); assert.match(value.manifestSha256, hash);
}
function rollback(value, journey, organisations) {
  exact(value, 'kind,shippingQualification,before,after,backup,changedSchema,consumerRefusedChangedSchema,privateFilesChanged,oldBinaryOnNewSchema,ready,clients,pairedClientsPreserved');
  assert.equal(value.kind, 'controlled-schema-change'); assert.equal(value.shippingQualification, false);
  assert.deepEqual(value.after, value.before);
  const {before} = value;
  exact(before, 'project,image,identity,schema,bindings');
  assert.equal(before.project, 'waitron-cloud-test'); assert.equal(before.image, journey.image);
  exact(before.identity, 'runtimeSha256,caSha256,schemaSha256');
  for (const digest of Object.values(before.identity)) assert.match(digest, hash);
  exact(before.schema, 'ledgerSha256,migrations,probe'); positive(before.schema.migrations);
  assert.equal(before.schema.probe, false); assert.equal(before.schema.ledgerSha256, before.identity.schemaSha256);
  exact(value.changedSchema, 'ledgerSha256,migrations,probe'); assert.match(value.changedSchema.ledgerSha256, hash);
  assert.notEqual(value.changedSchema.ledgerSha256, before.schema.ledgerSha256);
  assert.equal(value.changedSchema.migrations, before.schema.migrations + 1); assert.equal(value.changedSchema.probe, true);
  yes(value, 'consumerRefusedChangedSchema,privateFilesChanged,ready'); assert.equal(value.oldBinaryOnNewSchema, false);
  exact(value.backup, 'version,volumes'); assert.equal(value.backup.version, 1);
  assert.deepEqual(value.backup.volumes.map(v => v.role), ['config', 'postgres', 'storage', 'gateway']);
  for (const volume of value.backup.volumes) {
    exact(volume, 'role,archiveSha256,contentSha256,bytes');
    assert.match(volume.archiveSha256, hash); assert.match(volume.contentSha256, hash); positive(volume.bytes);
  }
  assert.ok(Array.isArray(before.bindings) && before.bindings.length > 0);
  assert.equal(new Set(before.bindings.map(v => v.id)).size, before.bindings.length);
  for (const row of before.bindings) {
    exact(row, 'id,image,mounts'); assert.match(row.id, hash); assert.match(row.image, image);
    assert.ok(journey.cleanup.created.some(v => v.kind === 'container' && v.id === row.id));
    assert.ok(Array.isArray(row.mounts));
    for (const mount of row.mounts) {
      exact(mount, 'name,destination'); assert.match(mount.name, /^waitron-cloud-test(?:_|-)[a-z0-9-]+$/);
      assert.match(mount.destination, /^\/[a-zA-Z0-9_/-]+$/);
    }
  }
  for (const volume of value.backup.volumes) assert.ok(before.bindings.some(row =>
    row.mounts.some(mount => mount.name === 'waitron-cloud-test_local-stack-' + volume.role)));
  assert.equal(value.pairedClientsPreserved, 2);
  assert.deepEqual(value.clients.map(v => v.installationId).sort(), organisations.map(v => v.installationId).sort());
  for (const client of value.clients) {
    exact(client, 'installationId,before,after,identityPreserved'); assert.equal(client.identityPreserved, true);
    for (const counts of [client.before, client.after]) {
      exact(counts, 'renewals,configurations'); positive(counts.renewals); positive(counts.configurations);
    }
    for (const name of ['renewals', 'configurations']) assert.ok(client.after[name] > client.before[name]);
  }
}

// Local observations do not establish publication, a supported release upgrade or deployment authority.
export function assembleTestCloudEvidence(input) {
  exact(input, 'journey,freeServices');
  const {journey: raw, freeServices} = input;
  validateFreeServiceReceipt(freeServices);
  const withdrawal = createTestCloudWithdrawalReceipt(raw);
  assert.equal(freeServices.cloudHead, raw.cloudSource.head); assert.equal(freeServices.cloudTree, raw.cloudSource.tree);
  assert.equal(raw.project, 'waitron-cloud-test'); assert.equal(raw.protectedContainersUnchanged, true);
  assert.equal(withdrawal.snapshot.status, 'expired');
  if (raw.withdrawal) assert.deepEqual(raw.withdrawal, withdrawal);
  exact(raw.waitronSource, 'base,client');
  for (const source of Object.values(raw.waitronSource)) waitronSource(source);
  const {base, client} = raw.waitronSource;
  assert.equal(base.image, raw.waitronImage); assert.equal(base.head, raw.waitronHead);
  for (const name of ['head', 'tree', 'dirty', 'files', 'sourceSha256']) assert.equal(client[name], base[name]);
  exact(raw.assets, 'cloud,waitron');
  asset(raw.assets.cloud, 'cloud', raw.image); asset(raw.assets.waitron, 'waitron', client.image);
  assert.equal(raw.assets.waitron.baseImage, base.image);
  const organisations = raw.organisations.map(value => {
    assert.match(value.localVenueId, uuid); assert.equal(value.installationState, 'active');
    return Object.fromEntries(['plan', 'organisationId', 'venueId', 'installationId', 'stateSha256'].map(k => [k, value[k]]));
  });
  const paid = raw.organisations.find(v => v.plan === 'paid'), free = raw.organisations.find(v => v.plan === 'free');
  assert.notEqual(paid.localVenueId, free.localVenueId);
  assert.deepEqual(raw.clients, {status: 'proved', actions: ['pair', 'renew', 'configuration'], demoVenues: 2, restartIdentity: 'proved'});
  assert.deepEqual(raw.tls, {untrustedRefused: true, wrongHostnameRefused: true});
  const snapshot = raw.paidSnapshot, verification = snapshot.workerVerification, recovery = snapshot.ownerRecovery;
  bind(snapshot, paid); assert.equal(snapshot.localVenueId, paid.localVenueId);
  assert.match(snapshot.pointId, uuid); assert.match(snapshot.sourceNodeId, uuid); assert.match(snapshot.sha256, hash); positive(snapshot.bytes);
  assert.equal(snapshot.status, 'published'); assert.equal(snapshot.verification, 'verified');
  yes(snapshot, 'networkDeniedDuringCapture,signedPublication,independentStoredDigest');
  bind(verification, snapshot, 'pointId,sha256,bytes'); assert.match(verification.attemptId, uuid);
  assert.match(verification.childId, hash); assert.match(verification.targetDigest, hash);
  assert.equal(verification.status, 'passed'); assert.equal(verification.activation, 'not_attempted');
  assert.equal(verification.modules, 15); yes(verification, 'cleanupConfirmed,noSupersession,childAbsent,workerStoppedNaturally');
  bind(recovery, verification, 'pointId,attemptId,targetDigest,sha256,bytes');
  assert.equal(recovery.protocolVersion, 2); assert.equal(recovery.cloudStatus, 'pending');
  assert.equal(recovery.activation, 'not_attempted'); assert.equal(recovery.reportedRestored, false); assert.equal(recovery.routeMoved, false);
  yes(recovery, 'noSupersession,independentDigest,prePlacement,sourceStoppedDuringRead,requestClosed,sourceIdentityPreserved');
  assert.deepEqual(recovery.refusals, {alternateTargetRefused: true, damagedArchiveRefused: true, placementCalls: 0, restoredReports: 0, stateUnchanged: true});
  inspectIntegrationAuthorisedRecovery(snapshot.authorisedRecovery, snapshot);
  assert.deepEqual(snapshot.snapshotFallback, {streamObjects: 0, pointerRows: 0, retainedSnapshotUnchanged: true,
    observations: ['before-snapshot-request', 'after-snapshot-read', 'after-snapshot-restore-and-close']});
  const {status, independentObservation, ...stream} = raw.paidStream;
  assert.deepEqual(inspectIntegrationStream(stream, {venueId: paid.venueId, installationId: paid.installationId,
    sourceNodeId: snapshot.sourceNodeId, localVenueId: snapshot.localVenueId,
    generation: stream.generation, recoverableAt: stream.recoverableAt}), raw.paidStream);
  const continuous = inspectIntegrationContinuousRecovery(raw.paidContinuousRecovery, raw.paidStream);
  bind(raw.freeRemote, free, 'organisationId,installationId');
  assert.deepEqual(raw.freeRemote, {organisationId: free.organisationId, installationId: free.installationId,
    submit: {status: 403, error: 'permission_denied'}, status: {status: 403, error: 'permission_denied'},
    invalidProof: {status: 401, error: 'invalid_proof'}, nativeStaffCsr: true, provision: 'permission_denied',
    placements: 0, hostnames: 0, requests: 0, jobs: 0, configurationUnchanged: true, plan: 'free'});
  assert.deepEqual(raw.paidRemote.routes, {staffAvailability: 200, staffPrivateWithoutLogin: 401, publicBeforeChallenge: 403,
    publicAfterChallenge: 200, publicPrivatePath: 404, freeNeighbourRefused: true, untrustedRefused: true,
    wrongHostnameRefused: true, sameNativeAvailability: true, staffCertificateMatches: true});
  assert.deepEqual(raw.paidRemote.client, {nativeStaffCsr: true, nativeCertificateInstalled: true, pairedSignedExchange: true, keysStayedInVenue: true});
  const resources = createTestCloudResourceEvidence(raw.capacity.observations);
  assert.ok(raw.capacity.observations.samples.some(v => v.phase === 'verification' && v.reading.verifierIds.includes(verification.childId)));
  assert.ok(raw.cleanup.created.some(v => v.kind === 'container' && v.id === verification.childId));
  rollback(raw.schemaRollback, raw, organisations);
  const source = value => Object.fromEntries(['head', 'tree', 'image', 'dirty'].map(k => [k, value[k]]));
  const identity = {project: raw.project, image: raw.image, schema: raw.cloudSource.head,
    caSha256: raw.schemaRollback.before.identity.caSha256, volumes: raw.schemaRollback.backup.volumes.map(v => raw.project + '_local-stack-' + v.role)};
  for (const name of identity.volumes) assert.ok(raw.cleanup.created.some(v => v.kind === 'volume' && v.id === name));
  verifyTestCloudReceipt({version: 1, kind: 'test-cloud-integration', runId: raw.runId, environment: 'lan-test-box', origin: raw.origin,
    cloud: source(raw.cloudSource), waitron: source(base), organisations, accountMail: raw.accountMail,
    clients: {status: raw.clients.status, waitronHead: raw.waitronHead, origin: raw.origin, actions: raw.clients.actions},
    snapshots: {status: 'proved', free: raw.freeSnapshot, paid: {archiveSha256: snapshot.sha256, upload: 'proved', verification: 'proved', restore: 'proved', activation: 'not-performed'}},
    continuous: {status: 'proved', capture: 'proved', restore: 'proved', snapshotFallback: 'proved', streamAbsentForFallback: true, activation: 'not-performed'},
    remote: {status: 'proved', freeProvision: raw.freeSnapshot, freeCertificate: raw.freeSnapshot, staffIsolation: 'proved', publicIsolation: 'proved', downgrade: 'proved', restart: 'proved',
      withdrawal: {streamMs: withdrawal.stream.after.durationMs, gatewayMs: withdrawal.gateway.durationMs, snapshotStsMs: withdrawal.snapshot.observedAt - withdrawal.snapshot.downgradedAt}},
    fixtures: {address: 'unavailable', relay: freeServices.relay, translation: freeServices.translation, deployedTranslation: freeServices.deployedTranslation, waitronRelay: 'unavailable', waitronTranslation: 'unavailable'},
    resources, rollback: {status: 'proved', before: identity, after: identity, oldBinaryOnNewSchema: false}, cleanup: raw.cleanup});
  return structuredClone({version: 1, kind: 'test-cloud-pre-release-evidence', runId: raw.runId,
    completeIntegration: false, shippingQualification: false, publication: 'unqualified', cloud: raw.cloudSource,
    waitron: raw.waitronSource, assets: raw.assets, organisations,
    snapshot: {pointId: snapshot.pointId, archiveSha256: snapshot.sha256, bytes: snapshot.bytes, attemptId: verification.attemptId},
    continuous, withdrawal, resources, freeServices, rollback: raw.schemaRollback, cleanup: raw.cleanup});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 3);
    const bytes = await readFile(process.argv[2]); assert.ok(bytes.length <= 2 * 1024 * 1024);
    process.stdout.write(JSON.stringify(assembleTestCloudEvidence(JSON.parse(bytes))) + '\n');
  } catch {process.stderr.write('Test Cloud evidence assembly refused\n'); process.exitCode = 1;}
}
