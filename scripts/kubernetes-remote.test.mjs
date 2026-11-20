import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {createSocket} from 'node:dgram';
import {EventEmitter, once} from 'node:events';
import {createConnection, createServer} from 'node:net';
import {createInterface} from 'node:readline';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {runKubernetesCheck} from './kubernetes-check.mjs';
import * as remoteRehearsal from './kubernetes-remote.mjs';

test('publication workers start away from the account and database primary and use different machines', async t => {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), 'cloud-remote-workers-'));
  t.after(() => rm(runtimeDirectory, {recursive: true, force: true}));
  await mkdir(join(runtimeDirectory, 'public-certs'));
  for (const file of ['gateway-issuer.pem', 'gateway-signing-key.pem', 'gateway-wireguard.key', 'gateway-manifest.json',
    'gateway-bot.key', 'public-certs/default.pem']) await writeFile(join(runtimeDirectory, file), 'fixture');
  const placed = Error('worker manifest captured'), placement = [];
  await assert.rejects(remoteRehearsal.startRemoteRehearsal({
    context: {nodes: ['account-node', 'database-node', 'worker-node'].map(name => ({name}))}, tag: 'owned:cloud',
    async kube(args) {
      if (args[1] === 'clusters.postgresql.cnpg.io') return JSON.stringify({status: {currentPrimary: 'cloud-db-1'}});
      if (args[1] === 'pod') {
        assert.equal(args[2], 'cloud-db-1');
        return JSON.stringify({spec: {nodeName: 'database-node'}});
      }
      placement.push(args.join(' '));
    },
    settings: {config: {gateway: {cellId: 'fixture-cell'}}, tls: {root: 'root', caKey: 'key'}, runtimeDirectory},
    async create(value) {
      if (value.metadata?.name !== 'remote-worker') return;
      assert.equal(value.kind, 'Deployment');
      assert.equal(value.spec.replicas, 1);
      assert.deepEqual(placement, ['taint nodes database-node waitron.cloud/publication-primary=held:NoSchedule']);
      const {affinity} = value.spec.template.spec;
      assert.deepEqual(affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms,
        [{matchExpressions: [{key: 'kubernetes.io/hostname', operator: 'NotIn', values: ['account-node']}]}]);
      assert.deepEqual(affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution,
        [{labelSelector: {matchLabels: {app: 'remote-worker'}}, topologyKey: 'kubernetes.io/hostname'}]);
      throw placed;
    },
  }), error => error === placed);
  assert.deepEqual(placement, [
    'taint nodes database-node waitron.cloud/publication-primary=held:NoSchedule',
    'taint nodes database-node waitron.cloud/publication-primary:NoSchedule-',
  ]);
});

