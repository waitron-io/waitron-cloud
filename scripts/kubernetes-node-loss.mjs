import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {spreadCoreDns} from './kubernetes-placement.mjs';
import {cleanUp} from './kubernetes-database.mjs';
import {verifierScratchPath} from '../deploy/kubernetes/services.mjs';

export const kindNodeImage = 'kindest/node:v1.34.3@sha256:08497ee19eace7b4b5348db5c6a1591d7752b164530a36f855cb0f2bdcbadd48';
const pauseImage = 'registry.k8s.io/pause:3.10';
const clusterLabel = 'io.x-k8s.kind.cluster';
const roleLabel = 'io.x-k8s.kind.role';
const networkLabel = 'cloud.kind.node-loss';
const subnet = '172.30.250.0/24';
const dockerId = /^[a-f0-9]{64}$/;
const controlPlanes = ['control-plane', 'control-plane2', 'control-plane3'];
const balancerRole = 'external-load-balancer';

function executeCommand(binary, args, {env, input, signal, timeout}) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, {env, signal: signal ?? undefined, timeout, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024}, (error, stdout, stderr) => {
      if (!error) return resolve(stdout.trim());
      const reason = error.code ?? error.signal ?? error.name;
      reject(Error(`${binary} ${args.join(' ')} failed (${reason}, limit ${timeout}ms)\n${stdout.slice(-8192)}\n${stderr.slice(-8192)}`, {cause: error}));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function retry(check, signal, canRetry = () => true) {
  while (!signal.aborted) {
    try {return await check();}
    catch (error) {
      if (!canRetry(error)) throw error;
      await delay(1000, undefined, {signal}).catch(() => {throw error;});
    }
  }
  signal.throwIfAborted();
}

export function retryApi(check, signal, stage) {
  return retry(check, signal, error => {
    const {message} = error;
    // kubectl reports the workload's exit separately from its own transport errors.
    const workloadExited = /^(?:error: )?command terminated with exit code [1-9]\d*$/im.test(message);
    const transportFailed = !workloadExited &&
      /Unable to connect to the server:|The connection to the server .* was refused|connection reset by peer|unexpected EOF|^error: EOF$/im.test(message);
    if (!transportFailed) return false;
    process.stderr.write(`Retrying Kind connection during ${stage}\n${error.message.slice(-2048)}\n`);
    return true;
  });
}

function parseMembers(output) {
  return Object.fromEntries(output.split('\n').map(line => {
    const [id, status, name] = line.split(', ');
    assert.match(id, /^[a-f0-9]{1,16}$/, 'node_loss.etcd_member_id');
    assert.equal(status, 'started', 'node_loss.etcd_member_started');
    return [name, id];
  }));
}

const etcd = `
container=$(crictl ps --name '^etcd$' --state Running -q)
test -n "$container"
exec crictl exec "$container" etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \
  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key --command-timeout=5s "$@"
`;

export async function runKubernetesNodeLoss({execute = executeCommand, database, storage, services, remote, coldRestart} = {}) {
  // Kind appends its role names to the cluster name, within one DNS label.
  const cluster = 'd621-' + randomUUID().replaceAll('-', '');
  const directory = await mkdtemp(join(tmpdir(), 'cloud-node-loss-'));
  const scratchMount = join(directory, 'verifier-mount');
  const scratchDisk = join(directory, 'verifier.ext4');
  const scratchWork = join(scratchMount, 'work');
  const kubeconfig = join(directory, 'kubeconfig');
  const env = {...process.env, KUBECONFIG: kubeconfig, DOCKER_CONTEXT: 'default', KIND_EXPERIMENTAL_PROVIDER: 'docker',
    KIND_EXPERIMENTAL_DOCKER_NETWORK: cluster};
  delete env.DOCKER_HOST;
  const stop = new AbortController(), shutdown = () => stop.abort();
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  const run = (binary, args, {input, signal = stop.signal, timeout = 15_000} = {}) =>
    execute(binary, args, {env, input, signal, timeout});
  const docker = (args, options) => run('docker', args, options);
  const kube = (args, options) => run('kubectl', ['--kubeconfig', kubeconfig, '--request-timeout=10s', ...args], options);
  const names = controlPlanes.map(suffix => `${cluster}-${suffix}`), balancerName = `${cluster}-${balancerRole}`;
  const list = (options) => docker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `label=${clusterLabel}=${cluster}`], options);
  const networks = (options) => docker(['network', 'ls', '--quiet', '--no-trunc', '--filter', `name=^${cluster}$`], options);
  const inspect = async (ids, options) => {
    assert.ok(ids.every(id => dockerId.test(id)), 'node_loss.container_id');
    if (!ids.length) return [];
    const rows = JSON.parse(await docker(['inspect', '--type=container', ...ids], options));
    assert.deepEqual(rows.map(row => row.Id), ids, 'node_loss.container_identity');
    return rows;
  };
  let networkId, creating = false, kubeBound = false, scratchMountAttempted = false, failure;
  const owned = new Set();
  function owns(row) {
    const name = row.Name.slice(1), labels = row.Config.Labels;
    return labels[clusterLabel] === cluster && (name === balancerName ? labels[roleLabel] === balancerRole :
      names.includes(name) && labels[roleLabel] === 'control-plane') &&
      (owned.has(row.Id) || row.NetworkSettings.Networks[cluster]?.NetworkID === networkId);
  }
  async function verifyNetwork(options) {
    const [row] = JSON.parse(await docker(['network', 'inspect', networkId], options));
    assert.ok(row?.Id === networkId && row.Name === cluster && row.Labels[networkLabel] === cluster, 'node_loss.network_ownership');
  }
  const verifyContainer = async (id, options) => {
    const [row] = await inspect([id], options);
    assert.ok(owns(row), 'node_loss.container_ownership');
    return row;
  };
  const readNodes = async (options) => {
    const {items} = JSON.parse(await kube(['get', 'nodes', '-o', 'json'], options));
    assert.deepEqual(items.map(row => row.metadata.name).sort(), [...names].sort(), 'node_loss.node_names');
    const uids = Object.fromEntries(items.map(row => [row.metadata.name, row.metadata.uid]));
    assert.ok(Object.values(uids).every(Boolean) && new Set(Object.values(uids)).size === 3, 'node_loss.node_uids');
    return uids;
  };
  const heartbeat = async (name, options) => {
    const lease = JSON.parse(await kube(['get', 'lease', name, '--namespace=kube-node-lease', '-o', 'json'], options));
    const renewed = Date.parse(lease.spec.renewTime);
    assert.ok(Number.isFinite(renewed), 'node_loss.invalid_lease_time');
    return renewed;
  };
  const etcdRun = (node, args, options) => docker(['exec', node.id, 'sh', '-ec', etcd, 'etcd', ...args], options);
  async function readEtcd(nodes, options) {
    const members = parseMembers(await etcdRun(nodes[0], ['member', 'list'], options));
    assert.deepEqual(Object.keys(members).sort(), [...names].sort(), 'node_loss.etcd_member_names');
    assert.equal(new Set(Object.values(members)).size, 3, 'node_loss.etcd_member_ids');
    await Promise.all(nodes.map(async node => {
      const health = await etcdRun(node, ['endpoint', 'health'], options);
      assert.match(health, /is healthy/, 'node_loss.etcd_health');
    }));
    return members;
  }

  try {
    assert.match(await run('kind', ['version']), /\bv0\.31\.0\b/);
    assert.equal(JSON.parse(await run('kubectl', ['version', '--client', '-o', 'json'])).clientVersion.gitVersion, 'v1.34.3');
    assert.equal(await list(), '', 'node_loss.cluster_exists');
    assert.equal(await networks(), '', 'node_loss.network_exists');
    if (services) {
      await mkdir(scratchMount, {mode: 0o700});
      await run('fallocate', ['-l', '1G', scratchDisk]);
      await run('mkfs.ext4', ['-q', '-m', '0', scratchDisk]);
      scratchMountAttempted = true;
      await run('mount', ['-o', 'loop,nodev,nosuid,noexec', scratchDisk, scratchMount]);
      await run('install', ['-d', '-m', '0700', '-o', '1000', '-g', '1000', scratchWork]);
    }
    networkId = await docker(['network', 'create', '--driver', 'bridge', '--subnet', subnet, '--label', `${networkLabel}=${cluster}`, cluster]);
    assert.match(networkId, dockerId, 'node_loss.network_id');
    await verifyNetwork();
    creating = true;
    process.stderr.write(`Creating owned Kind cluster ${cluster}\n`);
    const input = JSON.stringify({kind: 'Cluster', apiVersion: 'kind.x-k8s.io/v1alpha4',
      networking: {apiServerAddress: '127.0.0.1', ipFamily: 'ipv4'}, nodes: names.map((_, index) => ({
        role: 'control-plane',
        ...(services && index === 0 ? {extraMounts: [{hostPath: scratchWork, containerPath: verifierScratchPath}]} : {}),
      }))});
    // Retain a partial create so cleanup can check container IDs before removing anything.
    await run('kind', ['create', 'cluster', '--name', cluster, '--image', kindNodeImage, '--wait', '180s', '--retain', '--config', '-'],
      {input, timeout: 600_000});
    const containers = await inspect((await list()).split('\n').filter(Boolean));
    assert.ok(containers.every(owns), 'node_loss.container_ownership');
    assert.deepEqual(containers.map(row => row.Name.slice(1)).sort(), [...names, balancerName].sort(), 'node_loss.container_names');
    for (const row of containers) owned.add(row.Id);
    const balancer = containers.find(row => row.Name === '/' + balancerName);
    const [{HostIp, HostPort}] = balancer.NetworkSettings.Ports['6443/tcp'];
    assert.equal(HostIp, '127.0.0.1', 'node_loss.balancer_binding');
    const configuration = JSON.parse(await kube(['config', 'view', '--minify', '-o', 'json']));
    assert.equal(configuration.clusters[0].cluster.server, `https://127.0.0.1:${HostPort}`, 'node_loss.kubeconfig_binding');
    kubeBound = true;
    const nodes = names.map(name => {
      const row = containers.find(candidate => candidate.Name === '/' + name), ip = row.NetworkSettings.Networks[cluster].IPAddress;
      assert.match(ip, /^172\.30\.250\.\d{1,3}$/, 'node_loss.node_ip');
      return {name, ip, id: row.Id};
    });
    await kube(['taint', 'node', ...names, 'node-role.kubernetes.io/control-plane:NoSchedule-']);
    await kube(['wait', '--for=condition=Ready', 'nodes', '--all', '--timeout=180s'], {timeout: 185_000});
    await spreadCoreDns(kube, names);
    const nodeUids = await readNodes(), members = await readEtcd(nodes);
    async function stopNode(name, {whileStopped, afterRestart} = {}) {
      const node = nodes.find(candidate => candidate.name === name);
      assert.ok(node, 'node_loss.unknown_node');
      const stopped = await verifyContainer(node.id);
      assert.equal(stopped.NetworkSettings.Networks[cluster]?.IPAddress, node.ip, 'node_loss.address_before_stop');
      // Keep the selected node down for the whole leg independently of Docker restart policy.
      await docker(['update', '--restart=no', node.id]);
      const started = performance.now();
      await docker(['kill', '--signal=SIGKILL', node.id]);
      const failover = {signal: AbortSignal.any([stop.signal, AbortSignal.timeout(90_000)]), timeout: 95_000};
      async function expectStopped() {
        const {State} = await verifyContainer(node.id, failover);
        assert.ok(!State.Running && !State.Restarting, 'node_loss.container_still_running');
      }
      await expectStopped();
      process.stderr.write(`Kind node stopped ${node.name}\n`);
      await retry(async () => assert.equal(await kube(['get', '--raw=/readyz'], failover), 'ok'), failover.signal);
      const result = await whileStopped(failover);
      await expectStopped();
      const failoverMs = Math.round(performance.now() - started);
      const rejoin = {signal: AbortSignal.any([stop.signal, AbortSignal.timeout(180_000)]), timeout: 185_000};
      const leaseWhileStopped = await retryApi(() => heartbeat(node.name, rejoin), rejoin.signal, 'lease before restart');
      await verifyNetwork(rejoin);
      await docker(['network', 'disconnect', networkId, node.id], rejoin);
      await docker(['network', 'connect', networkId, '--ip', node.ip, node.id], rejoin);
      await docker(['start', node.id], rejoin);
      if (afterRestart) await afterRestart(rejoin);
      const restarted = await verifyContainer(node.id, rejoin);
      assert.equal(restarted.NetworkSettings.Networks[cluster]?.IPAddress, node.ip, 'node_loss.address_after_restart');
      // Ready can still hold its pre-outage value while the kubelet is absent.
      await retry(async () => assert.ok(await heartbeat(node.name, rejoin) > leaseWhileStopped, 'node_loss.stale_heartbeat'), rejoin.signal);
      await retryApi(() => kube(['wait', '--for=condition=Ready', 'nodes', '--all', '--timeout=180s'], rejoin), rejoin.signal, 'nodes Ready');
      const restartedNodes = await retryApi(() => readNodes(rejoin), rejoin.signal, 'node identity');
      assert.deepEqual(restartedNodes, nodeUids, 'node_loss.node_identity');
      assert.deepEqual(await retry(() => readEtcd(nodes, rejoin), rejoin.signal), members, 'node_loss.etcd_identity');
      return {stopped: node.name, failoverMs, ...result};
    }
    if (coldRestart) {
      const ids = nodes.map(({id}) => id);
      async function verifyBalancer(options) {
        const row = await verifyContainer(balancer.Id, options);
        assert.ok(row.State.Running, 'cold_restart.balancer_stopped');
        assert.deepEqual(row.NetworkSettings.Ports['6443/tcp'], [{HostIp, HostPort}], 'cold_restart.balancer_binding');
      }
      async function restartAll() {
        await verifyNetwork();
        const before = await Promise.all(ids.map(id => verifyContainer(id)));
        for (const [index, row] of before.entries()) {
          assert.equal(row.NetworkSettings.Networks[cluster]?.IPAddress, nodes[index].ip, 'node_loss.address_before_stop');
          assert.ok(row.State.Running, 'cold_restart.node_already_stopped');
        }
        await docker(['update', '--restart=no', ...ids]);
        await docker(['kill', '--signal=SIGKILL', ...ids]);
        const stopped = await Promise.all(ids.map(id => verifyContainer(id)));
        const stopTimes = stopped.map(({State}) => {
          assert.ok(!State.Running && !State.Restarting, 'node_loss.container_still_running');
          const time = Date.parse(State.FinishedAt);
          assert.ok(Number.isFinite(time), 'cold_restart.stop_time');
          return time;
        });
        await verifyBalancer();
        for (let probe = 0; probe < 2; probe++) {
          await assert.rejects(kube(['get', '--raw=/readyz']),
            /Unable to connect to the server:|connection reset by peer|^error: EOF$/im, 'cold_restart.api_still_ready');
          stop.signal.throwIfAborted();
        }
        process.stderr.write(`Kind API outage confirmed with all three nodes stopped
`);
        for (const {id, ip} of nodes) {
          await docker(['network', 'disconnect', networkId, id]);
          await docker(['network', 'connect', networkId, '--ip', ip, id]);
        }
        const started = performance.now();
        const rejoin = {signal: AbortSignal.any([stop.signal, AbortSignal.timeout(180_000)]), timeout: 185_000};
        await docker(['start', ...ids], rejoin);
        for (const [index, {id, ip}] of nodes.entries()) {
          const row = await verifyContainer(id, rejoin);
          assert.equal(row.NetworkSettings.Networks[cluster]?.IPAddress, ip, 'node_loss.address_after_restart');
          assert.ok(row.State.Running && Date.parse(row.State.StartedAt) > stopTimes[index], 'cold_restart.live_restart');
        }
        await retry(async () => {
          const leases = await Promise.all(names.map(name => heartbeat(name, rejoin)));
          assert.ok(leases.every((lease, index) => lease > stopTimes[index]), 'node_loss.stale_heartbeat');
        }, rejoin.signal);
        await retryApi(() => kube(['wait', '--for=condition=Ready', 'nodes', '--all', '--timeout=180s'], rejoin), rejoin.signal, 'nodes Ready');
        assert.deepEqual(await retryApi(() => readNodes(rejoin), rejoin.signal, 'node identity'), nodeUids, 'node_loss.node_identity');
        assert.deepEqual(await retry(() => readEtcd(nodes, rejoin), rejoin.signal), members, 'node_loss.etcd_identity');
        await verifyBalancer(rejoin);
        return {recoveryMs: Math.round(performance.now() - started)};
      }
      const result = await coldRestart({nodes, directory, run, kube, restartAll, signal: stop.signal});
      return {cluster, networkId, balancer: balancer.Id, nodes, nodeUids, members, coldRestart: result};
    }
    if (database) {
      const result = await database({nodes: nodes.map(node => node.name), cluster, directory, run, kube, stopNode, signal: stop.signal});
      return {cluster, networkId, balancer: balancer.Id, nodes, nodeUids, members, database: result};
    }
    if (storage) {
      const result = await storage({nodes, cluster, directory, run, kube, stopNode, signal: stop.signal});
      return {cluster, networkId, balancer: balancer.Id, nodes, nodeUids, members, storage: result};
    }
    if (remote) {
      const result = await remote({nodes, cluster, directory, run, kube, env, kubeconfig, stopNode, signal: stop.signal});
      return {cluster, networkId, balancer: balancer.Id, nodes, nodeUids, members, remote: result};
    }
    if (services) {
      const result = await services({nodes, cluster, directory, run, kube, env, kubeconfig, signal: stop.signal});
      return {cluster, networkId, balancer: balancer.Id, nodes, nodeUids, members,
        services: {...result, verifierScratchBytes: (await stat(scratchDisk)).size}};
    }
    const legs = [];
    for (const [index, node] of nodes.entries()) {
      legs.push(await stopNode(node.name, {whileStopped: async failover => {
        const name = 'node-loss-' + (index + 1);
        // Success on one API connection does not settle the balancer for the next connection.
        const duringFault = (args, input) => retryApi(() => kube(args, {...failover, input}), failover.signal, args.slice(0, 3).join(' '));
        const apply = manifest => duringFault(['apply', '-f', '-'], JSON.stringify({apiVersion: 'v1', metadata: {name}, ...manifest}));
        await apply({kind: 'ConfigMap', data: {stopped: node.name}});
        const config = JSON.parse(await duringFault(['get', 'configmap', name, '-o', 'json']));
        assert.equal(config.data.stopped, node.name, 'node_loss.configmap_read');
        const matchFields = [{key: 'metadata.name', operator: 'NotIn', values: [node.name]}];
        await apply({kind: 'Pod', spec: {restartPolicy: 'Never', containers: [{name: 'pause', image: pauseImage, imagePullPolicy: 'Never'}],
          affinity: {nodeAffinity: {requiredDuringSchedulingIgnoredDuringExecution: {nodeSelectorTerms: [{matchFields}]}}}}});
        await duringFault(['wait', '--for=condition=Ready', `pod/${name}`, '--timeout=90s']);
        const scheduledOn = JSON.parse(await duringFault(['get', 'pod', name, '-o', 'json'])).spec.nodeName;
        assert.ok(names.includes(scheduledOn) && scheduledOn !== node.name, 'node_loss.pod_survivor');
        return {scheduledOn};
      }}));
    }
    return {cluster, networkId, balancer: balancer.Id, nodes, nodeUids, members, legs};
  } catch (error) {
    failure = error;
    if (kubeBound) {
      const events = await kube(['get', 'events', '-A', '--sort-by=.lastTimestamp'], {signal: null}).catch(String);
      process.stderr.write(`Kind events for ${cluster}\n${events}\n`);
    }
    throw error;
  } finally {
    const cleanup = {signal: null};
    try {
      if (dockerId.test(networkId ?? '')) {
        await verifyNetwork(cleanup);
        if (creating) {
          const containers = await inspect((await list(cleanup)).split('\n').filter(Boolean), cleanup);
          for (const row of containers.filter(owns)) {
            if (failure) {
              const logs = await docker(['logs', '--tail=30', row.Id], cleanup).catch(String);
              process.stderr.write(`Kind container ${row.Name}\n${logs.slice(-8192)}\n`);
            }
            await docker(['rm', '--force', '--volumes', row.Id], cleanup);
          }
          assert.equal(await list(cleanup), '', 'node_loss.container_ownership_or_cleanup');
        }
        await docker(['network', 'rm', networkId], cleanup);
        assert.equal(await networks(cleanup), '', 'node_loss.network_remains');
      }
    } catch (error) {
      failure = failure ? new AggregateError([failure, error], `${failure.message}\nKind cleanup failed for ${cluster}: ${error.message}`) : error;
      throw failure;
    } finally {
      try {
        await cleanUp(failure, async () => {
          if (scratchMountAttempted) {
            await run('sh', ['-ec', 'if mountpoint -q "$1"; then umount "$1"; fi', 'cleanup', scratchMount], cleanup);
          }
          await rm(directory, {recursive: true, force: true});
        });
      } finally {
        process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);
      }
    }
  }
}
