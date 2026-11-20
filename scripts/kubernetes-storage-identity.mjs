import assert from 'node:assert/strict';
import {createPrivateKey, generateKeyPairSync, randomBytes} from 'node:crypto';
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {Agent} from 'node:https';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {audience, discoveryPath, issuer, policyName, storageIdentity, storageRuntime} from '../deploy/kubernetes/storage-identity.mjs';
import {createStorageCustody, readStorageCustody, storageNamespace} from '../deploy/kubernetes/secrets.mjs';
import {captureRuntime} from '../packages/backups/src/capture-config.ts';
import {StorageAuthority} from '../packages/backups/src/storage.ts';
import {bufferObject} from '../packages/backups/src/object-transfer.ts';
import {readObject, storageBucket, storageClient, withStockholmStore} from './kubernetes-storage-proof.mjs';
import {storeNodePort, waitForStore} from './kubernetes-storage.mjs';
import {retryApi} from './kubernetes-node-loss.mjs';

const require = createRequire(new URL('../packages/backups/package.json', import.meta.url));
const {CreateBucketCommand, DeleteObjectCommand, ListObjectsV2Command, PutBucketVersioningCommand} =
  require('@aws-sdk/client-s3');
const {AssumeRoleWithWebIdentityCommand, STSClient} = require('@aws-sdk/client-sts');
const mcAsset = 'mc.linux-amd64.RELEASE.2025-08-13T08-35-41Z';
const mcDigest = '01f866e9c5f9b87c2b09116fa5d7c06695b106242d829a8bb32990c00312e891';
const region = 'us-east-1';
const otherBucket = 'cloud-storage-other';
const venue = '00000000-0000-0000-0000-000000000001';

// Verify the process serves its mounted keys over TLS, including after the other replica's node stops.
const issuerProbe = `
const {readFileSync} = require('node:fs');
const {get} = require('node:https');
get({
  host: '127.0.0.1', port: 8443, path: '/jwks', servername: process.argv[1],
  ca: readFileSync('/issuer-tls/tls.crt'),
}, response => {
  if (response.statusCode !== 200) process.exitCode = 1;
  response.pipe(process.stdout);
});
`;

function policy(bucket) {
  const object = 'arn:aws:s3:::' + bucket + '/${jwt:scope}';
  const subject = kind => ({'jwt:sub': kind + ':' + bucket + ':${jwt:scope}'});
  const statement = (kind, actions, resource, extra) => ({
    Effect: 'Allow', Action: actions, Resource: [resource],
    Condition: {StringEquals: subject(kind), ...extra},
  });
  return {Version: '2012-10-17', Statement: [
    statement('capture', ['s3:PutObject'], object),
    statement('restore', ['s3:GetObject'], object),
    statement('stream', ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], object + '*'),
    statement('stream', ['s3:ListBucket'], 'arn:aws:s3:::' + bucket, {StringLike: {'s3:prefix': '${jwt:scope}*'}}),
  ]};
}

export async function configurePolicy({directory, run, signal}, endpoint, {ca, credentials}, services = false) {
  const config = join(directory, 'mc-config'), binary = join(directory, 'mc');
  await mkdir(join(config, 'certs', 'CAs'), {recursive: true, mode: 0o700});
  await writeFile(join(config, 'certs', 'CAs', 'store.crt'), ca);
  await writeFile(join(config, 'config.json'), JSON.stringify({version: '10', aliases: {rehearsal: {
    url: endpoint, accessKey: credentials.accessKeyId, secretKey: credentials.secretAccessKey, api: 'S3v4', path: 'on',
  }}}), {mode: 0o600});
  await run('curl', ['-fLsS', '--connect-timeout', '15', '--max-time', '120', '-o', binary,
    'https://github.com/minio/mc/releases/download/RELEASE.2025-08-13T08-35-41Z/' + mcAsset], {timeout: 125_000, signal});
  await run('sha256sum', ['--check', '-'], {input: mcDigest + '  ' + binary + '\n', signal});
  await chmod(binary, 0o700);
  const mc = args => run(binary, ['--config-dir', config, '--json', ...args], {signal, timeout: 30_000});
  const path = join(config, 'policy.json');
  await writeFile(path, JSON.stringify(policy(storageBucket)));
  await mc(['admin', 'policy', 'create', 'rehearsal', policyName, path]);
  const {info} = JSON.parse(await mc(['idp', 'openid', 'info', 'rehearsal']));
  const role = info.find(({key}) => key === 'roleARN')?.value;
  assert.match(role ?? '', /^arn:minio:iam:[^:]*::role\/[\w-]+$/, 'storage_identity.role');
  if (!services) return role;
  const account = async (name, actions) => {
    const accessKeyId = 'services-' + name;
    const secretAccessKey = randomBytes(32).toString('base64url');
    const servicePolicy = join(config, name + '.json');
    await writeFile(servicePolicy, JSON.stringify({Version: '2012-10-17', Statement: [{
      Effect: 'Allow', Action: actions,
      Resource: ['incoming/*', 'snapshots/*'].map(prefix => 'arn:aws:s3:::' + storageBucket + '/' + prefix),
    }]}));
    await mc(['admin', 'policy', 'create', 'rehearsal', accessKeyId, servicePolicy]);
    // Keep the password in stdin and keep the command's diagnostics free of credentials.
    await run('sh', ['-ec', 'IFS= read -r password; "$1" --config-dir "$2" admin user add rehearsal "$3" "$password" >/dev/null 2>&1',
      'create-storage-user', binary, config, accessKeyId], {input: secretAccessKey + '\n', signal, timeout: 30_000});
    await mc(['admin', 'policy', 'attach', 'rehearsal', accessKeyId, '--user', accessKeyId]);
    return {accessKeyId, secretAccessKey};
  };
  const accountCredentials = await account('account', ['s3:GetObject', 's3:PutObject', 's3:DeleteObject']);
  const workerCredentials = await account('worker', ['s3:GetObject', 's3:DeleteObject']);
  return {role, accountCredentials, workerCredentials};
}

