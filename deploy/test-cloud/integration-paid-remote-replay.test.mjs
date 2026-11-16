import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {verifyMachine} from '../../packages/registration/src/installation-proof.ts';
import {paidRemoteClient} from './test-fixtures/integration-paid-remote-client.mjs';

test('withdrawal replays the saved operation with fresh authentication after observation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'paid-remote-replay-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const key = generateKeyPairSync('ed25519');
  const publicKey = key.publicKey.export({type: 'spki', format: 'der'}).toString('base64url');
  const origin = 'https://waitron.local:3000', installationId = randomUUID();
  const issuedAt = 1800000000000, now = issuedAt + 900000;
  t.mock.method(Date, 'now', () => now);
  const lease = {payload: 'current-test-lease', signature: 'current-test-signature'};
  const payload = ['waitron-cloud-machine-v1', origin, 'configuration', installationId,
    randomUUID(), issuedAt, JSON.stringify({payload: 'old-test-lease', signature: 'old-test-signature'}),
    '{ "servicesVersion": 2 }'];
  const bytes = Buffer.from(JSON.stringify(payload));
  const saved = JSON.stringify({payload: bytes.toString('base64url'),
    signature: sign(null, bytes, key.privateKey).toString('base64url')});
  const view = {services: [{service: 'remote_access', state: 'unconfigured', configuration: {}}]};
  await mkdir(root + '/remote-peer');
  await mkdir(root + '/cloud');
  await writeFile(root + '/cloud/connection.json', JSON.stringify({environment: 'test', origin,
    privateKey: key.privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64url'),
    view: {registration: {installationId}}, lifecycle: {lease, view}}));
  await writeFile(root + '/remote-peer/configuration-envelope.json', saved);
  const received = [];
  const requestId = randomUUID();
  const result = await paidRemoteClient(root, {phase: 'withdrawn', placement: {installationId}, requestId},
    async (url, options) => {
      const action = new URL(url).pathname.split('/').at(-1);
      const envelope = JSON.parse(options.body);
      let claims;
      try {claims = verifyMachine(envelope, publicKey, origin, action, now);}
      catch (error) {
        assert.equal(error.code, 'invalid_proof');
        return Response.json({error: 'invalid_proof'}, {status: 401});
      }
      received.push({action, claims, payload: JSON.parse(Buffer.from(envelope.payload, 'base64url'))});
      if (action === 'configuration') return Response.json(view);
      assert.equal(action, 'staff-certificate-status');
      assert.deepEqual(JSON.parse(claims.body), {version: 1, requestId});
      return Response.json({error: 'permission_denied'}, {status: 403});
    });
  assert.deepEqual(result, {cachedConfigurationMasked: true, signedCertificateRefused: true});
  assert.deepEqual(received.map(value => value.action), ['configuration', 'staff-certificate-status']);
  const replay = received[0].payload;
  for (const index of [0, 1, 2, 3, 4, 7]) assert.equal(replay[index], payload[index]);
  assert.equal(replay[5], now);
  assert.equal(replay[6], JSON.stringify(lease));
  assert.equal(await readFile(root + '/remote-peer/configuration-envelope.json', 'utf8'), saved);
});
