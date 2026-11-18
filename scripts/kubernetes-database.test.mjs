import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('database loss requires a local Cloud image ID before it starts Kind', () => {
  const {status, stderr} = spawnSync(process.execPath, ['scripts/kubernetes-check.mjs', '--database-loss'], {
    encoding: 'utf8', env: {...process.env, PATH: '', TEST_CLOUD_INTEGRATION_IMAGE: 'cloud:latest'}
  });
  assert.equal(status, 1);
  assert.match(stderr, /database_loss\.cloud_image_id/);
  assert.doesNotMatch(stderr, /Creating owned Kind cluster/);
});

test('a changed operator download cannot reach Kubernetes', async () => {
  const {installDatabaseOperator} = await import('./kubernetes-database.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'cloud-database-pin-'));
  try {
    await assert.rejects(installDatabaseOperator({
      directory,
      async run(binary, args) {
        assert.equal(binary, 'curl');
        await writeFile(args[args.indexOf('--output') + 1], 'kind: Deployment\n');
      },
      kube() { assert.fail('unverified manifest reached Kubernetes'); }
    }), /database_loss\.operator_digest/);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('three local PostgreSQL copies preserve commits through primary and standby loss', {
  skip: process.env.TEST_KUBERNETES_DATABASE_LOSS !== '1', timeout: 1_800_000,
}, async () => {
  const {runKubernetesCheck} = await import('./kubernetes-check.mjs');
  const {database} = await runKubernetesCheck('kind-database-loss');
  assert.deepEqual(database.schema, {refusedBeforeMigration: true, readAfterMigration: true});
  assert.equal(database.syncOffControl, true);
  assert.equal(database.primary.acknowledgedRow, 'primary-loss');
  assert.equal(database.primary.oldPrimaryWriteSqlstate, '25006');
  assert.equal(database.standby.acknowledgedRow, 'standby-loss');
  assert.notEqual(database.clientNode, database.primary.stopped);
  assert.notEqual(database.clientNode, database.standby.stopped);
  console.log(JSON.stringify(database));
});
