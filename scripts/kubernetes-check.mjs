// Local only: prebuild the existing Cloud and pinned Waitron images, then run
// TEST_CLOUD_INTEGRATION_IMAGE=sha256:… TEST_CLOUD_INTEGRATION_WAITRON_IMAGE=sha256:… node scripts/kubernetes-check.mjs
// Requires kind 0.31.0, kubectl 1.34.3 and Docker with Buildx (the venue build uses RUN --network=none). This deletes only its newly created kind cluster.
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runTestCloudClients} from './test-cloud-integration.mjs';
const cluster = 'd620-' + randomUUID(), forwards = [];
const directory = await mkdtemp(join(tmpdir(), 'cloud-kubernetes-'));
const env = {...process.env, KUBECONFIG: join(directory, 'kubeconfig')};
const tag = cluster + ':cloud', image = process.env.TEST_CLOUD_INTEGRATION_IMAGE;
let created = false, tagged = false, result;
const stop = new AbortController(), shutdown = () => stop.abort();
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
async function run(binary, args, input, cleanup = false) {
  if (!cleanup) stop.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, {env, timeout: 180000, maxBuffer: 2 * 1024 * 1024,
      ...(cleanup ? {} : {signal: stop.signal})}, (error, stdout) => error ? reject(Error('kubernetes.command_failed:' + binary + ':' + (args[0] === '--context' ? args[4] : args[0]))) : resolve(stdout.trim()));
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
const kube = (args, input) => run('kubectl', ['--context', 'kind-' + cluster, '--namespace', 'default', ...args], input);
const pod = async role => {
  const rows = JSON.parse(await kube(['get', 'pods', '-l', 'app=' + role, '-o', 'json'])).items;
  assert.equal(rows.length, 1, 'kubernetes.replica_count');
  assert.equal(rows[0].spec.nodeName, cluster + '-control-plane', 'kubernetes.node_binding');
  return rows[0];
};
const exec = async (role, args, input) => kube(['exec', '-i', (await pod(role === 'account' ? 'cloud' : role)).metadata.name,
  '-c', role, '--', ...args], input);
async function forward(role, ports) {
  const name = (await pod(role)).metadata.name;
  const child = spawn('kubectl', ['--context', 'kind-' + cluster, '--namespace', 'default', 'port-forward', '--address', '127.0.0.1', 'pod/' + name,
    ...ports.map(port => ':' + port)], {env, stdio: ['ignore', 'pipe', 'pipe']});
  const closed = new Promise(resolve => child.once('close', resolve)); forwards.push({child, closed});
  return new Promise((resolve, reject) => {
    const found = {}, timer = setTimeout(() => reject(Error('kubernetes.forward_timeout')), 15000);
    child.once('error', () => {clearTimeout(timer); reject(Error('kubernetes.forward_failed'));});
    child.once('close', () => {clearTimeout(timer); reject(Error('kubernetes.forward_closed'));});
    child.stdout.on('data', part => {
      for (const match of String(part).matchAll(/127\.0\.0\.1:(\d+) -> (\d+)/g)) found[match[2]] = Number(match[1]);
      if (ports.every(port => found[port])) {clearTimeout(timer); resolve(found);}
    }); child.stderr.resume();
  });
}
try {
  assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.match(process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.match(await run('kind', ['version']), /v0\.31\.0/);
  assert.equal(JSON.parse(await run('kubectl', ['version', '--client', '-o', 'json'])).clientVersion.gitVersion, 'v1.34.3');
  await run('docker', ['tag', image, tag]); tagged = true;
  created = true;
  process.stderr.write('Creating owned local Kubernetes cluster\n');
  await run('kind', ['create', 'cluster', '--name', cluster, '--image', 'kindest/node:v1.34.3@sha256:08497ee19eace7b4b5348db5c6a1591d7752b164530a36f855cb0f2bdcbadd48', '--wait', '120s']);
  await run('kind', ['load', 'docker-image', '--name', cluster, tag]);
  const node = JSON.parse(await run('docker', ['inspect', cluster + '-control-plane']))[0];
  const address = node.NetworkSettings.Networks.kind.IPAddress;
  assert.match(address, /^(?:\d{1,3}\.){3}\d{1,3}$/);
  const manifest = JSON.parse((await readFile(new URL('../deploy/kubernetes/local-checks.yaml', import.meta.url), 'utf8')).replaceAll('CLOUD_IMAGE', tag));
  const proxy = (await readFile(new URL('../deploy/test-cloud/proxy.cfg', import.meta.url), 'utf8'))
    .replace('bind :3000', 'bind :3443').replace('server account account:3000', 'server account 127.0.0.1:3000');
  manifest.items.push({apiVersion: 'v1', kind: 'ConfigMap', metadata: {name: 'proxy'}, data: {'proxy.cfg': proxy}});
  await kube(['apply', '-f', '-'], JSON.stringify(manifest));
  await kube(['wait', '--for=condition=Ready', 'pod/cloud', '--timeout=180s']);
  await kube(['rollout', 'status', 'deployment/manifest', '--timeout=120s']);
  await kube(['wait', '--for=condition=Ready', 'pod/gateway', '--timeout=120s']);
  const core = await pod('cloud');
  assert.ok(core.spec.containers.filter(row => row.name !== 'mailpit').every(row => row.image === tag), 'kubernetes.image_binding');
  const ports = await forward('cloud', [3443, 8025]), gatewayPorts = await forward('gateway', [443]);
  const ca = await exec('account', ['cat', '/run/local-stack/lan/ca.pem']);
  const remote = {gatewayIp: address, port: gatewayPorts[443], worker: async action => {
    if (action === 'time') return (await pod('manifest')).status.containerStatuses[0].state.running.startedAt;
    assert.ok(['stop', 'start'].includes(action));
    await kube(['scale', 'deployment/manifest', '--replicas=' + (action === 'stop' ? 0 : 1)]);
    if (action === 'stop') await kube(['wait', '--for=delete', 'pod', '-l', 'app=manifest', '--timeout=30s']);
    else await kube(['rollout', 'status', 'deployment/manifest', '--timeout=60s']);
  }};
  process.stderr.write('Running native signup, pairing and remote-access journey against Kubernetes\n');
  result = await runTestCloudClients({image, waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE, freeRemote: true, paidRemote: true,
    kubernetes: {cluster, namespace: 'default', account: 'kube-account', ca, network: 'kind', proxyIp: address,
      port: ports[3443], mailPort: ports[8025], exec, remote}});
} catch (error) {
  if (created && !stop.signal.aborted) {try {process.stderr.write(await kube(['get', 'pods', '--request-timeout=5s']) + '\n');} catch {}}
  throw error;
} finally {
  for (const {child, closed} of forwards) {child.kill('SIGKILL'); await closed;}
  try {
    if (created) {
      await run('kind', ['delete', 'cluster', '--name', cluster], undefined, true);
      assert.equal(await run('docker', ['ps', '-aq', '--filter', 'label=io.x-k8s.kind.cluster=' + cluster], undefined, true), '', 'kubernetes.node_remains');
      if (result) result.kubernetes.removed = true;
    }
  } finally {
    if (tagged) await run('docker', ['image', 'rm', tag], undefined, true);
    await rm(directory, {recursive: true, force: true});
    process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);
  }
}
process.stdout.write(JSON.stringify(result) + '\n');
