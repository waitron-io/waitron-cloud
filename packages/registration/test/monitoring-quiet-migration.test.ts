import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {after, test} from 'node:test';
import type {Pool} from 'pg';
import {EmailOutbox} from '../src/email-outbox.ts';
import {transaction} from '../src/transaction.ts';
import {fixture as currentFixture} from './fixtures/relay-worker.ts';
import {migrationRelease} from './fixtures/migration-release.ts';

const release = await migrationRelease(36);
const target = await migrationRelease(37);
const {migrate,names:migrationNames}=target;
const fixture=(initialise=migrate)=>currentFixture(initialise);
after(()=>target.close());
after(() => release.close());
const {checkConsumerSchema} = await import(new URL('../../../deploy/local-stack/runtime.mjs', import.meta.url).href);
const {hasReleaseMigrationCount} = await import(new URL('scripts/database-recovery-migrations.mjs','file://'+target.root+'/').href);
const root = target.root;

async function seed(f: Awaited<ReturnType<typeof fixture>>) {
  const outbox = new EmailOutbox({activeKeyId: 'fixture', keys: {fixture: randomBytes(32).toString('hex')}});
  const records: {incident: string; account: string; installation: string; opening: string; recovery?: string; name: string}[] = [];
  for (const name of ['open-pending', 'open-processing', 'open-sent', 'open-failed', 'recovered-failed', 'recovered-processing',
    'recovered-sent', 'recovered-queued', 'recovered-done', 'suppressed', 'no-installation']) {
    const v = await f.venue();
    const venue = (await f.pool.query('SELECT venue_id FROM installations WHERE id=$1', [v.installation])).rows[0].venue_id;
    const recovered = name.startsWith('recovered');
    const incident = randomUUID();
    await f.pool.query(`INSERT INTO venue_incidents(id,venue_id,kind,status,revision,opened_at,changed_at)
      VALUES($1,$2,'disconnected',$3,$4,clock_timestamp()-interval '1 hour',clock_timestamp())`,
      [incident, venue, name === 'suppressed' ? 'suppressed' : recovered ? 'recovered' : 'open', recovered || name === 'suppressed' ? 2 : 1]);
    async function notice(state: 'open' | 'recovered', revision: number) {
      return transaction(f.pool, async client => {
        const [id] = await outbox.enqueueServiceAlerts(client, [{email: `${v.account}@example.test`, locale: 'en',
          incidentId: incident, venueId: venue, revision, issue: 'disconnected', state}]);
        await client.query('INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id) VALUES($1,$2,$3,$4,$5)',
          [id, incident, revision, state, v.account]);
        return id!;
      });
    }
    const opening = await notice('open', 1);
    if (name.includes('processing')) await f.pool.query(`UPDATE email_outbox SET status='processing',claim_id=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '1 minute',attempts=1 WHERE id=$1`, [opening]);
    if (name.includes('failed')) await f.pool.query(`UPDATE email_outbox SET status='failed',payload=NULL,key_id=NULL,finished_at=clock_timestamp() WHERE id=$1`, [opening]);
    if (name.includes('sent') || name.includes('queued') || name.includes('done')) await f.pool.query(`UPDATE email_outbox
      SET status='sent',payload=NULL,key_id=NULL,finished_at=clock_timestamp(),transport='smtp',message_id='fixture-smtp' WHERE id=$1`, [opening]);
    const recovery = name.includes('queued') || name.includes('done') ? await notice('recovered', 2) : undefined;
    if (name.includes('done')) await f.pool.query(`UPDATE email_outbox SET status='sent',payload=NULL,key_id=NULL,finished_at=clock_timestamp() WHERE id=$1`, [recovery]);
    if (name === 'no-installation') await f.pool.query('UPDATE installations SET superseded_by=$2,revoked_at=clock_timestamp() WHERE id=$1', [v.installation, records[0]!.installation]);
    records.push({incident, account: v.account, installation: v.installation, opening, recovery, name});
  }
  const v = await f.venue();
  await v.submit();
  await f.pool.query(`INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope)
    VALUES($1,1,gen_random_uuid(),'independent-factor-ciphertext')`, [v.account]);
  await f.pool.query('UPDATE relay_control SET stopped=true');
  return records;
}

