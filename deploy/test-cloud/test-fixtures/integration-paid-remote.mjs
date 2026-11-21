import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {setTimeout as delay} from 'node:timers/promises';
import {checkSnapshotGrantRefusal} from './integration-snapshot-exposure.mjs';

export async function checkRemoteRoute(name, probe, elapsed) {
  const log = result => {
    process.stderr.write('D621 HTTPS attempt ' + JSON.stringify({route: name, ...(elapsed && {seconds: elapsed() / 1000}), ...result}) + '\n');
  };
  try {
    const response = await probe();
    if (elapsed) log({status: response.status});
    return response;
  } catch (error) {
    log({error: error.code ?? (error.message === 'integration.remote_probe_timeout' ? error.message : error.name)});
    throw Error('integration.remote_route:' + name, {cause: error});
  }
}

export async function startRemotePeer({docker, paid, runId, own, image, waitronTunnelImage}) {
  const root = paid.venueRoot.slice('/tmp/cloud-integration-state/'.length) + '/remote-peer';
  const mount = (destination, subpath, readonly = '') =>
    'type=volume,src=' + paid.stateVolume + ',dst=' + destination + readonly + ',volume-subpath=' + root + subpath;
  const peerId = await docker(['create', '--pull=never', '--label', 'cloud.integration.owner=' + runId,
    '--network', 'container:' + paid.id, '--cap-add', 'NET_ADMIN', '--memory', '64m', '--memory-swap', '64m',
    ...(waitronTunnelImage ? ['--mount', mount('/control', '/control'), '--mount', mount('/keys', '/keys'), waitronTunnelImage] :
      ['--mount', mount('/input', '', ',readonly'), image, 'node', 'packages/remote-access/src/peer-cli.ts']),
  ], '', 'remote-peer-create');
  own(peerId);
  await docker(['start', peerId]);
  return peerId;
}

export async function measureWithVenuePeer({docker, peerId, peer, waitronTunnelImage, target, checkRoutes, prepareRoutes, signal}) {
  const measure = () => target.machineLoss(checkRoutes, peer.peerPublicKey, prepareRoutes);
  const {untilRemote} = await import('../../../scripts/kubernetes-remote.mjs');
  if (waitronTunnelImage) {
    const identity = async () => {
      const started = await docker(['inspect', '--format', '{{.State.Running}} {{.State.StartedAt}}', peerId]);
      assert.match(started, /^true /, 'integration.waitron_tunnel_stopped');
      const publicKey = await docker(['exec', peerId, 'wg', 'show', 'wg-cloud', 'public-key']);
      assert.equal(publicKey, peer.peerPublicKey, 'integration.waitron_tunnel_peer');
      const [{ifindex}] = JSON.parse(await docker(['exec', peerId, 'ip', '-j', 'link', 'show', 'wg-cloud']));
      return {started, ifindex};
    };
    const before = await untilRemote(identity, 30000, signal, 'waitron_tunnel_configured');
    const result = await measure();
    assert.deepEqual(await identity(), before, 'integration.waitron_tunnel_replaced');
    return {...result, fixtureTraffic: false, sameWaitronTunnel: true, waitronTunnelImage};
  }
  return {...await withFixturePeerTraffic({docker, peerId, peer, signal}, measure), fixtureTraffic: true};
}

async function withFixturePeerTraffic({docker, peerId, peer, signal}, measure) {
  await docker(['exec', peerId, 'ping', '-V'], '', 'remote-ping-tool');
  const trafficStop = new AbortController();
  const trafficSignal = AbortSignal.any([trafficStop.signal, ...[signal].filter(Boolean)]);
  process.stderr.write('D621 fixture traffic: one venue ping through the paired peer every five seconds\n');
  const traffic = (async () => {
    while (!trafficSignal.aborted) {
      await docker(['exec', peerId, 'ping', '-n', '-I', 'wg-cloud', '-c', '1', '-W', '1', peer.gatewayAddress],
        '', 'remote-venue-packet').catch(() => {});
      await delay(5000, undefined, {signal: trafficSignal}).catch(() => {});
    }
  })();
  try {return await measure();}
  finally {trafficStop.abort(); await traffic;}
}

