import assert from 'node:assert/strict';

export function verifierIdentityScope(identity, image) {
  assert.equal(identity.owner, 'waitron-cloud-test-backup');
  assert.equal(identity.image, image);
  assert.match(identity.scope, /^[a-f0-9-]{36}$/);
  return identity.scope;
}

export function checkVerifierChild(info, {id, image, scope}) {
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(info.Id, id);
  assert.equal(info.Image, image);
  assert.equal(info.Config.Labels['cloud.backup-verifier.scope'], scope);
  assert.equal(info.Config.Labels['cloud.backup-verifier.owner'], 'waitron-cloud-test-backup');
  return id;
}
