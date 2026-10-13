import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import type {Pool} from 'pg';
import * as registration from '../src/index.ts';
import {migrate, migrationNames} from '../src/migrate.ts';
import {fixture} from './fixtures/relay-worker.ts';

const {checkConsumerSchema} = await import(new URL('../../../deploy/local-stack/runtime.mjs', import.meta.url).href);
const {hasReleaseMigrationCount} = await import(new URL('../../../scripts/database-recovery-migrations.mjs', import.meta.url).href);

async function snapshot(pool: Pool) {
  const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname=current_schema()
    AND tablename NOT IN ('relay_control','schema_migrations') ORDER BY tablename`)).rows;
  const values: Record<string, unknown> = {};
  for (const {tablename} of tables) {
    values[tablename] = (await pool.query(`SELECT to_jsonb(t) AS value FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return {values, oid: (await pool.query("SELECT 'relay_messages'::regclass::oid AS oid")).rows[0].oid};
}
async function removeControl(pool: Pool) {
  await pool.query('DROP TABLE relay_control');
  await pool.query("DELETE FROM schema_migrations WHERE name='036_relay_operator_stop.sql'");
}
async function populate(f: Awaited<ReturnType<typeof fixture>>) {
  const v = await f.venue();
  const queued = await v.submit(), delayed = await v.submit(), claimed = await v.submit(), sending = await v.submit();
  const terminal = await v.submit();
  await f.pool.query("UPDATE relay_messages SET available_at=clock_timestamp()+interval '5 minutes' WHERE message_id=$1", [delayed.messageId]);
  await f.pool.query("UPDATE relay_messages SET claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute' WHERE message_id=$1", [claimed.messageId]);
  await f.pool.query("UPDATE relay_messages SET state='sending',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute',attempts=1 WHERE message_id=$1", [sending.messageId]);
  await f.pool.query("UPDATE relay_messages SET state='accepted',payload=NULL WHERE message_id=$1", [terminal.messageId]);
  const generation = randomUUID(), session = (await f.pool.query('SELECT id FROM cloud_sessions WHERE account_id=$1', [v.account])).rows[0].id;
  await f.pool.query("INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope) VALUES($1,1,$2,'preserved-factor-ciphertext')", [v.account, generation]);
  await f.pool.query(`INSERT INTO cloud_factor_enrolments(id,token_hash,account_id,session_id,password_fingerprint,base_version,secret_envelope,expires_at,attempt_limit)
    VALUES($1,$2,$3,$4,$5,1,'preserved-pending-ciphertext',clock_timestamp()+interval '10 minutes',3)`, [randomUUID(), 'ab'.repeat(32), v.account, session, 'cd'.repeat(32)]);
  await f.pool.query(`INSERT INTO cloud_factor_login_challenges(token_hash,account_id,password_fingerprint,factor_version,expires_at,attempt_limit)
    VALUES($1,$2,$3,1,clock_timestamp()+interval '10 minutes',3)`, ['ef'.repeat(32), v.account, 'cd'.repeat(32)]);
  await f.pool.query('INSERT INTO cloud_factor_recovery_codes(account_id,secret_generation,factor_version,code_hash) VALUES($1,$2,1,$3)', [v.account, generation, '12'.repeat(32)]);
  await f.pool.query("INSERT INTO cloud_factor_replays(account_id,secret_generation,time_step,code_hash,valid_until) VALUES($1,$2,1,$3,clock_timestamp()+interval '1 minute')", [v.account, generation, '34'.repeat(32)]);
  assert.deepEqual((await f.row(queued.messageId)).state, 'queued');
}

