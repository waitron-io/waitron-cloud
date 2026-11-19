import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {caVolume, cloudContainer, cleanUp, requireTls} from './kubernetes-database.mjs';
import {separateByHost} from './kubernetes-placement.mjs';

export async function untilRemote(probe, ms, signal, stage) {
  const end = performance.now() + ms;
  const limit = AbortSignal.any([AbortSignal.timeout(ms), ...[signal].filter(Boolean)]);
  let last;
  while (!limit.aborted) {
    try {
      const result = await probe(limit);
      if (result && performance.now() < end) return result;
    } catch (error) {last = error;}
    await delay(250, undefined, {signal: limit}).catch(() => {});
  }
  signal?.throwIfAborted();
  throw Error('remote.' + stage, {cause: last});
}

export async function startRemoteRehearsal({context, kube, create, tag, settings}) {
  const {cluster, nodes, run, signal} = context;
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
  await create({apiVersion: 'v1', kind: 'Pod', metadata: {name: 'remote-worker'}, spec: {
    restartPolicy: 'Never', serviceAccountName: 'remote-worker', containers: [worker], volumes: [caVolume,
      {name: 'identity', secret: {secretName: 'remote-worker-identity', defaultMode: 384}}, {name: 'work', emptyDir: {}}],
  }});
  await kube(['wait', '--for=condition=Ready', 'pod/remote-worker', '--timeout=180s']);
  const call = (args, limit) => kube(args, undefined, false, limit);
  const pods = async limit => JSON.parse(await call(['get', 'pods', '-l', 'app=remote-gateway', '-o', 'json'], limit)).items;
  const candidates = await untilRemote(async limit => {
    const rows = await pods(limit);
    return rows.length === 3 && rows.every(row => row.status.phase === 'Running') && new Set(rows.map(row => row.spec.nodeName)).size === 3 &&
      rows.map(row => row.metadata.name);
  }, 180000, signal, 'gateway_candidates');
  const relayId = await run('docker', ['create', '--pull=never', '--network', cluster, '--label', 'cloud.kind.node-loss=' + cluster,
    '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--memory', '64m', '--entrypoint', 'node', tag, 'deploy/kubernetes/remote-relay.mjs', nodes[0].ip]);
  assert.match(relayId, /^[a-f0-9]{64}$/);
  const close = () => run('docker', ['rm', '-f', relayId], {signal: null});
  try {
    await run('docker', ['start', relayId]);
    const gatewayIp = await run('docker', ['inspect', '--format', '{{(index .NetworkSettings.Networks "' + cluster + '").IPAddress}}', relayId]);
    assert.match(gatewayIp, /^172\.30\.250\.\d{1,3}$/, 'remote.relay_ip');
    const exec = (pod, cmd, limit) => call(['exec', pod, '--', ...cmd], limit);
    const active = async limit => {
      const rows = (await pods(limit)).filter(row => row.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'));
      assert.equal(rows.length, 1, 'remote.active_gateway');
      return rows[0].metadata.name;
    };
    return {gatewayIp, host: nodes[0].ip, port: 30443, ca: tls.root, close,
      async peers(limit) {return exec(await active(limit), ['wg', 'show', 'wg-cloud', 'peers'], limit);},
      async handover(checkRoutes, peer) {
        const old = await active(signal);
        const start = performance.now(), cut = Math.floor(Date.now() / 1000);
        await exec(old, ['sh', '-ec', 'kill -STOP "$(cat /state/election.pid)"'], signal);
        return untilRemote(async limit => {
          const next = await active(limit);
          assert.notEqual(next, old, 'remote.standby_required');
          await exec(old, ['sh', '-ec', '! ip link show wg-cloud >/dev/null 2>&1 && test ! -e /state/lease-active'], limit);
          await checkRoutes(limit);
          const observed = async column => (await exec(next, ['wg', 'show', 'wg-cloud', column], limit))
            .split('\n').map(line => line.split('\t')).find(fields => fields[0] === peer) ?? [];
          const [, handshake] = await observed('latest-handshakes');
          const [, received, sent] = await observed('transfer');
          assert.ok(Number(handshake) >= cut && Number(received) > 0 && Number(sent) > 0, 'remote.standby_handshake');
          return {durationMs: Math.ceil(performance.now() - start), interfaceWithdrawn: true, handshake: true};
        }, Math.max(1, 90000 - (performance.now() - start)), signal, 'handover_90_seconds');
      },
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
      async forgetPublicCopy(id) {
        assert.match(id, /^[a-f0-9-]{36}$/);
        await exec('remote-worker', ['rm', '/work/remote/' + id + '/key.pem']);
      },
    };
  } catch (failure) {
    await cleanUp(failure, close);
    throw failure;
  }
}
