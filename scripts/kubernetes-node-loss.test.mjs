import assert from 'node:assert/strict';
import test from 'node:test';

import {runKubernetesNodeLoss as runCheck} from './kubernetes-node-loss.mjs';

function fixture({foreign = false, foreignNetwork = false, partial = false, failWhileStopped = false, restarts = false, rejoin = undefined, readTimeout = false, leaseTimeout = false} = {}) {
  const calls = [], containers = new Map(), networkId = 'a'.repeat(64);
  let label, removed = false, pod, expectStaleLease = leaseTimeout;
  const starts = new Set();
  const names = ['control-plane', 'control-plane2', 'control-plane3'];
  const execute = async (binary, args, options) => {
    calls.push({binary, args, options});
    if (binary === 'kind') {
      if (args[0] === 'version') return 'kind v0.31.0';
      assert.equal(options.env.KIND_EXPERIMENTAL_DOCKER_NETWORK, label);
      assert.ok(`${label}-external-load-balancer`.length <= 63, 'the Kind balancer name must fit one DNS label');
      assert.equal(options.env.KIND_EXPERIMENTAL_PROVIDER, 'docker');
      assert.ok(args.includes('--retain'));
      const configuration = JSON.parse(options.input);
      assert.equal(configuration.networking.apiServerAddress, '127.0.0.1');
      assert.deepEqual(configuration.nodes.map(node => node.role), names.map(() => 'control-plane'));
      for (const [index, suffix] of (partial ? names.slice(0, 1) : names.concat('external-load-balancer')).entries()) {
        const id = String(index + 1).repeat(64);
        containers.set(id, {Id: id, Name: '/' + label + '-' + suffix, State: {Running: true, Restarting: false},
          Config: {Labels: {'io.x-k8s.kind.cluster': foreign && index === 2 ? 'foreign' : label,
            'io.x-k8s.kind.role': index === 3 ? 'external-load-balancer' : 'control-plane'}},
          NetworkSettings: {Networks: {[label]: {NetworkID: networkId, IPAddress: '172.30.250.' + (index + 2)}},
            Ports: {'6443/tcp': [{HostIp: '127.0.0.1', HostPort: '59876'}]}}});
      }
      if (partial) throw Error('synthetic Kind creation failure');
      return '';
    }
    if (binary === 'kubectl') {
      if (args[0] === 'version') return JSON.stringify({clientVersion: {gitVersion: 'v1.34.3'}});
      assert.equal(args[0], '--kubeconfig');
      assert.equal(args[1], options.env.KUBECONFIG);
      assert.equal(args[2], '--request-timeout=10s');
      const [verb, kind] = args.slice(3);
      if (verb === 'config') return JSON.stringify({clusters: [{cluster: {server: 'https://127.0.0.1:59876'}}]});
      if (verb === 'get' && kind === 'nodes') return JSON.stringify({items: names.map((suffix, i) => ({metadata: {name: label + '-' + suffix,
        uid: rejoin === 'node' && starts.size && i === 0 ? 'replacement-uid' : 'uid-' + i}}))});
      if (verb === 'get' && kind === 'lease') {
        const name = args[5];
        const id = Array.from(containers.keys()).find(key => containers.get(key).Name === '/' + name);
        if (leaseTimeout) {
          leaseTimeout = false;
          throw Error('Unable to connect to the server: context deadline exceeded');
        }
        const fresh = starts.has(id) && !expectStaleLease;
        if (starts.has(id)) expectStaleLease = false;
        return JSON.stringify({spec: {renewTime: fresh ? '2026-11-18T09:00:01Z' : '2026-11-18T09:00:00Z'}});
      }
      if (verb === 'get' && kind === '--raw=/readyz') return 'ok';
      if (verb === 'apply') {
        const manifest = JSON.parse(options.input);
        const stopped = Array.from(containers.values()).find(row => !row.State.Running);
        assert.ok(stopped, 'the API write must happen while a node is stopped');
        if (failWhileStopped) throw Error('synthetic API write failure');
        if (manifest.kind === 'Pod') {
          const terms = manifest.spec.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms;
          assert.deepEqual(terms, [{matchFields: [{key: 'metadata.name', operator: 'NotIn', values: [stopped.Name.slice(1)]}]}]);
          assert.equal(manifest.spec.containers[0].imagePullPolicy, 'Never');
          pod = {...manifest, spec: {...manifest.spec, nodeName: Array.from(containers.values()).find(row => row.State.Running).Name.slice(1)}};
        } else {
          pod = manifest;
        }
        return '';
      }
      if (verb === 'get' && kind === 'configmap' && readTimeout) {
        readTimeout = false;
        throw Error('Unable to connect to the server: context deadline exceeded');
      }
      if (verb === 'get' && (kind === 'configmap' || kind === 'pod')) return JSON.stringify(pod);
      if (verb === 'taint' || verb === 'wait' || kind === 'events') return '';
    }
    assert.equal(binary, 'docker');
    assert.equal(options.env.DOCKER_CONTEXT, 'default');
    assert.equal(options.env.DOCKER_HOST, undefined);
    const [verb, second, ...rest] = args;
    if (verb === 'ps') return Array.from(containers.keys()).join('\n');
    if (verb === 'network') {
      if (second === 'create') {
        label = args.at(-1);
        assert.ok(args.includes('--subnet'));
        assert.ok(args.includes('cloud.kind.node-loss=' + label));
        return networkId;
      }
      if (second === 'ls') return removed || !label ? '' : networkId;
      assert.equal(rest[0], networkId);
      if (second === 'inspect') return JSON.stringify([{Id: networkId, Name: label, Labels: {'cloud.kind.node-loss': foreignNetwork ? 'foreign' : label}}]);
      if (second === 'rm') {removed = true; return networkId;}
      const node = containers.get(rest.at(-1));
      assert.equal(node.State.Running, false);
      if (second === 'disconnect') delete node.NetworkSettings.Networks[label];
      else if (second === 'connect') {
        if (rejoin === 'connect') throw Error('synthetic reattach failure');
        node.NetworkSettings.Networks[label] = {NetworkID: networkId, IPAddress: rest[2]};
      }
      else assert.fail(args.join(' '));
      return '';
    }
    if (verb === 'inspect') return JSON.stringify(args.slice(2).map(id => containers.get(id)));
    if (verb === 'exec') return args.at(-1) === 'health' ? '127.0.0.1:2379 is healthy' :
      names.map((suffix, i) => `0123456789abcde${rejoin === 'member' && starts.size && i === 0 ? 9 : i}, started, ${label}-${suffix}, https://unused:2380, https://unused:2379, false`).join('\n');
    if (verb === 'logs') return 'synthetic container log';
    const node = containers.get(args.at(-1));
    assert.ok(node, args.join(' '));
    if (verb === 'update') assert.equal(second, '--restart=no');
    else if (verb === 'kill') {assert.equal(second, '--signal=SIGKILL'); node.State.Running = restarts;}
    else if (verb === 'start') {node.State.Running = true; starts.add(node.Id);}
    else if (verb === 'rm') containers.delete(node.Id);
    else assert.fail(args.join(' '));
    return '';
  };
  return {calls, execute, removed: () => removed, remaining: () => containers.size,
    mutations: verb => calls.filter(row => row.binary === 'docker' && row.args[0] === verb).map(row => row.args.at(-1))};
}

