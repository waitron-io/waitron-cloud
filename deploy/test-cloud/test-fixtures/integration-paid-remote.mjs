import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {setTimeout as delay} from 'node:timers/promises';

export async function proveIntegrationPaidRemote({docker, compose, control, account, paid, free, image, runId, own}) {
  const phase = async (phase, extra = {}) => JSON.parse(await docker(['exec', '-i', account, 'node', 'deploy/test-cloud/test-fixtures/integration-account.mjs'],
    JSON.stringify({phase, organisationId: paid.organisationId, installationId: paid.installationId, ...extra}), 'remote-' + phase));
  const gateway = await compose(['ps', '-q', 'gateway']);
  const gatewayIp = await docker(['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', gateway]);
  const port = Number((await compose(['port', 'gateway', '443'])).split(':').at(-1));
  const ca = await docker(['exec', gateway, 'cat', '/run/local-stack/lan/ca.pem']);
  const peer = await control(paid.id, 'paid-remote', {phase: 'key'});
  const sourceBefore = await control(paid.id, 'evidence');
  const placement = await phase('paid-remote-provision', peer);
  await control(paid.id, 'refresh');
  const client = await control(paid.id, 'paid-remote', {phase: 'certificate', placement, gatewayIp});
  assert.deepEqual(await phase('paid-remote-inspect', {csr: client.csr, certificate: client.certificate}), {certificateBoundToPairedVenue: true});
  const peerId = await docker(['create', '--pull=never', '--label', 'cloud.integration.owner=' + runId,
    '--network', 'container:' + paid.id, '--cap-add', 'NET_ADMIN', '--memory', '64m', '--memory-swap', '64m',
    '--mount', 'type=volume,src=' + paid.stateVolume + ',dst=/input,readonly,volume-subpath=' + paid.venueRoot.slice('/tmp/cloud-integration-state/'.length) + '/remote-peer',
    image, 'node', 'packages/remote-access/src/peer-cli.ts'], '', 'remote-peer-create');
  own(peerId); await docker(['start', peerId]);
  const probe = (hostname, path, {trust = ca, verificationHostname, method = 'GET', body, cookie} = {}) => new Promise((resolve, reject) => {
    const req = request({host: '127.0.0.1', port, servername: hostname, ca: trust, path, method, agent: false,
      ...(verificationHostname ? {checkServerIdentity: (_hostname, certificate) => checkServerIdentity(verificationHostname, certificate)} : {}),
      headers: {host: hostname, ...(cookie ? {cookie} : {}), ...(body ? {'content-type': 'application/json'} : {})}}, res => {
      const certificateSha256 = createHash('sha256').update(res.socket.getPeerCertificate().raw).digest('hex');
      let text = ''; res.on('data', part => {text += part; if (text.length > 65536) req.destroy(Error('integration.remote_response_large'));});
      res.once('error', reject); res.once('end', () => resolve({status: res.statusCode, body: text, headers: res.headers, certificateSha256}));
    });
    req.setTimeout(2000, () => req.destroy(Error('integration.remote_probe_timeout'))); req.once('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  let staff;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {staff = await probe(placement.staffHostname, '/public/availability'); if (staff.status === 200) break;} catch {}
    await delay(250);
  }
  assert.equal(staff?.status, 200, 'integration.paid_remote_staff_unavailable');
  assert.deepEqual(JSON.parse(staff.body), client.availability, 'integration.paid_remote_native_upstream');
  assert.equal(staff.certificateSha256, client.certificateSha256, 'integration.paid_remote_certificate_binding');
  assert.equal((await probe(placement.staffHostname, '/management-api/cloud/status')).status, 401);
  assert.equal((await probe(placement.publicHostname, '/management-api/cloud/status')).status, 404);
  assert.equal((await probe(placement.publicHostname, '/public/availability')).status, 403);
  const challenge = JSON.parse((await probe(placement.publicHostname, '/_cloud/challenge')).body);
  let nonce = 0;
  const deadline = Date.now() + 10000;
  while (createHash('sha256').update(challenge.challenge + ':' + nonce).digest().readUInt32BE(0) >= 2 ** (32 - challenge.difficulty)) {
    nonce++; assert.ok(Date.now() < deadline, 'integration.remote_challenge_timeout');
  }
  const solved = await probe(placement.publicHostname, '/_cloud/solve', {method: 'POST', body: {challenge: challenge.challenge, nonce}});
  assert.equal(solved.status, 204);
  const cookie = solved.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
  const publicResponse = await probe(placement.publicHostname, '/public/availability', {cookie});
  assert.equal(publicResponse.status, 200); assert.deepEqual(JSON.parse(publicResponse.body), client.availability);
  await assert.rejects(probe('staff-v-' + free.venueId + '.r.waitron.local', '/public/availability'));
  await assert.rejects(probe('v-' + free.venueId + '.r.waitron.local', '/_cloud/challenge'));
  await assert.rejects(probe(placement.staffHostname, '/public/availability', {trust: null}), /certificate|issuer|verify/i);
  await assert.rejects(probe(placement.staffHostname, '/public/availability', {verificationHostname: placement.publicHostname}), /certificate|Hostname/i);
  assert.ok((await docker(['exec', gateway, 'wg', 'show', 'wg-cloud', 'peers'])).split(/\s+/).includes(peer.peerPublicKey));
  const worker = await compose(['ps', '-q', 'gateway-manifest']);
  const beforeRestart = await docker(['inspect', '--format', '{{.State.StartedAt}}', worker]);
  await docker(['stop', '--time', '10', worker]);
  assert.deepEqual(await phase('paid-remote-downgrade'), {plan: 'free', configurationCleared: true, installationPreserved: true});
  const committed = Date.now();
  await docker(['start', worker]);
  const afterRestart = await docker(['inspect', '--format', '{{.State.StartedAt}}', worker]);
  assert.ok(Date.parse(afterRestart) > Date.parse(beforeRestart), 'integration.remote_worker_restart');
  let withdrawn = false;
  while (Date.now() - committed < 30000) {
    try {
      await assert.rejects(probe(placement.staffHostname, '/public/availability'));
      await assert.rejects(probe(placement.publicHostname, '/public/availability', {cookie}));
      assert.equal((await docker(['exec', gateway, 'wg', 'show', 'wg-cloud', 'peers'])).split(/\s+/).includes(peer.peerPublicKey), false);
      await docker(['exec', gateway, 'node', 'deploy/test-cloud/gateway-health.mjs']);
      withdrawn = true; break;
    } catch {await delay(250);}
  }
  assert.equal(withdrawn, true, 'integration.remote_withdrawal_required');
  const durationMs = Date.now() - committed;
  await control(paid.id, 'refresh');
  assert.deepEqual(await control(paid.id, 'paid-remote', {phase: 'withdrawn', placement, requestId: client.requestId}),
    {cachedConfigurationMasked: true, signedCertificateRefused: true});
  const sourceAfter = await control(paid.id, 'evidence');
  assert.deepEqual(sourceAfter.registration, sourceBefore.registration); assert.equal(sourceAfter.identitySha256, sourceBefore.identitySha256);
  assert.equal(sourceAfter.localVenueId, sourceBefore.localVenueId);
  return {organisationId: paid.organisationId, installationId: paid.installationId, venueId: paid.venueId,
    client: client.client, peerPresent: true,
    withdrawal: {staffRefused: true, publicRefused: true, peerRemoved: true, cachedConfigurationMasked: true,
      installationPreserved: true, restartObserved: true, plan: 'free', durationMs},
    routes: {staffAvailability: 200, staffPrivateWithoutLogin: 401, publicBeforeChallenge: 403, publicAfterChallenge: 200,
      publicPrivatePath: 404, freeNeighbourRefused: true, untrustedRefused: true, wrongHostnameRefused: true,
      sameNativeAvailability: true, staffCertificateMatches: true}};
}