async function checkRejectedTokens(custody, role, endpoint, ca, scope) {
  const config = storageIdentity(custody, role).authority;
  const privateKey = createPrivateKey(config.privateKey);
  const sign = changes => new StorageAuthority({...config, privateKey, ...changes});
  const wrongKey = generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey;
  const client = new STSClient({endpoint, region, maxAttempts: 1, requestHandler: {httpsAgent: new Agent({ca})}});
  try {
    for (const [token, reason] of [
      [sign({audience: 'untrusted-audience'}).token(scope), /azp.*must match configured OpenID Client ID/],
      [sign({privateKey: wrongKey}).token(scope), /signature|verification/i],
      [sign({}).token(scope, Date.now() - 120_000), /expired/i],
    ]) {
      await assert.rejects(client.send(new AssumeRoleWithWebIdentityCommand({
        RoleArn: role, RoleSessionName: 'waitron-backup', WebIdentityToken: token, DurationSeconds: 900,
      }), {abortSignal: AbortSignal.timeout(10_000)}), error => {
        assert.match(error.name, /^(InvalidParameterValue|ExpiredToken)$/);
        assert.match(error.message, reason);
        return true;
      });
    }
  } finally { client.destroy(); }
}

export async function reportGrantTiming({nodes, kube, signal}, stoppedName, since) {
  const peers = nodes.flatMap((node, index) => node.name === stoppedName ? [] : [2 * index, 2 * index + 1]);
  const found = await Promise.all(peers.map(async index => {
    const name = 'store-' + index;
    const output = await kube(['-n', storageNamespace, 'logs', name, '--since-time=' + since, '--timestamps'],
      {signal, timeout: 10_000}).catch(() => null);
    const timings = output?.match(/^\S+ WAITRON grant [a-z-]+ elapsed=[\d.µa-z]+$/gm);
    if (timings?.length) process.stderr.write(name + ' grant timing:\n' + timings.join('\n') + '\n');
    else if (output === null) process.stderr.write(name + ' grant timing unavailable\n');
    return Boolean(timings?.length);
  }));
  if (!found.some(Boolean)) process.stderr.write('No grant timing markers found on surviving store peers\n');
}

