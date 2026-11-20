import assert from 'node:assert/strict';
import {createHash, createPublicKey, X509Certificate} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {caVolume, cloudContainer, cleanUp, requireTls} from './kubernetes-database.mjs';
import {verifyManifest} from '../packages/remote-access/src/manifest.ts';
import {separateByHost} from './kubernetes-placement.mjs';
import {retryApi} from './kubernetes-node-loss.mjs';

export async function untilRemote(probe, ms, signal, stage) {
  const end = performance.now() + ms;
  const limit = AbortSignal.any([AbortSignal.timeout(Math.ceil(ms)), ...[signal].filter(Boolean)]);
  let last;
  while (!limit.aborted) {
    try {
      const result = await probe(limit);
      if (result && performance.now() < end) return result;
    } catch (error) {
      // A command aborted by the deadline tells us nothing new about the last probe.
      if (!limit.aborted || last === undefined) last = error;
    }
    await delay(250, undefined, {signal: limit}).catch(() => {});
  }
  signal?.throwIfAborted();
  throw Error('remote.' + stage, {cause: last});
}

const remoteDeadlineMs = 90_000;
const readGatewayPods = async (kube, limit) => JSON.parse(await kube(['get', 'pods', '-l', 'app=remote-gateway', '-o', 'json'], limit)).items;
const execGateway = (kube, pod, cmd, limit) => kube(['exec', pod, '--', ...cmd], limit);
const noGatewayInterface = ['sh', '-ec', `
  status=0
  if ip link show wg-cloud >/dev/null 2>&1; then echo 'WireGuard interface still present' >&2; status=1; fi
  if test -e /state/lease-active; then echo 'Lease readiness marker still present' >&2; status=1; fi
  exit "$status"
`];

async function peerCounters(kube, pod, peer, limit) {
  const counters = async column => (await execGateway(kube, pod, ['wg', 'show', 'wg-cloud', column], limit))
    .split('\n').map(line => line.split('\t')).find(fields => fields[0] === peer)?.slice(1).map(Number) ?? [];
  const [handshake] = await counters('latest-handshakes');
  const [receivedBytes, sentBytes] = await counters('transfer');
  return {handshake, receivedBytes, sentBytes};
}

