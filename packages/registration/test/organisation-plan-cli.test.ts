import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer, type Socket} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {after, before, beforeEach, test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';

const schema = `plan_cli_${randomUUID().replaceAll('-', '')}`, organisationId = randomUUID();
const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`});
const diagnostic = 'Organisation plan failed; check test mode, arguments, database and migrations\n';
let connection: string;
const children = new Set<ReturnType<typeof command>>();
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
  await pool.query('INSERT INTO organisations(id) VALUES($1)', [organisationId]);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema} -c transaction_timeout=0`); connection = url.href;
});
beforeEach(async () => {await pool.query("UPDATE organisations SET service_plan='free',service_plan_revision=0");});
after(async () => {
  for (const child of children) {child.process.kill('SIGKILL'); await child.done;}
  await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
});
function command(args = ['show', '--organisation', organisationId], env: Record<string, string | undefined> = {}) {
  const child = spawn(process.execPath, ['src/organisation-plan-cli.ts', ...args], {
    cwd: new URL('..', import.meta.url), env: {...process.env, DATABASE_URL: connection, CLOUD_TEST_SERVICE_PLANS: '1', PGAPPNAME: schema, ...env}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => {stdout += chunk;}); child.stderr.on('data', chunk => {stderr += chunk;});
  const started = Date.now(), timer = setTimeout(() => child.kill('SIGKILL'), 16000);
  const done = new Promise<{code: number | null; signal: string | null}>((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => {clearTimeout(timer); resolve({code, signal});});
  });
  const result = {process: child, done, output: () => stdout, error: () => stderr, elapsed: () => Date.now() - started};
  children.add(result); void done.finally(() => children.delete(result)); return result;
}
async function failure(child: ReturnType<typeof command>) {
  assert.deepEqual(await child.done, {code: 1, signal: null});
  assert.equal(child.output(), ''); assert.equal(child.error(), diagnostic);
  assert.equal((await admin.query('SELECT count(*) FROM pg_stat_activity WHERE application_name=$1', [schema])).rows[0].count, '0');
}
async function success(child: ReturnType<typeof command>, plan: string, revision: number, changed: boolean) {
  assert.deepEqual(await child.done, {code: 0, signal: null}, child.error());
  assert.equal(child.error(), ''); assert.deepEqual(JSON.parse(child.output()), {organisationId, plan, revision, changed});
  assert.ok(child.elapsed() < 5000);
}
async function unchanged() {
  assert.deepEqual((await pool.query('SELECT service_plan,service_plan_revision FROM organisations WHERE id=$1', [organisationId])).rows, [{service_plan: 'free', service_plan_revision: 0}]);
}
const set = ['set', '--organisation', organisationId, '--plan', 'paid'];

test('CLI shows and sets committed scoped plans across fresh processes', async () => {
  await success(command(), 'free', 0, false);
  await success(command(set), 'paid', 1, true); await success(command(set), 'paid', 1, false);
  await success(command(), 'paid', 1, false);
  await success(command(['set', '--organisation', organisationId, '--plan', 'free']), 'free', 2, true);
});
test('cli_requires_explicit_test_mode', async () => {
  for (const flag of [undefined, '0', '', 'true', '01', '2']) {await failure(command(set, {CLOUD_TEST_SERVICE_PLANS: flag})); await unchanged();}
});
test('cli_rejects_unknown_org_bad_plan_and_stale_schema', async () => {
  for (const args of [[], ['invalid'], ['show', '--organisation', randomUUID()], ['show', '--organisation', 'private-plan-sentinel'],
    ['set', '--organisation', organisationId, '--plan', 'trial'], [...set, '--plan', 'free'], [...set, '--extra'], ['show', '--organisation', organisationId, '--plan', 'paid']]) {
    await failure(command(args)); await unchanged();
  }
  const ledger = (await pool.query('SELECT * FROM schema_migrations')).rows;
  try {
    for (const sql of ["DELETE FROM schema_migrations WHERE name='042_organisation_service_plans.sql'",
      "UPDATE schema_migrations SET digest='private-plan-sentinel' WHERE name='041_content_translation_service.sql'",
      "INSERT INTO schema_migrations(name,digest) VALUES('999_unknown.sql','private-plan-sentinel')"]) {
      await pool.query(sql); await failure(command(set)); await failure(command()); await unchanged();
      await pool.query('TRUNCATE schema_migrations');
      for (const row of ledger) await pool.query('INSERT INTO schema_migrations(name,digest,applied_at) VALUES($1,$2,$3)', [row.name, row.digest, row.applied_at]);
    }
  } finally {
    await pool.query('TRUNCATE schema_migrations');
    for (const row of ledger) await pool.query('INSERT INTO schema_migrations(name,digest,applied_at) VALUES($1,$2,$3)', [row.name, row.digest, row.applied_at]);
  }
});
test('CLI database configuration failures do not disclose connection credentials', async () => {
  for (const value of [undefined, '', 'private-plan-sentinel', 'https://user:private-plan-sentinel@localhost/db', 'postgres://user:private-plan-sentinel@127.0.0.1:1/db']) {
    await failure(command(set, {DATABASE_URL: value})); await unchanged();
  }
});
test('CLI commit failure rolls back without acknowledgement or private error output', async () => {
  await pool.query("CREATE FUNCTION plan_cli_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-plan-sentinel'; END $$");
  await pool.query('CREATE CONSTRAINT TRIGGER plan_cli_fail AFTER UPDATE ON organisations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION plan_cli_fail()');
  try {await failure(command(set)); await unchanged();}
  finally {await pool.query('DROP TRIGGER plan_cli_fail ON organisations'); await pool.query('DROP FUNCTION plan_cli_fail()');}
});
test('CLI acknowledges only after shared readers release the policy lock', async () => {
  const reader = await pool.connect(); await reader.query('BEGIN');
  await reader.query('SELECT * FROM organisations WHERE id=$1 FOR SHARE', [organisationId]);
  const pid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const child = command(set);
  try {
    const deadline = Date.now() + 3000;
    let waiting = false;
    while (Date.now() < deadline) {
      waiting = !!(await admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))', [schema, pid])).rowCount;
      if (waiting) break; await delay(10);
    }
    assert.equal(waiting, true); assert.equal(child.output(), ''); await unchanged();
    await reader.query('COMMIT'); await success(child, 'paid', 1, true);
  } finally {await reader.query('ROLLBACK'); reader.release(); await child.done;}
});
test('CLI connection deadline bounds a database peer that never completes startup', async () => {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const child = command(set, {DATABASE_URL: `postgres://user:private-plan-sentinel@127.0.0.1:${address.port}/db`});
    await failure(child); assert.ok(child.elapsed() < 7000); await unchanged();
  } finally {for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve()));}
});
test('CLI statement deadline bounds an unavailable migration ledger', async () => {
  const blocker = await pool.connect(); await blocker.query('BEGIN'); await blocker.query('LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE');
  const child = command(set);
  try {await failure(child); assert.ok(child.elapsed() < 12000); await unchanged();}
  finally {await blocker.query('ROLLBACK'); blocker.release(); await child.done;}
});