export async function proveIntegrationPaidRemote({docker, compose, control, account, paid, free, image, waitronTunnelImage, runId, own, storageWithdrawal = false, target, observe, stockholm}) {
  const phase = async (phase, extra = {}, signal) => JSON.parse(await docker(['exec', '-i', account, 'node', 'deploy/test-cloud/test-fixtures/integration-account.mjs'],
    JSON.stringify({phase, organisationId: paid.organisationId, installationId: paid.installationId, ...extra}), 'remote-' + phase, signal));
  const gateway = target ? 'kube-gateway' : await compose(['ps', '-q', 'gateway']);
  const gatewayIp = target?.gatewayIp ?? await docker(['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', gateway]);
  const port = target?.port ?? Number((await compose(['port', 'gateway', '443'])).split(':').at(-1));
  const ca = stockholm ? target.ca : await docker(['exec', gateway, 'cat', '/run/local-stack/lan/ca.pem']);
  const peer = await control(paid.id, 'paid-remote', {phase: 'key'});
  const sourceBefore = await control(paid.id, 'evidence');
  const placement = await phase('paid-remote-provision', peer);
  await control(paid.id, 'refresh');
  const client = await control(paid.id, 'paid-remote', {phase: 'certificate', placement, gatewayIp,
    stockholmOrigin: stockholm?.origin, waitronTunnel: Boolean(waitronTunnelImage)});
  assert.deepEqual(await phase('paid-remote-inspect', {csr: client.csr, certificate: client.certificate}), {certificateBoundToPairedVenue: true});
  const peerId = await startRemotePeer({docker, paid, runId, own, image, waitronTunnelImage});
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
  const solvePublic = async (signal, probePublic = (path, options) => probe(placement.publicHostname, path, options)) => {
    const challenge = JSON.parse((await probePublic('/_cloud/challenge', {signal})).body);
    let nonce = 0;
    const deadline = Date.now() + 10000;
    while (createHash('sha256').update(challenge.challenge + ':' + nonce).digest().readUInt32BE(0) >= 2 ** (32 - challenge.difficulty)) {
      nonce++; assert.ok(Date.now() < deadline, 'integration.remote_challenge_timeout');
    }
    const solved = await probePublic('/_cloud/solve', {method: 'POST', body: {challenge: challenge.challenge, nonce}, signal});
    assert.equal(solved.status, 204, 'integration.remote_public_solve_status');
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
    const check = async (signal, expectedPublic, refreshPublicCookie = false, elapsed) => {
      const route = (name, hostname, options, path = '/public/availability') =>
        checkRemoteRoute(name, () => probe(hostname, path, {signal, ...options}), elapsed);
      const staffReply = await route('staff', placement.staffHostname);
      let publicReply = await route('public', placement.publicHostname, {cookie});
      if (refreshPublicCookie && publicReply.status === 403) {
        assert.match(publicReply.body, /src="\/_cloud\/challenge\.js"/);
        cookie = await solvePublic(signal, (path, options) => route('public ' + path, placement.publicHostname, options, path));
        publicReply = await route('public after challenge', placement.publicHostname, {cookie});
        if (!elapsed) process.stderr.write('D621 preparation public cookie ' + JSON.stringify({previousStatus: 403, refreshedStatus: publicReply.status}) + '\n');
      }
      assert.equal(staffReply.status, 200, 'integration.remote_staff_status');
      assert.equal(staffReply.certificateSha256, client.certificateSha256);
      assert.equal(publicReply.status, 200, 'integration.remote_public_status');
      assert.deepEqual(JSON.parse(staffReply.body), client.availability);
      assert.deepEqual(JSON.parse(publicReply.body), client.availability);
      if (expectedPublic) assert.equal(publicReply.certificateSha256, expectedPublic);
    };
    const verifyRoutes = (signal, elapsed) => check(signal, publicResponse.certificateSha256, true, elapsed);
    const pairedPeer = {...peer, gatewayAddress: placement.address.replace(/\.\d+$/, '.1')};
    if (stockholm.baseline) {
      await untilRemote(signal => target.peerTraffic(peer.peerPublicKey, signal), 30000, stockholm.signal, 'baseline_peer_traffic');
      let serviceStops, coldRestart;
      if (stockholm.measureStops) {
        const tunnel = () => docker(['inspect', '--format', '{{.State.Running}} {{.State.StartedAt}}', peerId]);
        const started = await tunnel();
        assert.match(started, /^true /, 'integration.outside_tunnel_running');
        const cold = stockholm.coldRestart && {
          async healthy(signal) {
            await verifyRoutes(signal);
            const signed = await target.publication(paid.venueId, signal);
            assert.deepEqual(signed.routes.map(route => route.installationId), [paid.installationId]);
            assert.equal(signed.certificate, publicResponse.certificateSha256, 'integration.cold_signed_certificate');
          },
          outage: {
            staff: signal => probe(placement.staffHostname, '/public/availability', {signal}),
            public: signal => probe(placement.publicHostname, '/public/availability', {cookie, signal}),
          },
        };
        ({serviceStops, coldRestart} = await withFixturePeerTraffic({docker, peerId, peer: pairedPeer, signal: stockholm.signal},
          () => stockholm.measureStops(verifyRoutes, async (survivors, {signal, started}) => {
            const worker = await target.publicationWorker(survivors, signal);
            const {certificate_public: initial} = await phase('stockholm-remote-publication', {}, signal);
            assert.ok(initial?.completed, 'integration.outside_original_publication');
            assert.deepEqual(await phase('stockholm-remote-renew', {}, signal), {scheduled: true});
            await untilRemote(async limit => {
              const {certificate_public: completed} = await phase('stockholm-remote-publication', {}, limit);
              return completed?.idle && completed.completed > initial.completed;
            }, 90_000, signal, 'outside_publication_completed');
            assert.deepEqual(await target.publicationWorker(survivors, signal), worker, 'integration.outside_publication_worker_changed');
            return {worker, completedMs: Math.round(performance.now() - started)};
          }, cold)));
        assert.equal(await tunnel(), started, 'integration.outside_tunnel_replaced');
      }
      return {staffHttps: true, publicHttps: true, unknownNameRefused: true, wrongCertificateRefused: true,
        privatePathRefused: true, peerTraffic: true, venueId: paid.venueId, ...(serviceStops && {serviceStops, sameTunnel: true}), ...(coldRestart && {coldRestart})};
    }
    if (stockholm.machineLoss) {
      const prepareRoutes = signal => check(signal, publicResponse.certificateSha256, true);
      const checkRoutes = (signal, elapsed) => check(signal, publicResponse.certificateSha256, true, elapsed);
      const machineLoss = await measureWithVenuePeer({docker, peerId, waitronTunnelImage, target, checkRoutes, prepareRoutes,
        peer: pairedPeer, signal: stockholm.signal});
      return {staffHttps: true, publicHttps: true, unknownNameRefused: true, wrongCertificateRefused: true, privatePathRefused: true, machineLoss};
    }
    const handover = await withFixturePeerTraffic({docker, peerId, peer: pairedPeer, signal: stockholm.signal},
      () => target.handover(verifyRoutes, peer.peerPublicKey));
    const idleJobs = async signal => {
      const jobs = await phase('stockholm-remote-publication', {}, signal);
      assert.ok(jobs.certificate_public?.idle && jobs.route?.idle, 'integration.stockholm_publication_jobs_not_idle');
      return jobs;
    };
    await untilRemote(idleJobs, 180000, stockholm.signal, 'publication_jobs_idle');
    const publication = performance.now();
    await target.forgetPublicCopy(paid.venueId, paid.installationId);
    assert.deepEqual(await phase('stockholm-remote-renew'), {scheduled: true});
    const certificateReplacementMs = await untilRemote(async signal => {
      const rows = await target.projected(paid.venueId, signal), certificate = rows[0].certificate;
      if (!certificate || certificate === publicResponse.certificateSha256 ||
        !rows.every(row => row.routes === 1 && row.certificate === certificate)) return false;
      await check(signal, certificate);
      return Math.ceil(performance.now() - publication);
    }, 180000, stockholm.signal, 'certificate_projection');
    await untilRemote(idleJobs, 180000, stockholm.signal, 'replacement_publication_idle');
    const original = await target.publication(paid.venueId, stockholm.signal);
    assert.deepEqual(original.routes.map(route => route.installationId), [paid.installationId]);
    assert.ok(original.certificate && original.certificate !== publicResponse.certificateSha256);
    assert.ok(original.request, 'integration.stockholm_public_request_missing');
    const {retryApi} = await import('../../../scripts/kubernetes-node-loss.mjs');
    let withdrawalStarted;
    const publicationMachineLoss = await target.stopPublicationWorker(async ({signal}) => {
      const inspectionStarted = performance.now();
      const jobs = await retryApi(() => idleJobs(signal), signal, 'publication jobs before renewal');
      const inspectionReadyMs = Math.ceil(performance.now() - inspectionStarted);
      process.stderr.write('D621 publication inspection ready after ' + inspectionReadyMs + ' ms\n');
      assert.deepEqual(await phase('stockholm-remote-renew', {}, signal), {scheduled: true});
      await untilRemote(async limit => {
        const {certificate_public: certificate} = await phase('stockholm-remote-publication', {}, limit);
        return certificate?.idle && certificate.completed > jobs.certificate_public.completed;
      }, 90000, signal, 'publication_resume');
      const reused = await target.publication(paid.venueId, signal);
      assert.equal(reused.certificate, original.certificate, 'integration.stockholm_public_certificate_reissued');
      assert.equal(reused.request, original.request, 'integration.stockholm_public_request_replaced');
      withdrawalStarted = performance.now();
      const revoked = await stockholm.revoke(signal);
      assert.equal(revoked.status, 200, 'integration.stockholm_revoke');
      assert.ok(revoked.body.revokedAt, 'integration.stockholm_revoke_confirmed');
      const withdrawnSequence = await untilRemote(async limit => {
        const {sequence, routes} = await target.publication(paid.venueId, limit);
        return sequence > original.sequence && routes.length === 0 && sequence;
      }, 90000, signal, 'withdrawal_while_worker_stopped');
      return {originalSequence: original.sequence, withdrawnSequence, inspectionReadyMs, signedWithdrawalMs: Math.ceil(performance.now() - withdrawalStarted)};
    });
    const withdrawalMs = await untilRemote(async signal => {
      const rows = await target.projected(paid.venueId, signal);
      if (!rows.every(row => row.routes === 0 && row.sequence >= publicationMachineLoss.withdrawnSequence)) return false;
      assert.ok(!(await peers(signal)).split(/\s+/).includes(peer.peerPublicKey));
      await assert.rejects(probe(placement.staffHostname, '/public/availability', {signal}));
      await assert.rejects(probe(placement.publicHostname, '/public/availability', {cookie, signal}));
      return Math.ceil(performance.now() - withdrawalStarted);
    }, Math.max(1, 180000 - (performance.now() - withdrawalStarted)), stockholm.signal, 'route_withdrawal_after_rejoin');
    return {staffHttps: true, publicHttps: true, unknownNameRefused: true, wrongCertificateRefused: true, privatePathRefused: true,
      handover, certificateReplacementMs, withdrawalMs, publicationMachineLoss};
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