export async function measureGatewayMachineLoss({kube, accountNode, stopNode, moveGateway, checkRoutes, prepareRoutes = checkRoutes, peer, signal}) {
  const holder = async limit => JSON.parse(await kube(['get', 'lease', 'remote-gateway', '-o', 'json'], limit)).spec.holderIdentity?.split(':')[0];
  const nodeFor = async (name, limit) => (await readGatewayPods(kube, limit)).find(row => row.metadata.name === name)?.spec.nodeName;
  const baseline = async limit => {
    const pod = await holder(limit);
    const node = await nodeFor(pod, limit);
    assert.ok(node, 'remote.gateway_lease_holder');
    await checkRoutes(limit);
    const {handshake, receivedBytes, sentBytes} = await peerCounters(kube, pod, peer, limit);
    assert.ok(handshake > 0 && receivedBytes > 0 && sentBytes > 0, 'remote.baseline_handshake');
    assert.equal(await holder(limit), pod, 'remote.baseline_gateway_changed');
    return {pod, node, baselineHandshakeAgeSeconds: Math.floor(Date.now() / 1000) - handshake};
  };
  let old = await untilRemote(baseline, remoteDeadlineMs, signal, 'machine_loss_baseline');
  if (old.node === accountNode) {
    await moveGateway(prepareRoutes, peer);
    old = await untilRemote(baseline, remoteDeadlineMs, signal, 'machine_loss_moved_baseline');
  }
  assert.notEqual(old.node, accountNode, 'remote.keep_account_node_up');
  const controller = JSON.parse(await kube(['get', 'lease', 'kube-controller-manager', '-n', 'kube-system', '-o', 'json'], signal));
  const controllerNode = controller.spec.holderIdentity?.split('_')[0];
  assert.ok(controllerNode, 'remote.controller_leader');
  assert.equal(await holder(signal), old.pod, 'remote.gateway_changed_before_stop');
  process.stderr.write('D621 gateway before machine stop ' + JSON.stringify({...old, controllerNode}) + '\n');

  let endpointWithdrawnMs;
  const stoppedAt = Date.now(), start = performance.now();
  const elapsed = () => Math.ceil(performance.now() - start);
  const result = await stopNode(old.node, {whileStopped: ({signal: faultSignal}) => untilRemote(async limit => {
    const {items} = JSON.parse(await kube(['get', 'endpointslices', '-l', 'kubernetes.io/service-name=remote-gateway', '-o', 'json'], limit));
    const endpoints = items.flatMap(slice => slice.endpoints.filter(endpoint => endpoint.conditions?.ready !== false));
    if (endpoints.some(endpoint => endpoint.targetRef?.name === old.pod)) throw Error('remote.old_endpoint_still_ready');
    if (endpointWithdrawnMs === undefined) {
      endpointWithdrawnMs = elapsed();
      process.stderr.write('D621 old endpoint unavailable ' + JSON.stringify({endpointWithdrawnMs, controllerNode}) + '\n');
    }
    // The dead pod can remain Ready after the Lease moved.
    const replacement = await holder(limit);
    const replacementNode = await nodeFor(replacement, limit);
    assert.ok(replacementNode && replacementNode !== old.node && endpoints.some(row => row.targetRef?.name === replacement),
      'remote.replacement_endpoint_unavailable');
    const {handshake, receivedBytes, sentBytes} = await peerCounters(kube, replacement, peer, limit);
    assert.ok(handshake >= Math.floor(stoppedAt / 1000) && receivedBytes > 0 && sentBytes > 0, 'remote.machine_loss_handshake');
    const handshakeMs = Math.max(0, handshake * 1000 - stoppedAt);
    await checkRoutes(limit, elapsed);
    const durationMs = elapsed();
    assert.ok(durationMs <= remoteDeadlineMs, 'remote.machine_loss_deadline');
    return {replacement, controllerNode, baselineHandshakeAgeSeconds: old.baselineHandshakeAgeSeconds,
      endpointWithdrawnMs, handshakeMs, durationMs, receivedBytes, sentBytes};
  }, Math.max(1, remoteDeadlineMs - (performance.now() - start)), faultSignal, 'machine_loss_90_seconds')});
  await untilRemote(async limit => {
    assert.notEqual(await holder(limit), old.pod, 'remote.rejoined_gateway_should_be_standby');
    await execGateway(kube, old.pod, noGatewayInterface, limit);
    return true;
  }, 180000, signal, 'machine_loss_rejoined_standby');
  return {...result, rejoinedStandby: true};
}

