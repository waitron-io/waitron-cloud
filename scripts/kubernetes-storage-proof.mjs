import assert from 'node:assert/strict';
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Agent, get} from 'node:https';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {BackupObjects} from '../packages/backups/src/storage.ts';
import {bufferObject} from '../packages/backups/src/object-transfer.ts';
import {installStockholmStore, storeBuildArgs, storeDiskEndpoint, storeNodePort, storePath, waitForStore} from './kubernetes-storage.mjs';

const require = createRequire(new URL('../packages/backups/package.json', import.meta.url));
const {
  S3Client, CreateBucketCommand, PutBucketVersioningCommand, GetBucketVersioningCommand, ListObjectsV2Command,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
export const storageBucket = 'cloud-storage-rehearsal';
const repairProbeObject = 'repair-probe-baseline';

export function storageClient({ip}, {ca, credentials}, bucket = storageBucket) {
  const location = {endpoint: 'https://' + ip + ':' + storeNodePort, region: 'us-east-1', bucket};
  const client = new S3Client({...location, credentials, forcePathStyle: true, maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {httpsAgent: new Agent({ca})}});
  const send = (Command, args, signal) => client.send(new Command({Bucket: bucket, ...args}), {abortSignal: signal});
  const objects = new BackupObjects(location, credentials, ca);
  return {objects, send, close() {objects.close(); client.destroy();}};
}

export async function readObject({objects}, name, key, signal) {
  const object = await objects.stage(name, key, {signal, maxBytes: 10 * 1024 * 1024});
  try {
    const chunks = [];
    for await (const chunk of object.open()) chunks.push(chunk);
    return Buffer.concat(chunks);
  } finally {
    await object.dispose();
  }
}

export function storeMetrics(ip, {ca, credentials}, signal) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const {accessKeyId, secretAccessKey} = credentials;
  const payload = encode({alg: 'HS512', typ: 'JWT'}) + '.' +
    encode({iss: 'prometheus', sub: accessKeyId, exp: Math.floor(Date.now() / 1000) + 300});
  const token = payload + '.' + createHmac('sha512', secretAccessKey).update(payload).digest('base64url');
  const endpoint = 'https://' + ip + ':' + storeNodePort + '/minio/v2/metrics/cluster';
  return new Promise((resolve, reject) => {
    // A fresh connection can reach either of the two peers on this machine.
    const request = get(endpoint, {ca, agent: false, signal, headers: {Authorization: 'Bearer ' + token}}, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(Error('storage_loss.peer_metrics HTTP ' + response.statusCode));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {body += chunk;});
      response.once('end', () => resolve(body));
      response.once('error', reject);
    });
    request.setTimeout(5000, () => request.destroy(Object.assign(Error('storage_loss.peer_metrics_timeout'), {code: 'ETIMEDOUT'})));
    request.once('error', reject);
  });
}

