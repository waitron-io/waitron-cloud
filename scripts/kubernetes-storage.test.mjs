import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, unlink, writeFile} from 'node:fs/promises';
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
  assert.equal(container.env.find(row => row.name === 'MINIO_DNS_CACHE_TTL')?.value, '1s');
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

test('both serving peers must report four online drives during the outage and six before it', async () => {
  const {waitForStoreDrives} = await import('./kubernetes-storage-proof.mjs');
  const reading = (peer, count, processes = 6) => {
    const server = 'store-' + peer + '.store-peers.d621-store.svc.cluster.local:9000';
    return 'minio_cluster_nodes_online_total{server="' + server + '"} ' + processes + '\n' +
      'minio_cluster_health_erasure_set_online_drives{pool="0",server="' + server + '",set="0"} ' + count;
  };
  const samples = [reading(2, 5), reading(3, 6), reading(2, 6)];
  let timedOut = false;
  await waitForStoreDrives(async () => {
    if (!timedOut) {
      timedOut = true;
      throw Object.assign(Error('storage_loss.peer_metrics_timeout'), {code: 'ETIMEDOUT'});
    }
    return samples.shift();
  }, ['store-2', 'store-3'], AbortSignal.timeout(5000));
  assert.deepEqual(samples, []);

  const afterStop = [reading(2, 5, 4), reading(3, 4, 4), reading(2, 4, 4)];
  assert.equal(await waitForStoreDrives(async () => afterStop.shift(), ['store-2', 'store-3'], AbortSignal.timeout(5000), 4),
    'store-2=4, store-3=4');
  assert.deepEqual(afterStop, []);

  const stop = new AbortController();
  async function short() {
    stop.abort();
    return reading(2, 5);
  }
  await assert.rejects(waitForStoreDrives(short, ['store-2', 'store-3'], stop.signal),
    /store-2=5, store-3=unseen/);
});

const repairEndpoint = {ip: '172.30.250.10'};
const repairAccount = {caPath: '/fixture/store.crt', credentials: {accessKeyId: 'fixture', secretAccessKey: 'synthetic-password'}};

test('bucket repair starts once and polls only its returned token', async () => {
  const {healStoreBucket} = await import('./kubernetes-storage-proof.mjs');
  const replies = [{clientToken: 'fixture:3'}, {Summary: 'running'}, {Summary: 'finished'}];
  const operations = [];
  const run = mockRepair(connectedReports(), async (binary, args, {input}) => {
    assert.equal(binary, 'curl');
    assert.ok(args.includes('--aws-sigv4') && args.includes('--cacert') && args.includes('--config'));
    assert.ok(args.includes('--fail-with-body'), 'keep the store error body on an HTTP failure');
    assert.ok(!args.join(' ').includes('synthetic-password'));
    assert.match(input, /user = "fixture:synthetic-password"/);
    const [, url] = /^url = "([^"]+)"/m.exec(input);
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/minio/admin/v3/heal/cloud-storage-rehearsal');
    operations.push([parsed.search, args[args.indexOf('--data-binary') + 1]]);
    return JSON.stringify(replies.shift());
  });
  await healStoreBucket({node: repairEndpoint, account: repairAccount, returnedPeers, run, signal: AbortSignal.timeout(5000)});
  assert.deepEqual(operations, [
    ['', '{"recursive":true,"dryRun":false,"remove":false,"scanMode":1}'],
    ['?clientToken=fixture%3A3', ''],
    ['?clientToken=fixture%3A3', ''],
  ]);
});

test('the rejoined store retries reported offline shards and refuses exhausting repair attempts', async () => {
  const storage = await import('./kubernetes-storage-proof.mjs');
  for (const reports of [['offline', 'ok'], ['offline', 'offline', 'offline']]) {
    let attempts = 0;
    const run = mockRepair([clusterReport('complete:0'), clusterReport('complete:1')], async (_binary, args) => JSON.stringify(args[args.indexOf('--data-binary') + 1] ?
      {clientToken: 'fixture:' + ++attempts} : {Summary: 'finished',
        Items: [{type: 'object', object: 'fixture-object', after: {drives: [{state: reports[attempts - 1]}]}}]}));
    const repair = () => storage.healRejoinedStore({node: repairEndpoint, account: repairAccount, run,
      signal: AbortSignal.timeout(5000)});
    if (reports.length === 2) assert.equal(await repair(), 2);
    else await assert.rejects(repair, /storage_loss.incomplete_bucket_repair/);
    assert.equal(attempts, reports.length);
  }
});

