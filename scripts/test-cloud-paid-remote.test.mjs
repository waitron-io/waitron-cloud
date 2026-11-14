import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('the paid remote client reads the certificate installed by pinned Waitron', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE, timeout: 60000,
}, t => {
  const source = `
    import assert from 'node:assert/strict';
    import {mkdir, readFile, writeFile} from 'node:fs/promises';
    import {generateKeyPairSync} from 'node:crypto';
    import {createServer} from 'node:http';
    import forge from '/waitron/apps/server/node_modules/node-forge/lib/index.js';
    import {paidRemoteClient} from '/proof/integration-paid-remote-client.mjs';
    const root = '/tmp/paid-remote-state', hostname = 'staff.synthetic.test';
    await mkdir(root + '/cloud', {recursive: true});
    const {privateKey} = generateKeyPairSync('ed25519');
    await writeFile(root + '/cloud/connection.json', JSON.stringify({environment: 'test',
      origin: 'https://waitron.local:3000', privateKey: privateKey.export({format: 'der', type: 'pkcs8'}).toString('base64url'),
      view: {registration: {installationId: 'installation-test'}}, lifecycle: {lease: {}, view: {revision: 1}}}));
    const upstream = createServer((req, res) => {res.setHeader('content-type', 'application/json'); res.end('{"available":true}');});
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    await writeFile(root + '/ready.json', JSON.stringify({origin: 'http://127.0.0.1:' + upstream.address().port}));
    let certificate;
    const localFetch = async url => {
      if (url.endsWith('/configuration')) return Response.json({services: [{service: 'remote_access', configuration: {enabled: true}}]});
      if (url.endsWith('/staff-certificate-submit')) {
        const key = forge.pki.privateKeyFromPem(await readFile(root + '/cloud/staff.key', 'utf8'));
        const cert = forge.pki.createCertificate();
        cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e); cert.serialNumber = '01';
        cert.validity.notBefore = new Date(Date.now() - 60000); cert.validity.notAfter = new Date(Date.now() + 60000);
        cert.setSubject([{name: 'commonName', value: hostname}]); cert.setIssuer(cert.subject.attributes);
        cert.setExtensions([{name: 'subjectAltName', altNames: [{type: 2, value: hostname}]}]);
        cert.sign(key, forge.md.sha256.create()); certificate = forge.pki.certificateToPem(cert);
        return Response.json({requestId: 'request-test'});
      }
      assert.ok(url.endsWith('/staff-certificate-status'));
      return Response.json({state: 'ready', installationId: 'installation-test', hostname, certificate, requestId: 'request-test'});
    };
    await paidRemoteClient(root, {phase: 'key'});
    const result = await paidRemoteClient(root, {phase: 'certificate',
      placement: {installationId: 'installation-test', staffHostname: hostname}, gatewayIp: '127.0.0.1'}, localFetch);
    assert.equal(result.certificate, certificate);
    assert.equal(result.client.nativeCertificateInstalled, true);
    assert.deepEqual(result.availability, {available: true});
    process.exit(0);
  `;
  const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8', timeout: 60000}).trim();
  const fixtures = fileURLToPath(new URL('../deploy/test-cloud/test-fixtures', import.meta.url));
  const id = docker('create', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,mode=1777', '--mount', `type=bind,src=${fixtures},dst=/proof,readonly`,
    '--entrypoint', 'node', process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    '--import', '/waitron/apps/server/node_modules/tsx/dist/loader.mjs', '--input-type=module', '-e', source);
  t.after(() => docker('rm', '-f', '-v', id));
  const run = spawnSync('docker', ['start', '-a', id], {encoding: 'utf8', timeout: 55000});
  assert.equal(run.status, 0, run.stderr);
});

// Certificates bind the routed peer; the public hostname must never expose staff paths.
test('the paired paid venue serves its own staff and public routes through the LAN gateway', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]'),
    freeRemote: true, paidRemote: true});
  const paid = receipt.organisations.find(value => value.plan === 'paid');
  assert.ok(receipt.paidRemote, 'The genuine paired paid remote proof is missing');
  assert.equal(receipt.paidRemote.organisationId, paid.organisationId);
  assert.equal(receipt.paidRemote.installationId, paid.installationId);
  assert.equal(receipt.paidRemote.venueId, paid.venueId);
  assert.deepEqual(receipt.paidRemote.client, {nativeStaffCsr: true, nativeCertificateInstalled: true,
    pairedSignedExchange: true, keysStayedInVenue: true});
  assert.deepEqual(receipt.paidRemote.routes, {staffAvailability: 200, staffPrivateWithoutLogin: 401,
    publicBeforeChallenge: 403, publicAfterChallenge: 200, publicPrivatePath: 404,
    freeNeighbourRefused: true, untrustedRefused: true, wrongHostnameRefused: true,
    sameNativeAvailability: true, staffCertificateMatches: true});
  assert.equal(receipt.paidRemote.peerPresent, true);
  assert.ok(receipt.paidRemote.withdrawal, 'The paired paid-to-free withdrawal and worker restart proof is missing');
  const {durationMs, ...withdrawal} = receipt.paidRemote.withdrawal;
  assert.deepEqual(withdrawal, {staffRefused: true, publicRefused: true, peerRemoved: true,
    cachedConfigurationMasked: true, installationPreserved: true, restartObserved: true, plan: 'free'});
  assert.ok(Number.isSafeInteger(durationMs) && durationMs >= 0 && durationMs < 30000);
  assert.equal(receipt.completeIntegration, false);
  assert.throws(() => verifyTestCloudReceipt(receipt));
  assert.deepEqual(receipt.cleanup.created, receipt.cleanup.removed);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  for (const word of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'cookie']) assert.equal(JSON.stringify(receipt).includes(word), false, word);
  console.log('PAID_REMOTE_RECEIPT=' + JSON.stringify(receipt));
});