async function checkGrants(context, account, custodyDirectory) {
  const {nodes, directory, kube, stopNode, signal} = context;
  const [origin] = nodes;
  const location = node => ({endpoint: 'https://' + node.ip + ':' + storeNodePort, region, bucket: storageBucket});
  const {endpoint} = location(origin);
  const role = await configurePolicy(context, endpoint, account);
  const caFile = join(directory, 'store.crt');
  const runtime = (custody, node) =>
    captureRuntime(storageRuntime(custody, role, location(node).endpoint, region, caFile, account.credentials));
  const custody = await readStorageCustody(custodyDirectory);
  const first = runtime(custody, origin);
  const sealed = first.options.vault.create(venue, 1);
  const {streamKey} = first.options.vault.open(venue, 1, sealed);
  const clients = [];
  const client = (node, credentials = account.credentials, bucket = storageBucket) => {
    const instance = storageClient(node, {ca: account.ca, credentials}, bucket);
    clients.push(instance);
    return instance;
  };
  const open = async (runtime, node, kind, scope, bucket = storageBucket) => {
    const result = await runtime.options.grant({...location(node), bucket}, {kind, bucket, scope});
    assert.ok(result.credentials.accessKeyId && result.credentials.secretAccessKey && result.credentials.sessionToken);
    const remaining = Date.parse(result.expiresAt) - Date.now();
    assert.ok(remaining > 890_000 && remaining <= 901_000, 'storage_identity.grant_duration');
    return result;
  };
  const createBucket = async bucket => {
    const root = client(origin, account.credentials, bucket);
    await root.send(CreateBucketCommand, {}, signal);
    await root.send(PutBucketVersioningCommand, {VersioningConfiguration: {Status: 'Enabled'}}, signal);
    return root;
  };
  const bytes = Buffer.from('synthetic encrypted snapshot');
  const capture = 'incoming/current', snapshot = 'snapshots/current', stream = 'streams/current/';
  const otherSnapshot = 'snapshots/other', otherStream = 'streams/other/chunk';
  const accessDenied = error => error.name === 'AccessDenied' && error.$metadata?.httpStatusCode === 403;
  const put = (target, key, limit = signal) => target.objects.putStaged(key, bufferObject(bytes), streamKey, {signal: limit});
  const get = (target, key, limit = signal) => readObject(target, key, streamKey, limit);
  const list = (target, Prefix) => target.send(ListObjectsV2Command, {Prefix}, signal);
  try {
    const root = await createBucket(storageBucket);
    const other = await createBucket(otherBucket);
    for (const key of [snapshot, otherSnapshot, otherStream]) await put(root, key);
    await put(other, snapshot);
    const captureClient = client(origin, (await open(first, origin, 'capture', capture)).credentials);
    await put(captureClient, capture);
    assert.deepEqual(await get(root, capture), bytes);
    await assert.rejects(put(captureClient, 'incoming/other'), accessDenied);
    await assert.rejects(get(captureClient, capture), accessDenied);

    const restore = await open(first, origin, 'restore', snapshot);
    const restoreClient = client(origin, restore.credentials);
    assert.deepEqual(await get(restoreClient, snapshot), bytes);
    await assert.rejects(get(restoreClient, otherSnapshot), accessDenied);
    await assert.rejects(get(client(origin, restore.credentials, otherBucket), snapshot), accessDenied);
    await assert.rejects(put(restoreClient, snapshot), accessDenied);
    const crossBucket = await open(first, origin, 'restore', snapshot, otherBucket);
    await assert.rejects(get(client(origin, crossBucket.credentials), snapshot), accessDenied);

    const streamClient = client(origin, (await open(first, origin, 'stream', stream)).credentials);
    const chunk = stream + 'chunk';
    await put(streamClient, chunk);
    assert.deepEqual(await get(streamClient, chunk), bytes);
    assert.deepEqual((await list(streamClient, stream)).Contents.map(row => row.Key), [chunk]);
    await assert.rejects(list(streamClient, 'streams/'), accessDenied);
    await assert.rejects(list(streamClient), accessDenied);
    await assert.rejects(get(streamClient, otherStream), accessDenied);
    await streamClient.send(DeleteObjectCommand, {Key: chunk}, signal);
    assert.equal((await list(streamClient, stream)).KeyCount, 0);
    await checkRejectedTokens(custody, role, endpoint, account.ca, {kind: 'restore', bucket: storageBucket, scope: snapshot});
    process.stderr.write('Real grants, scoped operations and token refusals passed\n');

    const kubeIdentity = args => kube(['-n', storageNamespace, ...args], {signal, timeout: 185_000});
    const before = JSON.parse(await kubeIdentity(['get', 'pods', '-l', 'app=storage-identity', '-o', 'json'])).items;
    const [pod] = before;
    assert.equal(before.length, 2);
    await kubeIdentity(['delete', 'pod', pod.metadata.name, '--wait=true', '--timeout=120s']);
    await kubeIdentity(['rollout', 'status', 'deployment/storage-identity', '--timeout=120s']);
    const after = JSON.parse(await kubeIdentity(['get', 'pods', '-l', 'app=storage-identity', '-o', 'json'])).items;
    const replacement = after.find(row => !before.some(old => old.metadata.uid === row.metadata.uid));
    assert.ok(replacement, 'storage_identity.replacement');
    const getJwks = async (name, limit) => JSON.parse(await kube(['-n', storageNamespace, 'exec', name, '--',
      'node', '-e', issuerProbe, new URL(issuer).hostname], {signal: limit}));
    const expectedJwks = storageIdentity(custody, role).jwks;
    assert.deepEqual(await getJwks(replacement.metadata.name, signal), expectedJwks);
    const stoppedName = replacement.spec.nodeName;
    const remainingIssuer = after.find(row => row.spec.nodeName !== stoppedName);
    assert.ok(remainingIssuer, 'storage_identity.issuer_spread');
    const survivor = nodes.find(node => node.name === remainingIssuer.spec.nodeName);
    assert.ok(survivor, 'storage_identity.issuer_survivor');
    const reopened = runtime(await readStorageCustody(custodyDirectory), survivor);
    let renewalStartedAt;
    try {
      assert.equal(reopened.options.vault.open(venue, 1, sealed).streamKey, streamKey);
      const expires = Date.parse(restore.expiresAt);
      process.stderr.write('Issuer replacement and custody reopen passed; waiting for the expiry window\n');
      await delay(Math.max(0, expires - Date.now() - 45_000), undefined, {signal});
      const {renewed, ...outage} = await stopNode(stoppedName, {whileStopped: async ({signal: stopped}) => {
        assert.ok(Date.now() < expires, 'storage_identity.grant_expired_before_check');
        const originalGrant = client(survivor, restore.credentials);
        await delay(Math.max(0, expires - Date.now() + 2_000), undefined, {signal: stopped});
        await assert.rejects(get(originalGrant, snapshot, stopped),
          error => error.name === 'InvalidAccessKeyId' && error.$metadata?.httpStatusCode === 403);
        process.stderr.write('Surviving store refused the expired grant\n');
        const survivingKey = await retryApi(() => getJwks(remainingIssuer.metadata.name, stopped), stopped, 'issuer JWKS');
        assert.deepEqual(survivingKey, expectedJwks);
        process.stderr.write('Requesting a fresh grant while the machine is stopped\n');
        renewalStartedAt = new Date().toISOString();
        const started = performance.now();
        const renewed = await open(reopened, survivor, 'restore', snapshot).finally(() => {
          process.stderr.write('Fresh grant request ended after ' + Math.round(performance.now() - started) + ' ms\n');
        });
        process.stderr.write('Fresh grant issued while the machine is stopped\n');
        return {expiredGrantRefused: true, issuerKeyStable: true, issuerSurvivor: survivor.name, renewed};
      }});
      const ready = AbortSignal.any([signal, AbortSignal.timeout(240_000)]);
      process.stderr.write('Machine rejoined; waiting for all six store peers\n');
      await waitForStore({nodes: nodes.map(node => node.name), kube, signal: ready});
      const restored = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      process.stderr.write('Store peers ready; reading the encrypted snapshot with the renewed grant\n');
      assert.deepEqual(await get(client(survivor, renewed.credentials), snapshot, restored), bytes);
      return {...outage, renewedGrantReadAfterRejoin: true};
    } finally {
      reopened.close();
      if (renewalStartedAt) await reportGrantTiming(context, stoppedName, renewalStartedAt);
    }
  } finally {
    first.close();
    for (const connection of clients) connection.close();
  }
}

