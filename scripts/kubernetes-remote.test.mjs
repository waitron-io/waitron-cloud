import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {createSocket} from 'node:dgram';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {runKubernetesCheck} from './kubernetes-check.mjs';
import * as remoteRehearsal from './kubernetes-remote.mjs';

test('handover can use the fractional time left after pausing the election', async () => {
  assert.equal(await remoteRehearsal.untilRemote(async () => 'standby', 500.5, undefined, 'standby'), 'standby');
});

test('a timed-out probe preserves the last observation from before the deadline', async () => {
  const last = Error('old endpoint still serving');
  let tried = false;
  await assert.rejects(remoteRehearsal.untilRemote(async signal => {
    if (tried) return delay(5000, undefined, {signal});
    tried = true;
    throw last;
  }, 750, undefined, 'machine_loss_90_seconds'), {message: 'remote.machine_loss_90_seconds', cause: last});
});

test('machine loss follows the Lease while the dead gateway still looks Ready', {timeout: 3000}, async t => {
  let now = 100, down = false, slices = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Date, 'now', () => 1_000_250);
  const pod = (name, nodeName) => ({metadata: {name}, spec: {nodeName},
    status: {conditions: [{type: 'Ready', status: 'True'}]}});
  const lease = name => JSON.stringify({spec: {holderIdentity: name + ':session'}});
  const kube = async args => {
    const [verb, resource, name] = args;
    if (verb === 'get' && resource === 'lease') {
      return lease(name === 'kube-controller-manager' ? 'gateway-node_controller' : down || slices ? 'next' : 'old');
    }
    if (verb === 'get' && resource === 'pods') {
      return JSON.stringify({items: [pod('old', 'gateway-node'), pod('next', 'standby-node')]});
    }
    if (resource === 'endpointslices') {
      const oldReady = ++slices === 1;
      now = oldReady ? 115 : 150;
      return JSON.stringify({items: [{endpoints: [
        {targetRef: {name: 'old'}, conditions: {ready: oldReady}},
        {targetRef: {name: 'next'}, conditions: {ready: true}},
      ]}]});
    }
    assert.equal(verb, 'exec');
    if (args[3] === 'sh') {
      assert.equal(down, false, 'the old gateway is checked only after it has restarted');
      assert.equal(resource, 'old');
      return '';
    }
    assert.equal(resource, down ? 'next' : 'old', 'read WireGuard from the current Lease holder');
    return args.at(-1) === 'transfer' ? 'peer\t12\t15' : down ? 'peer\t1007' : 'peer\t990';
  };
  assert.equal(typeof remoteRehearsal.measureGatewayMachineLoss, 'function');
  const result = await remoteRehearsal.measureGatewayMachineLoss({kube, accountNode: 'account-node', peer: 'peer',
    checkRoutes: async () => {if (down && slices < 2) throw Error('paths still routed to old gateway');},
    moveGateway: () => assert.fail('the account node does not hold the Lease'),
    stopNode: async (node, {whileStopped}) => {
      assert.equal(node, 'gateway-node');
      down = true;
      const result = await whileStopped({signal: new AbortController().signal});
      down = false;
      return {stopped: node, ...result};
    }});
  assert.equal(result.replacement, 'next');
  assert.equal(result.controllerNode, 'gateway-node');
  assert.equal(result.endpointWithdrawnMs, 50);
  assert.equal(result.handshakeMs, 6750);
  assert.deepEqual([result.receivedBytes, result.sentBytes], [12, 15]);
});

test('a failed public challenge is reported within the machine-stop clock', async t => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const failure = Error('public challenge failed after 403');
  let stopped = false, observed;
  t.mock.method(AbortSignal, 'timeout', ms => timeout(stopped ? 20 : ms));
  const kube = async ([verb, resource, name]) => {
    if (verb === 'exec') return name === '--' ? 'peer\t22\t33' : assert.fail('unexpected command');
    if (resource === 'lease') return JSON.stringify({spec: {holderIdentity:
      name === 'kube-controller-manager' ? 'account-node_id' : stopped ? 'next' : 'old'}});
    if (resource === 'pods') return JSON.stringify({items: ['old', 'next'].map(name =>
      ({metadata: {name}, spec: {nodeName: name + '-node'}}))});
    if (resource === 'endpointslices') return JSON.stringify({items: [{endpoints: [{targetRef: {name: 'next'}}]}]});
    assert.fail('unexpected Kubernetes read');
  };
  const readKube = async args => args.at(-1) === 'latest-handshakes' ? 'peer\t' + Math.floor(Date.now() / 1000) : kube(args);
  await assert.rejects(remoteRehearsal.measureGatewayMachineLoss({
    kube: readKube, accountNode: 'account-node', peer: 'peer',
    checkRoutes: async (_signal, elapsed) => {if (stopped) {observed = elapsed?.(); throw failure;}},
    moveGateway: () => assert.fail('the account node does not hold the Lease'),
    stopNode: async (_node, {whileStopped}) => {
      stopped = true;
      return whileStopped({signal: new AbortController().signal});
    },
  }), {message: 'remote.machine_loss_90_seconds', cause: failure});
  assert.ok(observed >= 0 && observed < 90000);
});

