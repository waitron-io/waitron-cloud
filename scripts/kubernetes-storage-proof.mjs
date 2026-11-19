import assert from 'node:assert/strict';
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Agent, get} from 'node:https';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {BackupObjects} from '../packages/backups/src/storage.ts';
import {bufferObject} from '../packages/backups/src/object-transfer.ts';
import {installStockholmStore, storeBuildArgs, storeNodePort} from './kubernetes-storage.mjs';

const require = createRequire(new URL('../packages/backups/package.json', import.meta.url));
const {
  S3Client, CreateBucketCommand, PutBucketVersioningCommand, GetBucketVersioningCommand, ListObjectsV2Command,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
export const storageBucket = 'cloud-storage-rehearsal';

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

export async function withStockholmStore({nodes, cluster, directory, run, kube, signal}, verify, openId) {
  const image = cluster + ':store';
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

async function proveStockholmStorage({nodes, stopNode, signal}, account) {
  const names = nodes.map(node => node.name), clients = new Map();
  try {
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
    const baseline = randomBytes(512), bytes = randomBytes(512);
    await first.objects.putStaged('baseline', bufferObject(baseline), key, {signal: ready});
    const name = 'outage-0', multipart = 'multipart-0';
    const uploadLimit = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    await waitForDrives(nodes[0], 6, uploadLimit);
    const upload = await startMultipart(first, multipart, encrypted, uploadLimit);
    const [node, ...survivorNodes] = nodes;
    const survivors = survivorNodes.map(machine => clients.get(machine.name));
    const [client] = survivors, [survivor] = survivorNodes;
    return await stopNode(node.name, {whileStopped: async ({signal: stopped}) => {
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
      assert.deepEqual(listed.Contents.map(row => row.Key).sort(), ['baseline', multipart, name]);
    }});
  } finally {
    for (const client of clients.values()) client.close();
  }
}
