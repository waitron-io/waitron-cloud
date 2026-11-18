import assert from 'node:assert/strict';
import test from 'node:test';

async function runCheck(options) {
  const module = await import('./kubernetes-node-loss.mjs').catch(error => {
    assert.notEqual(error.code, 'ERR_MODULE_NOT_FOUND', 'the local node-loss check is missing');
    throw error;
  });
  return module.runKubernetesNodeLoss(options);
}

function fixture({foreign = false, foreignNetwork = false, partial = false, failWhileStopped = false, restarts = false} = {}) {
  const calls = [], containers = new Map(), networkId = 'a'.repeat(64);
  let label, removed = false, pod;
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
      if (verb === 'get' && kind === 'nodes') return JSON.stringify({items: names.map((suffix, i) => ({metadata: {name: label + '-' + suffix, uid: 'uid-' + i}}))});
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
      else if (second === 'connect') node.NetworkSettings.Networks[label] = {NetworkID: networkId, IPAddress: rest[2]};
      else assert.fail(args.join(' '));
      return '';
    }
    if (verb === 'inspect') return JSON.stringify(args.slice(2).map(id => containers.get(id)));
    if (verb === 'exec') return args.at(-1) === 'health' ? '127.0.0.1:2379 is healthy' :
      names.map((suffix, i) => `0123456789abcde${i}, started, ${label}-${suffix}, https://unused:2380, https://unused:2379, false`).join('\n');
    if (verb === 'logs') return 'synthetic container log';
    const node = containers.get(args.at(-1));
    assert.ok(node, args.join(' '));
    if (verb === 'update') assert.equal(second, '--restart=no');
    else if (verb === 'kill') {assert.equal(second, '--signal=SIGKILL'); node.State.Running = restarts;}
    else if (verb === 'start') node.State.Running = true;
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
  });
}
