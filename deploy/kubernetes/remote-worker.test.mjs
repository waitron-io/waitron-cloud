import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {test} from 'node:test';
import {signManifest} from '../../packages/remote-access/src/manifest.ts';

async function publicationFixture() {
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
      current = {...value, metadata: {...value.metadata, resourceVersion: String(Number(current.metadata.resourceVersion) + 1)}};
    },
  };
  const artifacts = secretArtifacts({secret, cellId, trust: publicKey});
  await artifacts.publishManifest(cellId, manifest(3));
  return {artifacts, cellId, manifest, secret, current: () => current};
}

test('a stale publisher cannot replace a newer gateway generation', async () => {
  const {artifacts, cellId, manifest, current} = await publicationFixture();
  const committed = structuredClone(current());
  await assert.rejects(artifacts.publishManifest(cellId, manifest(2)), /remote.stale_publication/);
  assert.deepEqual(current(), committed);
});

const venueId = '0ea59815-c897-489c-8316-299c6c5e62fc';
const installationId = '1965af9f-790b-4480-92a3-26a2cae30e84';
const replacementId = 'eea9eede-9f6a-47e6-8d8d-4764858c709f';
const publicCopy = {pem: 'fixture certificate and key', csr: 'fixture signing request'};

test('a fresh worker reuses the public copy only for the matching installation', async () => {
  const {artifacts, cellId, secret, current} = await publicationFixture();
  const version = Number(current().metadata.resourceVersion);
  await artifacts.publishPublicCertificate(installationId, venueId, publicCopy);
  assert.equal(Number(current().metadata.resourceVersion), version + 1);
  const generation = JSON.parse(Buffer.from(current().data['routes.json'], 'base64'));
  assert.equal(generation.manifest, await artifacts.readManifest());
  assert.deepEqual(generation.certificates, {[venueId]: publicCopy.pem});
  const {secretArtifacts} = await import('./remote-worker.mjs');
  const restarted = secretArtifacts({secret, cellId});
  assert.deepEqual(await restarted.readPublicCertificate(installationId), publicCopy);
  assert.equal(await restarted.readPublicCertificate(replacementId), undefined);
  const missingRequest = structuredClone(current());
  delete generation.publicRequests[venueId].csr;
  missingRequest.data['routes.json'] = Buffer.from(JSON.stringify(generation)).toString('base64');
  await secret.replace(missingRequest);
  assert.equal(await restarted.readPublicCertificate(installationId), undefined);
  await artifacts.publishPublicCertificate(replacementId, venueId, {...publicCopy, csr: 'new request'});
  assert.equal(await restarted.readPublicCertificate(installationId), undefined);
  assert.equal(await restarted.readPublicCertificate(replacementId).then(copy => copy.csr), 'new request');
  assert.equal(JSON.parse(Buffer.from(current().data['routes.json'], 'base64')).manifest, generation.manifest);
});

test('a competing update wins and a public certificate write reports the version conflict', async () => {
  const {artifacts, cellId, manifest, secret, current} = await publicationFixture();
  const replace = secret.replace;
  const winner = manifest(4);
  secret.replace = async value => {
    secret.replace = replace;
    await artifacts.publishManifest(cellId, winner);
    assert.notEqual(value.metadata.resourceVersion, current().metadata.resourceVersion);
    throw Object.assign(Error('remote.kubernetes_request'), {status: 409});
  };
  await assert.rejects(artifacts.publishPublicCertificate(installationId, venueId, publicCopy), {status: 409});
  assert.equal(await artifacts.readManifest(), winner);
  assert.deepEqual(JSON.parse(Buffer.from(current().data['routes.json'], 'base64')).certificates, {});
});
