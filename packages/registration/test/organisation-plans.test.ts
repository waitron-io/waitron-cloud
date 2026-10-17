import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {after, before, beforeEach, test} from 'node:test';
import {Pool} from 'pg';
import {migrate, migrationNames} from '../src/migrate.ts';
import {transaction} from '../src/transaction.ts';
import {OrganisationPlanStore, planAllows, readOrganisationPlan, requirePlanService,
  parsePlanMode, requireTestPlanVenue, type PlanService} from '../src/organisation-plans.ts';

const schema = `plans_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, application_name: schema,
  options: `-c search_path=${schema} -c statement_timeout=5000`});
const store = new OrganisationPlanStore(pool);
const first = randomUUID(), second = randomUUID();
const services: PlanService[] = ['address_lookup', 'transactional_email', 'content_translation',
  'continuous_backup', 'retained_snapshots', 'remote_access'];
before(async () => {await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool);});
beforeEach(async () => {
  await pool.query('DELETE FROM organisations');
  await pool.query('INSERT INTO organisations(id) VALUES($1),($2)', [first, second]);
});
after(async () => {await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();});
const view = (organisationId = first, plan = 'free', revision = 0, changed = false) => ({organisationId, plan, revision, changed});

test('free_is_default_and_paid_adds_only_backup_and_remote', async () => {
  assert.deepEqual(await store.show(first), view());
  for (const [index, service] of services.entries()) {
    assert.equal(planAllows('free', service), index < 3, service);
    assert.equal(planAllows('paid', service), true, service);
    await transaction(pool, async client => {
      if (index < 3) await requirePlanService(client, first, service, 'test-free-paid');
      else await assert.rejects(requirePlanService(client, first, service, 'test-free-paid'), /permission_denied/);
    });
  }
  await store.set(first, 'paid');
  for (const service of services) await transaction(pool, client => requirePlanService(client, first, service, 'test-free-paid'));
  for (const plan of ['free', 'paid'] as const) assert.equal(planAllows(plan, 'fiscal_allocation' as PlanService), false);
  assert.equal(planAllows('invalid' as 'paid', 'remote_access'), false);
});

test('set_is_atomic_idempotent_and_scoped', async () => {
  assert.deepEqual(await store.set(first, 'free'), view());
  assert.deepEqual(await store.set(first, 'paid'), view(first, 'paid', 1, true));
  assert.deepEqual(await store.set(first, 'paid'), view(first, 'paid', 1));
  assert.deepEqual(await store.show(second), view(second));
  assert.deepEqual(await store.set(first, 'free'), view(first, 'free', 2, true));
  assert.deepEqual(await store.show(first), view(first, 'free', 2));
});

test('concurrent first readers and setters keep one revision per change', async () => {
  const results = await Promise.all(Array.from({length: 12}, () => store.set(first, 'paid')));
  assert.equal(results.filter(result => result.changed).length, 1);
  for (const result of results) assert.equal(result.revision, 1);
  const reads = await Promise.all(Array.from({length: 6}, () => store.show(first)));
  for (const result of reads) assert.deepEqual(result, view(first, 'paid', 1));
  assert.deepEqual(await store.show(second), view(second));
});

test('shared policy readers block an update until their transaction commits', async () => {
  const reader = await pool.connect();
  await reader.query('BEGIN');
  let update: Promise<unknown> | undefined;
  try {
    assert.equal(await readOrganisationPlan(reader, first), 'free');
    const pid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    update = store.set(first, 'paid');
    const deadline = Date.now() + 3000;
    let waiting = false;
    while (Date.now() < deadline) {
      waiting = !!(await admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))', [schema, pid])).rowCount;
      if (waiting) break;
      await delay(10);
    }
    assert.equal(waiting, true, 'setter must wait for the shared policy lock');
    assert.deepEqual(await store.show(first), view());
    await reader.query('COMMIT');
    assert.deepEqual(await update, view(first, 'paid', 1, true));
  } finally {await reader.query('ROLLBACK'); reader.release(); await update;}
});

test('failed commit leaves the plan and revision unchanged', async () => {
  await pool.query("CREATE FUNCTION plan_commit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-plan-sentinel'; END $$");
  await pool.query('CREATE CONSTRAINT TRIGGER plan_commit_fail AFTER UPDATE ON organisations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION plan_commit_fail()');
  try {
    await assert.rejects(store.set(first, 'paid'), /private-plan-sentinel/);
    assert.deepEqual(await store.show(first), view());
    assert.deepEqual(await store.show(second), view(second));
  } finally {await pool.query('DROP TRIGGER plan_commit_fail ON organisations'); await pool.query('DROP FUNCTION plan_commit_fail()');}
});

test('unknown organisations and invalid inputs never create or change a plan', async () => {
  for (const id of [randomUUID(), 'invalid', '']) {
    await assert.rejects(store.show(id)); await assert.rejects(store.set(id, 'paid'));
  }
  await assert.rejects(store.set(first, 'trial' as 'paid'));
  assert.deepEqual(await store.show(first), view());
  assert.equal((await pool.query('SELECT count(*) FROM organisations')).rows[0].count, '2');
});

test('ordinary_mode_preserves_existing_behaviour', async () => {
  assert.equal(parsePlanMode(undefined), 'existing'); assert.equal(parsePlanMode('0'), 'existing');
  assert.equal(parsePlanMode('1'), 'test-free-paid');
  await transaction(pool, async client => {
    for (const service of services) await requirePlanService(client, randomUUID(), service, 'existing');
    await assert.rejects(requirePlanService(client, randomUUID(), 'remote_access', 'test-free-paid'));
    await assert.rejects(requirePlanService(client, first, 'remote_access', 'invalid' as 'existing'));
  });
  for (const flag of ['', 'true', '01', ' 1', '2']) assert.throws(() => parsePlanMode(flag), /invalid_plan_mode/);
});

test('test_mode_rejects_production_venue', () => {
  requireTestPlanVenue('test', 'test-free-paid');
  requireTestPlanVenue('production', 'existing');
  for (const environment of ['production', '', 'dev']) assert.throws(() => requireTestPlanVenue(environment, 'test-free-paid'), /permission_denied/);
  assert.throws(() => requireTestPlanVenue('test', 'invalid' as 'existing'), /invalid_plan_mode/);
});

test('migration upgrades existing organisations without changing legacy data and remains repeatable', async () => {
  const legacy = `plans_legacy_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${legacy}`);
  const old = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${legacy}`});
  try {
    await old.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
    for (const name of migrationNames.slice(0, 41)) {
      const sql = await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
      await old.query(sql);
      await old.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)', [name, createHash('sha256').update(sql).digest('hex')]);
    }
    await old.query('INSERT INTO organisations(id) VALUES($1)', [first]);
    await Promise.all([migrate(old), migrate(old)]);
    assert.deepEqual(await new OrganisationPlanStore(old).show(first), view());
    assert.equal((await old.query('SELECT count(*) FROM schema_migrations')).rows[0].count, '42');
    await assert.rejects(old.query("UPDATE organisations SET service_plan='trial'"));
    await assert.rejects(old.query('UPDATE organisations SET service_plan_revision=-1'));
    await assert.rejects(old.query('UPDATE organisations SET service_plan=NULL'));
  } finally {await old.end(); await admin.query(`DROP SCHEMA ${legacy} CASCADE`);}
});
