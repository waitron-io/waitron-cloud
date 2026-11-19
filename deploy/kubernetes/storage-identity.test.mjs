import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import {mkdtemp, rm, stat, unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';

const run = promisify(execFile);

test('storage custody survives reopening and refuses a lost key', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'storage-identity-test-'));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const directory = join(parent, 'custody');
  const {createStorageCustody, readStorageCustody} = await import('./secrets.mjs');

  const initial = await createStorageCustody(directory, run);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  for (const file of ['signing.pem', 'master.key', 'issuer.key']) {
    assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
  }
  assert.deepEqual(await readStorageCustody(directory), initial);
  await assert.rejects(createStorageCustody(directory, run), {code: 'EEXIST'});
  await unlink(join(directory, 'master.key'));
  await assert.rejects(readStorageCustody(directory), /storage_identity\.custody_unavailable/);
});

test('expired issuer TLS stops projection and leaves the stored keys readable', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'storage-identity-test-'));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const directory = join(parent, 'custody');
  const {createStorageCustody, readStorageCustody} = await import('./secrets.mjs');
  const {storageIdentity, storageRuntime} = await import('./storage-identity.mjs');
  const original = await createStorageCustody(directory, run);
  const certificate = new X509Certificate(original.certificate);
  let now = certificate.validToDate.getTime() + 1000;
  t.mock.method(Date, 'now', () => now);
  const reopened = await readStorageCustody(directory);
  assert.deepEqual(reopened, original);
  assert.equal(storageRuntime(reopened, 'role', 'https://store.local', 'us-east-1', '/store.crt', {})
    .CLOUD_BACKUP_MASTER_KEY, original.masterKey);
  assert.throws(() => storageIdentity(reopened, 'role'), /storage_identity\.issuer_certificate_time/);
  now = certificate.validFromDate.getTime() - 1000;
  assert.throws(() => storageIdentity(reopened, 'role'), /storage_identity\.issuer_certificate_time/);
});

test('only the public issuer documents and issuer TLS identity are projected to two pods', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'storage-identity-test-'));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const {createStorageCustody} = await import('./secrets.mjs');
  const custody = await createStorageCustody(join(parent, 'custody'), run);
  const {storageIdentity} = await import('./storage-identity.mjs');
  const identity = storageIdentity(custody, 'arn:aws:iam::test:role/storage');
  const resources = identity.resources;
  const [deployment] = resources.filter(row => row.kind === 'Deployment');
  const pod = deployment.spec.template.spec;
  assert.equal(deployment.spec.replicas, 2);
  assert.equal(pod.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution[0].topologyKey,
    'kubernetes.io/hostname');
  assert.equal(pod.automountServiceAccountToken, false);
  const privateProjection = resources.find(row => row.kind === 'Secret');
  assert.deepEqual(privateProjection.stringData, {'tls.crt': custody.certificate, 'tls.key': custody.tlsKey});
  const documents = resources.find(row => row.kind === 'ConfigMap').data;
  const {issuer, jwks_uri} = JSON.parse(documents['discovery.json']);
  assert.equal(issuer, identity.authority.issuer);
  assert.equal(jwks_uri, issuer + '/jwks');
  const [key] = JSON.parse(documents['jwks.json']).keys;
  assert.deepEqual(Object.keys(key).sort(), ['alg', 'e', 'kid', 'kty', 'n', 'use']);
  assert.equal(key.kid, identity.authority.keyId);
  assert.equal(identity.authority.privateKey, custody.signingKey);
  assert.equal(JSON.stringify(resources).includes(custody.masterKey), false);
  assert.equal(JSON.stringify(resources).includes(custody.signingKey.replaceAll('\n', '\\n')), false);
});

test('store loads role-based OpenID on startup and retains its peer trust', async () => {
  const {stockholmStoreResources} = await import('../../scripts/kubernetes-storage.mjs');
  const {audience, discoveryPath, issuer, policyName} = await import('./storage-identity.mjs');
  const openId = {configUrl: issuer + discoveryPath, clientId: audience, rolePolicy: policyName};
  const items = stockholmStoreResources(['node-a', 'node-b', 'node-c'], 'local:store', openId);
  const pod = items.find(row => row.kind === 'StatefulSet').spec.template.spec;
  const env = Object.fromEntries(pod.containers[0].env.map(({name, value}) => [name, value]));
  assert.equal(env.MINIO_IDENTITY_OPENID_CONFIG_URL, openId.configUrl);
  assert.equal(env.MINIO_IDENTITY_OPENID_CLIENT_ID, audience);
  assert.equal(env.MINIO_IDENTITY_OPENID_ROLE_POLICY, policyName);
  assert.deepEqual(pod.volumes[0].secret.items.filter(item => item.path.startsWith('CAs/')), [
    {key: 'tls.crt', path: 'CAs/local.crt'}, {key: 'issuer.crt', path: 'CAs/issuer.crt'},
  ]);
});
