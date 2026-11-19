import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {setTimeout as delay} from 'node:timers/promises';
import {checkSnapshotGrantRefusal} from './integration-snapshot-exposure.mjs';

export async function proveIntegrationPaidRemote({docker, compose, control, account, paid, free, image, runId, own, storageWithdrawal = false, target, observe, stockholm}) {
  const phase = async (phase, extra = {}) => JSON.parse(await docker(['exec', '-i', account, 'node', 'deploy/test-cloud/test-fixtures/integration-account.mjs'],
    JSON.stringify({phase, organisationId: paid.organisationId, installationId: paid.installationId, ...extra}), 'remote-' + phase));
  const gateway = target ? 'kube-gateway' : await compose(['ps', '-q', 'gateway']);
  const gatewayIp = target?.gatewayIp ?? await docker(['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', gateway]);
  const port = target?.port ?? Number((await compose(['port', 'gateway', '443'])).split(':').at(-1));
  const ca = stockholm ? target.ca : await docker(['exec', gateway, 'cat', '/run/local-stack/lan/ca.pem']);
  const peer = await control(paid.id, 'paid-remote', {phase: 'key'});
  const sourceBefore = await control(paid.id, 'evidence');
  const placement = await phase('paid-remote-provision', peer);
  await control(paid.id, 'refresh');
  const client = await control(paid.id, 'paid-remote', {phase: 'certificate', placement, gatewayIp, stockholmOrigin: stockholm?.origin});
  assert.deepEqual(await phase('paid-remote-inspect', {csr: client.csr, certificate: client.certificate}), {certificateBoundToPairedVenue: true});
  const peerId = await docker(['create', '--pull=never', '--label', 'cloud.integration.owner=' + runId,
    '--network', 'container:' + paid.id, '--cap-add', 'NET_ADMIN', '--memory', '64m', '--memory-swap', '64m',
    '--mount', 'type=volume,src=' + paid.stateVolume + ',dst=/input,readonly,volume-subpath=' + paid.venueRoot.slice('/tmp/cloud-integration-state/'.length) + '/remote-peer',
    image, 'node', 'packages/remote-access/src/peer-cli.ts'], '', 'remote-peer-create');
  own(peerId); await docker(['start', peerId]);
  const probe = (hostname, path, {trust = ca, verificationHostname, method = 'GET', body, cookie, signal} = {}) => new Promise((resolve, reject) => {
    const req = request({signal: AbortSignal.any([signal, ...(signal ? [AbortSignal.timeout(5000)] : [])].filter(Boolean)), host: stockholm ? target.host : '127.0.0.1', port, servername: hostname, ca: trust, path, method, agent: false,
      ...(verificationHostname ? {checkServerIdentity: (_hostname, certificate) => checkServerIdentity(verificationHostname, certificate)} : {}),
      headers: {host: hostname, ...(cookie ? {cookie} : {}), ...(body ? {'content-type': 'application/json'} : {})}}, res => {
      const certificateSha256 = createHash('sha256').update(res.socket.getPeerCertificate().raw).digest('hex');
      let text = ''; res.on('data', part => {text += part; if (text.length > 65536) req.destroy(Error('integration.remote_response_large'));});
      res.once('error', reject); res.once('end', () => resolve({status: res.statusCode, body: text, headers: res.headers, certificateSha256}));
    });
    req.setTimeout(2000, () => req.destroy(Error('integration.remote_probe_timeout'))); req.once('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  const {untilRemote} = stockholm ? await import('../../../scripts/kubernetes-remote.mjs') : {};
  let staff;
  if (stockholm) staff = await untilRemote(async signal => {
    const reply = await probe(placement.staffHostname, '/public/availability', {signal});
    return reply.status === 200 && reply;
  }, 180000, stockholm.signal, 'staff_ready');
  else for (let attempt = 0; attempt < 80; attempt++) {
    try {staff = await probe(placement.staffHostname, '/public/availability'); if (staff.status === 200) break;} catch {}
    await delay(250);
  }
  assert.equal(staff?.status, 200, 'integration.paid_remote_staff_unavailable');
  assert.deepEqual(JSON.parse(staff.body), client.availability, 'integration.paid_remote_native_upstream');
  assert.equal(staff.certificateSha256, client.certificateSha256, 'integration.paid_remote_certificate_binding');
  assert.equal((await probe(placement.staffHostname, '/management-api/cloud/status')).status, 401);
  if (stockholm) await untilRemote(async signal =>
    (await probe(placement.publicHostname, '/management-api/cloud/status', {signal})).status === 404,
  180000, stockholm.signal, 'public_ready');
  else assert.equal((await probe(placement.publicHostname, '/management-api/cloud/status')).status, 404);
  assert.equal((await probe(placement.publicHostname, '/public/availability')).status, 403);
  const solvePublic = async signal => {
    const challenge = JSON.parse((await probe(placement.publicHostname, '/_cloud/challenge', {signal})).body);
    let nonce = 0;
    const deadline = Date.now() + 10000;
    while (createHash('sha256').update(challenge.challenge + ':' + nonce).digest().readUInt32BE(0) >= 2 ** (32 - challenge.difficulty)) {
      nonce++; assert.ok(Date.now() < deadline, 'integration.remote_challenge_timeout');
    }
    const solved = await probe(placement.publicHostname, '/_cloud/solve', {method: 'POST', body: {challenge: challenge.challenge, nonce}, signal});
    assert.equal(solved.status, 204);
    return solved.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
  };
  let cookie = await solvePublic(), renewedAt = Date.now();
  const publicResponse = await probe(placement.publicHostname, '/public/availability', {cookie});
  assert.equal(publicResponse.status, 200); assert.deepEqual(JSON.parse(publicResponse.body), client.availability);
  const unknownVenue = stockholm ? randomUUID() : free.venueId;
  await assert.rejects(probe('staff-v-' + unknownVenue + '.r.waitron.local', '/public/availability'));
  await assert.rejects(probe('v-' + unknownVenue + '.r.waitron.local', '/_cloud/challenge'));
  await assert.rejects(probe(placement.staffHostname, '/public/availability', {trust: null}), /certificate|issuer|verify/i);
  await assert.rejects(probe(placement.staffHostname, '/public/availability', {verificationHostname: placement.publicHostname}), /certificate|Hostname/i);
  const peers = signal => stockholm ? target.peers(signal) : docker(['exec', gateway, 'wg', 'show', 'wg-cloud', 'peers']);
  assert.ok((await peers()).split(/\s+/).includes(peer.peerPublicKey));
  if (stockholm) {
    const check = async (signal, expectedPublic, refreshPublicCookie = false) => {
      const staffReply = await probe(placement.staffHostname, '/public/availability', {signal});
      let publicReply = await probe(placement.publicHostname, '/public/availability', {cookie, signal});
      if (refreshPublicCookie && publicReply.status === 403) {
        assert.match(publicReply.body, /src="\/_cloud\/challenge\.js"/);
        cookie = await solvePublic(signal);
        publicReply = await probe(placement.publicHostname, '/public/availability', {cookie, signal});
        process.stderr.write('D621 preparation public cookie ' + JSON.stringify({previousStatus: 403, refreshedStatus: publicReply.status}) + '\n');
      }
      assert.equal(staffReply.status, 200);
      assert.equal(staffReply.certificateSha256, client.certificateSha256);
      assert.equal(publicReply.status, 200);
      assert.deepEqual(JSON.parse(staffReply.body), client.availability);
      assert.deepEqual(JSON.parse(publicReply.body), client.availability);
      if (expectedPublic) assert.equal(publicReply.certificateSha256, expectedPublic);
    };
    const verifyRoutes = signal => check(signal, publicResponse.certificateSha256);
    if (stockholm.machineLoss) {
      await docker(['exec', peerId, 'ping', '-V'], '', 'remote-ping-tool');
      const trafficStop = new AbortController();
      const signal = AbortSignal.any([trafficStop.signal, stockholm.signal].filter(Boolean));
      const gatewayAddress = placement.address.replace(/\.\d+$/, '.1');
      process.stderr.write('D621 fixture traffic: one venue ping through the paired peer every five seconds\n');
      const traffic = (async () => {
        while (!signal.aborted) {
          await docker(['exec', peerId, 'ping', '-n', '-I', 'wg-cloud', '-c', '1', '-W', '1', gatewayAddress],
            '', 'remote-venue-packet').catch(() => {});
          await delay(5000, undefined, {signal}).catch(() => {});
        }
      })();
      try {
        const prepareRoutes = signal => check(signal, publicResponse.certificateSha256, true);
        const machineLoss = await target.machineLoss(verifyRoutes, peer.peerPublicKey, prepareRoutes);
        return {staffHttps: true, publicHttps: true, unknownNameRefused: true, wrongCertificateRefused: true, privatePathRefused: true,
          machineLoss: {...machineLoss, fixtureTraffic: true}};
      } finally {
        trafficStop.abort();
        await traffic;
      }
    }
    const handover = await target.handover(verifyRoutes, peer.peerPublicKey);
    const publication = performance.now();
    await target.forgetPublicCopy(paid.installationId);
    assert.deepEqual(await phase('stockholm-remote-renew'), {scheduled: true});
    const certificateReplacementMs = await untilRemote(async signal => {
      const rows = await target.projected(paid.venueId, signal), certificate = rows[0].certificate;
      if (!certificate || certificate === publicResponse.certificateSha256 ||
        !rows.every(row => row.routes === 1 && row.certificate === certificate)) return false;
      await check(signal, certificate);
      return Math.ceil(performance.now() - publication);
    }, 180000, stockholm.signal, 'certificate_projection');
    const withdrawal = performance.now(), revoked = await stockholm.revoke();
    assert.equal(revoked.status, 200, 'integration.stockholm_revoke');
    assert.ok(revoked.body.revokedAt, 'integration.stockholm_revoke_confirmed');
    const withdrawalMs = await untilRemote(async signal => {
      const rows = await target.projected(paid.venueId, signal);
      if (!rows.every(row => row.routes === 0)) return false;
      assert.ok(!(await peers(signal)).split(/\s+/).includes(peer.peerPublicKey));
      await assert.rejects(probe(placement.staffHostname, '/public/availability', {signal}));
      await assert.rejects(probe(placement.publicHostname, '/public/availability', {cookie, signal}));
      return Math.ceil(performance.now() - withdrawal);
    }, 180000, stockholm.signal, 'route_withdrawal');
    return {staffHttps: true, publicHttps: true, unknownNameRefused: true, wrongCertificateRefused: true, privatePathRefused: true,
      handover, certificateReplacementMs, withdrawalMs};
  }
  if (observe) await observe(async signal => {
    // The public gate cookie lasts five minutes; renew it before expiry.
    if (Date.now() - renewedAt >= 240000) {cookie = await solvePublic(); renewedAt = Date.now();}
    signal?.throwIfAborted();
    const staff = await probe(placement.staffHostname, '/public/availability', {signal});
    assert.equal(staff.status, 200); assert.deepEqual(JSON.parse(staff.body), client.availability);
    assert.equal(staff.certificateSha256, client.certificateSha256);
    const publicReply = await probe(placement.publicHostname, '/public/availability', {cookie, signal});
    assert.equal(publicReply.status, 200); assert.deepEqual(JSON.parse(publicReply.body), client.availability);
  });
  let storage, storageBefore, storageStartedAt;
  if (storageWithdrawal) {
    storageBefore = await control(paid.id, 'storage-withdrawal', {phase: 'before', foreignVenueId: free.venueId});
    assert.deepEqual(storageBefore, {writeStatus: 200, readStatus: 200, outsidePrefixRefused: true, neighbourRefused: true});
    storage = await compose(['ps', '-q', 'storage']);
    storageStartedAt = await docker(['inspect', '--format', '{{.State.StartedAt}}', storage]);
    await docker(['stop', '--time', '10', storage], '', 'storage-withdrawal-stop');
  }
  const worker = target ? undefined : await compose(['ps', '-q', 'gateway-manifest']);
  const beforeRestart = target ? await target.worker('time') : await docker(['inspect', '--format', '{{.State.StartedAt}}', worker]);
  if (target) await target.worker('stop'); else await docker(['stop', '--time', '10', worker]);
  assert.deepEqual(await phase('paid-remote-downgrade'), {plan: 'free', configurationCleared: true, installationPreserved: true});
  const committed = Date.now();
  if (storageWithdrawal) {
    await docker(['start', storage], '', 'storage-withdrawal-start');
    const restartedAt = await docker(['inspect', '--format', '{{.State.StartedAt}}', storage]);
    assert.ok(Date.parse(restartedAt) > Date.parse(storageStartedAt), 'integration.storage_restart_not_observed');
  }

  if (target) await target.worker('start'); else await docker(['start', worker]);
  const afterRestart = target ? await target.worker('time') : await docker(['inspect', '--format', '{{.State.StartedAt}}', worker]);
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
  let directStorage, snapshotExposure;
  if (storageWithdrawal) {
    const after = await control(paid.id, 'storage-withdrawal', {phase: 'after', startedAt: committed});
    assert.equal(after.writeStatus, 403); assert.equal(after.readStatus, 403);
    assert.ok(Number.isSafeInteger(after.durationMs) && after.durationMs >= 0 && after.durationMs < 30000);
    const retained = await phase('inspect-storage-withdrawal');
    assert.deepEqual(retained, {retainedData: true, readerPreserved: true, installationPreserved: true, plan: 'free'});
    directStorage = {organisationId: paid.organisationId, venueId: paid.venueId, installationId: paid.installationId,
      before: storageBefore, after, restartObserved: true, ...retained};
    const newGrantRefused = checkSnapshotGrantRefusal(await control(paid.id, 'snapshot-refusal'));
    snapshotExposure = {organisationId: paid.organisationId, venueId: paid.venueId, installationId: paid.installationId,
      ...await control(paid.id, 'snapshot-exposure', {downgradedAt: committed}), newGrantRefused};
  }

  await control(paid.id, 'refresh');
  assert.deepEqual(await control(paid.id, 'paid-remote', {phase: 'withdrawn', placement, requestId: client.requestId}),
    {cachedConfigurationMasked: true, signedCertificateRefused: true});
  const sourceAfter = await control(paid.id, 'evidence');
  assert.deepEqual(sourceAfter.registration, sourceBefore.registration); assert.equal(sourceAfter.identitySha256, sourceBefore.identitySha256);
  assert.equal(sourceAfter.streamId, sourceBefore.streamId);
  return {organisationId: paid.organisationId, installationId: paid.installationId, venueId: paid.venueId,
    client: client.client, peerPresent: true,
    ...(directStorage ? {directStorage} : {}),
    ...(snapshotExposure ? {snapshotExposure} : {}),
    withdrawal: {staffRefused: true, publicRefused: true, peerRemoved: true, cachedConfigurationMasked: true,
      installationPreserved: true, restartObserved: true, plan: 'free', durationMs},
    routes: {staffAvailability: 200, staffPrivateWithoutLogin: 401, publicBeforeChallenge: 403, publicAfterChallenge: 200,
      publicPrivatePath: 404, freeNeighbourRefused: true, untrustedRefused: true, wrongHostnameRefused: true,
      sameNativeAvailability: true, staffCertificateMatches: true}};
}
