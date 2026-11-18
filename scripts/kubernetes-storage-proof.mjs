import assert from 'node:assert/strict';
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Agent, get} from 'node:https';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {BackupObjects} from '../packages/backups/src/storage.ts';
import {bufferObject} from '../packages/backups/src/object-transfer.ts';
import {installStockholmStore, storeBuildArgs, storeNodePort, storePath, waitForStore} from './kubernetes-storage.mjs';

const require = createRequire(new URL('../packages/backups/package.json', import.meta.url));
const {
  S3Client, CreateBucketCommand, PutBucketVersioningCommand, GetBucketVersioningCommand, ListObjectsV2Command,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
const bucket = 'cloud-storage-rehearsal';

function storageClient({ip}, {ca, credentials}) {
  const location = {endpoint: 'https://' + ip + ':' + storeNodePort, region: 'us-east-1', bucket};
  const client = new S3Client({...location, credentials, forcePathStyle: true, maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {httpsAgent: new Agent({ca})}});
  const send = (Command, args, signal) => client.send(new Command({Bucket: bucket, ...args}), {abortSignal: signal});
  return {objects: new BackupObjects(location, credentials, ca), send, close: () => client.destroy()};
}

async function readObject({objects}, name, key, signal) {
  const object = await objects.stage(name, key, {signal, maxBytes: 10 * 1024 * 1024});
  try {
    const chunks = [];
    for await (const chunk of object.open()) chunks.push(chunk);
    return Buffer.concat(chunks);
  } finally {
    await object.dispose();
  }
}

function storeMetrics(ip, {ca, credentials}, signal) {
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

export async function waitForPieces(run, node, keys, signal, multipart) {
  // A read can succeed from the other four drives before the returned drives have healed.
  const disks = ['0', '1'].map(slot => storePath + '/' + slot + '/' + bucket);
  const metadata = disks.flatMap(disk => keys.map(key => disk + '/' + key + '/xl.meta'));
  const parts = disks.map(disk => disk + '/' + multipart);
  const check = `
    first=$1; second=$2; shift 2
    for file; do [ -s "$file" ] || exit 0; done
    for object in "$first" "$second"; do
      for version in "$object"/*; do
        if [ -s "$version/part.1" ] && [ -s "$version/part.2" ]; then continue 2; fi
      done
      exit 0
    done
    echo repaired
  `;
  for (;;) {
    const result = await run('docker', ['exec', node.id, 'sh', '-ec', check, 'store', ...parts, ...metadata], {signal});
    if (result === 'repaired') return;
    await delay(1000, undefined, {signal});
  }
}

export async function runKubernetesStorage({nodes, cluster, directory, run, kube, stopNode, signal}) {
  const image = cluster + ':store', names = nodes.map(node => node.name), clients = new Map();
  const bootstrap = await readFile(new URL('../deploy/kubernetes/bounded-amazon/bootstrap.sh', import.meta.url), 'utf8');
  let failure;
  try {
    process.stderr.write('Building pinned private store image\n');
    await run('docker', storeBuildArgs(image), {timeout: 900_000});
    await run('kind', ['load', 'docker-image', '--name', cluster, image], {timeout: 180_000});
    for (const node of nodes) {
      await run('docker', ['exec', '-i', node.id, 'bash', '-s', '--', 'object-storage'], {input: bootstrap});
    }
    process.stderr.write('Waiting for all six store peers\n');
    const account = await installStockholmStore({nodes: names, addresses: nodes.map(node => node.ip), image, directory, run, kube, signal});
    nodes.forEach(node => clients.set(node.name, storageClient(node, account)));
    const waitForDrives = (machine, drives, deadline) => {
      const ordinal = names.indexOf(machine.name) * 2;
      return waitForStoreDrives(requestSignal => storeMetrics(machine.ip, account, requestSignal),
        ['store-' + ordinal, 'store-' + (ordinal + 1)], deadline, drives);
    };
    const first = clients.get(names[0]), ready = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    await waitForDrives(nodes[0], 6, ready);
    await first.send(CreateBucketCommand, {}, ready);
    await first.send(PutBucketVersioningCommand, {VersioningConfiguration: {Status: 'Enabled'}}, ready);
    assert.equal((await first.send(GetBucketVersioningCommand, {}, ready)).Status, 'Enabled');

    const key = randomBytes(32).toString('base64'), wrongKey = randomBytes(32).toString('base64');
    const encrypted = {SSECustomerAlgorithm: 'AES256', SSECustomerKey: key,
      SSECustomerKeyMD5: createHash('md5').update(Buffer.from(key, 'base64')).digest('base64')};
    const old = new Map([['baseline', randomBytes(512)]]);
    await first.objects.putStaged('baseline', bufferObject(old.get('baseline')), key, {signal: ready});
    const legs = [];
    for (const [index, node] of [...nodes, nodes[0]].entries()) {
      const name = 'outage-' + index, multipart = 'multipart-' + index, bytes = randomBytes(512);
      const uploadLimit = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
      await waitForDrives(nodes[0], 6, uploadLimit);
      const upload = await startMultipart(first, multipart, encrypted, uploadLimit);
      const survivorNodes = nodes.filter(machine => machine.name !== node.name);
      const survivors = survivorNodes.map(machine => clients.get(machine.name));
      const [client] = survivors;
      const survivor = survivorNodes[0];
      const leg = await stopNode(node.name, {whileStopped: async ({signal: stopped}) => {
        // MinIO must see the four surviving drives before it can assess a multipart write.
        const peerCounts = await waitForDrives(survivor, 4, stopped);
        process.stderr.write('Store drives after stop on ' + survivor.name + ' (' + peerCounts + ')\n');
        for (const survivor of survivors) {
          assert.deepEqual(await readObject(survivor, 'baseline', key, stopped), old.get('baseline'));
        }
        for (const [object, expected] of old) {
          if (object !== 'baseline') assert.deepEqual(await readObject(client, object, key, stopped), expected, object);
        }
        await client.objects.putStaged(name, bufferObject(bytes), key, {signal: stopped});
        assert.deepEqual(await readObject(client, name, key, stopped), bytes, name);
        await assert.rejects(readObject(client, name, wrongKey, stopped), error => error.$metadata?.httpStatusCode === 403);
        await finishMultipart(client, upload, encrypted, stopped);
        assert.deepEqual(await readObject(client, multipart, key, stopped), upload.bytes, multipart);
        await assert.rejects(readObject(client, multipart, wrongKey, stopped), error => error.$metadata?.httpStatusCode === 403);
        const listed = await client.send(ListObjectsV2Command, {}, stopped);
        assert.deepEqual(listed.Contents.map(row => row.Key).sort(), [...old.keys(), name, multipart].sort());
      }});
      old.set(name, bytes);
      old.set(multipart, upload.bytes);
      const repairStart = performance.now(), repair = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
      process.stderr.write('Checking store repair after rejoin ' + node.name + '\n');
      try {
        await waitForStore({nodes: names, kube, signal: repair});
        const peerCounts = await waitForDrives(survivor, 6, repair);
        process.stderr.write('Store drives online after rejoin on ' + survivor.name + ' (' + peerCounts + ')\n');
        // A survivor has the acknowledged bytes while the returned volumes are still missing them.
        assert.deepEqual(await readObject(client, name, key, repair), bytes, name);
        assert.deepEqual(await readObject(client, multipart, key, repair), upload.bytes, multipart);
        await waitForPieces(run, node, [name, multipart], repair, multipart);
        const returned = clients.get(node.name);
        assert.deepEqual(await readObject(returned, name, key, repair), bytes, name);
        assert.deepEqual(await readObject(returned, multipart, key, repair), upload.bytes, multipart);
      } catch (error) {
        throw Error('storage_loss.repair on ' + node.name + ': ' + error.message, {cause: error});
      }
      const repairMs = Math.round(performance.now() - repairStart);
      process.stderr.write('Confirmed returned shards on ' + node.name + ' in ' + repairMs + ' ms\n');
      legs.push({...leg, repairMs});
    }
    return {legs};
  } catch (error) {
    failure = error;
    const pods = await kube(['-n', 'd621-store', 'get', 'pods', '-o', 'wide'], {signal: null}).catch(String);
    process.stderr.write('Store pods:\n' + pods + '\n');
    throw error;
  } finally {
    for (const client of clients.values()) client.close();
    if (await run('docker', ['image', 'inspect', image], {signal: null}).catch(() => '')) {
      try {await run('docker', ['image', 'rm', image], {signal: null});}
      catch (error) {
        if (!failure) throw error;
        throw new AggregateError([failure, error], failure.message + '; store image cleanup failed');
      }
    }
  }
}