test('036 preserves every populated release-35 row and digest across concurrent repeated upgrade', async () => {
  const f = await fixture();
  try {
    assert.equal(migrationNames.at(-1), '036_relay_operator_stop.sql');
    await populate(f); await removeControl(f.pool);
    const before = await snapshot(f.pool);
    const ledger = (await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    assert.equal(ledger.length, 35);
    assert.deepEqual(ledger.map(row => row.name), migrationNames.slice(0, 35));
    await Promise.all([migrate(f.pool), migrate(f.pool)]); await migrate(f.pool);
    assert.deepEqual(await snapshot(f.pool), before);
    const upgraded = (await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    assert.deepEqual(upgraded.slice(0, 35), ledger);
    assert.equal(upgraded.length, 36);
    assert.equal(upgraded[35].name, '036_relay_operator_stop.sql');
    for (const row of upgraded) {
      assert.equal(row.digest, createHash('sha256').update(await readFile(new URL('../migrations/' + row.name, import.meta.url))).digest('hex'));
    }
    assert.deepEqual((await f.pool.query('SELECT * FROM relay_control')).rows, [{singleton: true, stopped: false}]);
    const control = new registration.RelayControl(f.pool);
    assert.deepEqual(await control.stop(), {stopped: true});
    await Promise.all([migrate(f.pool), migrate(f.pool)]); await migrate(f.pool);
    assert.deepEqual(await control.status(), {stopped: true});
    assert.deepEqual(await snapshot(f.pool), before);
  } finally {await f.close();}
});

test('cancelled 036 ledger insert rolls back its table and every old row before retry', async () => {
  const f = await fixture(), held = await f.pool.connect();
  let run: Promise<void> | undefined;
  try {
    assert.equal(migrationNames.at(-1), '036_relay_operator_stop.sql');
    await populate(f); await removeControl(f.pool);
    const before = await snapshot(f.pool);
    const ledger = (await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    await held.query('BEGIN');
    const blocker = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await held.query('LOCK TABLE schema_migrations IN SHARE MODE');
    run = migrate(f.pool); void run.catch(() => {});
    let pid: number | undefined;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const row = (await f.pool.query(`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
        WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'INSERT INTO schema_migrations%'`, [f.schema])).rows[0];
      if (row?.blockers.includes(blocker)) {pid = row.pid; break;}
      await delay(10);
    }
    assert.ok(pid, '036 insert is blocked by the held ledger lock');
    await f.pool.query('SELECT pg_cancel_backend($1)', [pid]);
    await assert.rejects(run, {code: '57014'});
    assert.equal((await f.pool.query("SELECT to_regclass('relay_control') AS relation")).rows[0].relation, null);
    assert.deepEqual((await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows, ledger);
    assert.deepEqual(await snapshot(f.pool), before);
    await held.query('ROLLBACK');
    await migrate(f.pool);
    assert.equal((await f.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count, '36');
    assert.deepEqual((await f.pool.query('SELECT * FROM relay_control')).rows, [{singleton: true, stopped: false}]);
    assert.deepEqual(await snapshot(f.pool), before);
  } finally {await held.query('ROLLBACK'); held.release(); await run?.catch(() => {}); await f.close();}
});

test('release-36 consumer and recovery gates refuse historical future missing and changed ledgers', async () => {
  const f = await fixture();
  try {
    const root = new URL('../../../', import.meta.url).pathname;
    assert.equal(hasReleaseMigrationCount('36'), true);
    for (const count of ['33', '34', '35', '37']) assert.equal(hasReleaseMigrationCount(count), false);
    await checkConsumerSchema(f.pool, root);
    const tail = (await f.pool.query("SELECT * FROM schema_migrations WHERE name='036_relay_operator_stop.sql'")).rows[0];
    await f.pool.query("DELETE FROM schema_migrations WHERE name='036_relay_operator_stop.sql'");
    await assert.rejects(checkConsumerSchema(f.pool, root), /schema_incompatible/);
    await f.pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)', [tail.name, 'changed']);
    await assert.rejects(checkConsumerSchema(f.pool, root), /schema_incompatible/);
    await f.pool.query('UPDATE schema_migrations SET digest=$2 WHERE name=$1', [tail.name, tail.digest]);
    await f.pool.query("UPDATE schema_migrations SET name='unknown.sql' WHERE name='036_relay_operator_stop.sql'");
    await assert.rejects(checkConsumerSchema(f.pool, root), /schema_incompatible/);
    await f.pool.query("UPDATE schema_migrations SET name='036_relay_operator_stop.sql' WHERE name='unknown.sql'");
    await checkConsumerSchema(f.pool, root);
  } finally {await f.close();}
});