for (const withdrawal of [undefined, 'before probes', 'after probes']) {
  test(withdrawal ? 'publication connectivity refuses DNS withdrawal ' + withdrawal :
    'publication connectivity probes both survivors while the dead DNS replica is advertised', async () => {
    assert.equal(typeof remoteRehearsal.measurePublicationConnectivity, 'function', 'publication must check connectivity during the stop');
    let snapshots = 0, apiDisconnected = false;
    const probes = [];
    const check = () => remoteRehearsal.measurePublicationConnectivity({
      originalNode: 'stopped-node', primaryNode: 'primary-node', survivingWorker: 'survivor', signal: AbortSignal.timeout(3000),
      async kube(args) {
        const [verb, resource] = args;
        if (verb === 'get' && resource === 'endpointslices') {
          const ready = [{nodeName: 'primary-node', conditions: {ready: true}}];
          if (args.includes('kubernetes.io/service-name=kube-dns')) {
            snapshots++;
            if (withdrawal !== 'before probes') ready.push({
              nodeName: 'stopped-node', conditions: {ready: withdrawal !== 'after probes' || snapshots === 1},
            });
          }
          return JSON.stringify({items: [{endpoints: ready}]});
        }
        assert.equal(verb, 'exec');
        assert.equal(snapshots, 1, 'run probes between endpoint snapshots');
        if (!withdrawal && resource === 'cloud-services' && !apiDisconnected) {
          apiDisconnected = true;
          throw Error('kubectl exec failed\nerror: EOF');
        }
        probes.push([resource, args[3]]);
        return JSON.stringify({lookupMs: Array(10).fill(2), connectionMs: 5});
      },
    });
    if (withdrawal) {
      await assert.rejects(check(), /stopped DNS replica already withdrawn/);
      assert.equal(probes.length, withdrawal === 'before probes' ? 0 : 2);
    } else {
      assert.deepEqual(Object.keys(await check()).sort(), ['account', 'worker']);
      assert.deepEqual(probes.sort(), [['cloud-services', 'account'], ['survivor', 'worker']]);
      assert.equal(snapshots, 2);
    }
  });
}

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
  let now = 100, down = false, rejoined = false, slices = 0, standbyLeaseReads = 0, standbyChecks = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Date, 'now', () => 1_000_250);
  const pod = (name, nodeName) => ({metadata: {name}, spec: {nodeName},
    status: {conditions: [{type: 'Ready', status: 'True'}]}});
  const lease = name => JSON.stringify({spec: {holderIdentity: name + ':session'}});
  const kube = async args => {
    const [verb, resource, name] = args;
    if (verb === 'get' && resource === 'lease') {
      if (name === 'kube-controller-manager') return lease('gateway-node_controller');
      if (rejoined) return lease(++standbyLeaseReads === 1 ? 'old' : 'next');
      return lease(down ? 'next' : 'old');
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
      if (++standbyChecks === 1) throw Error('old gateway still has its tunnel interface');
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
      rejoined = true;
      return {stopped: node, ...result};
    }});
  assert.equal(result.replacement, 'next');
  assert.equal(result.controllerNode, 'gateway-node');
  assert.equal(result.endpointWithdrawnMs, 50);
  assert.equal(result.handshakeMs, 6750);
  assert.equal(standbyLeaseReads, 3, 'the rebooted gateway must also give up the Lease');
  assert.equal(standbyChecks, 2, 'the rebooted gateway must pass the standby check before recovery completes');
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
  const {remote, nodes} = await runKubernetesCheck('kind-remote');
  assert.equal(remote.pairing.persistedRenewal, true);
  for (const key of ['staffHttps', 'publicHttps', 'unknownNameRefused', 'wrongCertificateRefused', 'privatePathRefused']) {
    assert.equal(remote[key], true, key);
  }
  assert.equal(remote.handover.interfaceWithdrawn, true);
  assert.equal(remote.handover.handshake, true);
  assert.ok(remote.handover.durationMs <= 90000);
  assert.ok(remote.certificateReplacementMs <= 180000);
  assert.ok(remote.withdrawalMs <= 180000);
  const loss = remote.publicationMachineLoss;
  assert.equal(loss.stopped, loss.originalNode);
  assert.equal(new Set([nodes[0].name, loss.stopped, loss.survivingNode]).size, 3);
  assert.ok(nodes.some(node => node.name === loss.databasePrimaryNode));
  assert.notEqual(loss.databasePrimaryNode, loss.stopped);
  assert.ok(loss.withdrawnSequence > loss.originalSequence);
  for (const connectivity of [loss.connectivity.account, loss.connectivity.worker]) {
    assert.equal(connectivity.lookupMs.length, 10);
    assert.ok(connectivity.lookupMs.every(ms => ms <= 2000));
    assert.ok(connectivity.connectionMs <= 5000);
  }
  assert.ok(loss.failoverMs <= 90000);
  assert.deepEqual(remote.cleanup.remaining, []);
  console.log('D621 gateway timings (ms)', {handover: remote.handover.durationMs,
    handoverFixtureTraffic: 'one venue packet every five seconds',
    certificateReplacement: remote.certificateReplacementMs, withdrawal: remote.withdrawalMs,
    publicationMachineLoss: loss});
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

