import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const fixture = JSON.parse(await readFile(new URL('./test-fixtures/integration-assembly-synthetic.json', import.meta.url)));
function input() {
  const value = structuredClone(fixture);
  const host = {availableMiB: 4096, freeGiB: 20, quarantined:
    ['waitron-app-1', 'waitron-print-agent-1', 'waitron-mailpit-1'].map((name, i) => ({name, id: String(i + 1).repeat(64), state: 'running', health: 'healthy'}))};
  value.journey.capacity.observations = {clock: 'shared-monotonic',
    baseline: {startedMs: 0.125, finishedMs: 10.25, reading: structuredClone(host)},
    samples: Array.from({length: 17}, (_, i) => ({startedMs: 100.25 + i * 5000, finishedMs: 110.75 + i * 5000,
      phase: i === 0 ? 'startup' : i < 15 ? 'settled' : i === 15 ? 'verification' : 'integration',
      reading: {...structuredClone(host), availableMiB: 3000, freeGiB: 18, cloudMiB: 1800,
        verifierCount: i === 15 ? 1 : 0, verifierMiB: i === 15 ? 1000 : 0, scratchMiB: i === 15 ? 240 : 0,
        fixtureBytes: 1234, oom: false, protectedUnchanged: true,
        verifierIds: i === 15 ? [value.journey.paidSnapshot.workerVerification.childId] : []}})),
    after: {startedMs: 80120.5, finishedMs: 80130.75, reading: structuredClone(host)}};
  return value;
}
async function assemble(value) {
  const api = await import('../../scripts/assemble-test-cloud-evidence.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/assemble-test-cloud-evidence.mjs')) return {};
    throw error;
  });
  assert.equal(typeof api.assembleTestCloudEvidence, 'function', 'The source-bound evidence assembler is missing');
  return api.assembleTestCloudEvidence(value);
}

// These are synthetic inputs for rejection controls, never evidence of an executed journey.
test('assembly keeps measured local proof separate from release and complete-integration qualification', async () => {
  const value = input(), previous = structuredClone(value), result = await assemble(value);
  assert.equal(result.kind, 'test-cloud-pre-release-evidence');
  assert.equal(result.completeIntegration, false);
  assert.equal(result.shippingQualification, false);
  assert.equal(result.publication, 'unqualified');
  assert.equal(result.runId, value.journey.runId);
  assert.deepEqual(result.cloud, value.journey.cloudSource);
  assert.equal(result.snapshot.pointId, value.journey.paidSnapshot.pointId);
  assert.equal(result.snapshot.archiveSha256, value.journey.paidSnapshot.sha256);
  assert.equal(result.withdrawal.snapshot.status, 'expired');
  assert.equal(result.resources.samples.length, 17);
  assert.equal(result.resources.samples[15].verifierCount, 1);
  assert.deepEqual(result.freeServices, value.freeServices);
  assert.deepEqual(result.rollback, value.journey.schemaRollback);
  assert.deepEqual(result.cleanup, value.journey.cleanup);
  assert.deepEqual(value, previous);
  result.cleanup.removed.pop();
  assert.deepEqual(value, previous, 'Published evidence must not share mutable input references');
});

