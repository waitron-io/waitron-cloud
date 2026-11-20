import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import * as databaseRehearsal from './kubernetes-database.mjs';

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

test('account recovery requires a database failure and readiness from the original process', async () => {
  assert.equal(typeof databaseRehearsal.measureAccountRecovery, 'function');
  const before = {uid: 'account-pod', containerId: 'account-container', restartCount: 0};
  for (const [scenario, refusal] of [
    ['recovers', null], ['different container', /account_restarted/],
    ['second listening event', /account_listening_events/], ['liveness refused', /account_not_live/],
    ['no observed database failure', /account_database_failure_not_observed/],
  ]) {
    let readiness = 0, live = 0, apiDisconnected = false;
    const run = databaseRehearsal.measureAccountRecovery({
      before, signal: AbortSignal.timeout(2500),
      async health(path) {
        if (path === 'live') {
          live++;
          return scenario === 'liveness refused' ? {status: 503, body: {}} : {status: 200, body: {status: 'live'}};
        }
        if (scenario === 'recovers' && !apiDisconnected) {
          apiDisconnected = true;
          throw Error('kubectl exec failed\nerror: EOF');
        }
        return ++readiness === 1 && scenario !== 'no observed database failure' ?
          {status: 503, body: {status: 'unavailable'}} : {status: 200, body: {status: 'ready'}};
      },
      async logs() {
        const listening = '{"status":"listening","port":3000}';
        return scenario === 'second listening event' ? listening + '\n' + listening : listening;
      },
      async identity() {return scenario === 'different container' ? {...before, containerId: 'new-container'} : before;},
    });
    if (!refusal) {
      const result = await run;
      assert.equal(result.failure, 'readiness 503');
      assert.ok(result.readyMs >= result.failureMs);
      assert.ok(live >= 2);
    } else {
      await assert.rejects(run, refusal);
    }
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
  assert.ok(database.primary.account.backendPid > 0);
  assert.ok(database.primary.account.readyMs <= 90_000);
  assert.ok(database.primary.account.readyMs >= database.primary.account.failureMs);
  assert.equal(database.standby.acknowledgedRow, 'standby-loss');
  assert.notEqual(database.clientNode, database.primary.stopped);
  assert.notEqual(database.clientNode, database.standby.stopped);
  console.log(JSON.stringify(database));
});
