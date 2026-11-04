import assert from 'node:assert/strict';
import {test} from 'node:test';
const load = () => import('./test-fixtures/integration-verifier-ownership.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-verifier-ownership.mjs')) return {};
  throw error;
});
const image = 'sha256:' + 'a'.repeat(64), scope = 'a0000000-0000-4000-8000-000000000001', id = 'b'.repeat(64);
const identity = {owner: 'waitron-cloud-test-backup', image, scope};
const child = {Id: id, Image: image, Config: {Labels: {'cloud.backup-verifier.owner': 'waitron-cloud-test-backup', 'cloud.backup-verifier.scope': scope}}};
// Cleanup may follow only the durable identity and exact matching child, never a foreign scope or image.
test('verifier cleanup accepts its durable identity and exact child', async () => {
  const {verifierIdentityScope, checkVerifierChild} = await load();
  assert.equal(typeof verifierIdentityScope, 'function'); assert.equal(typeof checkVerifierChild, 'function');
  assert.equal(verifierIdentityScope(identity, image), scope);
  assert.equal(checkVerifierChild(child, {id, image, scope}), id);
});
for (const [name, change] of [['owner', {owner: 'other'}], ['image', {image: 'sha256:' + 'c'.repeat(64)}], ['scope', {scope: 'other'}]]) test('verifier cleanup refuses foreign identity ' + name, async () => {
  const {verifierIdentityScope} = await load(); assert.equal(typeof verifierIdentityScope, 'function');
  assert.throws(() => verifierIdentityScope({...identity, ...change}, image));
});
for (const [name, change] of [
  ['id', value => {value.Id = 'c'.repeat(64);}], ['image', value => {value.Image = 'sha256:' + 'c'.repeat(64);}],
  ['scope', value => {value.Config.Labels['cloud.backup-verifier.scope'] = 'other';}],
  ['owner', value => {value.Config.Labels['cloud.backup-verifier.owner'] = 'other';}],
]) test('verifier cleanup refuses foreign child ' + name, async () => {
  const {checkVerifierChild} = await load(); assert.equal(typeof checkVerifierChild, 'function');
  const value = structuredClone(child); change(value);
  assert.throws(() => checkVerifierChild(value, {id, image, scope}));
});
test('verifier cleanup refuses a malformed selected child id', async () => {
  const {checkVerifierChild} = await load(); assert.equal(typeof checkVerifierChild, 'function');
  assert.throws(() => checkVerifierChild({...child, Id: 'bad'}, {id: 'bad', image, scope}));
});
