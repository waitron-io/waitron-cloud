import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createPrivateKey, generateKeyPairSync, randomUUID, sign, X509Certificate, createHash} from 'node:crypto';
import {createServer} from 'node:https';
import {request} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';

// The paired venue keeps both private keys; the account receives only its public peer key and CSR.
export async function paidRemoteClient(root, {phase, placement, gatewayIp, requestId}, localFetch) {
  const directory = root + '/remote-peer';
  await mkdir(directory, {mode: 0o700, recursive: true});
  if (phase === 'key') {
    const key = generateKeyPairSync('x25519');
    await writeFile(directory + '/wireguard.key', key.privateKey.export({format: 'der', type: 'pkcs8'}).subarray(-32).toString('base64'), {mode: 0o600, flag: 'wx'});
    return {peerPublicKey: key.publicKey.export({format: 'der', type: 'spki'}).subarray(-32).toString('base64')};
  }
  const state = JSON.parse(await readFile(root + '/cloud-connection.json', 'utf8'));
  assert.equal(state.environment, 'test');
  assert.equal(state.origin, 'https://waitron.local:3000');
  const installationId = state.view.registration.installationId;
  assert.equal(placement.installationId, installationId);
  const key = createPrivateKey({key: Buffer.from(state.privateKey, 'base64url'), format: 'der', type: 'pkcs8'});
  const envelope = (action, body) => {
    const bytes = Buffer.from(JSON.stringify(['waitron-cloud-machine-v1', state.origin, action,
      installationId, randomUUID(), Date.now(), JSON.stringify(state.lifecycle.lease), JSON.stringify(body)]));
    return {payload: bytes.toString('base64url'), signature: sign(null, bytes, key).toString('base64url')};
  };
  const exchange = (action, value) => localFetch(state.origin + '/api/installations/' + action, {method: 'POST',
      headers: {'content-type': 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(10000),
      body: JSON.stringify(value)});
  const send = async (action, body) => {
    const response = await exchange(action, envelope(action, body));
    assert.equal(response.status, 200, 'integration.paid_remote_exchange');
    return response.json();
  };
  const remoteService = value => value.services.find(service => service.service === 'remote_access');
  if (phase === 'withdrawn') {
    const saved = JSON.parse(await readFile(directory + '/configuration-envelope.json', 'utf8'));
    const replayed = await exchange('configuration', saved);
    assert.equal(replayed.status, 200);
    const remote = remoteService(await replayed.json());
    assert.equal(remote.state, 'unconfigured', 'integration.remote_replay_state');
    assert.deepEqual(remote.configuration, {}, 'integration.remote_replay_configuration');
    assert.equal(remoteService(state.lifecycle.view).state, 'unconfigured');
    assert.deepEqual(remoteService(state.lifecycle.view).configuration, {});
    const refused = await exchange('staff-certificate-status', envelope('staff-certificate-status', {version: 1, requestId}));
    assert.equal(refused.status, 403); assert.deepEqual(await refused.json(), {error: 'permission_denied'});
    return {cachedConfigurationMasked: true, signedCertificateRefused: true};
  }
  assert.equal(phase, 'certificate');
  const {createStaffCsr, installStaffCertificate} = await import('/waitron/apps/server/src/cloud-remote.ts');
  const csr = await createStaffCsr(root, placement.staffHostname);
  const saved = envelope('configuration', {servicesVersion: 2});
  const configured = await exchange('configuration', saved);
  assert.equal(configured.status, 200);
  assert.ok(Object.keys(remoteService(await configured.json()).configuration).length > 0, 'integration.remote_paid_configuration_required');
  await writeFile(directory + '/configuration-envelope.json', JSON.stringify(saved), {mode: 0o600, flag: 'wx'});
  const submitted = await send('staff-certificate-submit', {version: 1, hostname: placement.staffHostname,
    revision: state.lifecycle.view.revision, csr, previousRequestId: null});
  let reply;
  for (let attempt = 0; attempt < 100; attempt++) {
    reply = await send('staff-certificate-status', {version: 1, requestId: submitted.requestId});
    if (reply.state === 'ready') break;
    await delay(250);
  }
  assert.equal(reply.state, 'ready', 'integration.paid_remote_certificate_pending');
  assert.equal(reply.installationId, installationId);
  assert.equal(reply.hostname, placement.staffHostname);
  await installStaffCertificate(root, placement.staffHostname, reply.certificate);
  const certificate = await readFile(root + '/cloud-staff.crt', 'utf8');
  assert.equal(certificate, reply.certificate);
  const ready = JSON.parse(await readFile(root + '/ready.json', 'utf8'));
  const availability = await (await localFetch(ready.origin + '/public/availability')).json();
  // This TLS adapter forwards to the running native venue; it supplies no application responses.
  const server = createServer({key: await readFile(root + '/cloud-staff.key'), cert: certificate}, (req, res) => {
    const target = new URL(req.url, ready.origin);
    const upstream = request(target, {method: req.method, headers: {...req.headers, host: target.host}}, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.setTimeout(5000, () => upstream.destroy());
    upstream.once('error', () => {res.destroy();});
    req.once('aborted', () => upstream.destroy()); req.pipe(upstream);
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(9443, '127.0.0.1', resolve);});
  await writeFile(directory + '/peer.json', JSON.stringify({address: placement.address,
    privateKey: await readFile(directory + '/wireguard.key', 'utf8'), gatewayPublicKey: placement.gatewayPublicKey,
    gatewayEndpoint: gatewayIp + ':51820', upstreamHost: '127.0.0.1', upstreamPort: 9443}), {mode: 0o600, flag: 'wx'});
  return {installationId, csr, certificate, requestId: reply.requestId, availability,
    certificateSha256: createHash('sha256').update(new X509Certificate(certificate).raw).digest('hex'),
    client: {nativeStaffCsr: true, nativeCertificateInstalled: true, pairedSignedExchange: true, keysStayedInVenue: true}};
}