test('the same relay ports follow a changed address and then fail over to another node', {timeout: 15000}, async t => {
  const local = '127.0.0.1';
  const backend = async name => {
    const tcp = createServer(socket => socket.once('data', bytes => socket.end(name + ':' + bytes)));
    let udp;
    async function bindUdp(port = 0) {
      udp = createSocket('udp4');
      udp.on('message', (bytes, peer) => udp.send(name + ':' + bytes, peer.port, peer.address));
      udp.bind(port, local);
      await once(udp, 'listening');
    }
    async function closeUdp() {
      const closed = once(udp, 'close');
      udp.close();
      udp = undefined;
      await closed;
    }
    tcp.listen(0, local);
    t.after(() => {tcp.close(); udp?.close();});
    await Promise.all([once(tcp, 'listening'), bindUdp()]);
    return {tcp, ports: {tcp: tcp.address().port, udp: udp.address().port}, bindUdp, closeUdp};
  };
  const [original, replacement, standby] = await Promise.all(['original', 'replacement', 'standby'].map(backend));
  const preload = `
    import dns from 'node:dns';
    import {Socket} from 'node:dgram';
    import net from 'node:net';
    import {syncBuiltinESMExports} from 'node:module';
    const backends = ${JSON.stringify({
      '192.0.2.1': original.ports, '192.0.2.2': replacement.ports, '192.0.2.3': standby.ports,
    })};
    const local = ${JSON.stringify(local)};
    let primary = '192.0.2.1', hangNextLookup = false;
    process.on('message', address => {
      primary = address;
      hangNextLookup = true;
      process.send('updated');
    });
    const lookup = dns.lookup;
    dns.lookup = (name, options, done) => {
      if (name === 'node-first') return done(null, primary, 4);
      if (name === 'node-second') return done(null, '192.0.2.3', 4);
      if (name === 'node-third') {
        process.send('check');
        if (hangNextLookup) {hangNextLookup = false; return;}
        return done(Object.assign(Error('unavailable'), {code: 'ENOTFOUND'}));
      }
      return lookup(name, options, done);
    };
    const connectTcp = net.createConnection;
    net.createConnection = (options, connected) => {
      const ports = backends[options.host];
      if (ports) options = {...options, host: local, port: ports.tcp};
      return connectTcp(options, connected);
    };
    const connectUdp = Socket.prototype.connect;
    Socket.prototype.connect = function (port, address, connected) {
      const ports = backends[address === 'node-first' ? primary : address];
      return ports ? connectUdp.call(this, ports.udp, local, connected) : connectUdp.call(this, port, address, connected);
    };
    syncBuiltinESMExports();
  `;
  const relay = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload),
    fileURLToPath(new URL('../deploy/kubernetes/remote-relay.mjs', import.meta.url)),
    'node-first', '31820', '0', local, '0', 'node-second', 'node-third',
  ], {stdio: ['ignore', 'pipe', 'inherit', 'ipc']});
  const lines = createInterface({input: relay.stdout}), exited = once(relay, 'exit');
  const client = createSocket('udp4'), events = new EventEmitter();
  relay.on('message', event => events.emit(event));
  t.after(async () => {
    client.close();
    lines.close();
    if (relay.exitCode === null && relay.signalCode === null) relay.kill();
    await exited;
  });
  const [line] = await Promise.race([
    once(lines, 'line'), exited.then(() => assert.fail('relay exited before listening')),
  ]);
  const {tcp, udp} = JSON.parse(line);
  assert.ok(tcp > 0 && udp > 0, 'the relay opens a TCP and a UDP listener');

  async function verifyUdp(expected, signal) {
    const reply = once(client, 'message', {signal});
    client.send('WireGuard', udp, local);
    const [datagram] = await reply;
    assert.equal(datagram.toString(), expected + ':WireGuard');
  }
  const verifyReplies = expected => remoteRehearsal.untilRemote(async () => {
    const signal = AbortSignal.timeout(200);
    const socket = createConnection({host: local, port: tcp, signal}, () => socket.write('staff'));
    try {
      const [data] = await once(socket, 'data', {signal});
      assert.equal(data.toString(), expected + ':staff');
      await verifyUdp(expected, signal);
      return true;
    } finally {socket.destroy();}
  }, 6000, t.signal, 'relay_reply_' + expected);

  await verifyReplies('original');
  await original.closeUdp();
  const gap = once(lines, 'line', {signal: t.signal});
  client.send('WireGuard while the endpoint is down', udp, local);
  assert.deepEqual(await gap, ['remote.relay_endpoint_unavailable']);
  await original.bindUdp(original.ports.udp);
  await verifyReplies('original');

  const updated = once(events, 'updated', {signal: t.signal});
  relay.send('192.0.2.2');
  await updated;
  await verifyReplies('replacement');

  await Promise.all([replacement, standby].map(node => new Promise(resolve => node.tcp.close(resolve))));
  const checked = () => once(events, 'check', {signal: t.signal});
  for (let check = 0; check < 4; check++) await checked();
  await verifyUdp('replacement', AbortSignal.timeout(500));

  standby.tcp.listen(standby.ports.tcp, local);
  await once(standby.tcp, 'listening');
  await checked();
  await checked();
  await verifyUdp('replacement', AbortSignal.timeout(500));
  await verifyReplies('standby');
});

