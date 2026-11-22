import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareDatabaseWitness} from './kubernetes-cold-restart.mjs';

function databaseFixture({missing = false, recovering = false, staleReadiness = false} = {}) {
  const oldRow = 'before-restart', newRow = 'after-restart';
  let restarted = false, wrote = false;
  const signals = [], replicationQueries = [], created = new Set(), tables = new Set();
  const kube = async ([flag, namespace, verb, resource, ...args], {signal}) => {
    assert.equal(flag, '-n');
    assert.equal(namespace, 'd621-data');
    if (verb === 'get') {
      assert.equal(resource, 'clusters.postgresql.cnpg.io');
      signals.push(signal);
      return JSON.stringify({status: {
        readyInstances: restarted && recovering ? 2 : 3,
        currentPrimary: restarted ? 'cloud-db-2' : 'cloud-db-1',
      }});
    }
    assert.equal(verb, 'exec');
    assert.equal(resource, restarted ? 'cloud-db-2' : 'cloud-db-1');
    assert.deepEqual(args.slice(0, 4), ['-c', 'postgres', '--', 'psql']);
    const sql = args.at(-1);
    if (sql === 'SELECT NOT pg_is_in_recovery()') return 't';
    if (sql.includes('pg_stat_replication')) {
      replicationQueries.push(sql);
      return staleReadiness && replicationQueries.length === 1 ? 'f' : 't';
    }
    const createdTable = sql.match(/^CREATE TABLE (\w+)/)?.[1];
    if (createdTable) {
      if (tables.has(createdTable)) throw Error('relation already exists');
      tables.add(createdTable);
      created.add(createdTable);
      assert.ok(sql.includes(oldRow));
      return oldRow;
    }
    if (sql.startsWith('DROP TABLE')) {
      assert.ok(tables.delete(sql.split(' ').at(-1)));
      return '';
    }
    if (sql.startsWith('INSERT')) {
      assert.ok(sql.includes(newRow));
      wrote = true;
      return newRow;
    }
    assert.ok(sql.startsWith('SELECT'));
    return sql.includes(oldRow) ? (missing ? '' : oldRow) : (wrote ? newRow : '');
  };
  return {kube, restart: () => {restarted = true;}, wrote: () => wrote, signals, created, tables,
    replicationQueries};
}

test('the database witness reads the old row and confirms a fresh write on a different primary', async () => {
  const f = databaseFixture();
  const verify = await prepareDatabaseWitness({kube: f.kube, signal: new AbortController().signal});
  f.restart();
  const result = await verify();
  assert.equal(result.primary, 'cloud-db-2');
  assert.ok(result.databaseRecoveryMs >= 0);
  assert.ok(f.wrote());
});

test('two database witnesses use distinct tables and remove them on success', async () => {
  const f = databaseFixture();
  const context = {kube: f.kube, signal: new AbortController().signal};
  const first = await prepareDatabaseWitness(context);
  const second = await prepareDatabaseWitness(context);
  assert.equal(f.created.size, 2);
  f.restart();
  await first();
  assert.equal(f.tables.size, 1);
  await second();
  assert.equal(f.tables.size, 0);
});

test('the database witness waits for both streaming standbys even when the saved status says three are ready', async () => {
  const f = databaseFixture({staleReadiness: true});
  const verify = await prepareDatabaseWitness({kube: f.kube, signal: new AbortController().signal});
  f.restart();
  await verify();
  assert.equal(f.replicationQueries.length, 2);
  for (const query of f.replicationQueries) assert.match(query, /WHERE state = 'streaming'\) = 2$/);
});

test('the database witness refuses a missing acknowledged row before trying a fresh write', async () => {
  const f = databaseFixture({missing: true});
  const verify = await prepareDatabaseWitness({kube: f.kube, signal: new AbortController().signal});
  f.restart();
  await assert.rejects(verify(), /cold_restart.retained_row/);
  assert.equal(f.wrote(), false);
});

