import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {test} from 'node:test';
import {signManifest} from '../../packages/remote-access/src/manifest.ts';

test('a stale publisher cannot replace a newer gateway generation', async () => {
  const {secretArtifacts} = await import('./remote-worker.mjs');
  const {privateKey, publicKey} = generateKeyPairSync('ed25519');
  const cellId = '46366bbc-4f72-4a38-b93b-40d160cf9c2b';
  const now = Date.now();
  const manifest = sequence => JSON.stringify(signManifest({
    version: 1, audience: 'waitron-cloud-gateway', cellId, sequence, issuedAt: now, expiresAt: now + 60000, routes: [],
  }, privateKey, now));
  let current = {apiVersion: 'v1', kind: 'Secret',
    metadata: {name: 'remote-routes', namespace: 'd621-data', resourceVersion: '1'}, data: {}};
  const secret = {
    get: async () => structuredClone(current),
    replace: async value => {
      assert.equal(value.metadata.resourceVersion, current.metadata.resourceVersion);
      current = {...value, metadata: {...value.metadata, resourceVersion: '2'}};
    },
  };
  const artifacts = secretArtifacts({secret, cellId, trust: publicKey});
  await artifacts.publishManifest(cellId, manifest(3));
  const committed = structuredClone(current);
  await assert.rejects(artifacts.publishManifest(cellId, manifest(2)), /remote.stale_publication/);
  assert.deepEqual(current, committed);
});
