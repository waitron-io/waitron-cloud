import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {stockholmStoreResources} from './kubernetes-storage.mjs';

test('store reserves six private volumes, two from each machine, for specific peers', async () => {
  const nodes = ['stockholm-a', 'stockholm-b', 'stockholm-c'];
  const items = stockholmStoreResources(nodes, 'local:store');
  const store = items.find(row => row.kind === 'StatefulSet');
  const pod = store.spec.template.spec;
  const [container] = pod.containers;
  assert.equal(store.spec.replicas, 6);
  assert.equal(store.spec.podManagementPolicy, 'Parallel');
  assert.equal(container.image, 'local:store');
  assert.equal(container.imagePullPolicy, 'Never');
  assert.deepEqual(container.readinessProbe.httpGet, {scheme: 'HTTPS', path: '/minio/health/cluster', port: 'https'});
  assert.equal(pod.securityContext.runAsUser, 10001);
  assert.equal(pod.automountServiceAccountToken, false);
  assert.equal(pod.topologySpreadConstraints[0].whenUnsatisfiable, 'DoNotSchedule');
  assert.equal(pod.topologySpreadConstraints[0].topologyKey, 'kubernetes.io/hostname');
  assert.ok(container.args.join(' ').includes('--certs-dir /certs'));
  assert.ok(container.volumeMounts.some(row => row.name === 'certs' && row.mountPath === '/certs' && row.readOnly));
  assert.ok(container.env.some(row => row.name === 'MINIO_STORAGE_CLASS_STANDARD' && row.value === 'EC:3'));
  const services = items.filter(row => row.kind === 'Service');
  const peer = services.find(row => row.metadata.name === store.spec.serviceName);
  assert.equal(peer.spec.clusterIP, 'None');
  assert.equal(peer.spec.publishNotReadyAddresses, true);
  const api = services.find(row => row.spec.type === 'NodePort');
  assert.equal(api.spec.externalTrafficPolicy, 'Local');
  assert.equal(api.spec.publishNotReadyAddresses ?? false, false);
  const paths = [];
  const placements = [];
  const claimTemplate = store.spec.volumeClaimTemplates[0].metadata.name;
  for (let index = 0; index < 6; index++) {
    const claim = items.find(row => row.kind === 'PersistentVolumeClaim' &&
      row.metadata.name === claimTemplate + '-' + store.metadata.name + '-' + index);
    const volume = items.find(row => row.kind === 'PersistentVolume' && row.metadata.name === claim.spec.volumeName);
    assert.deepEqual(volume.spec.claimRef, {name: claim.metadata.name, namespace: 'd621-store'});
    assert.equal(volume.spec.persistentVolumeReclaimPolicy, 'Retain');
    const [match] = volume.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions;
    assert.equal(match.key, 'kubernetes.io/hostname');
    assert.equal(match.operator, 'In');
    placements.push(match.values[0]);
    paths.push(volume.spec.local.path);
  }
  assert.deepEqual(placements, ['stockholm-a', 'stockholm-a', 'stockholm-b', 'stockholm-b', 'stockholm-c', 'stockholm-c']);
  assert.deepEqual(paths, ['/var/local/d621-store/0', '/var/local/d621-store/1',
    '/var/local/d621-store/0', '/var/local/d621-store/1', '/var/local/d621-store/0', '/var/local/d621-store/1']);
});

test('multipart upload refuses a part response without the requested encryption', async () => {
  const {startMultipart} = await import('./kubernetes-storage-proof.mjs');
  const encrypted = {SSECustomerAlgorithm: 'AES256', SSECustomerKeyMD5: 'test-key-digest'};
  const send = async Command => Command.name === 'CreateMultipartUploadCommand' ?
    {UploadId: 'synthetic-upload'} : {ETag: 'synthetic-part'};
  await assert.rejects(startMultipart({send}, 'example', encrypted, AbortSignal.timeout(2000)),
    /storage_loss.multipart_encryption/);
});

test('repair waits for both survivor peers to reconnect before reading', async () => {
  const {waitForRepairPeers} = await import('./kubernetes-storage-proof.mjs');
  assert.equal(typeof waitForRepairPeers, 'function', 'repair must wait for the store view');
  const reading = (peer, count) =>
    'minio_cluster_nodes_online_total{server="store-' + peer + '.store-peers.d621-store.svc.cluster.local:9000"} ' + count;
  const samples = [reading(2, 5), reading(3, 6), reading(2, 6)];
  await waitForRepairPeers(async () => samples.shift(), ['store-2', 'store-3'], AbortSignal.timeout(5000));
  assert.deepEqual(samples, []);

  const stop = new AbortController();
  async function short() {
    stop.abort();
    return reading(2, 5);
  }
  await assert.rejects(waitForRepairPeers(short, ['store-2', 'store-3'], stop.signal),
    /store-2=5, store-3=unseen/);
});

test('repair checks both disks for actual multipart data files', async t => {
  const {waitForPieces} = await import('./kubernetes-storage-proof.mjs');
  const temp = await mkdtemp(join(tmpdir(), 'store-shards-test-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  for (const disk of ['0', '1']) {
    const directory = join(temp, disk, 'cloud-storage-rehearsal', 'multipart-0');
    await mkdir(join(directory, 'data-version'), {recursive: true});
    await writeFile(join(directory, 'xl.meta'), 'metadata');
    await writeFile(join(directory, 'data-version', 'part.1'), 'data');
  }
  await writeFile(join(temp, '0/cloud-storage-rehearsal/multipart-0/data-version/part.2'), 'data');
  const controller = new AbortController();
  async function run(binary, [exec, id, shell, flag, script, name, ...args]) {
    assert.deepEqual([binary, exec, id], ['docker', 'exec', 'example-node']);
    const paths = args.map(path => path.replace('/var/local/d621-store', temp));
    const {stdout} = await promisify(execFile)(shell, [flag, script, name, ...paths]);
    if (!stdout) controller.abort();
    return stdout.trim();
  }
  const files = ['multipart-0'];
  const node = {id: 'example-node'};
  await assert.rejects(waitForPieces(run, node, files, controller.signal, 'multipart-0'), {name: 'AbortError'});
  await writeFile(join(temp, '1/cloud-storage-rehearsal/multipart-0/data-version/part.2'), 'data');
  await waitForPieces(run, node, files, AbortSignal.timeout(2000), 'multipart-0');
});

test('encrypted bytes, listing and multipart survive each machine loss and repair', {
  skip: process.env.TEST_KUBERNETES_STOCKHOLM_STORAGE !== '1', timeout: 2_100_000,
}, async () => {
  const child = promisify(execFile)(process.execPath, ['scripts/kubernetes-check.mjs', '--storage-loss'],
    {timeout: 2_000_000, maxBuffer: 2 * 1024 * 1024});
  child.child.stderr.pipe(process.stderr);
  const {stdout} = await child;
  const {storage: {legs}} = JSON.parse(stdout);
  assert.equal(legs.length, 4);
  assert.equal(new Set(legs.map(leg => leg.stopped)).size, 3);
  assert.equal(legs[0].stopped, legs[3].stopped);
  assert.ok(legs.every(leg => leg.failoverMs <= 90_000 && leg.repairMs <= 180_000));
  console.log(JSON.stringify(legs));
});
