import assert from 'node:assert/strict';
import {test} from 'node:test';
const load = () => import('./test-fixtures/integration-snapshot-exposure.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-snapshot-exposure.mjs')) return {};
  throw error;
});
const selected = {venueId: '22222222-2222-4222-8222-222222222222', installationId: '33333333-3333-4333-8333-333333333333',
  identitySha256: 'a'.repeat(64), archiveSha256: 'b'.repeat(64)};
const saved = {...selected, id: '44444444-4444-4444-8444-444444444444', requestedAt: 1000, acceptedAt: 2000, writeStatus: 200,
  expiresAt: new Date(901000).toISOString(), incomingKey: 'incoming/44444444-4444-4444-8444-444444444444',
  location: {endpoint: 'https://waitron.local:8333', bucket: 'venue-' + selected.venueId, region: 'local'}};
const accepted = async () => ({$metadata: {httpStatusCode: 200}});
const expired = () => Object.assign(Error('private provider detail'), {$metadata: {httpStatusCode: 403}, name: 'InvalidAccessKeyId'});

test('a snapshot write still accepted after downgrade reports remaining exposure without claiming expiry', async () => {
  const {observeSnapshotExposure} = await load();
  assert.equal(typeof observeSnapshotExposure, 'function', 'Snapshot residual-access observation is missing');
  assert.deepEqual(await observeSnapshotExposure({saved, selected, downgradedAt: 300000, put: accepted, now: () => 301000}),
    {requestedAt: 1000, acceptedAt: 2000, expiresAt: saved.expiresAt, downgradedAt: 300000, observedAt: 301000,
      remainingMs: 600000, writeStatus: 200, expiryObserved: false});
});

test('only an actual storage credential-expiry refusal after expiry can report observed expiry', async () => {
  const {observeSnapshotExposure} = await load(); assert.equal(typeof observeSnapshotExposure, 'function');
  assert.deepEqual(await observeSnapshotExposure({saved, selected, downgradedAt: 300000, put: async () => {throw expired();}, now: () => 902000}),
    {requestedAt: 1000, acceptedAt: 2000, expiresAt: saved.expiresAt, downgradedAt: 300000, observedAt: 902000,
      remainingMs: 0, writeStatus: 403, expiryObserved: true});
});

for (const key of Object.keys(selected)) test('snapshot exposure refuses substituted ' + key, async () => {
  const {observeSnapshotExposure} = await load(); assert.equal(typeof observeSnapshotExposure, 'function');
  await assert.rejects(observeSnapshotExposure({saved: {...saved, [key]: 'foreign'}, selected, downgradedAt: 300000, put: accepted, now: () => 301000}));
});
for (const [key, value] of [['id', 'other'], ['incomingKey', 'incoming/other'], ['requestedAt', NaN], ['requestedAt', -1],
  ['acceptedAt', 999], ['acceptedAt', 300001], ['writeStatus', 403], ['expiresAt', 'invalid'],
  ['expiresAt', new Date(1000).toISOString()], ['expiresAt', new Date(902001).toISOString()]]) {
  test('snapshot exposure refuses invalid original ' + key + '=' + value, async () => {
    const {observeSnapshotExposure} = await load(); assert.equal(typeof observeSnapshotExposure, 'function');
    await assert.rejects(observeSnapshotExposure({saved: {...saved, [key]: value}, selected, downgradedAt: 300000, put: accepted, now: () => 301000}));
  });
}
for (const [key, value] of [['endpoint', 'http://waitron.local:8333'], ['bucket', 'another-bucket'], ['region', 'elsewhere']]) {
  test('snapshot exposure refuses substituted location ' + key, async () => {
    const {observeSnapshotExposure} = await load(); assert.equal(typeof observeSnapshotExposure, 'function');
    await assert.rejects(observeSnapshotExposure({saved: {...saved, location: {...saved.location, [key]: value}}, selected,
      downgradedAt: 300000, put: accepted, now: () => 301000}));
  });
}
for (const downgradedAt of [undefined, NaN, '300000', 1999, 301001]) test('snapshot exposure refuses an invalid downgrade time ' + downgradedAt, async () => {
  const {observeSnapshotExposure} = await load(); assert.equal(typeof observeSnapshotExposure, 'function');
  await assert.rejects(observeSnapshotExposure({saved, selected, downgradedAt, put: accepted, now: () => 301000}));
});
for (const failure of [Error('private network error'), Object.assign(expired(), {name: 'AccessDenied'}),
  Object.assign(expired(), {$metadata: {httpStatusCode: 500}})]) test('another failure cannot stand in for observed snapshot expiry: ' + failure.name, async () => {
  const {observeSnapshotExposure} = await load(); assert.equal(typeof observeSnapshotExposure, 'function');
  await assert.rejects(observeSnapshotExposure({saved, selected, downgradedAt: 300000, put: async () => {throw failure;}, now: () => 902000}));
});
test('an early credential refusal cannot be called expiry', async () => {
  const {observeSnapshotExposure} = await load(); assert.equal(typeof observeSnapshotExposure, 'function');
  await assert.rejects(observeSnapshotExposure({saved, selected, downgradedAt: 300000, put: async () => {throw expired();}, now: () => 301000}));
});
test('a write accepted after expiry cannot be called bounded access', async () => {
  const {observeSnapshotExposure} = await load(); assert.equal(typeof observeSnapshotExposure, 'function');
  await assert.rejects(observeSnapshotExposure({saved, selected, downgradedAt: 300000, put: accepted, now: () => 902000}));
});
test('a provider reply crossing the expiry boundary cannot establish pre-expiry access', async () => {
  const {observeSnapshotExposure} = await load(); assert.equal(typeof observeSnapshotExposure, 'function');
  let clock = 900999;
  await assert.rejects(observeSnapshotExposure({saved, selected, downgradedAt: 300000,
    put: async () => {clock = 901001; return accepted();}, now: () => clock}));
});