export async function withStockholmStorageIdentity(context, verify) {
  const {directory, kube, run, signal} = context;
  const custodyDirectory = join(directory, 'storage-custody');
  const custody = await createStorageCustody(custodyDirectory, (binary, args) => run(binary, args, {signal}));
  const {resources} = storageIdentity(custody);
  const manifest = items => ({signal, input: JSON.stringify({apiVersion: 'v1', kind: 'List', items})});
  await kube(['apply', '-f', '-'], manifest([{apiVersion: 'v1', kind: 'Namespace', metadata: {name: storageNamespace}}]));
  try {
    await kube(['create', '-f', '-'], manifest(resources.filter(row => row.kind === 'Secret')));
  } catch {
    throw Error('storage_identity.issuer_secret_create');
  }
  await kube(['apply', '-f', '-'], manifest(resources.filter(row => row.kind !== 'Secret')));
  await kube(['-n', storageNamespace, 'rollout', 'status', 'deployment/storage-identity', '--timeout=180s'],
    {signal, timeout: 185_000});
  const openId = {configUrl: issuer + discoveryPath, clientId: audience, rolePolicy: policyName, ca: custody.certificate};
  if (context.installStore) return verify(await context.installStore(openId), custody, custodyDirectory);
  return withStockholmStore(context, account => verify(account, custody, custodyDirectory), openId);
}

export function runStorageIdentity(context) {
  return withStockholmStorageIdentity(context, (account, _custody, custodyDirectory) => checkGrants(context, account, custodyDirectory));
}