test('the Kind fault loop stops each exact container, schedules on a survivor and verifies rejoin', async () => {
  const f = fixture(), result = await runCheck({execute: f.execute});
  assert.equal(result.legs.length, 3);
  assert.deepEqual(f.mutations('kill'), ['1', '2', '3'].map(digit => digit.repeat(64)));
  assert.deepEqual(f.mutations('start'), f.mutations('kill'));
  for (const {stopped} of result.legs) {
    const reads = f.calls.filter(({binary, args}) => binary === 'kubectl' && args.includes('lease') && args.includes(stopped));
    assert.equal(reads.length, 2, 'rejoin must observe a fresh node heartbeat');
  }
  assert.ok(result.legs.every(leg => leg.stopped !== leg.scheduledOn));
  assert.deepEqual(Object.values(result.members), ['0', '1', '2'].map(digit => '0123456789abcde' + digit));
  assert.ok(f.removed());
  assert.equal(f.remaining(), 0);
});

test('a container with an unrelated Kind label is never stopped or removed', async () => {
  const f = fixture({foreign: true});
  await assert.rejects(runCheck({execute: f.execute}), /container.ownership/);
  assert.deepEqual(f.mutations('kill'), []);
  assert.ok(!f.mutations('rm').includes('3'.repeat(64)));
});