export async function waitForStoreDrives(read, expected, signal, drives = 6) {
  const counts = new Map(expected.map(peer => [peer, 'unseen']));
  const summary = () => [...counts].map(([peer, count]) => peer + '=' + count).join(', ');
  try {
    while ([...counts.values()].some(count => count !== drives)) {
      signal.throwIfAborted();
      const text = await read(signal).catch(error => {
        if (error.code !== 'ETIMEDOUT' || signal.aborted) throw error;
        process.stderr.write('Store drive metrics request timed out (' + summary() + ')\n');
        return null;
      });
      if (text !== null) {
        const metric = /^minio_cluster_health_erasure_set_online_drives\{pool="0",server="(store-[0-5])\.store-peers\.d621-store\.svc\.cluster\.local:9000",set="0"\} (\d+)$/m.exec(text);
        assert.ok(metric && counts.has(metric[1]), 'storage_loss.unexpected_peer_metric');
        counts.set(metric[1], Number(metric[2]));
      }
      if ([...counts.values()].some(count => count !== drives)) await delay(1000, undefined, {signal});
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    throw Error('storage_loss.expected ' + drives + ' online drives (' + summary() + ')', {cause: error});
  }
  return summary();
}

async function uploadEncryptedPart(send, args, encrypted, signal) {
  const part = await send(UploadPartCommand, {...args, ...encrypted}, signal);
  assert.ok(part.ETag, 'storage_loss.multipart_part_etag');
  assert.ok(part.SSECustomerAlgorithm === encrypted.SSECustomerAlgorithm &&
    part.SSECustomerKeyMD5 === encrypted.SSECustomerKeyMD5, 'storage_loss.multipart_encryption');
  return part.ETag;
}

export async function startMultipart({send}, Key, encrypted, signal) {
  const first = randomBytes(5 * 1024 * 1024), last = randomBytes(512);
  const {UploadId} = await send(CreateMultipartUploadCommand, {Key, ...encrypted}, signal);
  assert.ok(UploadId, 'storage_loss.multipart_id');
  const ETag = await uploadEncryptedPart(send, {Key, UploadId, PartNumber: 1, Body: first}, encrypted, signal);
  return {Key, UploadId, ETag, last, bytes: Buffer.concat([first, last])};
}

async function finishMultipart({send}, {Key, UploadId, ETag, last}, encrypted, signal) {
  const first = {PartNumber: 1, ETag};
  const complete = second => send(CompleteMultipartUploadCommand,
    {Key, UploadId, MultipartUpload: {Parts: [first, {PartNumber: 2, ETag: second}]}, ...encrypted}, signal);
  await assert.rejects(complete(ETag), {name: 'InvalidPart'});
  const second = await uploadEncryptedPart(send, {Key, UploadId, PartNumber: 2, Body: last}, encrypted, signal);
  const done = await complete(second);
  assert.ok(done.VersionId && done.VersionId !== 'null', 'storage_loss.multipart_version');
}

export async function runStoreHeal({node, account, run, signal}, dryRun) {
  // MinIO can delete a dangling version during a dry run. Probe only the dedicated fixture.
  const path = '/minio/admin/v3/heal/' + storageBucket + (dryRun ? '/' + repairProbeObject : '');
  const url = new URL(path, 'https://' + node.ip + ':' + storeNodePort);
  const {accessKeyId, secretAccessKey} = account.credentials;
  const post = async body => {
    signal.throwIfAborted();
    const hash = createHash('sha256').update(body).digest('hex');
    const output = await run('curl', ['--disable', '--silent', '--show-error', '--fail-with-body', '--noproxy', '*',
      '--aws-sigv4', 'aws:amz:us-east-1:s3', '--cacert', account.caPath, '--request', 'POST',
      '--header', 'Content-Type: application/json', '--header', 'x-amz-content-sha256: ' + hash,
      '--data-binary', body, '--config', '-'], {
      input: 'url = "' + url.href + '"\nuser = "' + accessKeyId + ':' + secretAccessKey + '"\n',
      signal, timeout: 180_000,
    });
    try {return JSON.parse(output);}
    catch {throw Error('storage_loss.heal_reply');}
  };
  const started = await post(JSON.stringify({recursive: !dryRun, dryRun, remove: false, scanMode: 1}));
  assert.ok(typeof started?.clientToken === 'string' && started.clientToken, 'storage_loss.heal_token');
  const peer = dryRun ? /:([0-9]+)$/.exec(started.clientToken)?.[1] : undefined;
  if (dryRun) assert.ok(peer, 'storage_loss.probe_peer');
  url.searchParams.set('clientToken', started.clientToken);
  const items = [];
  for (;;) {
    const reply = await post('');
    for (const item of reply?.Items ?? []) {
      if (item.type !== 'object') continue;
      if (dryRun) {
        if (item.object === repairProbeObject) items.push(item);
      } else {
        const states = phase => (phase?.drives ?? []).map(drive => drive.state).join(', ');
        process.stderr.write('Store healed ' + item.object + ' (' + states(item.before) + ') to (' + states(item.after) + ')\n');
      }
    }
    if (reply?.Summary === 'finished') return {peer, items};
    assert.notEqual(reply?.Summary, 'stopped', 'storage_loss.heal_stopped');
    assert.ok(reply?.Summary === 'running' || reply?.Summary === 'not started', 'storage_loss.heal_status');
    await delay(1000, undefined, {signal});
  }
}

export async function healStoreBucket({returnedPeers, ...request}) {
  const endpoints = returnedPeers.map(storeDiskEndpoint);
  let lastProbe = 'no completed probe for ' + endpoints.join(', ');
  try {
    let previousPeer;
    for (;;) {
      const {peer, items} = await runStoreHeal(request, true);
      const drives = items.length === 1 ? items[0].before?.drives ?? [] : [];
      const states = endpoints.map(endpoint => {
        const matching = drives.filter(drive => drive.endpoint === endpoint);
        return matching.length === 1 ? matching[0].state : 'unreported';
      });
      lastProbe = 'peer ' + peer + ': ' + endpoints.map((endpoint, index) => endpoint + '=' + states[index]).join(', ');
      process.stderr.write('Store repair probe ' + lastProbe + '\n');
      // Either local serving peer can receive the bucket repair through the NodePort.
      const complete = states.every(state => state === 'ok');
      if (complete && previousPeer && peer !== previousPeer) break;
      previousPeer = complete ? peer : undefined;
      await delay(1000, undefined, {signal: request.signal});
    }
  } catch (error) {
    if (request.signal.reason?.name !== 'TimeoutError') throw error;
    throw Error('storage_loss.probe_deadline waiting for two complete reports from different serving peers. Last report: ' + lastProbe,
      {cause: error});
  }
  await runStoreHeal(request, false);
}

export async function requireRepairedPieces(run, node, keys, signal, multipart) {
  // A read can succeed from the other four drives before the returned drives have healed.
  const disks = ['0', '1'].map(slot => storePath + '/' + slot + '/' + storageBucket);
  const metadata = disks.flatMap(disk => keys.map(key => disk + '/' + key + '/xl.meta'));
  const parts = disks.map(disk => disk + '/' + multipart);
  const check = `
    first=$1; second=$2; shift 2
    for file; do [ -s "$file" ] || { echo "$file"; exit 0; }; done
    for object in "$first" "$second"; do
      for version in "$object"/*; do
        if [ -s "$version/part.1" ] && [ -s "$version/part.2" ]; then continue 2; fi
      done
      echo "$object (multipart parts)"
      exit 0
    done
    echo repaired
  `;
  const result = await run('docker', ['exec', node.id, 'sh', '-ec', check, 'store', ...parts, ...metadata], {signal});
  if (result !== 'repaired') throw Error('storage_loss.missing_shards ' + result);
}

export async function withStockholmStore({nodes, cluster, directory, run, kube, signal}, verify, openId) {
  const image = cluster + ':store';
  const bootstrap = await readFile(new URL('../deploy/kubernetes/bounded-amazon/bootstrap.sh', import.meta.url), 'utf8');
  let failure;
  try {
    process.stderr.write('Building pinned private store image\n');
    const buildOptions = openId ? ['--build-arg', 'WAITRON_GRANT_TIMING=1'] : [];
    await run('docker', storeBuildArgs(image, buildOptions), {timeout: 900_000});
    await run('kind', ['load', 'docker-image', '--name', cluster, image], {timeout: 180_000});
    for (const node of nodes) {
      await run('docker', ['exec', '-i', node.id, 'bash', '-s', '--', 'object-storage'], {input: bootstrap});
    }
    process.stderr.write('Waiting for all six store peers\n');
    const account = await installStockholmStore({nodes: nodes.map(node => node.name),
      addresses: nodes.map(node => node.ip), image, directory, run, kube, signal, openId});
    return await verify(account);
  } catch (error) {
    failure = error;
    const pods = await kube(['-n', 'd621-store', 'get', 'pods', '-o', 'wide'], {signal: null}).catch(String);
    process.stderr.write('Store pods:\n' + pods + '\n');
    throw error;
  } finally {
    if (await run('docker', ['image', 'inspect', image], {signal: null}).catch(() => '')) {
      try {await run('docker', ['image', 'rm', image], {signal: null});}
      catch (error) {
        if (!failure) throw error;
        throw new AggregateError([failure, error], failure.message + '; store image cleanup failed');
      }
    }
  }
}

export function runKubernetesStorage(context) {
  return withStockholmStore(context, account => proveStockholmStorage(context, account));
}

async function proveStockholmStorage({nodes, run, kube, stopNode, signal}, account) {
  const names = nodes.map(node => node.name), clients = new Map();
  try {
    nodes.forEach(node => clients.set(node.name, storageClient(node, account)));
    const peersOn = machine => {
      const ordinal = names.indexOf(machine.name) * 2;
      return ['store-' + ordinal, 'store-' + (ordinal + 1)];
    };
    const waitForDrives = (machine, drives, deadline) =>
      waitForStoreDrives(requestSignal => storeMetrics(machine.ip, account, requestSignal), peersOn(machine), deadline, drives);
    const first = clients.get(names[0]), ready = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    await waitForDrives(nodes[0], 6, ready);
    await first.send(CreateBucketCommand, {}, ready);
    await first.send(PutBucketVersioningCommand, {VersioningConfiguration: {Status: 'Enabled'}}, ready);
    assert.equal((await first.send(GetBucketVersioningCommand, {}, ready)).Status, 'Enabled');

    const key = randomBytes(32).toString('base64'), wrongKey = randomBytes(32).toString('base64');
    const encrypted = {SSECustomerAlgorithm: 'AES256', SSECustomerKey: key,
      SSECustomerKeyMD5: createHash('md5').update(Buffer.from(key, 'base64')).digest('base64')};
    const baseline = randomBytes(512), bytes = randomBytes(512);
    await first.objects.putStaged('baseline', bufferObject(baseline), key, {signal: ready});
    await first.objects.putStaged(repairProbeObject, bufferObject(randomBytes(512)), key, {signal: ready});
    const name = 'outage-0', multipart = 'multipart-0';
    const uploadLimit = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    await waitForDrives(nodes[0], 6, uploadLimit);
    const upload = await startMultipart(first, multipart, encrypted, uploadLimit);
    const [node, ...survivorNodes] = nodes;
    const survivors = survivorNodes.map(machine => clients.get(machine.name));
    const [client] = survivors, [survivor] = survivorNodes;
    let rejoinSince;
    const leg = await stopNode(node.name, {whileStopped: async ({signal: stopped}) => {
      // MinIO must see the four surviving drives before it can assess a multipart write.
      const driveCounts = await waitForDrives(survivor, 4, stopped);
      process.stderr.write('Store drives after stop on ' + survivor.name + ' (' + driveCounts + ')\n');
      for (const survivingClient of survivors) {
        assert.deepEqual(await readObject(survivingClient, 'baseline', key, stopped), baseline);
      }
      await client.objects.putStaged(name, bufferObject(bytes), key, {signal: stopped});
      assert.deepEqual(await readObject(client, name, key, stopped), bytes, name);
      await assert.rejects(readObject(client, name, wrongKey, stopped), error => error.$metadata?.httpStatusCode === 403);
      await finishMultipart(client, upload, encrypted, stopped);
      assert.deepEqual(await readObject(client, multipart, key, stopped), upload.bytes, multipart);
      await assert.rejects(readObject(client, multipart, wrongKey, stopped), error => error.$metadata?.httpStatusCode === 403);
      const listed = await client.send(ListObjectsV2Command, {}, stopped);
      assert.deepEqual(listed.Contents.map(row => row.Key).sort(), ['baseline', multipart, name, repairProbeObject]);
      rejoinSince = new Date().toISOString();
    }});
    const repairStart = performance.now(), repair = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
    process.stderr.write('Checking store repair after rejoin ' + node.name + '\n');
    try {
      await waitForStore({nodes: names, kube, signal: repair});
      const driveCounts = await waitForDrives(survivor, 6, repair);
      process.stderr.write('Store drives online after rejoin on ' + survivor.name + ' (' + driveCounts + ')\n');
      await healStoreBucket({node: survivor, account, returnedPeers: peersOn(node), run, signal: repair});
      await requireRepairedPieces(run, node, [name, multipart], repair, multipart);
      assert.deepEqual(await readObject(first, name, key, repair), bytes, name);
      assert.deepEqual(await readObject(first, multipart, key, repair), upload.bytes, multipart);
    } catch (error) {
      for (const pod of peersOn(survivor)) {
        const log = await kube(['-n', 'd621-store', 'logs', pod, '--timestamps', '--since-time=' + rejoinSince],
          {signal: null}).catch(() => '');
        const connections = log.split('\n').filter(line => /re-connected in |drive ID mismatch/.test(line));
        if (connections.length) process.stderr.write('Store data connections on ' + pod + ':\n' + connections.join('\n') + '\n');
      }
      throw Error('storage_loss.repair on ' + node.name + ': ' + error.message, {cause: error});
    }
    const repairMs = Math.round(performance.now() - repairStart);
    process.stderr.write('Confirmed returned shards on ' + node.name + ' in ' + repairMs + ' ms\n');
    return {...leg, repairMs};
  } finally {
    for (const client of clients.values()) client.close();
  }
}
