import assert from 'node:assert/strict';
import {test} from 'node:test';

const load = () => import('./test-fixtures/integration-lifetime-receipt.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-lifetime-receipt.mjs')) return {};
  throw error;
});
const source = {head: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false, files: 1693, runtimeSha256: 'c'.repeat(64)};
const fixture = () => ({runId: '11111111-1111-4111-8111-111111111111', cloud: structuredClone(source),
  storageBinarySha256: 'd'.repeat(64), requestedSeconds: 900, requestedAt: 1000000, acceptedAt: 1001000,
  expiresAt: '1970-01-01T00:31:40.000Z', refusedAt: 1901000, elapsedMs: 901000.25,
  beforeStatus: 200, afterStatus: 403, afterError: 'InvalidAccessKeyId'});
const expected = () => ({version: 1, kind: 'test-cloud-storage-lifetime', runId: '11111111-1111-4111-8111-111111111111',
  cloud: structuredClone(source), storage: {kind: 'native-seaweedfs', binarySha256: 'd'.repeat(64)},
  purpose: 'provider-lifetime', requestedSeconds: 900, requestedAt: 1000000, acceptedAt: 1001000,
  expiresAt: '1970-01-01T00:31:40.000Z', refusedAt: 1901000, elapsedMs: 901000.25,
  before: {status: 200}, after: {status: 403, error: 'InvalidAccessKeyId'},
  completeIntegration: false, shippingQualification: false});

// Replacing observed refusal or real elapsed time with advertised validity must fail.
test('a full provider-lifetime report preserves actual source, binary, time and storage observations', async () => {
  const {createSnapshotLifetimeReceipt, verifySnapshotLifetimeReceipt} = await load();
  assert.equal(typeof createSnapshotLifetimeReceipt, 'function', 'The strict provider-lifetime producer is missing');
  assert.equal(typeof verifySnapshotLifetimeReceipt, 'function', 'The strict provider-lifetime reader is missing');
  assert.deepEqual(createSnapshotLifetimeReceipt(fixture()), expected());
  assert.equal(verifySnapshotLifetimeReceipt(expected()), true);
});

test('a twelve-second diagnostic stays separate from the fifteen-minute proof', async () => {
  const {createSnapshotLifetimeReceipt, verifySnapshotLifetimeReceipt} = await load();
  const value = createSnapshotLifetimeReceipt({...fixture(), requestedSeconds: 12,
    expiresAt: '1970-01-01T00:16:52.000Z', refusedAt: 1013000, elapsedMs: 13000.25});
  assert.equal(value.purpose, 'short-diagnostic');
  assert.equal(verifySnapshotLifetimeReceipt(value), true);
  value.purpose = 'provider-lifetime';
  assert.throws(() => verifySnapshotLifetimeReceipt(value));
});

const changes = [
  ['version', v => v.version = 2], ['kind', v => v.kind = 'test-cloud-integration'],
  ['run id', v => v.runId = '../private'], ['dirty source', v => v.cloud.dirty = true],
  ['source head', v => v.cloud.head = 'main'], ['source tree', v => v.cloud.tree = 'main'],
  ['file count', v => v.cloud.files = 0], ['fractional file count', v => v.cloud.files = 1693.5],
  ['runtime manifest', v => v.cloud.runtimeSha256 = 'mutable'], ['binary digest', v => v.storage.binarySha256 = 'mutable'],
  ['storage boundary', v => v.storage.kind = 'deployed-issuer'], ['classification', v => v.purpose = 'short-diagnostic'],
  ['unexpected lifetime', v => v.requestedSeconds = 899], ['text lifetime', v => v.requestedSeconds = '900'],
  ['grant before request', v => v.acceptedAt = 999999], ['grant after expiry', v => v.acceptedAt = 1900000],
  ['invalid expiry', v => v.expiresAt = 'invalid'], ['numeric expiry', v => v.expiresAt = 1900000],
  ['early refusal', v => {v.refusedAt = 1899999; v.elapsedMs = 899999;}],
  ['advertised duration without waiting', v => v.elapsedMs = 12000],
  ['wall clock jump', v => {v.refusedAt += 30000; v.elapsedMs = 901000;}],
  ['never accepted', v => v.before.status = 403], ['still accepted', v => v.after.status = 200],
  ['network failure', v => v.after = {status: null, error: 'ECONNRESET'}],
  ['different provider error', v => v.after.error = 'AccessDenied'],
  ['complete claim', v => v.completeIntegration = true], ['shipping claim', v => v.shippingQualification = true],
  ['private extension', v => v.token = 'private'], ['source extension', v => v.cloud.privateKey = 'private'],
  ['storage extension', v => v.storage.endpoint = 'private'], ['response extension', v => v.after.message = 'private'],
];
for (const [name, change] of changes) test('the lifetime reader refuses ' + name, async () => {
  const {verifySnapshotLifetimeReceipt} = await load(); assert.equal(typeof verifySnapshotLifetimeReceipt, 'function');
  const value = expected(); change(value); assert.throws(() => verifySnapshotLifetimeReceipt(value));
});
for (const [key, value] of [['requestedAt', -1], ['requestedAt', 1000000.5], ['acceptedAt', NaN],
  ['refusedAt', '1901000'], ['elapsedMs', NaN], ['elapsedMs', Infinity], ['elapsedMs', -1]]) {
  test('the lifetime reader refuses malformed ' + key + '=' + value, async () => {
    const {verifySnapshotLifetimeReceipt} = await load(); assert.equal(typeof verifySnapshotLifetimeReceipt, 'function');
    assert.throws(() => verifySnapshotLifetimeReceipt({...expected(), [key]: value}));
  });
}
for (const seconds of [12, 900]) for (const shift of [-1001, 1001]) test('the provider expiry must match the requested ' + seconds + ' seconds within rounding: ' + shift, async () => {
  const {createSnapshotLifetimeReceipt} = await load(); assert.equal(typeof createSnapshotLifetimeReceipt, 'function');
  const expires = 1000000 + seconds * 1000 + shift;
  assert.throws(() => createSnapshotLifetimeReceipt({...fixture(), requestedSeconds: seconds,
    expiresAt: new Date(expires).toISOString(), refusedAt: expires + 1001, elapsedMs: expires + 1001 - 1000000}));
});
test('the producer projects only public evidence and does not retain input references', async () => {
  const {createSnapshotLifetimeReceipt} = await load();
  const value = fixture(); value.privateProviderError = 'private';
  const receipt = createSnapshotLifetimeReceipt(value);
  assert.deepEqual(receipt, expected()); value.cloud.head = 'e'.repeat(40);
  assert.equal(receipt.cloud.head, 'a'.repeat(40));
});