test('outside relay keeps the client-facing address and uses only the three mesh node addresses upstream', async () => {
  const id = 'a'.repeat(64), calls = [];
  assert.equal(typeof remoteRehearsal.startRemoteRelay, 'function');
  const relay = await remoteRehearsal.startRemoteRelay({cluster: 'private-proof', tag: 'cloud:proof', outside: true,
    nodes: ['a', 'b', 'c'].map(name => ({name})), run: async (binary, args, options) => {
      calls.push([binary, args, options]);
      if (args[0] === 'create') return id;
      if (args[0] === 'inspect') return '172.30.250.8';
    }});
  assert.equal(relay.gatewayIp, '172.30.250.8');
  assert.deepEqual(calls[0][1].slice(-8), ['deploy/kubernetes/remote-relay.mjs', '10.77.0.1',
    '31820', '51820', '0.0.0.0', '30443', '10.77.0.2', '10.77.0.3']);
  assert.equal(calls[0][1][calls[0][1].indexOf('--network') + 1], 'private-proof');
  await relay.close();
  assert.deepEqual(calls.at(-1), ['docker', ['rm', '-f', id], {signal: null}]);
});

test('the outside service relay binds account and store separately from the gateway', async () => {
  const calls = [];
  await remoteRehearsal.startRemoteRelay({cluster: 'private-proof', tag: 'cloud:proof',
    outside: true, services: true, nodes: ['a', 'b', 'c'].map(name => ({name})),
    run: async (_binary, args) => {
      calls.push(args);
      if (args[0] === 'create') return 'a'.repeat(64);
      if (args[0] === 'inspect') return '172.30.250.8';
    }});
  assert.deepEqual(calls[0].slice(-4), ['10.77.0.2', '10.77.0.3', '--tcp=3000:3000', '--tcp=9000:30900']);
});

test('the next available control plane is selected after an API failure', async () => {
  assert.equal(typeof remoteRehearsal.selectSurvivingNode, 'function');
  const probes = [];
  const found = await remoteRehearsal.selectSurvivingNode(['a', 'b', 'c'], async node => {
    probes.push(node);
    if (node === 'a') throw Error('SSH disconnected');
    return node === 'b' ? 'ok' : 'unexpected';
  });
  assert.equal(found, 'b');
  assert.deepEqual(probes, ['a', 'b']);
  await assert.rejects(remoteRehearsal.selectSurvivingNode(['a', 'b', 'c'], async () => 'not ready'),
    /remote\.no_surviving_control_plane/);
});

test('a service port does not depend on the gateway or the other service port', {timeout: 10000}, async t => {
  const listen = async label => {
    const server = createServer(socket => socket.once('data', () => socket.end(label)));
    server.listen(0, '127.0.0.1');
    t.after(() => server.close());
    await once(server, 'listening');
    return server;
  };
  const [account, storage] = await Promise.all([listen('account on B'), listen('storage on C')]);
  const preload = `
    import net from 'node:net';
    import {syncBuiltinESMExports} from 'node:module';
    const targets = {'192.0.2.2:3000': ${account.address().port}, '192.0.2.3:30900': ${storage.address().port}};
    const connect = net.createConnection;
    net.createConnection = (options, listener) => {
      const port = targets[options.host + ':' + options.port];
      return connect(port ? {...options, host: '127.0.0.1', port} : {path: '/nonexistent-private-relay.sock'}, listener);
    };
    syncBuiltinESMExports();
  `;
  const relay = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload),
    fileURLToPath(new URL('../deploy/kubernetes/remote-relay.mjs', import.meta.url)),
    '192.0.2.1', '31820', '0', '127.0.0.1', '0', '192.0.2.2', '192.0.2.3', '--tcp=0:3000', '--tcp=0:30900',
  ], {stdio: ['ignore', 'pipe', 'inherit']});
  const lines = createInterface({input: relay.stdout}), exited = once(relay, 'exit');
  t.after(async () => {lines.close(); relay.kill(); await exited;});
  const [line] = await once(lines, 'line', {signal: t.signal});
  const ports = JSON.parse(line).services;
  assert.equal(ports?.length, 2);
  const read = port => new Promise((resolve, reject) => {
    const socket = createConnection({host: '127.0.0.1', port}, () => socket.end('probe'));
    const chunks = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
  await remoteRehearsal.untilRemote(async () => {
    const result = await Promise.all(ports.map(read));
    assert.deepEqual(result, ['account on B', 'storage on C']);
    return true;
  }, 3000, t.signal, 'service_relay');
});

