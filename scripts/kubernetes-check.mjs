// Local only: prebuild the existing Cloud and pinned Waitron images, then run
// TEST_CLOUD_INTEGRATION_IMAGE=sha256:… TEST_CLOUD_INTEGRATION_WAITRON_IMAGE=sha256:… node scripts/kubernetes-check.mjs
// Requires kind 0.31.0, kubectl 1.34.3 and Docker with Buildx (the venue build uses RUN --network=none). This deletes only its newly created kind cluster.
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {runTestCloudClients, parseIntegrationJson} from './test-cloud-integration.mjs';
export async function loadVerifierImage(image, kubeArgs, env, signal) {
  signal?.throwIfAborted();
  const exporter = spawn('docker', ['save', image], {env, signal, stdio: ['ignore', 'pipe', 'pipe']});
  const importer = spawn('kubectl', kubeArgs, {env, signal, stdio: ['pipe', 'pipe', 'pipe']});
  const children = [exporter, importer], exits = children.map(child => new Promise(resolve => {
    child.once('error', () => {}); child.once('close', resolve); child.stderr.resume();
  }));
  importer.stdout.resume();
  const timer = setTimeout(() => {for (const child of children) child.kill('SIGKILL');}, 180000);
  try {
    await pipeline(exporter.stdout, importer.stdin, {signal});
    assert.ok((await Promise.all(exits)).every(code => code === 0), 'kubernetes.verifier_image_load');
  } catch {throw Error('kubernetes.verifier_image_load');}
  finally {clearTimeout(timer); for (const child of children) child.kill('SIGKILL'); await Promise.all(exits);}
}

export function createKubernetesVerifier({template, kube, pod, loadImage}) {
  const status = async () => (await pod('verifier')).status.containerStatuses.find(row => row.name === 'verifier').state;
  const exec = args => kube(['exec', '-i', 'pod/verifier', '-c', 'verifier', '--', ...args]);
  return {
    async start(pointId, {image, revision}) {
      assert.ok(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(pointId) &&
        /^sha256:[a-f0-9]{64}$/.test(image) && /^[a-f0-9]{40}$/.test(revision), 'kubernetes.verifier_binding');
      const value = structuredClone(template), worker = value.spec.containers.find(row => row.name === 'verifier');
      value.spec.hostAliases[0].ip = (await pod('cloud')).status.podIP;
      const environment = {CLOUD_INTEGRATION_POINT_ID: pointId, CLOUD_VERIFIER_IMAGE: image, CLOUD_INTEGRATION_WAITRON_REVISION: revision};
      for (const row of worker.env) if (Object.hasOwn(environment, row.name)) row.value = environment[row.name];
      await kube(['apply', '-f', '-'], JSON.stringify(value));
      await kube(['wait', '--for=condition=Ready', 'pod/verifier', '--timeout=180s']);
      await loadImage(image);
      return 'kube-verifier';
    },
    identity: async () => parseIntegrationJson(await exec(['cat', '/run/backup-verifier/verifier-controller/identity.json'])),
    docker: args => kube(['exec', '-i', 'pod/verifier', '-c', 'docker', '--', 'docker', ...args]),
    running: async () => Boolean((await status()).running),
    async stop() {
      await exec(['node', '-e', 'process.kill(1,"SIGTERM")']);
      await kube(['wait', '--for=jsonpath={.status.containerStatuses[?(@.name=="verifier")].state.terminated}', 'pod/verifier', '--timeout=15s']);
    },
    exitCode: async () => String((await status()).terminated?.exitCode),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
  const verifierTemplate = manifest.items.find(item => item.metadata.name === 'verifier');
  manifest.items = manifest.items.filter(item => item !== verifierTemplate);
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
  const verifier = createKubernetesVerifier({template: verifierTemplate, kube, pod,
    loadImage: id => loadVerifierImage(id, ['--context', 'kind-' + cluster, '--namespace', 'default', 'exec', '-i',
      'pod/verifier', '-c', 'docker', '--', 'docker', 'load'], env, stop.signal)});
  result = await runTestCloudClients({image, waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE, freeRemote: true, paidRemote: true, paidVerification: true,
    kubernetes: {cluster, namespace: 'default', account: 'kube-account', ca, network: 'kind', proxyIp: address,
      port: ports[3443], mailPort: ports[8025], exec, remote, verifier}});
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
}
