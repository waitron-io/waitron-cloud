import assert from 'node:assert/strict';
import {test} from 'node:test';

const load = () => import('./test-fixtures/integration-withdrawal-receipt.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-withdrawal-receipt.mjs')) return {};
  throw error;
});
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = {organisationId: uuid(2), venueId: uuid(3), installationId: uuid(4)};
const cloud = {head: 'a'.repeat(40), tree: 'b'.repeat(40), image: 'sha256:' + 'c'.repeat(64), dirty: false, files: 1689, runtimeSha256: 'd'.repeat(64)};
const stream = {...binding, before: {writeStatus: 200, readStatus: 200, outsidePrefixRefused: true, neighbourRefused: true},
  after: {writeStatus: 403, readStatus: 403, durationMs: 3400}, restartObserved: true,
  retainedData: true, readerPreserved: true, installationPreserved: true, plan: 'free'};
const gateway = {...binding, staffRefused: true, publicRefused: true, peerRemoved: true, cachedConfigurationMasked: true,
  installationPreserved: true, restartObserved: true, plan: 'free', durationMs: 3100};
const snapshot = {...binding, pointId: uuid(5), requestedAt: 1000, acceptedAt: 2000, expiresAt: '1970-01-01T00:15:01.000Z',
  downgradedAt: 300000, observedAt: 301000, remainingMs: 600000, writeStatus: 200, expiryObserved: false, newGrantRefused: true};
const expected = () => ({version: 1, kind: 'test-cloud-withdrawal', runId: uuid(1), cloud: structuredClone(cloud),
  installation: {...binding}, stream: structuredClone(stream), gateway: structuredClone(gateway),
  snapshot: {...snapshot, status: 'residual-access'}});
function raw() {
  const {organisationId, venueId, installationId, ...withdrawal} = gateway;
  return {version: 1, kind: 'test-cloud-clients', runId: uuid(1), completeIntegration: false, image: cloud.image, cloudSource: structuredClone(cloud),
    organisations: [{plan: 'free', organisationId: uuid(6), venueId: uuid(7), installationId: uuid(8)}, {plan: 'paid', ...binding}],
    paidSnapshot: {...binding, pointId: uuid(5)}, paidRemote: {...binding, withdrawal},
    paidStorageWithdrawal: structuredClone(stream), paidSnapshotExposure: structuredClone(snapshot)};
}
async function api() {
  const value = await load();
  assert.equal(typeof value.createTestCloudWithdrawalReceipt, 'function', 'The strict withdrawal receipt producer is missing');
  assert.equal(typeof value.verifyTestCloudWithdrawalReceipt, 'function', 'The strict withdrawal receipt reader is missing');
  return value;
}

// The break caught here is reporting advertised remaining validity as completed withdrawal.
test('a live snapshot write stays residual access in a redacted receipt from the same paired run', async () => {
  const {createTestCloudWithdrawalReceipt, verifyTestCloudWithdrawalReceipt} = await api();
  const input = raw(), original = structuredClone(input);
  const receipt = createTestCloudWithdrawalReceipt(input);
  assert.deepEqual(receipt, expected());
  assert.equal(verifyTestCloudWithdrawalReceipt(JSON.parse(JSON.stringify(receipt))), true);
  assert.deepEqual(input, original);
  receipt.stream.after.durationMs = 1;
  assert.equal(input.paidStorageWithdrawal.after.durationMs, 3400, 'the published result must not retain mutable input references');
});
test('an actual post-expiry refusal reports observed expiry separately from withdrawal times', async () => {
  const {createTestCloudWithdrawalReceipt, verifyTestCloudWithdrawalReceipt} = await api();
  const input = raw(); Object.assign(input.paidSnapshotExposure, {observedAt: 902000, remainingMs: 0, writeStatus: 403, expiryObserved: true});
  const want = expected(); Object.assign(want.snapshot, {observedAt: 902000, remainingMs: 0, writeStatus: 403, expiryObserved: true, status: 'expired'});
  assert.deepEqual(createTestCloudWithdrawalReceipt(input), want);
  assert.equal(verifyTestCloudWithdrawalReceipt(want), true);
});

