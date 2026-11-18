import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
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
  assert.equal(pod.securityContext.runAsUser, 10001);
  assert.equal(pod.automountServiceAccountToken, false);
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