test('measured rejoin waits for both serving peers to read all six drives before repairing', async () => {
  const {healRejoinedStore} = await import('./kubernetes-storage-proof.mjs');
  for (const comesOnline of [true, false]) {
    const deadline = new AbortController();
    const reports = [
      clusterReport('complete:0'), clusterReport('partial:1', 'offline'),
      ...(comesOnline ? [clusterReport('complete:0'), clusterReport('complete:1')] : []),
    ];
    const writes = [{clientToken: 'repair:1'}, {Summary: 'finished'}];
    const run = mockRepair(reports, async () => JSON.stringify(writes.shift()), () => {
      if (!comesOnline) deadline.abort(new DOMException('test deadline', 'TimeoutError'));
    });
    const repair = () => healRejoinedStore({node: repairEndpoint, account: repairAccount, run, signal: deadline.signal});
    if (comesOnline) {
      assert.equal(await repair(), 1);
      assert.deepEqual(writes, []);
    } else {
      await assert.rejects(repair, error => error.message.includes('peer 1') &&
        error.message.includes(returnedDisk('store-5') + '=offline'));
      assert.equal(writes.length, 2, 'the bucket repair must never start before both serving peers are ready');
    }
  }
});

test('bucket repair exposes a stopped job and an invalid start', async () => {
  const {healStoreBucket} = await import('./kubernetes-storage-proof.mjs');
  for (const [replies, error] of [
    [[{clientToken: 'fixture:3'}, {Summary: 'stopped'}], /storage_loss.heal_stopped/],
    [[{}], /storage_loss.heal_token/],
  ]) {
    const run = mockRepair(connectedReports(), async () => JSON.stringify(replies.shift()));
    await assert.rejects(healStoreBucket({node: repairEndpoint, account: repairAccount, returnedPeers, run,
      signal: AbortSignal.timeout(5000)}), error);
    assert.deepEqual(replies, []);
  }
});

const bucketHealPath = '/minio/admin/v3/heal/cloud-storage-rehearsal';
const returnedPeers = ['store-0', 'store-1'];
const returnedDisk = peer => 'https://' + peer + '.store-peers.d621-store.svc.cluster.local:9000/disk';
const baselineReport = (secondState = 'ok') => ({type: 'object', object: 'repair-probe-baseline', before: {drives: [
  {endpoint: returnedDisk('store-0'), state: 'ok'}, {endpoint: returnedDisk('store-1'), state: secondState},
]}});

const clusterReport = (token, survivingState = 'ok') => ({
  token, replies: [{Summary: 'finished', Items: [{type: 'object', object: 'repair-probe-baseline', before: {
    drives: Array.from({length: 6}, (_, index) => ({
      endpoint: returnedDisk('store-' + index), state: index === 5 ? survivingState : 'ok',
    })),
  }}]}],
});
const connectedReports = () => ['first:2', 'second:3'].map(token =>
  ({token, replies: [{Summary: 'finished', Items: [baselineReport()]}]}));

function mockRepair(probes, repair, onLastProbe = () => {}) {
  const pending = [...probes];
  let current;
  return async (binary, args, {input, signal}) => {
    const [, url] = /^url = "([^"]+)"/m.exec(input);
    const {pathname, searchParams} = new URL(url);
    const body = args[args.indexOf('--data-binary') + 1];
    if (pathname === bucketHealPath) {
      assert.equal(pending.length, 0, 'repair started before every required probe');
      assert.equal(current, undefined, 'repair started before the last probe finished');
      return repair(binary, args, {input, signal});
    }
    assert.equal(pathname, bucketHealPath + '/repair-probe-baseline', 'dry-run target must be the dedicated synthetic probe object');
    const token = searchParams.get('clientToken');
    if (!token) {
      assert.equal(current, undefined, 'another probe started before the prior probe finished');
      assert.deepEqual(JSON.parse(body), {recursive: false, dryRun: true, remove: false, scanMode: 1});
      current = pending.shift();
      assert.ok(current, 'unexpected extra probe');
      return JSON.stringify({clientToken: current.token});
    }
    assert.equal(token, current.token);
    assert.equal(body, '');
    const reply = current.replies.shift();
    if (reply.Summary === 'finished') {
      current = undefined;
      if (!pending.length) onLastProbe();
    }
    return JSON.stringify(reply);
  };
}

test('repair waits for both serving peers to read both returned disks', async () => {
  const {healStoreBucket} = await import('./kubernetes-storage-proof.mjs');
  const reports = [
    ['first:3', [{Summary: 'finished', Items: [baselineReport()]}]],
    ['repeat:3', [{Summary: 'finished', Items: [baselineReport()]}]],
    ['partial:3', [{Summary: 'finished', Items: [baselineReport('offline')]}]],
    ['after-partial:2', [{Summary: 'finished', Items: [baselineReport()]}]],
    ['other:3', [{Summary: 'running', Items: [baselineReport()]}, {Summary: 'finished'}]],
  ].map(([token, replies]) => ({token, replies}));
  const actualRepair = [{clientToken: 'repair:3'}, {Summary: 'finished'}];
  const run = mockRepair(reports, async () => JSON.stringify(actualRepair.shift()));
  await healStoreBucket({node: repairEndpoint, account: repairAccount, returnedPeers, run, signal: AbortSignal.timeout(9000)});
  assert.deepEqual(actualRepair, []);
});

