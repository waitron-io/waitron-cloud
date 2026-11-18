import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {installStockholmDatabase} from './kubernetes-data.mjs';
import {runKubernetesNodeLoss} from './kubernetes-node-loss.mjs';

test('Stockholm database setup starts one ready PostgreSQL copy on each machine-local volume', {
  skip: process.env.TEST_KUBERNETES_STOCKHOLM_DATABASE !== '1', timeout: 900_000,
}, async () => {
  const bootstrap = await readFile(new URL('../deploy/kubernetes/bounded-amazon/bootstrap.sh', import.meta.url), 'utf8');
  const {database: copies} = await runKubernetesNodeLoss({
    database: async ({nodes, directory, run, kube}) => {
      const execNode = (node, args, options) => run('docker', ['exec', '-i', node, ...args], options);
      for (const node of nodes) {
        await execNode(node, ['bash', '-s', '--', 'database-storage'], {input: bootstrap});
      }
      await installStockholmDatabase({nodes, directory, run, kube});

      const read = async (...args) => JSON.parse(await kube(['-n', 'd621-data', 'get', ...args, '-o', 'json']));
      const {items: pods} = await read('pods', '-l', 'cnpg.io/cluster=cloud-db,cnpg.io/podRole=instance');
      assert.deepEqual(pods.map(pod => pod.spec.nodeName).sort(), [...nodes].sort());
      assert.equal(await kube(['-n', 'd621-data', 'get', 'secret', 'cloud-db-app', '-o', 'name']), 'secret/cloud-db-app');
      return Promise.all(pods.map(async pod => {
        const node = pod.spec.nodeName;
        assert.ok(pod.status.conditions.some(row => row.type === 'Ready' && row.status === 'True'));
        const claimName = pod.spec.volumes.find(volume => volume.name === 'pgdata').persistentVolumeClaim.claimName;
        const claim = await read('pvc', claimName);
        assert.equal(claim.status.phase, 'Bound');
        assert.equal(claim.spec.volumeName, node);
        const {spec} = await read('pv', node);
        assert.equal(spec.local.path, '/var/local/d621-postgres');
        assert.equal(spec.persistentVolumeReclaimPolicy, 'Retain');
        assert.deepEqual(spec.nodeAffinity.required.nodeSelectorTerms, [{matchExpressions: [
          {key: 'kubernetes.io/hostname', operator: 'In', values: [node]},
        ]}]);
        assert.equal(await execNode(node, ['stat', '-c', '%u:%g %a', '/var/local/d621-postgres']), '26:26 700');
        assert.equal(await execNode(node, ['cat', '/var/local/d621-postgres/pgdata/PG_VERSION']), '18');
        return {pod: pod.metadata.name, node, claim: claimName, volume: claim.spec.volumeName};
      }));
    },
  });
  console.log(JSON.stringify(copies));
});
