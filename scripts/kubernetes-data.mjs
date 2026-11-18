import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {databaseCluster, installDatabaseOperator} from './kubernetes-database.mjs';

const namespace = 'd621-data';
const storageClass = 'd621-local-postgres';
const storagePath = '/var/local/d621-postgres';

export async function installStockholmDatabase({nodes, directory, run, kube, installOperator = installDatabaseOperator}) {
  assert.equal(nodes.length, 3, 'stockholm.database_node_count');
  assert.equal(new Set(nodes).size, 3, 'stockholm.database_duplicate_nodes');
  const cluster = databaseCluster({storageClass, proofRoles: false});
  cluster.metadata.namespace = namespace;
  const size = cluster.spec.storage.size;
  const items = [
    {apiVersion: 'v1', kind: 'Namespace', metadata: {name: namespace}},
    {apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: {name: storageClass},
      provisioner: 'kubernetes.io/no-provisioner', volumeBindingMode: 'WaitForFirstConsumer'},
    ...nodes.map(node => ({apiVersion: 'v1', kind: 'PersistentVolume', metadata: {name: node},
      spec: {storageClassName: storageClass, capacity: {storage: size}, accessModes: ['ReadWriteOnce'],
        persistentVolumeReclaimPolicy: 'Retain', local: {path: storagePath},
        nodeAffinity: {required: {nodeSelectorTerms: [{matchExpressions: [
          {key: 'kubernetes.io/hostname', operator: 'In', values: [node]},
        ]}]}},
      }})),
    cluster,
  ];

  try {
    await installOperator({directory, run, kube});
    await kube(['apply', '-f', '-'], {timeout: 30_000, input: JSON.stringify({apiVersion: 'v1', kind: 'List', items})});
    await kube(['-n', namespace, 'wait', '--for=jsonpath={.status.readyInstances}=3',
      'cluster/' + cluster.metadata.name, '--timeout=240s'], {timeout: 245_000});
    const {items: pods} = JSON.parse(await kube(['-n', namespace, 'get', 'pods',
      '-l', 'cnpg.io/cluster=' + cluster.metadata.name + ',cnpg.io/podRole=instance', '-o', 'json']));
    assert.deepEqual(pods.map(pod => pod.spec.nodeName).sort(), [...nodes].sort(), 'stockholm.database_placement');
  } catch (error) {
    for (const name of ['cnpg-system', namespace]) {
      const output = await kube(['-n', name, 'get', 'events', '--sort-by=.lastTimestamp']).catch(() => '');
      if (output) process.stderr.write(name + ' events:\n' + output + '\n');
    }
    throw error;
  }
}

async function main() {
  const [config, context, ...nodes] = process.argv.slice(2);
  assert.ok(config?.startsWith('--kubeconfig=/') && context?.startsWith('--context='),
    'Pass an explicit kubeconfig and context');
  const directory = await mkdtemp(join(tmpdir(), 'd621-data-'));
  const run = async (binary, args, {input, timeout = 15_000} = {}) =>
    execFileSync(binary, args, {input, timeout, killSignal: 'SIGKILL', encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit']});
  const kube = (args, options) => run('kubectl', [config, context, ...args], options);
  try {
    await installStockholmDatabase({nodes, directory, run, kube});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