test('repair deadline names the missing data path without starting repair', async () => {
  const {healStoreBucket} = await import('./kubernetes-storage-proof.mjs');
  const deadline = new AbortController();
  const run = mockRepair([{token: 'partial:2', replies: [{Summary: 'finished', Items: [baselineReport('offline')]}]}],
    () => assert.fail('bucket repair started with a disk offline'), () => deadline.abort(new DOMException('test deadline', 'TimeoutError')));
  await assert.rejects(healStoreBucket({node: repairEndpoint, account: repairAccount, returnedPeers, run,
    signal: deadline.signal}), error => error.message.includes('peer 2') &&
      error.message.includes(returnedDisk('store-1') + '=offline'));
});

test('repair paces probes and explains why one report is insufficient', async () => {
  const {healStoreBucket} = await import('./kubernetes-storage-proof.mjs');
  const deadline = new AbortController();
  const run = mockRepair([{token: 'first:2', replies: [{Summary: 'finished', Items: [baselineReport()]}]}],
    () => assert.fail('bucket repair started after just one serving peer reported'),
    () => setTimeout(() => deadline.abort(new DOMException('test deadline', 'TimeoutError')), 100));
  await assert.rejects(healStoreBucket({node: repairEndpoint, account: repairAccount, returnedPeers, run,
    signal: deadline.signal}), /waiting for two complete reports from different serving peers.*peer 2/);
});

test('repair preserves cancellation during the probe wait', async () => {
  const {healStoreBucket} = await import('./kubernetes-storage-proof.mjs');
  const stop = new AbortController();
  const run = mockRepair([{token: 'first:2', replies: [{Summary: 'finished', Items: [baselineReport()]}]}],
    () => assert.fail('bucket repair started after stopping'), () => stop.abort());
  await assert.rejects(healStoreBucket({node: repairEndpoint, account: repairAccount, returnedPeers, run,
    signal: stop.signal}), {name: 'AbortError'});
});

test('repair refuses a probe token without a peer suffix', async () => {
  const {healStoreBucket} = await import('./kubernetes-storage-proof.mjs');
  const run = mockRepair([{token: 'fixture', replies: []}], () => assert.fail('bucket repair started with an invalid token'));
  await assert.rejects(healStoreBucket({node: repairEndpoint, account: repairAccount, returnedPeers, run,
    signal: AbortSignal.timeout(2000)}), /storage_loss\.probe_peer/);
});

test('repair checks metadata and both multipart parts on both disks', async t => {
  const {requireRepairedPieces} = await import('./kubernetes-storage-proof.mjs');
  const temp = await mkdtemp(join(tmpdir(), 'store-shards-test-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  for (const disk of ['0', '1']) {
    const directory = join(temp, disk, 'cloud-storage-rehearsal', 'multipart-0');
    await mkdir(join(directory, 'data-version'), {recursive: true});
    await writeFile(join(directory, 'xl.meta'), 'metadata');
    await writeFile(join(directory, 'data-version', 'part.1'), 'data');
    const ordinary = join(temp, disk, 'cloud-storage-rehearsal', 'outage-0');
    await mkdir(ordinary);
    await writeFile(join(ordinary, 'xl.meta'), 'inline data');
  }
  await writeFile(join(temp, '0/cloud-storage-rehearsal/multipart-0/data-version/part.2'), 'data');
  async function run(binary, [exec, id, shell, flag, script, name, ...args]) {
    assert.deepEqual([binary, exec, id], ['docker', 'exec', 'example-node']);
    const paths = args.map(path => path.replace('/var/local/d621-store', temp));
    const {stdout} = await promisify(execFile)(shell, [flag, script, name, ...paths]);
    return stdout.trim();
  }
  const files = ['outage-0', 'multipart-0'];
  const node = {id: 'example-node'};
  const signal = AbortSignal.timeout(3000);
  await assert.rejects(requireRepairedPieces(run, node, files, signal, 'multipart-0'), /storage_loss.missing_shards/);
  await writeFile(join(temp, '1/cloud-storage-rehearsal/multipart-0/data-version/part.2'), 'data');
  for (const file of ['0/cloud-storage-rehearsal/multipart-0/xl.meta', '1/cloud-storage-rehearsal/outage-0/xl.meta']) {
    const metadata = join(temp, file);
    await unlink(metadata);
    await assert.rejects(requireRepairedPieces(run, node, files, signal, 'multipart-0'), /storage_loss.missing_shards/);
    await writeFile(metadata, 'metadata');
  }
  await requireRepairedPieces(run, node, files, signal, 'multipart-0');
});

test('encrypted bytes, listing and multipart survive the first machine outage and repair', {
  skip: process.env.TEST_KUBERNETES_STOCKHOLM_STORAGE !== '1', timeout: 2_100_000,
}, async () => {
  const child = promisify(execFile)(process.execPath, ['scripts/kubernetes-check.mjs', '--storage-loss'],
    {timeout: 2_000_000, maxBuffer: 2 * 1024 * 1024});
  child.child.stderr.pipe(process.stderr);
  const {stdout} = await child;
  const {storage, nodes} = JSON.parse(stdout);
  assert.equal(storage.stopped, nodes[0].name);
  assert.ok(storage.failoverMs <= 90_000);
  assert.ok(storage.repairMs > 0 && storage.repairMs <= 180_000);
  console.log(JSON.stringify(storage));
});