test('a network with a foreign ownership label is left alone before Kind starts', async () => {
  const f = fixture({foreignNetwork: true});
  await assert.rejects(runCheck({execute: f.execute}), /network.ownership/);
  assert.ok(!f.calls.some(({binary, args}) => binary === 'kind' && args[0] === 'create'));
  assert.equal(f.removed(), false);
});

test('a node that stays running is refused before any fault workload starts', async () => {
  const f = fixture({restarts: true});
  await assert.rejects(runCheck({execute: f.execute}), /container_still_running/);
  assert.ok(!f.calls.some(({binary, args}) => binary === 'kubectl' && args.includes('apply')));
  assert.equal(f.remaining(), 0);
  assert.ok(f.removed());
});

for (const [mode, message] of [['partial', /synthetic Kind creation failure/], ['failWhileStopped', /synthetic API write failure/]]) {
  test(`owned containers and network are removed after ${mode === 'partial' ? 'a failed Kind create' : 'a failed API write during a fault'}`, async () => {
    const f = fixture({[mode]: true});
    await assert.rejects(runCheck({execute: f.execute}), message);
    assert.equal(f.remaining(), 0);
    assert.ok(f.removed());
    const diagnostics = f.calls.findIndex(({binary, args}) => binary === 'docker' && args[0] === 'logs');
    const removal = f.calls.findIndex(({binary, args}) => binary === 'docker' && args[0] === 'rm');
    assert.ok(diagnostics !== -1 && diagnostics < removal, 'read owned container logs before removing them');
    const writes = f.calls.filter(({binary, args}) => binary === 'kubectl' && args.includes('apply'));
    assert.equal(writes.length, mode === 'partial' ? 0 : 1, 'a refused write should fail immediately');
  });
}

for (const [rejoin, message] of [['node', /node_identity/], ['member', /etcd_identity/], ['connect', /synthetic reattach failure/]]) {
  test(`a failed rejoin (${rejoin}) stops the run and still removes owned containers`, {timeout: 3000}, async () => {
    const f = fixture({rejoin});
    await assert.rejects(runCheck({execute: f.execute}), message);
    assert.equal(f.mutations('kill').length, 1);
    assert.equal(f.remaining(), 0);
    assert.ok(f.removed());
  });
}


test('the fault check retries a transient API connection timeout while the node stays down', async () => {
  const f = fixture({readTimeout: true}), result = await runCheck({execute: f.execute});
  assert.equal(result.legs.length, 3);
  assert.equal(f.calls.filter(({binary, args}) => binary === 'kubectl' && args.includes('configmap') && args.includes('node-loss-1')).length, 2);
  assert.equal(f.mutations('kill').length, 3);
  assert.ok(f.removed());
});


test('lease recovery retries a connection timeout and waits out a stale heartbeat', async () => {
  const f = fixture({leaseTimeout: true}), result = await runCheck({execute: f.execute});
  const first = result.legs[0].stopped;
  const reads = f.calls.filter(({binary, args}) => binary === 'kubectl' && args.includes('lease') && args.includes(first));
  assert.equal(reads.length, 4, 'two reads while stopped and two after restart');
  assert.equal(result.legs.length, 3);
});

test('the database check can stop only an owned node and leaves cleanup to the Kind fixture', async () => {
  const f = fixture();
  await assert.rejects(runCheck({execute: f.execute, async database({nodes, stopNode}) {
    assert.equal(nodes.length, 3);
    assert.equal(f.mutations('kill').length, 0);
    await stopNode('unrelated-node', {whileStopped: () => assert.fail('foreign fault started')});
  }}), /node_loss\.unknown_node/);
  assert.deepEqual(f.mutations('kill'), []);
  assert.equal(f.remaining(), 0);
  assert.ok(f.removed());
});

test('a database fault runs its checks around the stop and restart of the selected node', async () => {
  const f = fixture();
  const result = await runCheck({execute: f.execute, async database({nodes, stopNode}) {
    const [node] = nodes;
    await stopNode(node, {
      whileStopped: async () => {
        assert.deepEqual(f.mutations('kill'), ['1'.repeat(64)]);
        assert.deepEqual(f.mutations('start'), []);
      },
      afterRestart: async () => {
        assert.deepEqual(f.mutations('start'), ['1'.repeat(64)]);
      }
    });
    return {rejoined: node};
  }});
  assert.equal(result.database.rejoined, result.nodes[0].name);
  assert.equal(f.remaining(), 0);
  assert.ok(f.removed());
});
