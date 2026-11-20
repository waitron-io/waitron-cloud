import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {installStockholmDatabase} from './kubernetes-data.mjs';

const namespace = 'd621-data', database = 'cloud-db';
const recoveryLimitMs = 240_000;
const before = 'before-restart', after = 'after-restart';

export async function prepareDatabaseWitness({kube, signal}) {
  const table = 'cold_restart_probe_' + randomUUID().replaceAll('-', '');
  const insert = marker => `INSERT INTO ${table} VALUES ('${marker}') RETURNING marker`;
  const select = marker => `SELECT marker FROM ${table} WHERE marker = '${marker}'`;
  const command = (args, active) => kube(['-n', namespace, ...args], {signal: active});
  const sql = (pod, query, active) => command(['exec', pod, '-c', 'postgres', '--', 'psql',
    '-XAtq', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'app', '-c', query], active);
  async function findPrimary(active, readiness = "SELECT NOT pg_is_in_recovery()") {
    const {status} = JSON.parse(await command(['get', 'clusters.postgresql.cnpg.io', database, '-o', 'json'], active));
    const primary = status?.currentPrimary;
    if (status?.readyInstances === 3 && /^cloud-db-\d+$/.test(primary) &&
      await sql(primary, readiness, active) === 't') return primary;
  }
  const primary = await findPrimary(signal);
  assert.ok(primary, 'cold_restart.initial_primary');
  assert.equal(await sql(primary, `CREATE TABLE ${table} (marker text PRIMARY KEY); ${insert(before)}`,
    signal), before, 'cold_restart.acknowledged_row');

  return async () => {
    const started = performance.now();
    const active = AbortSignal.any([signal, AbortSignal.timeout(recoveryLimitMs)]);
    // The saved operator status can outlive a full stop. Confirm the standbys are streaming now.
    const readiness = "SELECT NOT pg_is_in_recovery() AND (SELECT count(*) FROM pg_stat_replication WHERE state = 'streaming') = 2";
    let current, lastError;
    try {
      while (!current) {
        active.throwIfAborted();
        try {current = await findPrimary(active, readiness);}
        catch (error) {lastError = error;}
        if (!current) await delay(1000, undefined, {signal: active});
      }
    } catch (error) {
      const reason = active.reason ?? error;
      throw Error('cold_restart.database_readiness: ' + reason.message + (lastError ? '\n' + lastError.message : ''), {cause: reason});
    }
    active.throwIfAborted();
    assert.equal(await sql(current, select(before), active), before, 'cold_restart.retained_row');
    assert.equal(await sql(current, insert(after), active), after, 'cold_restart.new_write');
    assert.equal(await sql(current, select(after), active), after, 'cold_restart.new_row');
    const databaseRecoveryMs = Math.round(performance.now() - started);
    await sql(current, `DROP TABLE ${table}`, active);
    return {primary: current, databaseRecoveryMs};
  };
}

export async function runKubernetesColdRestart(context) {
  const {nodes, run, restartAll} = context;
  const input = await readFile(new URL('../deploy/kubernetes/bounded-amazon/bootstrap.sh', import.meta.url), 'utf8');
  const markerPath = '/var/local/d621-postgres/.cold-restart-marker';
  const onNode = (node, ...args) => run('docker', ['exec', node.id, ...args]);
  for (const node of nodes) {
    await run('docker', ['exec', '-i', node.id, 'bash', '-s', '--', 'database-storage'], {input});
    await onNode(node, 'sh', '-ec', 'printf "%s\\n" "$1" > "$2"', 'marker', node.name, markerPath);
  }
  await installStockholmDatabase({...context, nodes: nodes.map(({name}) => name)});
  const verifyDatabase = await prepareDatabaseWitness(context);
  const api = await restartAll();
  const database = await verifyDatabase();
  for (const node of nodes) {
    assert.equal(await onNode(node, 'cat', markerPath), node.name, 'cold_restart.node_marker');
  }
  process.stderr.write(`Kind cold restart: Kubernetes recovered in ${api.recoveryMs} ms, PostgreSQL in ${database.databaseRecoveryMs} ms after Kubernetes\n`);
  return {...api, ...database};
}