const changes = [
  ['input extension', v => v.token = 'PRIVATE_CANARY'],
  ['asset array with named fields', v => v.journey.assets.cloud = Object.assign([], v.journey.assets.cloud)],
  ['free-service revision', v => v.freeServices.cloudHead = 'f'.repeat(40)],
  ['free-service tree', v => v.freeServices.cloudTree = 'f'.repeat(40)],
  ['missing free-service suite', v => v.freeServices.suites.pop()],
  ['unexecuted free-service suite', v => v.freeServices.suites[0].skipped = 1],
  ['live translation claim', v => v.freeServices.translation = 'live'],
  ['mutable Cloud image', v => v.journey.image = 'cloud:latest'],
  ['wrong Waitron image', v => v.journey.waitronImage = 'sha256:' + 'f'.repeat(64)],
  ['wrong Waitron revision', v => v.journey.waitronHead = 'f'.repeat(40)],
  ['different duplicate withdrawal', v => v.journey.withdrawal = {kind: 'foreign'}],
  ['extra Waitron source image', v => v.journey.waitronSource.spare = structuredClone(v.journey.waitronSource.base)],
  ['wrong Waitron source', v => v.journey.waitronSource.client.tree = 'f'.repeat(40)],
  ['wrong Waitron runtime', v => v.journey.waitronSource.client.sourceSha256 = 'f'.repeat(64)],
  ['dirty Waitron source', v => v.journey.waitronSource.base.dirty = true],
  ['wrong Cloud assets', v => v.journey.assets.cloud.image = 'sha256:' + 'f'.repeat(64)],
  ['wrong client assets', v => v.journey.assets.waitron.image = 'sha256:' + 'f'.repeat(64)],
  ['unmeasured assets', v => v.journey.assets.cloud.files = 0],
  ['private asset extension', v => v.journey.assets.privateKey = 'PRIVATE_CANARY'],
  ['missing client actions', v => v.journey.clients.actions.pop()],
  ['failed account mail', v => v.journey.accountMail.free = 'not-run'],
  ['false free backup denial', v => v.journey.freeSnapshot.httpStatus = 200],
  ['false free remote denial', v => v.journey.freeRemote.submit.status = 200],
  ['foreign free remote owner', v => v.journey.freeRemote.organisationId = v.journey.organisations[1].organisationId],
  ['missing remote isolation', v => v.journey.paidRemote.routes.publicPrivatePath = 200],
  ['missing installed certificate', v => v.journey.paidRemote.client.nativeCertificateInstalled = false],
  ['foreign continuous stream', v => v.journey.paidStream.venueId = v.journey.organisations[0].venueId],
  ['missing continuous restore', v => delete v.journey.paidContinuousRecovery],
  ['matching malformed stream generation', v => {
    v.journey.paidStream.generation = '../private'; v.journey.paidContinuousRecovery.generation = '../private';
  }],
  ['stream observed before recovery point', v => v.journey.paidStream.checkedAt = '1970-01-01T00:00:00.000Z'],
  ['false continuous integrity', v => v.journey.paidContinuousRecovery.integrity = 'bad'],
  ['unbound snapshot restore', v => v.journey.paidSnapshot.authorisedRecovery.sha256 = 'f'.repeat(64)],
  ['missing snapshot authority refusal', v => v.journey.paidSnapshot.authorisedRecovery.wrongAuthorityRefused = false],
  ['incomplete snapshot fallback', v => v.journey.paidSnapshot.snapshotFallback.streamObjects = 1],
  ['different verification attempt', v => v.journey.paidSnapshot.ownerRecovery.attemptId = v.journey.runId],
  ['different verification archive', v => v.journey.paidSnapshot.workerVerification.sha256 = 'f'.repeat(64)],
  ['unconfirmed verifier cleanup', v => v.journey.paidSnapshot.workerVerification.childAbsent = false],
  ['wrong measured verifier', v => v.journey.capacity.observations.samples[15].reading.verifierIds = ['f'.repeat(64)]],
  ['incomplete resource chronology', v => v.journey.capacity.observations.samples.splice(7, 1)],
  ['protected process change', v => v.journey.protectedContainersUnchanged = false],
  ['unfinished cleanup', v => v.journey.cleanup.removed.pop()],
  ['foreign cleanup owner', v => v.journey.cleanup.created[0].owner = v.journey.organisations[0].installationId],
  ['different deployment project', v => v.journey.schemaRollback.before.project = 'waitron'],
  ['missing schema refusal', v => v.journey.schemaRollback.consumerRefusedChangedSchema = false],
  ['changed deployment identity', v => v.journey.schemaRollback.after.identity.caSha256 = 'f'.repeat(64)],
  ['different ledger identity', v => {v.journey.schemaRollback.before.schema.ledgerSha256 = 'f'.repeat(64); v.journey.schemaRollback.after.schema.ledgerSha256 = 'f'.repeat(64);}],
  ['missing matching backup', v => v.journey.schemaRollback.backup.volumes.pop()],
  ['unmounted saved volume', v => {
    for (const state of [v.journey.schemaRollback.before, v.journey.schemaRollback.after]) state.bindings[0].mounts = [];
  }],
  ['missing client renewal', v => v.journey.schemaRollback.clients[0].after.renewals = 1],
  ['foreign rollback client', v => v.journey.schemaRollback.clients[0].installationId = v.journey.runId],
  ['unobserved snapshot expiry', v => {const x = v.journey.paidSnapshotExposure; x.expiryObserved = false; x.observedAt = x.downgradedAt; x.remainingMs = Date.parse(x.expiresAt) - x.observedAt; x.writeStatus = 200;}],
  ...[
    ['waitronSource', 'privateKey', 'PRIVATE_CANARY'],
    ['assets.cloud', 'kind', 'waitron'], ['assets.cloud', 'bytes', 0], ['assets.cloud', 'manifestSha256', 'unmeasured'],
    ['assets.waitron', 'baseImage', 'sha256:' + 'f'.repeat(64)],
    ['paidSnapshot', 'status', 'pending'], ['paidSnapshot', 'verification', 'failed'],
    ['paidSnapshot.workerVerification', 'status', 'invalid'], ['paidSnapshot.workerVerification', 'modules', 14],
    ['paidSnapshot.workerVerification', 'activation', 'attempted'],
    ['paidSnapshot.ownerRecovery', 'protocolVersion', 1], ['paidSnapshot.ownerRecovery', 'cloudStatus', 'restored'],
    ['paidSnapshot.ownerRecovery', 'activation', 'attempted'], ['paidSnapshot.ownerRecovery', 'reportedRestored', true],
    ['paidSnapshot.ownerRecovery', 'routeMoved', true], ['paidSnapshot.ownerRecovery.refusals', 'placementCalls', 1],
    ['paidStream', 'status', 'unavailable'], ['tls', 'wrongHostnameRefused', false],
    ['organisations.0', 'installationState', 'revoked'],
    ['schemaRollback', 'privateKey', 'PRIVATE_CANARY'], ['schemaRollback', 'kind', 'same-image'],
    ['schemaRollback', 'shippingQualification', true], ['schemaRollback', 'oldBinaryOnNewSchema', true],
    ['schemaRollback', 'pairedClientsPreserved', 1], ['schemaRollback.backup', 'version', 2],
    ['schemaRollback.backup.volumes.0', 'archiveSha256', 'unmeasured'],
    ['schemaRollback.backup.volumes.0', 'contentSha256', 'unmeasured'], ['schemaRollback.backup.volumes.0', 'bytes', 0],
    ['schemaRollback.clients.0', 'identityPreserved', false],
    ['schemaRollback.changedSchema', 'ledgerSha256', 'unmeasured'],
    ['schemaRollback.changedSchema', 'migrations', 99], ['schemaRollback.changedSchema', 'probe', false],
    ['schemaRollback.changedSchema', 'privateKey', 'PRIVATE_CANARY'],
    ['schemaRollback.clients.0.before', 'renewals', 0], ['schemaRollback.clients.0.before', 'configurations', 0],
  ].map(([path, name, changed]) => [path + '.' + name, v => {
    let section = v.journey;
    for (const key of path.split('.')) section = section[key];
    section[name] = changed;
  }]),
  ...[
    'schemaRollback.before', 'schemaRollback.before.identity', 'schemaRollback.before.schema',
    'schemaRollback.before.bindings.0', 'schemaRollback.before.bindings.0.mounts.0',
    'schemaRollback.backup', 'schemaRollback.backup.volumes.0',
    'schemaRollback.clients.0', 'schemaRollback.clients.0.before',
    'waitronSource.base', 'assets.cloud',
  ].map(path => [path + ' private extension', v => {
    let section = v.journey;
    for (const key of path.split('.')) section = section[key];
    section.privateKey = 'PRIVATE_CANARY';
    if (path.startsWith('schemaRollback.before')) v.journey.schemaRollback.after = structuredClone(v.journey.schemaRollback.before);
  }]),
  ...[
    ['files', 0], ['sourceSha256', 'unmeasured'],
  ].map(([key, changed]) => ['matching invalid Waitron ' + key, v => {
    v.journey.waitronSource.base[key] = changed; v.journey.waitronSource.client[key] = changed;
  }]),
  ...[
    ['project', 'waitron'], ['image', 'sha256:' + 'f'.repeat(64)],
    ['identity.caSha256', 'unmeasured'], ['identity.runtimeSha256', 'unmeasured'], ['schema.probe', true],
    ['bindings.0.image', 'mutable:latest'], ['bindings.0.mounts.0.destination', 'relative'],
  ].map(([path, changed]) => ['matching invalid rollback ' + path, v => {
    for (const state of [v.journey.schemaRollback.before, v.journey.schemaRollback.after]) {
      const keys = path.split('.'); let section = state;
      for (const key of keys.slice(0, -1)) section = section[key];
      section[keys.at(-1)] = changed;
    }
  }]),
  ['duplicate matching container binding', v => {
    for (const state of [v.journey.schemaRollback.before, v.journey.schemaRollback.after]) state.bindings.push(structuredClone(state.bindings[0]));
  }],
  ['private digest in matching identity', v => {
    for (const state of [v.journey.schemaRollback.before, v.journey.schemaRollback.after]) state.identity.privateKey = 'f'.repeat(64);
  }],
  ['unchanged claimed changed ledger', v => v.journey.schemaRollback.changedSchema.ledgerSha256 = v.journey.schemaRollback.before.schema.ledgerSha256],
  ['empty claimed original schema', v => {
    for (const state of [v.journey.schemaRollback.before, v.journey.schemaRollback.after]) state.schema.migrations = 0;
    v.journey.schemaRollback.changedSchema.migrations = 1;
  }],
  ['additional foreign mount', v => {
    for (const state of [v.journey.schemaRollback.before, v.journey.schemaRollback.after]) state.bindings[0].mounts.push({name: 'waitron_private', destination: '/run/foreign'});
  }],
  ['duplicate local venue identity', v => v.journey.organisations[0].localVenueId = v.journey.organisations[1].localVenueId],
  ['false client restart evidence', v => v.journey.clients.restartIdentity = 'not-run'],
  ['malformed free local identity', v => v.journey.organisations[0].localVenueId = 'invalid'],
  ['snapshot local identity differs from pairing', v => v.journey.organisations[1].localVenueId = v.journey.runId],
  ['matching zero archive sizes', v => {
    for (const section of [v.journey.paidSnapshot, v.journey.paidSnapshot.workerVerification,
      v.journey.paidSnapshot.ownerRecovery, v.journey.paidSnapshot.authorisedRecovery]) section.bytes = 0;
  }],
  ['verification and recovery name another point', v => {
    v.journey.paidSnapshot.workerVerification.pointId = v.journey.runId;
    v.journey.paidSnapshot.ownerRecovery.pointId = v.journey.runId;
  }],
  ['matching malformed verification attempts', v => {
    v.journey.paidSnapshot.workerVerification.attemptId = 'invalid';
    v.journey.paidSnapshot.ownerRecovery.attemptId = 'invalid';
  }],
  ['matching malformed verification targets', v => {
    v.journey.paidSnapshot.workerVerification.targetDigest = 'invalid';
    v.journey.paidSnapshot.ownerRecovery.targetDigest = 'invalid';
  }],
  ['unrecorded matching container', v => {
    for (const state of [v.journey.schemaRollback.before, v.journey.schemaRollback.after]) state.bindings[0].id = 'f'.repeat(64);
  }],
  ['absent matching volume cleanup', v => {
    for (const key of ['created', 'removed']) v.journey.cleanup[key] = v.journey.cleanup[key].filter(r => r.id !== 'waitron-cloud-test_local-stack-config');
  }],
  ['absent matching verifier cleanup', v => {
    for (const key of ['created', 'removed']) v.journey.cleanup[key] = v.journey.cleanup[key].filter(r => r.id !== v.journey.paidSnapshot.workerVerification.childId);
  }],
  ...[
    ['paidSnapshot', ['networkDeniedDuringCapture', 'signedPublication', 'independentStoredDigest']],
    ['paidSnapshot.workerVerification', ['cleanupConfirmed', 'noSupersession', 'childAbsent', 'workerStoppedNaturally']],
    ['paidSnapshot.ownerRecovery', ['noSupersession', 'independentDigest', 'prePlacement', 'sourceStoppedDuringRead', 'requestClosed', 'sourceIdentityPreserved']],
    ['paidStream', ['nativeStreaming', 'signedPointerVerified', 'retainedSnapshotUnchanged', 'noSupersession', 'noActivation', 'independentObservation']],
    ['schemaRollback', ['consumerRefusedChangedSchema', 'privateFilesChanged', 'ready']],
  ].flatMap(([path, names]) => names.map(name => [path + '.' + name, v => {
    let section = v.journey;
    for (const key of path.split('.')) section = section[key];
    section[name] = false;
  }])),
];
for (const [name, change] of changes) test('assembly refuses ' + name, async () => {
  await assemble(input());
  const value = input(); change(value);
  await assert.rejects(assemble(value), error => {
    assert.notEqual(error.message, 'The source-bound evidence assembler is missing');
    return true;
  });
});

test('assembly command refuses private or oversized input without echoing it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-evidence-assembly-'));
  try {
    const file = join(directory, 'input.json');
    const run = (...args) => spawnSync(process.execPath, ['scripts/assemble-test-cloud-evidence.mjs', ...args], {encoding: 'utf8'});
    await writeFile(file, JSON.stringify(input()));
    const valid = run(file);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).completeIntegration, false);
    assert.equal(run(file, file).status, 1, 'A valid first file must not hide ignored arguments');
    const privateInput = input(); privateInput.freeServices.token = 'PRIVATE_CANARY';
    await writeFile(file, JSON.stringify(privateInput));
    for (const result of [run(file), run(), run(file, file)]) {
      assert.equal(result.status, 1); assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'Test Cloud evidence assembly refused\n');
    }
    await writeFile(file, ' '.repeat(2 * 1024 * 1024) + JSON.stringify(input()));
    assert.equal(run(file).status, 1);
  } finally {await rm(directory, {recursive: true, force: true});}
});