async function oldState(pool: Pool) {
  const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname=current_schema()
    AND tablename NOT IN ('schema_migrations','venue_alert_episodes','venue_alert_recipients','service_alert_deliveries') ORDER BY tablename`)).rows;
  const state: Record<string, unknown> = {};
  for (const {tablename} of tables) state[tablename] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
  state.deliveries = (await pool.query('SELECT outbox_id,incident_id,revision,state,account_id FROM service_alert_deliveries ORDER BY outbox_id')).rows;
  return state;
}

test('populated36UpgradePreservesLegacyWork', async () => {
  const f = await fixture(release.migrate);
  try {
    const records = await seed(f), before = await oldState(f.pool);
    const ledger = (await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    assert.equal(ledger.length, 36);
    await migrate(f.pool);
    assert.notEqual((await f.pool.query("SELECT to_regclass('venue_alert_episodes') AS relation")).rows[0].relation, null, '037 persists episode state');
    assert.deepEqual(await oldState(f.pool), before, 'outbox ciphertext, claims, receipts and independent account/factor/relay rows stay byte-identical');
    assert.deepEqual((await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0, 36), ledger);
    const episodes = (await f.pool.query('SELECT * FROM venue_alert_episodes')).rows;
    assert.equal(episodes.length, 9, 'suppressed and missing-current-installation incidents gain no authority');
    for (const episode of episodes) {
      assert.equal(episode.legacy, true); assert.equal(episode.quiet_seconds, 0); assert.equal(episode.reminder_seconds, 0);
      assert.equal(episode.opening_revision, 1); assert.ok(episode.opening_processed_at);
      assert.equal(episode.opening_due_at.getTime(), episode.opened_at.getTime());
      const recipients = (await f.pool.query('SELECT * FROM venue_alert_recipients WHERE episode_id=$1', [episode.id])).rows;
      assert.equal(recipients.length, 1); assert.equal(recipients[0].reminder_due_at, null); assert.equal(recipients[0].reminder_status, 'cancelled');
    }
    for (const record of records) {
      const delivery = (await f.pool.query('SELECT * FROM service_alert_deliveries WHERE outbox_id=$1', [record.opening])).rows[0];
      assert.equal(delivery.notification, 'transition');
      assert.equal(!!delivery.episode_id, !['suppressed', 'no-installation'].includes(record.name));
    }
    const sentRecovered = records.find(r => r.name === 'recovered-sent')!;
    const slot = (await f.pool.query(`SELECT r.*,e.recovery_complete FROM venue_alert_recipients r
      JOIN venue_alert_episodes e ON e.id=r.episode_id WHERE e.incident_id=$1`, [sentRecovered.incident])).rows[0];
    assert.equal(slot.recovery_status, 'cancelled', 'old sent opening gets no retroactive recovery');
    assert.equal(slot.recovery_complete, true);
  } finally {await f.close();}
});

test('legacyRecoveredInflightOpeningIsWatched', async () => {
  const f = await fixture(release.migrate);
  try {
    const records = await seed(f); await migrate(f.pool);
    assert.notEqual((await f.pool.query("SELECT to_regclass('venue_alert_episodes') AS relation")).rows[0].relation, null, '037 persists recovery work');
    for (const [name, status, complete] of [['recovered-processing', 'waiting', false], ['recovered-queued', 'queued', false], ['recovered-done', 'done', true]] as const) {
      const record = records.find(r => r.name === name)!;
      const row = (await f.pool.query(`SELECT e.*,r.recovery_status FROM venue_alert_episodes e
        JOIN venue_alert_recipients r ON r.episode_id=e.id WHERE incident_id=$1`, [record.incident])).rows[0];
      assert.equal(row.status, 'recovered'); assert.equal(row.recovery_revision, 2);
      assert.equal(row.recovery_status, status); assert.equal(row.recovery_complete, complete);
      if (record.recovery) assert.equal((await f.pool.query('SELECT episode_id FROM service_alert_deliveries WHERE outbox_id=$1', [record.recovery])).rows[0].episode_id, row.id);
    }
  } finally {await f.close();}
});

test('interrupted037RollsBackAndRetries', async () => {
  const f = await fixture(release.migrate), held = await f.pool.connect();
  let run: Promise<void> | undefined;
  try {
    await seed(f); const before = await oldState(f.pool);
    const ledger = (await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    await held.query('BEGIN'); const blocker = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await held.query('LOCK TABLE schema_migrations IN SHARE MODE');
    run = migrate(f.pool); void run.catch(() => {});
    let pid: number | undefined;
    for (let n = 0; n < 300; n++) {
      const row = (await f.pool.query(`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
        WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'INSERT INTO schema_migrations%'`, [f.schema])).rows[0];
      if (row?.blockers.includes(blocker)) {pid = row.pid; break;} await delay(10);
    }
    assert.ok(pid, '037 reaches its ledger insert after the DDL and backfill');
    await f.pool.query('SELECT pg_cancel_backend($1)', [pid]); await assert.rejects(run, {code: '57014'});
    assert.equal((await f.pool.query("SELECT to_regclass('venue_alert_episodes') AS relation")).rows[0].relation, null);
    assert.equal((await f.pool.query("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='service_alert_deliveries' AND column_name='episode_id'")).rows[0].count, '0');
    assert.deepEqual(await oldState(f.pool), before);
    assert.deepEqual((await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows, ledger);
    await held.query('ROLLBACK'); await migrate(f.pool); await migrate(f.pool);
    assert.equal((await f.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count, '37');
    assert.deepEqual(await oldState(f.pool), before);
  } finally {await held.query('ROLLBACK'); held.release(); await run?.catch(() => {}); await f.close();}
});

test('concurrent037BackfillRunsOnce', async () => {
  const f = await fixture(release.migrate);
  try {
    await seed(f); await Promise.all([migrate(f.pool), migrate(f.pool)]);
    assert.notEqual((await f.pool.query("SELECT to_regclass('venue_alert_episodes') AS relation")).rows[0].relation, null, '037 concurrent migration persists state');
    const episodes = (await f.pool.query('SELECT * FROM venue_alert_episodes ORDER BY id')).rows;
    const recipients = (await f.pool.query('SELECT * FROM venue_alert_recipients ORDER BY episode_id,account_id')).rows;
    assert.equal(episodes.length, 9); assert.equal(recipients.length, 9);
    await migrate(f.pool);
    assert.deepEqual((await f.pool.query('SELECT * FROM venue_alert_episodes ORDER BY id')).rows, episodes);
    assert.deepEqual((await f.pool.query('SELECT * FROM venue_alert_recipients ORDER BY episode_id,account_id')).rows, recipients);
  } finally {await f.close();}
});

test('current37LedgerIsExact', async () => {
  const f = await fixture();
  try {
    assert.equal(migrationNames.length, 37); assert.equal(migrationNames.at(-1), '037_monitoring_quiet_escalation.sql');
    assert.equal(hasReleaseMigrationCount('37'), true);
    for (const count of ['33', '34', '35', '36', '38']) assert.equal(hasReleaseMigrationCount(count), false);
    assert.equal(hasReleaseMigrationCount('36', release.names), true); assert.equal(hasReleaseMigrationCount('37', release.names), false);
    const ledger = (await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    for (const row of ledger) assert.equal(row.digest, createHash('sha256').update(await readFile(new URL('../migrations/' + row.name, import.meta.url))).digest('hex'));
    await checkConsumerSchema(f.pool, root); await assert.rejects(checkConsumerSchema(f.pool, release.root), /schema_incompatible/);
    const tail = ledger.at(-1);
    for (const sql of ["DELETE FROM schema_migrations WHERE name='037_monitoring_quiet_escalation.sql'",
      "UPDATE schema_migrations SET digest='changed' WHERE name='037_monitoring_quiet_escalation.sql'",
      "UPDATE schema_migrations SET name='unknown.sql' WHERE name='037_monitoring_quiet_escalation.sql'",
      "INSERT INTO schema_migrations(name,digest) VALUES('999_future.sql','future')"]) {
      await f.pool.query(sql); await assert.rejects(checkConsumerSchema(f.pool, root), /schema_incompatible/);
      await f.pool.query("DELETE FROM schema_migrations WHERE name IN('037_monitoring_quiet_escalation.sql','unknown.sql','999_future.sql')");
      await f.pool.query('INSERT INTO schema_migrations(name,digest,applied_at) VALUES($1,$2,$3)', [tail.name, tail.digest, tail.applied_at]);
    }
  } finally {await f.close();}
});

test('episode constraints refuse invalid timings, incomplete recovery and duplicate notification slots', async () => {
  const f = await fixture(release.migrate);
  try {
    const records = await seed(f); await migrate(f.pool);
    const record = records.find(r => r.name === 'open-pending')!;
    const episode = (await f.pool.query('SELECT * FROM venue_alert_episodes WHERE incident_id=$1', [record.incident])).rows[0];
    for (const sql of [
      "UPDATE venue_alert_episodes SET status='recovered',recovery_revision=NULL WHERE id=$1",
      'UPDATE venue_alert_episodes SET opening_revision=0 WHERE id=$1',
      'UPDATE venue_alert_episodes SET quiet_seconds=-1 WHERE id=$1',
      'UPDATE venue_alert_episodes SET reminder_seconds=604801 WHERE id=$1',
      "UPDATE venue_alert_episodes SET opening_due_at=opening_due_at+interval '1 second' WHERE id=$1",
      'UPDATE venue_alert_episodes SET recovery_complete=true WHERE id=$1',
      "UPDATE venue_alert_recipients SET reminder_status='queued',reminder_due_at=NULL WHERE episode_id=$1",
    ]) await assert.rejects(f.pool.query(sql, [episode.id]), {code: '23514'}, sql);
    await assert.rejects(f.pool.query(`INSERT INTO venue_alert_episodes(incident_id,installation_id,opening_revision,opened_at,
      quiet_seconds,reminder_seconds,opening_due_at,status) VALUES($1,$2,1,$3,0,0,$3,'open')`,
      [record.incident, record.installation, episode.opened_at]), {code: '23505'});
    await assert.rejects(f.pool.query("INSERT INTO venue_alert_recipients(episode_id,account_id,reminder_status,recovery_status) VALUES($1,$2,'cancelled','waiting')",
      [episode.id, record.account]), {code: '23505'});
    const outbox = new EmailOutbox({activeKeyId: 'fixture', keys: {fixture: randomBytes(32).toString('hex')}});
    const venue = (await f.pool.query('SELECT venue_id FROM venue_incidents WHERE id=$1', [record.incident])).rows[0].venue_id;
    const ids = await transaction(f.pool, c => outbox.enqueueServiceAlerts(c, Array.from({length: 3}, () =>
      ({email: `${record.account}@example.test`, locale: 'en', incidentId: record.incident, venueId: venue, revision: 1, issue: 'disconnected', state: 'open'}))));
    const insert = (id: string, revision: number, notification: string, state = 'open') => f.pool.query(`INSERT INTO service_alert_deliveries
      (outbox_id,incident_id,revision,state,account_id,episode_id,notification) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [id, record.incident, revision, state, record.account, episode.id, notification]);
    await insert(ids[0]!, 1, 'reminder');
    await assert.rejects(insert(ids[1]!, 1, 'reminder'), {code: '23505'});
    await assert.rejects(insert(ids[1]!, 3, 'reminder'), {code: '23505'}, 'episode identity also prevents revision-based duplicates');
    await assert.rejects(insert(ids[2]!, 2, 'reminder', 'recovered'), {code: '23514'});
    assert.equal((await f.pool.query('SELECT count(*) FROM service_alert_deliveries WHERE episode_id=$1', [episode.id])).rows[0].count, '2', 'opening and reminder share one revision');
  } finally {await f.close();}
});

