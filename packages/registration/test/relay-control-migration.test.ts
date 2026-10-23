import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import test, {after} from 'node:test';
import type {Pool, PoolClient} from 'pg';
import * as registration from '../src/index.ts';
import {migrationRelease} from './fixtures/migration-release.ts';
const release = await migrationRelease(36);
const {migrate, names: migrationNames} = release;
after(() => release.close());
import {fixture} from './fixtures/relay-worker.ts';
import {admitFixtureMessage} from './fixtures/relay-counter-rollover.ts';

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
  const submit = () => admitFixtureMessage(() => v.submit(),
    evidence => console.log('migration rollover evidence', JSON.stringify(evidence)));
  const queued = await submit(), delayed = await submit(), claimed = await submit(), sending = await submit();
  const terminal = await submit();
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
  const f = await fixture(release.migrate);
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
      assert.equal(row.digest, createHash('sha256').update(await readFile(new URL('packages/registration/migrations/' + row.name, 'file://' + release.root + '/'))).digest('hex'));
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
  const f = await fixture(release.migrate), held = await f.pool.connect();
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
  const f = await fixture(release.migrate);
  try {
    const root = release.root;
    assert.equal(hasReleaseMigrationCount('36', release.names), true);
    for (const count of ['33', '34', '35', '37']) assert.equal(hasReleaseMigrationCount(count, release.names), false);
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


test('migration setup survives a proved counter rollover without retaining a failed admission', async () => {
  const f = await fixture(release.migrate);
  const notices: string[] = [], observed = new Set<PoolClient>();
  const onNotice = (notice: {message?: string}) => {
    if (notice.message?.startsWith('relay counter rollover: ')) {
      notices.push(notice.message); console.log(notice.message);
    }
  };
  const observeClient = (client: PoolClient) => {
    if (!observed.has(client)) {observed.add(client); client.on('notice', onNotice);}
  };
  f.pool.on('connect', observeClient);
  try {
    const v = await f.venue();
    const messages = new registration.RelayMessages(f.pool, f.issuer, 'http://localhost',
      {...f.relay, bounds: {...f.relay.bounds, windowSeconds: 1}});
    const body = {version: 1, messageId: randomUUID(), grantId: v.grant.id, grantRevision: 1,
      class: 'password_reset', recipient: 'migration@example.test', displayName: 'Ana',
      locale: 'es-ES', timeZone: 'Europe/Madrid', expiresAt: new Date(Date.now() + 1800000).toISOString(),
      token: Buffer.alloc(32, 1).toString('base64url')};
    await f.pool.query(`CREATE SEQUENCE fixture_admission_attempt;
      CREATE FUNCTION fixture_cross_counter_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF nextval('fixture_admission_attempt')=1 THEN
          PERFORM pg_sleep(1.1);
          RAISE NOTICE 'relay counter rollover: %', json_build_object(
            'counterEndsAt', (SELECT max(ends_at) FROM relay_bounds_windows),
            'databaseNow', clock_timestamp(), 'messageExpiresAt', NEW.expires_at,
            'counterRows', (SELECT count(*) FROM relay_bounds_counters),
            'reservations', (SELECT count(*) FROM relay_reservations));
        END IF;
        RETURN NEW;
      END$$;
      CREATE TRIGGER fixture_cross_counter_boundary BEFORE INSERT ON relay_messages
        FOR EACH ROW EXECUTE FUNCTION fixture_cross_counter_boundary()`);
    const observer = await f.pool.connect();
    observeClient(observer);
    observer.release();
    const rollovers: unknown[] = [];
    const held = await f.pool.connect();
    let result: Awaited<ReturnType<typeof messages.execute>>;
    try {
      result = await admitFixtureMessage(
        () => messages.execute('email-submit', v.proof('email-submit', body)),
        evidence => {rollovers.push(evidence); console.log('migration rollover evidence', JSON.stringify(evidence));});
    } finally {held.release();}
    assert.equal(result.created, true);
    assert.equal(notices.length, 1, 'the pool connection used for admission reports the rollover notice');
    assert.ok(rollovers.length >= 1, 'the deliberately expired admission is reported');
    assert.ok(Number((await f.pool.query('SELECT last_value FROM fixture_admission_attempt')).rows[0].last_value) >= 2);
    assert.equal((await f.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count, '1');
    assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count, '1');
    assert.deepEqual((await f.pool.query('SELECT kind,count::text FROM relay_bounds_counters ORDER BY kind')).rows,
      [{kind: 'grant', count: '1'}, {kind: 'recipient', count: '1'}]);
    assert.equal((await messages.execute('email-submit', v.proof('email-submit', body))).created, false);
    assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count, '1');
    assert.deepEqual((await f.pool.query('SELECT kind,count::text FROM relay_bounds_counters ORDER BY kind')).rows,
      [{kind: 'grant', count: '1'}, {kind: 'recipient', count: '1'}], 'replay preserves both abuse counters');
    await f.row(body.messageId);
  } finally {
    f.pool.removeListener('connect', observeClient);
    for (const client of observed) client.removeListener('notice', onNotice);
    await f.close();
  }
});
