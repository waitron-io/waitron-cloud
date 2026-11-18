import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Agent} from 'node:https';
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

async function startMultipart({send}, Key, encrypted, signal) {
  const first = randomBytes(5 * 1024 * 1024), last = randomBytes(512);
  const {UploadId} = await send(CreateMultipartUploadCommand, {Key, ...encrypted}, signal);
  assert.ok(UploadId, 'storage_loss.multipart_id');
  const {ETag} = await send(UploadPartCommand, {Key, UploadId, PartNumber: 1, Body: first, ...encrypted}, signal);
  assert.ok(ETag, 'storage_loss.multipart_first_part');
  return {Key, UploadId, ETag, last, bytes: Buffer.concat([first, last])};
}

async function finishMultipart({send}, {Key, UploadId, ETag, last}, encrypted, signal) {
  const first = {PartNumber: 1, ETag};
  const complete = second => send(CompleteMultipartUploadCommand,
    {Key, UploadId, MultipartUpload: {Parts: [first, {PartNumber: 2, ETag: second}]}, ...encrypted}, signal);
  await assert.rejects(complete(ETag), {name: 'InvalidPart'});
  const second = await send(UploadPartCommand, {Key, UploadId, PartNumber: 2, Body: last, ...encrypted}, signal);
  assert.ok(second.ETag, 'storage_loss.multipart_second_part');
  const done = await complete(second.ETag);
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
    const first = clients.get(names[0]), ready = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
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
      const upload = await startMultipart(first, multipart, encrypted, AbortSignal.any([signal, AbortSignal.timeout(60_000)]));
      const survivors = names.filter(machine => machine !== node.name).map(machine => clients.get(machine));
      const [client] = survivors;
      const leg = await stopNode(node.name, {whileStopped: async ({signal: stopped}) => {
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
        const listed = await client.send(ListObjectsV2Command, {}, stopped);
        assert.deepEqual(listed.Contents.map(row => row.Key).sort(), [...old.keys(), name, multipart].sort());
      }});
      old.set(name, bytes);
      old.set(multipart, upload.bytes);
      const repairStart = performance.now(), repair = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
      await waitForStore({nodes: names, kube, signal: repair});
      // A successful read with all drives back queues MinIO's repair for that object.
      assert.deepEqual(await readObject(first, name, key, repair), bytes, name);
      assert.deepEqual(await readObject(first, multipart, key, repair), upload.bytes, multipart);
      await waitForPieces(run, node, [name, multipart], repair, multipart);
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