test('the outside Kind network drops traffic to the private API port and carries Flux and signed remote HTTPS', {
  skip: process.env.TEST_KUBERNETES_OUTSIDE_NETWORK !== '1', timeout: 40 * 60 * 1000,
}, async () => {
  assert.equal(process.platform, 'linux');
  const {installFlux, fluxImages, prepareFluxBundle, startOutsideFluxMirror} = await import('./kubernetes-git.mjs');
  const {meshNodeAddress, startKindOutsideMesh} = await import('./kubernetes-outside.mjs');
  let checked, cleaned;
  const {remote} = await runKubernetesCheck('kind-remote', {stopGatewayNode: true, async prepareOutside(context, tag) {
    const {cluster, directory, nodes, run, kube, signal, waitronImage} = context;
    const execute = (binary, args, input, cleanup) => run(binary, args, {input, signal: cleanup ? null : signal, timeout: 180000});
    const accountPid = await run('docker', ['inspect', '--type=container', '--format={{.State.Pid}}', nodes[0].id]);
    assert.match(accountPid, /^[1-9][0-9]*$/);
    const mesh = await startKindOutsideMesh(context);
    let flux;
    const close = async () => {
      try {await flux?.close();}
      finally {await mesh.close();}
      await assert.rejects(run('ip', ['link', 'show', 'dev', mesh.interfaceName], {signal: null}), /does not exist/);
      cleaned = true;
    };
    try {
      assert.equal(await run('curl', ['-fsS', '--retry', '4', '--retry-delay', '1', '--retry-max-time', '8', '--max-time', '2',
        '--cacert', join(directory, 'services-ca.crt'),
        '--resolve', 'cloud.example.test:3000:10.77.0.1', 'https://cloud.example.test:3000/api/health/ready']),
      '{"status":"ready"}');
      for (const [index, node] of nodes.entries()) {
        await run('curl', ['-fsS', '--max-time', '10', '--cacert', join(directory, 'store.crt'),
          '--connect-to', node.ip + ':30900:' + meshNodeAddress(index) + ':30900',
          'https://' + node.ip + ':30900/minio/health/cluster']);
      }
      await kube(['get', '--raw=/readyz']);
      const countDrops = async () => {
        const rules = await run('nsenter', ['-t', accountPid, '-n', 'iptables', '-t', 'mangle', '-nvxL', 'D618-OUTSIDE']);
        return Number(rules.match(/^\s*(\d+)\s+\d+\s+DROP\s/m)?.[1]);
      };
      const before = await countDrops();
      await assert.rejects(run('curl', ['-kfsS', '--connect-timeout', '2', 'https://10.77.0.1:6443/readyz']), /failed \(28,/);
      assert.ok(await countDrops() > before, 'the node filter dropped the private API request');
      const path = await prepareFluxBundle(directory, cluster, {run: execute, node: nodes[0].name});
      for (const {upstream, tag: name} of fluxImages(cluster)) {
        await run('docker', ['pull', upstream], {timeout: 180000});
        await run('docker', ['tag', upstream, name]);
        try {await run('kind', ['load', 'docker-image', '--name', cluster, name], {timeout: 180000});}
        finally {await run('docker', ['image', 'rm', name], {signal: null});}
      }
      const labels = {app: 'manifest'};
      flux = await installFlux({name: cluster, image: waitronImage, run: execute, controllersPath: path, signal,
        baselineNode: nodes[2].name, mirror: options => startOutsideFluxMirror({...options, interfaceName: mesh.interfaceName}),
        kube: (args, input, cleanup, requestSignal) => kube(args, {input, signal: cleanup ? null : requestSignal ?? signal}),
        deployment: {apiVersion: 'apps/v1', kind: 'Deployment', metadata: {name: 'manifest'}, spec: {
          selector: {matchLabels: labels}, template: {metadata: {labels}, spec: {nodeName: nodes[2].name,
            containers: [{name: 'manifest', image: tag, imagePullPolicy: 'Never', command: ['sleep', '3600']}]}}}}});
      checked = true;
      return {close};
    } catch (error) {
      try {await close();}
      catch (cleanup) {throw new AggregateError([error, cleanup], error.message + '; ' + cleanup.message);}
      throw error;
    }
  }});
  assert.equal(checked, true, 'the real mesh carried account, store and Flux traffic');
  assert.equal(cleaned, true, 'the outside host interface was removed');
  assert.equal(remote.staffHttps, true);
  assert.equal(remote.publicHttps, true);
  assert.deepEqual(remote.cleanup.remaining, []);
});

test('outside network setup is bound to the private Kind remote rehearsal', async () => {
  let prepared = false;
  await assert.rejects(runKubernetesCheck('unknown-target', {prepareOutside: async () => {prepared = true;}}),
    {message: 'kubernetes.outside_network_target'});
  assert.equal(prepared, false);
});