test('legacy backfill snapshots only the latest opening links and leaves older links unmapped', async () => {
  const f = await fixture(release.migrate);
  try {
    const records = await seed(f);
    const record = records.find(r => r.name === 'open-sent')!, empty = records.find(r => r.name === 'open-pending')!;
    await f.pool.query('UPDATE venue_incidents SET revision=3 WHERE id=$1', [record.incident]);
    const old = (await f.pool.query('SELECT * FROM email_outbox WHERE id=$1', [record.opening])).rows[0];
    const next = randomUUID();
    await f.pool.query(`INSERT INTO email_outbox(id,kind,status,expires_at,finished_at)
      VALUES($1,'service_alert','sent',$2,clock_timestamp())`, [next, old.expires_at]);
    await f.pool.query("INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id) VALUES($1,$2,3,'open',$3)",
      [next, record.incident, record.account]);
    await f.pool.query('DELETE FROM service_alert_deliveries WHERE outbox_id=$1', [empty.opening]);
    await migrate(f.pool);
    assert.equal((await f.pool.query('SELECT episode_id FROM service_alert_deliveries WHERE outbox_id=$1', [record.opening])).rows[0].episode_id, null);
    const episode = (await f.pool.query('SELECT * FROM venue_alert_episodes WHERE incident_id=$1', [record.incident])).rows[0];
    assert.equal(episode.opening_revision, 3);
    assert.equal((await f.pool.query('SELECT episode_id FROM service_alert_deliveries WHERE outbox_id=$1', [next])).rows[0].episode_id, episode.id);
    assert.equal((await f.pool.query(`SELECT count(*) FROM venue_alert_recipients r JOIN venue_alert_episodes e ON e.id=r.episode_id
      WHERE e.incident_id=$1`, [empty.incident])).rows[0].count, '0', 'current membership cannot authorize a retroactive opening');
  } finally {await f.close();}
});