const changes = [
  ['run identity', v => v.runId = '../private'], ['dirty source', v => v.cloud.dirty = true],
  ['mutable image', v => v.cloud.image = 'cloud:latest'], ['missing runtime hash', v => delete v.cloud.runtimeSha256],
  ['missing source commit', v => delete v.cloud.head], ['invalid source commit', v => v.cloud.head = 'main'],
  ['invalid source tree', v => v.cloud.tree = 'main'], ['invalid runtime hash', v => v.cloud.runtimeSha256 = 'unmeasured'], ['unmeasured files', v => v.cloud.files = 0],
  ['source extension', v => v.cloud.token = 'private'], ['root extension', v => v.token = 'private'],
  ['wrong receipt kind', v => v.kind = 'test-cloud-integration'], ['wrong version', v => v.version = 2],
  ['missing stream', v => delete v.stream], ['missing gateway', v => delete v.gateway], ['missing snapshot', v => delete v.snapshot],
  ['private installation extension', v => v.installation.privateKey = 'private'],
  ...['stream', 'gateway', 'snapshot'].flatMap(section => Object.keys(binding).map(key =>
    [`${section} foreign ${key}`, v => v[section][key] = uuid(99)])),
  ['changed point', v => v.snapshot.pointId = 'other'],
  ['stream write still works', v => v.stream.after.writeStatus = 200], ['stream read still works', v => v.stream.after.readStatus = 200],
  ['stream deadline', v => v.stream.after.durationMs = 30000], ['gateway deadline', v => v.gateway.durationMs = 30000],
  ['negative stream duration', v => v.stream.after.durationMs = -1], ['fractional gateway duration', v => v.gateway.durationMs = 0.5],
  ['stream original write', v => v.stream.before.writeStatus = 403], ['stream original read', v => v.stream.before.readStatus = 403],
  ...['outsidePrefixRefused', 'neighbourRefused'].map(key => ['stream ' + key, v => v.stream.before[key] = false]),
  ...['restartObserved', 'retainedData', 'readerPreserved', 'installationPreserved'].map(key => ['stream ' + key, v => v.stream[key] = false]),
  ...['staffRefused', 'publicRefused', 'peerRemoved', 'cachedConfigurationMasked', 'installationPreserved', 'restartObserved'].map(key => ['gateway ' + key, v => v.gateway[key] = false]),
  ['invalid installation IDs', v => {for (const part of ['installation', 'stream', 'gateway', 'snapshot']) for (const key of Object.keys(binding)) v[part][key] = 'invalid';}],
  ['stream plan', v => v.stream.plan = 'paid'], ['gateway plan', v => v.gateway.plan = 'paid'],
  ['stream private extension', v => v.stream.after.payload = 'private'], ['gateway private extension', v => v.gateway.secretAccessKey = 'private'],
  ['snapshot private extension', v => v.snapshot.credentials = 'private'],
  ['new snapshot grant', v => v.snapshot.newGrantRefused = false],
  ['invalid request time', v => v.snapshot.requestedAt = -1], ['nonfinite request time', v => v.snapshot.requestedAt = NaN],
  ['typed request time', v => v.snapshot.requestedAt = '1000'], ['acceptance before request', v => v.snapshot.acceptedAt = 999],
  ['acceptance after downgrade', v => v.snapshot.acceptedAt = 300001], ['observation before downgrade', v => v.snapshot.observedAt = 299999],
  ['invalid expiry', v => v.snapshot.expiresAt = 'invalid'], ['expiry before acceptance', v => v.snapshot.expiresAt = new Date(1999).toISOString()],
  ['excessive lifetime', v => {v.snapshot.expiresAt = new Date(902001).toISOString(); v.snapshot.remainingMs = 601001;}],
  ['expiry before original acceptance', v => {Object.assign(v.snapshot, {expiresAt: new Date(1999).toISOString(), remainingMs: 0, writeStatus: 403, expiryObserved: true, status: 'expired'});}],
  ['invented remaining time', v => v.snapshot.remainingMs = 599999], ['nonfinite remaining time', v => v.snapshot.remainingMs = Infinity],
  ['nonboolean expiry', v => {v.snapshot.expiryObserved = 'true'; v.snapshot.observedAt = 902000; v.snapshot.remainingMs = 0; v.snapshot.writeStatus = 403; v.snapshot.status = 'expired';}],
  ['wrong post-expiry status', v => {v.snapshot.expiryObserved = true; v.snapshot.observedAt = 902000; v.snapshot.remainingMs = 0; v.snapshot.writeStatus = 500; v.snapshot.status = 'expired';}],
  ['wrong expired label', v => {v.snapshot.expiryObserved = true; v.snapshot.observedAt = 902000; v.snapshot.remainingMs = 0; v.snapshot.writeStatus = 403;}],
  ['invented expiry', v => v.snapshot.expiryObserved = true], ['invented completed status', v => v.snapshot.status = 'expired'],
  ['provider unavailable', v => v.snapshot.writeStatus = 503], ['early provider refusal', v => {v.snapshot.writeStatus = 403; v.snapshot.expiryObserved = true; v.snapshot.status = 'expired';}],
  ['accepted after expiry', v => {v.snapshot.observedAt = 902000; v.snapshot.remainingMs = 0;}],
];
for (const [name, change] of changes) test('strict withdrawal reader refuses ' + name, async () => {
  const {verifyTestCloudWithdrawalReceipt} = await api(); const value = expected(); change(value);
  assert.throws(() => verifyTestCloudWithdrawalReceipt(value));
});
for (const [name, change] of [
  ['missing source', v => delete v.cloudSource], ['different running image', v => v.image = 'sha256:' + 'f'.repeat(64)], ['missing downgrade evidence', v => delete v.paidSnapshotExposure],
  ['different snapshot owner', v => v.paidSnapshot.organisationId = uuid(99)],
  ['different snapshot point', v => v.paidSnapshot.pointId = uuid(99)],
  ['different gateway owner', v => v.paidRemote.organisationId = uuid(99)],
  ['duplicate paid pair', v => v.organisations.push({...v.organisations[1]})],
  ['wrong raw kind', v => v.kind = 'test-cloud-integration'], ['wrong raw version', v => v.version = 2],
  ['false complete claim', v => v.completeIntegration = true],
  ['private source extension', v => v.cloudSource.token = 'private'], ['private snapshot extension', v => v.paidSnapshotExposure.token = 'private'],
]) test('withdrawal producer refuses ' + name, async () => {
  const {createTestCloudWithdrawalReceipt} = await api(); const value = raw(); change(value);
  assert.throws(() => createTestCloudWithdrawalReceipt(value));
});
