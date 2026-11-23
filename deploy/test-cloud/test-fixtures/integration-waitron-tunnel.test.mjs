import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import * as client from './integration-paid-remote-client.mjs';
import * as remote from './integration-paid-remote.mjs';

for (const pingWorks of [true, false]) {
  test(`the fixture ${pingWorks ? 'starts measured stops' : 'refuses measured stops'} when loopback ping ${pingWorks ? 'works' : 'fails'}`, async () => {
    let stops = 0;
    const traffic = [];
    const refused = Error('integration.command_failed:remote-ping-tool');
    const docker = async (args, input, phase) => {
      assert.equal(input, '');
      if (phase === 'remote-ping-tool') {
        assert.deepEqual(args, ['exec', 'peer', 'ping', '-n', '-I', 'lo', '-c', '1', '-W', '1', '127.0.0.1']);
        if (!pingWorks) throw refused;
        return;
      }
      traffic.push({args, phase});
    };
    const measure = () => remote.measureWithVenuePeer({docker, peerId: 'peer',
      peer: {peerPublicKey: 'paired', gatewayAddress: '10.77.4.1'}, target: {machineLoss: async () => {
        stops++;
        return {stopped: 'old'};
      }}});
    if (pingWorks) assert.deepEqual(await measure(), {stopped: 'old', fixtureTraffic: true});
    else await assert.rejects(measure, error => error === refused);
    assert.equal(stops, pingWorks ? 1 : 0);
    assert.deepEqual(traffic, pingWorks ? [{phase: 'remote-venue-packet',
      args: ['exec', 'peer', 'ping', '-n', '-I', 'wg-cloud', '-c', '1', '-W', '1', '10.77.4.1']}] : []);
  });
}

test('the Waitron companion uses the venue key and its own traffic', async t => {
  const root = await mkdtemp(join(tmpdir(), 'waitron-tunnel-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, 'wireguard.key'), 'synthetic paired key', {mode: 0o600});
  assert.equal(typeof client.stageWaitronTunnel, 'function', 'the companion inputs must be staged');
  await client.stageWaitronTunnel(root, {address: '10.77.4.2', gatewayPublicKey: 'synthetic gateway key'}, '172.30.250.7');
  assert.equal(await readFile(join(root, 'keys/private-key'), 'utf8'), 'synthetic paired key');
  assert.equal((await stat(join(root, 'keys/private-key'))).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'control/peer.json'), 'utf8')),
    {address: '10.77.4.2', gatewayPublicKey: 'synthetic gateway key', endpoint: '172.30.250.7:51820'});

  const calls = [], image = 'sha256:' + 'b'.repeat(64);
  let ifindex = 12, started = 'true original';
  const docker = async args => {
    calls.push(args);
    if (args[0] === 'create') return 'companion';
    if (args[0] === 'inspect') return started;
    if (args.includes('public-key')) return 'paired';
    if (args.includes('link')) return JSON.stringify([{ifindex}]);
    if (args[0] === 'start') return '';
    assert.fail('unexpected Docker call: ' + args.slice(0, 4).join(' '));
  };
  const paid = {id: 'venue', stateVolume: 'venue-state', venueRoot: '/tmp/cloud-integration-state/paid'};
  const peerId = await remote.startRemotePeer({docker, paid, runId: 'owner', own: () => {}, waitronTunnelImage: image});
  const measureCompanion = machineLoss => remote.measureWithVenuePeer({docker, peerId, peer: {peerPublicKey: 'paired'},
    waitronTunnelImage: image, target: {machineLoss}});
  const result = await measureCompanion(async () => ({stopped: 'old'}));
  assert.deepEqual(calls[0].slice(-5), [
    '--mount', 'type=volume,src=venue-state,dst=/control,volume-subpath=paid/remote-peer/control',
    '--mount', 'type=volume,src=venue-state,dst=/keys,volume-subpath=paid/remote-peer/keys', image,
  ]);
  assert.equal(calls[0].includes('container:venue'), true);
  assert.equal(calls[0].includes('NET_ADMIN'), true);
  assert.equal(calls.some(args => args.includes('ping')), false);
  assert.equal(result.fixtureTraffic, false);

  const replaced = {code: 'ERR_ASSERTION', message: /^integration\.waitron_tunnel_replaced\b/};
  await assert.rejects(measureCompanion(async () => {
    ifindex = 13;
    return {stopped: 'old'};
  }), replaced);
  await assert.rejects(measureCompanion(async () => {
    started = 'true restarted';
    return {stopped: 'old'};
  }), replaced);
});