test('pinned releases 33 through 36 run their unchanged complete manifests', async () => {
  for (const count of [33, 34, 35, 36] as const) {
    const selected = await migrationRelease(count), f = await fixture(selected.migrate);
    try {
      await Promise.all([selected.migrate(f.pool), selected.migrate(f.pool)]);
      const ledger = (await f.pool.query('SELECT name,digest FROM schema_migrations ORDER BY name')).rows;
      assert.equal(ledger.length, count);
      assert.deepEqual(ledger.map(r => r.name), migrationNames.slice(0, count));
      for (const row of ledger) assert.equal(row.digest, createHash('sha256').update(await readFile(new URL('../migrations/' + row.name, import.meta.url))).digest('hex'));
      await checkConsumerSchema(f.pool, selected.root);
      await assert.rejects(checkConsumerSchema(f.pool, root), /schema_incompatible/);
    } finally {await f.close(); if (count !== 36) await selected.close();}
  }
});

test('legacy backfill keeps 103 recipients in statements of at most 100 rows', async () => {
  const f = await fixture(release.migrate), event = 'fixture_monitor_' + randomUUID().replaceAll('-', '');
  try {
    const records = await seed(f), record = records.find(r => r.name === 'open-pending')!;
    const old = (await f.pool.query('SELECT * FROM email_outbox WHERE id=$1', [record.opening])).rows[0];
    for (let n = 0; n < 102; n++) {
      const account = randomUUID(), id = randomUUID();
      await f.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)', [account]);
      await f.pool.query(`INSERT INTO email_outbox(id,kind,key_id,payload,expires_at) VALUES($1,'service_alert',$2,$3,$4)`,
        [id, old.key_id, old.payload, old.expires_at]);
      await f.pool.query("INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id) VALUES($1,$2,1,'open',$3)",
        [id, record.incident, account]);
    }
    await f.pool.query(`CREATE TABLE fixture_batch_sizes(kind text,size integer);
      CREATE FUNCTION fixture_monitor_batch() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE size integer; BEGIN
       SELECT count(*) INTO size FROM fixture_new_rows;
       IF size>100 THEN RAISE EXCEPTION 'monitor_batch_too_large'; END IF;
       INSERT INTO fixture_batch_sizes VALUES(TG_TABLE_NAME,size); RETURN NULL;
      END $$;
      CREATE FUNCTION fixture_monitor_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN
       IF to_regclass('venue_alert_recipients') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('venue_alert_recipients') AND tgname='fixture_recipient_batch'
       ) THEN
        CREATE TRIGGER fixture_recipient_batch AFTER INSERT ON venue_alert_recipients REFERENCING NEW TABLE AS fixture_new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION fixture_monitor_batch();
       END IF;
      END $$;
      CREATE EVENT TRIGGER ${event} ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION fixture_monitor_ddl();
      CREATE TRIGGER fixture_delivery_batch AFTER UPDATE ON service_alert_deliveries REFERENCING NEW TABLE AS fixture_new_rows
       FOR EACH STATEMENT EXECUTE FUNCTION fixture_monitor_batch()`);
    await migrate(f.pool);
    const episode = (await f.pool.query('SELECT id FROM venue_alert_episodes WHERE incident_id=$1', [record.incident])).rows[0].id;
    assert.equal((await f.pool.query('SELECT count(*) FROM venue_alert_recipients WHERE episode_id=$1', [episode])).rows[0].count, '103');
    assert.equal((await f.pool.query('SELECT count(*) FROM service_alert_deliveries WHERE episode_id=$1', [episode])).rows[0].count, '103');
    const batches = (await f.pool.query('SELECT kind,size FROM fixture_batch_sizes WHERE size=100')).rows;
    assert.deepEqual(batches.map(r => r.kind).sort(), ['service_alert_deliveries', 'venue_alert_recipients']);
    assert.equal((await f.pool.query('SELECT count(*) FROM fixture_batch_sizes WHERE size>100')).rows[0].count, '0');
  } finally {await f.pool.query(`DROP EVENT TRIGGER IF EXISTS ${event}`); await f.close();}
});
test('a recovered historical incident with no opening creates no notification authority',async()=>{
 const f=await fixture(release.migrate);
 try{
  const v=await f.venue(),venue=(await f.pool.query('SELECT venue_id FROM installations WHERE id=$1',[v.installation])).rows[0].venue_id;
  const incident=randomUUID();await f.pool.query("INSERT INTO venue_incidents(id,venue_id,kind,status,revision) VALUES($1,$2,'disconnected','recovered',2)",[incident,venue]);await migrate(f.pool);
  const episode=(await f.pool.query('SELECT * FROM venue_alert_episodes WHERE incident_id=$1',[incident])).rows[0];assert.equal(episode.legacy,true);assert.equal(episode.recovery_complete,true);assert.equal((await f.pool.query('SELECT count(*) FROM venue_alert_recipients WHERE episode_id=$1',[episode.id])).rows[0].count,'0');
  const {MonitorWorker}=await import('../src/monitoring.ts');const worker=new MonitorWorker(f.pool,new EmailOutbox({activeKeyId:'proof',keys:{proof:randomBytes(32).toString('hex')}}),{quietSeconds:2,reminderSeconds:3});await worker.schedule();
  for(let n=0;n<3;n++){await f.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp()');await worker.runOnce();}
  assert.equal((await f.pool.query('SELECT count(*) FROM service_alert_deliveries')).rows[0].count,'0');assert.equal((await f.pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');
 }finally{await f.close();}
});