test('the paired venue keeps its endpoint through an elected gateway handover', {
  skip: process.env.TEST_KUBERNETES_REMOTE !== '1' || Boolean(process.env.TEST_CLOUD_INTEGRATION_WAITRON_TUNNEL_IMAGE), timeout: 35 * 60 * 1000,
}, async () => {
  const {remote} = await runKubernetesCheck('kind-remote');
  assert.equal(remote.pairing.persistedRenewal, true);
  for (const key of ['staffHttps', 'publicHttps', 'unknownNameRefused', 'wrongCertificateRefused', 'privatePathRefused']) {
    assert.equal(remote[key], true, key);
  }
  assert.equal(remote.handover.interfaceWithdrawn, true);
  assert.equal(remote.handover.handshake, true);
  assert.ok(remote.handover.durationMs <= 90000);
  assert.ok(remote.certificateReplacementMs <= 180000);
  assert.ok(remote.withdrawalMs <= 180000);
  assert.deepEqual(remote.cleanup.remaining, []);
  console.log('D621 gateway timings (ms)', {handover: remote.handover.durationMs,
    certificateReplacement: remote.certificateReplacementMs, withdrawal: remote.withdrawalMs});
});

test('the paired venue keeps its endpoint when the active gateway machine stops', {
  skip: process.env.TEST_KUBERNETES_REMOTE_MACHINE_LOSS !== '1', timeout: 35 * 60 * 1000,
}, async () => {
  const {remote, nodes} = await runKubernetesCheck('kind-remote', {stopGatewayNode: true});
  const loss = remote.machineLoss, companion = process.env.TEST_CLOUD_INTEGRATION_WAITRON_TUNNEL_IMAGE;
  assert.notEqual(loss.stopped, nodes[0].name);
  assert.ok(nodes.some(node => node.name === loss.controllerNode));
  assert.equal(loss.fixtureTraffic, !companion);
  if (companion) {
    assert.equal(loss.waitronTunnelImage, companion);
    assert.equal(loss.sameWaitronTunnel, true);
  }
  assert.equal(remote.staffHttps, true);
  assert.equal(remote.publicHttps, true);
  assert.equal(loss.rejoinedStandby, true);
  assert.ok(loss.endpointWithdrawnMs <= loss.durationMs);
  assert.ok(loss.durationMs <= 90000);
  assert.deepEqual(remote.cleanup.remaining, []);
  console.log('D621 gateway-machine timings', loss);
});

test('the WireGuard relay forwards replies after the upstream endpoint returns', {timeout: 10000}, async t => {
  const local = '127.0.0.1', destination = createSocket('udp4');
  destination.bind(0, local);
  await once(destination, 'listening');
  const {port: upstreamPort} = destination.address();
  destination.close();
  await once(destination, 'close');
  const relay = spawn(process.execPath, [
    fileURLToPath(new URL('../deploy/kubernetes/remote-relay.mjs', import.meta.url)), local, String(upstreamPort), '0', local,
  ], {stdio: ['ignore', 'pipe', 'inherit']});
  const lines = createInterface({input: relay.stdout}), exited = once(relay, 'exit');
  const client = createSocket('udp4'), replacement = createSocket('udp4');
  t.after(async () => {
    client.close();
    replacement.close();
    lines.close();
    if (relay.exitCode === null && relay.signalCode === null) relay.kill();
    await exited;
  });
  const [line] = await Promise.race([
    once(lines, 'line'), exited.then(() => assert.fail('relay exited before listening')),
  ]);
  const relayPort = Number(line);
  client.send('packet before replacement', relayPort, local);
  const [gap] = await Promise.race([
    once(lines, 'line'),
    exited.then(() => assert.fail('relay exited during the endpoint gap')),
  ]);
  assert.equal(gap, 'remote.relay_endpoint_unavailable');
  replacement.on('message', (bytes, peer) => replacement.send(bytes, peer.port, local));
  replacement.bind(upstreamPort, local);
  await once(replacement, 'listening');
  client.send('packet after replacement', relayPort, local);
  const [response] = await once(client, 'message');
  assert.equal(response.toString(), 'packet after replacement');
});
