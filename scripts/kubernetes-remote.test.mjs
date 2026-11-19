import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {createSocket} from 'node:dgram';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {runKubernetesCheck} from './kubernetes-check.mjs';

test('the paired venue keeps its endpoint through an elected gateway handover', {
  skip: process.env.TEST_KUBERNETES_REMOTE !== '1', timeout: 35 * 60 * 1000,
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