export async function startRemoteRehearsal({context, kube, create, tag, settings}) {
  const {cluster, nodes, run, signal, stopNode, stopGatewayNode} = context;
  const {tls, config: {gateway: {cellId}}, runtimeDirectory} = settings;
  const names = ['gateway-issuer.pem', 'gateway-signing-key.pem', 'gateway-wireguard.key', 'gateway-manifest.json'];
  const bootstrap = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(join(runtimeDirectory, name), 'utf8')])));
  const secret = (name, data) => create({apiVersion: 'v1', kind: 'Secret', metadata: {name}, data}).catch(() => {
    throw Error('remote.identity_create:' + name);
  });
  const encoded = files => Object.fromEntries(Object.entries(files).map(([key, value]) => [key, Buffer.from(value).toString('base64')]));
  await secret('remote-worker-identity', encoded({...bootstrap, 'ca.pem': tls.root, 'ca-key.pem': tls.caKey}));
  await secret('remote-gateway-identity', encoded({'issuer.pem': bootstrap['gateway-issuer.pem'],
    'wireguard.key': bootstrap['gateway-wireguard.key'], 'ca.pem': tls.root, 'default.pem': await readFile(join(runtimeDirectory, 'public-certs/default.pem')),
    'bot.key': await readFile(join(runtimeDirectory, 'gateway-bot.key'))}));
  const resources = JSON.parse(await readFile(new URL('../deploy/kubernetes/remote.yaml', import.meta.url), 'utf8'));
  const deployment = resources.items.find(row => row.kind === 'Deployment').spec.template;
  deployment.spec.affinity = separateByHost(deployment.metadata.labels);
  deployment.spec.containers[0].image = tag;
  deployment.spec.containers[0].env.find(row => row.name === 'GATEWAY_CELL_ID').value = cellId;
  await create(resources);
  const command = requireTls + 'mkdir -m 700 -p /work/lan\n' +
    'cp -L /identity/gateway-* /work/\ncp -L /identity/ca*.pem /work/lan/\n' +
    'chmod 600 /work/*.* /work/lan/*\nexec node deploy/kubernetes/remote-worker.mjs';
  const worker = cloudContainer(tag, 'worker', 'cloud-db-app', ['sh', '-ec', command]);
  worker.env.push(...Object.entries({NODE_ENV: 'production', CLOUD_TEST_SERVICE_PLANS: '0',
    CLOUD_VENUE_SERVICE_LEVELS: '0', CLOUD_STOCKHOLM_REMOTE_CELL: cellId, LOCAL_STACK_CONFIG_DIR: '/work'}).map(([name, value]) => ({name, value})));
  worker.volumeMounts.push({name: 'identity', mountPath: '/identity', readOnly: true}, {name: 'work', mountPath: '/work'});
  worker.readinessProbe = {exec: {command: ['test', '-f', '/tmp/remote-worker-ready']}, periodSeconds: 1};
  const workerLabels = {app: 'remote-worker'}, accountNode = nodes[0].name;
  const affinity = {...separateByHost(workerLabels), nodeAffinity: {requiredDuringSchedulingIgnoredDuringExecution: {
    nodeSelectorTerms: [{matchExpressions: [{key: 'kubernetes.io/hostname', operator: 'NotIn', values: [accountNode]}]}],
  }}};
  const call = (args, limit) => kube(args, undefined, false, limit);
  const readyWorkers = async (count, limit) => {
    const {items} = JSON.parse(await call(['get', 'pods', '-l', 'app=remote-worker', '-o', 'json'], limit));
    const rows = items.filter(row => !row.metadata.deletionTimestamp);
    return rows.length === count && rows.every(row => row.status.conditions?.some(
      condition => condition.type === 'Ready' && condition.status === 'True')) && rows;
  };
  async function databasePrimaryNode(limit) {
    const {status} = JSON.parse(await call(['get', 'clusters.postgresql.cnpg.io', 'cloud-db', '-o', 'json'], limit));
    assert.ok(status?.currentPrimary, 'remote.database_primary_missing');
    const {spec} = JSON.parse(await call(['get', 'pod', status.currentPrimary, '-o', 'json'], limit));
    assert.ok(nodes.some(node => node.name === spec.nodeName), 'remote.database_primary_outside_cell');
    return spec.nodeName;
  }
  async function publicationEndpoints(phase, limit) {
    const endpoints = async (namespace, service) => {
      const {items} = JSON.parse(await call(['get', 'endpointslices', '--namespace=' + namespace,
        '-l', 'kubernetes.io/service-name=' + service, '-o', 'json'], limit));
      return items.flatMap(slice => slice.endpoints.map(row =>
        ({pod: row.targetRef?.name, node: row.nodeName, addresses: row.addresses, ready: row.conditions?.ready})));
    };
    const [dns, database] = await Promise.all([endpoints('kube-system', 'kube-dns'), endpoints('d621-data', 'cloud-db-rw')]);
    process.stderr.write('D621 publication endpoints ' + JSON.stringify({phase, dns, database}) + '\n');
  }
  const primaryAtPlacement = stopGatewayNode ? accountNode : await databasePrimaryNode(signal);
  // A cordon asks CloudNativePG to move the primary. Reserve its node with a scheduling taint instead.
  const primaryPlacementTaint = 'waitron.cloud/publication-primary';
  const holdPrimary = primaryAtPlacement !== accountNode;
  if (holdPrimary) await call(['taint', 'nodes', primaryAtPlacement, primaryPlacementTaint + '=held:NoSchedule'], signal);
  let originalWorker;
  try {
    await create({apiVersion: 'apps/v1', kind: 'Deployment', metadata: {name: 'remote-worker'}, spec: {
      replicas: 1, selector: {matchLabels: workerLabels}, template: {metadata: {labels: workerLabels}, spec: {
        affinity, serviceAccountName: 'remote-worker', containers: [worker], volumes: [caVolume,
          {name: 'identity', secret: {secretName: 'remote-worker-identity', defaultMode: 384}}, {name: 'work', emptyDir: {}}],
      }},
    }});
    [originalWorker] = await untilRemote(limit => readyWorkers(1, limit), 180000, signal, 'publication_worker');
    assert.notEqual(originalWorker.spec.nodeName, accountNode, 'remote.publication_worker_on_account_node');
    assert.notEqual(originalWorker.spec.nodeName, primaryAtPlacement, 'remote.publication_worker_on_database_primary');
  } finally {
    if (holdPrimary) await kube(['taint', 'nodes', primaryAtPlacement, primaryPlacementTaint + ':NoSchedule-'], undefined, true);
  }
  const trust = createPublicKey(bootstrap['gateway-issuer.pem']);
  async function readPublication(limit) {
    const secret = JSON.parse(await call(['get', 'secret', 'remote-routes', '-o', 'json'], limit));
    return {secret, generation: JSON.parse(Buffer.from(secret.data['routes.json'], 'base64'))};
  }
  const pods = limit => readGatewayPods(call, limit);
  const candidates = await untilRemote(async limit => {
    const rows = await pods(limit);
    return rows.length === 3 && rows.every(row => row.status.phase === 'Running') && new Set(rows.map(row => row.spec.nodeName)).size === 3 &&
      rows.map(row => row.metadata.name);
  }, 180000, signal, 'gateway_candidates');
  const [primary, ...standbys] = nodes.map(node => node.name);
  const relayId = await run('docker', ['create', '--pull=never', '--network', cluster, '--label', 'cloud.kind.node-loss=' + cluster,
    '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--memory', '64m', '--entrypoint', 'node', tag, 'deploy/kubernetes/remote-relay.mjs',
    primary, '31820', '51820', '0.0.0.0', '30443', ...standbys]);
  assert.match(relayId, /^[a-f0-9]{64}$/);
  const close = () => run('docker', ['rm', '-f', relayId], {signal: null});
  try {
    await run('docker', ['start', relayId]);
    const gatewayIp = await run('docker', ['inspect', '--format', '{{(index .NetworkSettings.Networks "' + cluster + '").IPAddress}}', relayId]);
    assert.match(gatewayIp, /^172\.30\.250\.\d{1,3}$/, 'remote.relay_ip');
    const exec = (pod, cmd, limit) => execGateway(call, pod, cmd, limit);
    const active = async limit => {
      const rows = (await pods(limit)).filter(row => row.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'));
      assert.equal(rows.length, 1, 'remote.active_gateway');
      return rows[0].metadata.name;
    };
    async function handover(checkRoutes, peer) {
      const old = await active(signal);
      const start = performance.now(), cut = Math.floor(Date.now() / 1000);
      await exec(old, ['sh', '-ec', 'kill -STOP "$(cat /state/election.pid)"'], signal);
      return untilRemote(async limit => {
        const next = await active(limit);
        assert.notEqual(next, old, 'remote.standby_required');
        await exec(old, noGatewayInterface, limit);
        await checkRoutes(limit, () => performance.now() - start);
        const {handshake, receivedBytes, sentBytes} = await peerCounters(call, next, peer, limit);
        assert.ok(handshake >= cut && receivedBytes > 0 && sentBytes > 0, 'remote.standby_handshake');
        return {durationMs: Math.ceil(performance.now() - start), interfaceWithdrawn: true, handshake: true};
      }, Math.max(1, remoteDeadlineMs - (performance.now() - start)), signal, 'handover_90_seconds');
    }
    return {gatewayIp, host: gatewayIp, port: 30443, ca: tls.root, close, handover,
      ...(stopGatewayNode ? {machineLoss: (checkRoutes, peer, prepareRoutes) => measureGatewayMachineLoss({kube: call,
        accountNode: nodes[0].name, stopNode, moveGateway: handover, checkRoutes, prepareRoutes, peer, signal})} : {}),
      async peers(limit) {return exec(await active(limit), ['wg', 'show', 'wg-cloud', 'peers'], limit);},
      projected(venueId, limit) {
        return Promise.all(candidates.map(async name => JSON.parse(await exec(name, ['node', '-e', `
          const {readFileSync} = require('node:fs');
          const {X509Certificate} = require('node:crypto');
          const {manifest, certificates} = JSON.parse(readFileSync('/routes/routes.json'));
          const {sequence, routes} = JSON.parse(Buffer.from(JSON.parse(manifest).payload, 'base64url'));
          const pem = certificates[process.argv[1]];
          console.log(JSON.stringify({sequence, routes: routes.length, certificate: pem ? new X509Certificate(pem).fingerprint256.replaceAll(':','').toLowerCase() : null}));
        `, venueId], limit))));
      },
      async forgetPublicCopy(venueId, installationId) {
        const {secret, generation} = await readPublication(signal);
        const saved = generation.publicRequests?.[venueId];
        assert.equal(saved?.installationId, installationId, 'remote.publication_request_binding');
        delete saved.csr;
        secret.data['routes.json'] = Buffer.from(JSON.stringify(generation)).toString('base64');
        await kube(['replace', '-f', '-'], JSON.stringify(secret), false, signal);
      },
      async publication(venueId, limit) {
        const {generation} = await readPublication(limit);
        const {sequence, routes} = verifyManifest(JSON.parse(generation.manifest), trust, cellId);
        const pem = generation.certificates[venueId], csr = generation.publicRequests?.[venueId]?.csr;
        return {sequence, routes, certificate: pem && new X509Certificate(pem).fingerprint256.replaceAll(':', '').toLowerCase(),
          request: csr && createHash('sha256').update(csr).digest('hex')};
      },
      async stopPublicationWorker(whileStopped) {
        await call(['scale', 'deployment/remote-worker', '--replicas=2'], signal);
        const rows = await untilRemote(limit => readyWorkers(2, limit), 180000, signal, 'publication_workers');
        const original = rows.find(row => row.metadata.uid === originalWorker.metadata.uid);
        assert.ok(original, 'remote.original_publication_worker_missing');
        const originalNode = original.spec.nodeName;
        const survivingNode = rows.find(row => row !== original).spec.nodeName;
        assert.equal(new Set([accountNode, originalNode, survivingNode]).size, 3, 'remote.publication_worker_placement');
        const primaryNode = await databasePrimaryNode(signal);
        assert.notEqual(originalNode, primaryNode, 'remote.publication_stop_would_kill_database_primary');
        await publicationEndpoints('before stop', signal);
        const result = await stopNode(originalNode, {async whileStopped(fault) {
          await retryApi(() => publicationEndpoints('during stop', fault.signal), fault.signal, 'publication endpoints');
          return whileStopped(fault);
        }});
        return {...result, originalNode, survivingNode, databasePrimaryNode: primaryNode};
      },
    };
  } catch (failure) {
    await cleanUp(failure, close);
    throw failure;
  }
}
