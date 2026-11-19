import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {isIPv4} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

import {storageNamespace as namespace} from '../deploy/kubernetes/secrets.mjs';
const storeName = 'store';
const peerService = 'store-peers';
const storageClass = 'd621-local-store';
const apiName = 's3';
const uid = 10001;
const port = 9000;
export const storeNodePort = 30900;
const storePath = '/var/local/d621-store';
const labels = {app: storeName};
const peers = Array.from({length: 6}, (_, index) => 'store-' + index);
const dns = name => name + '.' + namespace + '.svc.cluster.local';
const peerDns = name => name + '.' + dns(peerService);

export function storeBuildArgs(image, args = []) {
  return ['buildx', 'build', '--builder', 'default', ...args, '--load',
    '-f', 'deploy/kubernetes/images/store/Dockerfile', '-t', image, 'deploy/kubernetes/images/store'];
}

export function stockholmStoreResources(nodes, image, openId) {
  assert.equal(nodes.length, 3, 'stockholm.store_node_count');
  assert.equal(new Set(nodes).size, 3, 'stockholm.store_duplicate_nodes');
  const claim = {accessModes: ['ReadWriteOnce'], storageClassName: storageClass, resources: {requests: {storage: '10Gi'}}};
  const disks = peers.flatMap((peer, index) => {
    const name = 'disk-' + peer, node = nodes[Math.floor(index / 2)];
    return [
      {apiVersion: 'v1', kind: 'PersistentVolume', metadata: {name},
        spec: {accessModes: claim.accessModes, capacity: claim.resources.requests, storageClassName: storageClass,
          persistentVolumeReclaimPolicy: 'Retain', local: {path: storePath + '/' + (index % 2)},
          claimRef: {name, namespace}, nodeAffinity: {required: {nodeSelectorTerms: [{matchExpressions: [
            {key: 'kubernetes.io/hostname', operator: 'In', values: [node]},
          ]}]}}}},
      {apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: {name, namespace}, spec: {...claim, volumeName: name}},
    ];
  });
  return [
    {apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: {name: storageClass},
      provisioner: 'kubernetes.io/no-provisioner', volumeBindingMode: 'WaitForFirstConsumer'},
    ...disks,
    {apiVersion: 'v1', kind: 'Service', metadata: {name: peerService, namespace},
      spec: {clusterIP: 'None', publishNotReadyAddresses: true, selector: labels, ports: [{name: 'https', port}]}},
    {apiVersion: 'v1', kind: 'Service', metadata: {name: apiName, namespace},
      spec: {type: 'NodePort', externalTrafficPolicy: 'Local', selector: labels, ports: [{name: 'https', port, nodePort: storeNodePort}]}},
    {apiVersion: 'apps/v1', kind: 'StatefulSet', metadata: {name: storeName, namespace},
      spec: {replicas: peers.length, serviceName: peerService, podManagementPolicy: 'Parallel',
        selector: {matchLabels: labels}, template: {metadata: {labels}, spec: {
          automountServiceAccountToken: false,
          securityContext: {runAsUser: uid, runAsGroup: uid, runAsNonRoot: true, seccompProfile: {type: 'RuntimeDefault'}},
          topologySpreadConstraints: [{maxSkew: 1, topologyKey: 'kubernetes.io/hostname',
            whenUnsatisfiable: 'DoNotSchedule', labelSelector: {matchLabels: labels}}],
          containers: [{name: storeName, image, imagePullPolicy: 'Never',
            args: ['server', '--address', ':' + port, '--certs-dir', '/certs',
              ...peers.map(peer => 'https://' + peerDns(peer) + ':' + port + '/disk')],
            envFrom: [{secretRef: {name: 'store-credentials'}}],
            env: [{name: 'MINIO_STORAGE_CLASS_STANDARD', value: 'EC:3'}, {name: 'MINIO_BROWSER', value: 'off'},
              {name: 'MINIO_UPDATE', value: 'off'}, ...(openId ? [
              {name: 'MINIO_IDENTITY_OPENID_CONFIG_URL', value: openId.configUrl},
              {name: 'MINIO_IDENTITY_OPENID_CLIENT_ID', value: openId.clientId},
              {name: 'MINIO_IDENTITY_OPENID_ROLE_POLICY', value: openId.rolePolicy},
            ] : [])],
            ports: [{name: 'https', containerPort: port}],
            securityContext: {allowPrivilegeEscalation: false, capabilities: {drop: ['ALL']}},
            // The basic readiness endpoint can return 200 before the object layer starts.
            readinessProbe: {httpGet: {scheme: 'HTTPS', path: '/minio/health/cluster', port: 'https'},
              timeoutSeconds: 5, periodSeconds: 2},
            volumeMounts: [{name: 'disk', mountPath: '/disk'}, {name: 'certs', mountPath: '/certs', readOnly: true}],
          }],
          volumes: [{name: 'certs', secret: {secretName: 'store-tls', items: [
            {key: 'tls.crt', path: 'public.crt'}, {key: 'tls.key', path: 'private.key'}, {key: 'tls.crt', path: 'CAs/local.crt'},
            ...(openId ? [{key: 'issuer.crt', path: 'CAs/issuer.crt'}] : []),
          ]}}],
        }}, volumeClaimTemplates: [{metadata: {name: 'disk'}, spec: claim}]},
    },
  ];
}