test('outside restart waits for three ready copies and a writable primary', {timeout: 3000}, async t => {
  const f = databaseFixture(), stop = new AbortController(), signal = new AbortController().signal;
  const log = t.mock.method(process.stderr, 'write');
  let reads = 0, writeSignal;
  const kube = (args, options) => {
    if (args[2] === 'get' && ++reads <= 3) return JSON.stringify({status: {
      readyInstances: reads === 1 ? 2 : 3, currentPrimary: 'cloud-db-1',
    }});
    if (args.at(-1) === 'SELECT NOT pg_is_in_recovery()' && reads === 2) return 'f';
    if (args.at(-1).startsWith('CREATE TABLE')) {
      assert.equal(reads, 3);
      writeSignal = options.signal;
    }
    return f.kube(args, options);
  };
  const verify = await prepareDatabaseWitness({kube, signal, initialReadiness: {ms: 180_000, signal: stop.signal}});
  assert.equal(f.created.size, 1);
  assert.match(String(log.mock.calls[0].arguments[0]), /"initialReady":2,"ready":3,"primary":"cloud-db-1","writable":true/);
  stop.abort();
  assert.ok(writeSignal.aborted);
  f.restart();
  assert.equal((await verify()).primary, 'cloud-db-2');
  assert.equal(f.wrote(), true);
});

test('outside restart readiness times out before writing', {timeout: 3000}, async t => {
  const expiry = new AbortController(), failure = Object.assign(Error('test cluster read failed'), {code: 'EIO'});
  const log = t.mock.method(process.stderr, 'write');
  const f = databaseFixture();
  t.mock.method(AbortSignal, 'timeout', ms => {assert.equal(ms, 180_000); return expiry.signal;});
  let reads = 0;
  const kube = async (args, options) => {
    if (args[2] !== 'get') return f.kube(args, options);
    if (++reads === 2) {
      setImmediate(() => expiry.abort());
      throw failure;
    }
    return JSON.stringify({status: {readyInstances: 2, currentPrimary: 'cloud-db-1'}});
  };
  await assert.rejects(prepareDatabaseWitness({kube, signal: new AbortController().signal,
    initialReadiness: {ms: 180_000}}), error => error.message === 'cold_restart.initial_primary' &&
    error.cause?.cause === failure);
  assert.match(String(log.mock.calls[0].arguments[0]), /"initialReady":2,"ready":2,"primary":"cloud-db-1","writable":null,"lastCommand":\{"stage":"cluster","code":"EIO"\}/);
  assert.equal(reads, 2);
  assert.equal(f.created.size, 0);
});

test('outside restart readiness cancels before writing', async () => {
  const f = databaseFixture(), stop = new AbortController(), reason = Error('latest stop reached');
  const kube = async (args, options) => {
    const output = await f.kube(args, options);
    if (args.at(-1) === 'SELECT NOT pg_is_in_recovery()') stop.abort(reason);
    return output;
  };
  await assert.rejects(prepareDatabaseWitness({kube, signal: new AbortController().signal,
    initialReadiness: {ms: 180_000, signal: stop.signal}}), error => error.cause === reason);
  assert.equal(f.created.size, 0);
});

test('the database witness stops waiting for three copies after 240 seconds', {timeout: 3000}, async t => {
  const deadline = new AbortController();
  const timeout = t.mock.method(AbortSignal, 'timeout', ms => {
    assert.equal(ms, 240_000);
    queueMicrotask(() => deadline.abort(Error('synthetic recovery deadline')));
    return deadline.signal;
  });
  const f = databaseFixture({recovering: true});
  const verify = await prepareDatabaseWitness({kube: f.kube, signal: new AbortController().signal});
  f.restart();
  await assert.rejects(verify(), /synthetic recovery deadline/);
  assert.equal(timeout.mock.callCount(), 1);
  assert.ok(f.signals.at(-1).aborted);
  assert.equal(f.wrote(), false);
});

test('the private Kind cluster keeps its PostgreSQL data through an all-node outage', {
  skip: process.env.TEST_KUBERNETES_COLD_RESTART !== '1', timeout: 1_800_000,
}, async () => {
  const {runKubernetesNodeLoss} = await import('./kubernetes-node-loss.mjs');
  const {runKubernetesColdRestart} = await import('./kubernetes-cold-restart.mjs');
  const {coldRestart} = await runKubernetesNodeLoss({coldRestart: runKubernetesColdRestart});
  assert.ok(coldRestart.recoveryMs < 180_000);
  assert.ok(coldRestart.databaseRecoveryMs < 240_000);
});