export async function waitForStore({nodes, kube, signal}) {
  do {
    const {items} = JSON.parse(await kube(['-n', namespace, 'get', 'pods', '-l', 'app=store', '-o', 'json'], {signal}));
    if (items.length === peers.length && items.every(row =>
      row.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'))) {
      assert.deepEqual(items.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
        .map(row => [row.metadata.name, row.spec.nodeName]),
      peers.map((name, index) => [name, nodes[Math.floor(index / 2)]]), 'stockholm.store_placement');
      return;
    }
    await delay(1000, undefined, {signal});
  } while (!signal.aborted);
  signal.throwIfAborted();
}

export async function installStockholmStore({nodes, addresses, image, directory, run, kube, signal, openId}) {
  const items = stockholmStoreResources(nodes, image, openId);
  assert.ok(addresses.length === 3 && addresses.every(isIPv4), 'stockholm.store_addresses');
  const credentials = {accessKeyId: randomBytes(16).toString('hex'), secretAccessKey: randomBytes(24).toString('hex')};
  const certPath = join(directory, 'store.crt'), keyPath = join(directory, 'store.key');
  const names = [dns(apiName), ...peers.map(peerDns)].map(name => 'DNS:' + name);
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=' + dns(apiName),
    '-addext', 'subjectAltName=' + [...names, ...addresses.map(ip => 'IP:' + ip)].join(','),
    '-addext', 'basicConstraints=critical,CA:TRUE', '-out', certPath, '-keyout', keyPath], {signal});
  const [ca, key] = await Promise.all([readFile(certPath, 'utf8'), readFile(keyPath, 'utf8')]);
  const manifest = items => ({signal, timeout: 30_000, input: JSON.stringify({apiVersion: 'v1', kind: 'List', items})});
  await kube(['apply', '-f', '-'], manifest([{apiVersion: 'v1', kind: 'Namespace', metadata: {name: namespace}}]));
  const secret = (name, values) => ({apiVersion: 'v1', kind: 'Secret', metadata: {name, namespace}, stringData: values});
  try {
    await kube(['create', '-f', '-'], manifest([
      secret('store-tls', {'tls.crt': ca, 'tls.key': key, ...(openId && {'issuer.crt': openId.ca})}),
      secret('store-credentials', {MINIO_ROOT_USER: credentials.accessKeyId, MINIO_ROOT_PASSWORD: credentials.secretAccessKey}),
    ]));
  } catch {
    // Kubernetes may include Secret input in a validation error.
    throw Error('stockholm.store_secret_create');
  }
  await kube(['apply', '-f', '-'], manifest(items));
  const ready = AbortSignal.any([signal, AbortSignal.timeout(240_000)]);
  try {
    await waitForStore({nodes, kube, signal: ready});
  } catch (error) {
    const events = await kube(['-n', namespace, 'get', 'events', '--sort-by=.lastTimestamp'], {signal}).catch(() => '');
    if (events) process.stderr.write(namespace + ' events:\n' + events + '\n');
    throw error;
  }
  return {ca, credentials};
}

async function main() {
  const [config, context, image, ...args] = process.argv.slice(2);
  assert.ok(config?.startsWith('--kubeconfig=/') && context?.startsWith('--context=') && image && args.length === 6,
    'Pass an explicit kubeconfig and context, store image, three node names and three private addresses');
  const directory = await mkdtemp(join(tmpdir(), 'd621-store-'));
  const run = async (binary, argv, {input, timeout = 15_000} = {}) =>
    execFileSync(binary, argv, {input, timeout, killSignal: 'SIGKILL', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});
  const kube = (argv, options) => run('kubectl', [config, context, '--request-timeout=10s', ...argv], options);
  try {
    await installStockholmStore({nodes: args.slice(0, 3), addresses: args.slice(3), image, directory, run, kube,
      signal: AbortSignal.timeout(300_000)});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(error => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
