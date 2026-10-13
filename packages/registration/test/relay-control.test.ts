import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool, type PoolClient} from 'pg';
import * as registration from '../src/index.ts';
import {migrate} from '../src/migrate.ts';

async function fixture() {
  const schema = `relay_control_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
  const options = `-c search_path=${schema} -c statement_timeout=5000`;
  const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, options, application_name: schema});
  const writer = new Pool({connectionString: process.env.TEST_DATABASE_URL, options, application_name: schema + '_writer'});
  const reader = new Pool({connectionString: process.env.TEST_DATABASE_URL, options, application_name: schema + '_reader'});
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  return {schema, pool, writer, reader, async close() {
    await Promise.all([pool.end(), writer.end(), reader.end()]);
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }};
}
function control(pool: Pool) {
  assert.equal(typeof registration.RelayControl, 'function', 'durable relay control is available');
  return new registration.RelayControl(pool);
}
async function unavailable(action: Promise<unknown>) {
  await assert.rejects(action, {code: 'relay_unavailable'});
}
async function waitLock(observer: Pool | PoolClient, name: string, query: string, blocker: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await observer.query('SELECT pg_stat_clear_snapshot()');
    const row = (await observer.query(`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2`, [name, '%' + query + '%'])).rows[0];
    if (row?.blockers.includes(blocker)) return row.pid as number;
    await delay(10);
  }
  assert.fail(`expected ${name} to wait at ${query} on backend ${blocker}`);
}

test('control is durable and idempotent without changing unrelated account state', async () => {
  const f = await fixture();
  try {
    const c = control(f.pool), other = control(f.writer);
    await f.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)', [randomUUID()]);
    const accounts = (await f.pool.query('SELECT * FROM cloud_accounts')).rows;
    assert.deepEqual(await c.status(), {stopped: false});
    assert.deepEqual(await c.stop(), {stopped: true});
    assert.deepEqual(await c.stop(), {stopped: true});
    assert.deepEqual(await other.status(), {stopped: true});
    assert.deepEqual(await other.resume(), {stopped: false});
    assert.deepEqual(await other.resume(), {stopped: false});
    assert.deepEqual(await c.status(), {stopped: false});
    assert.deepEqual((await f.pool.query('SELECT * FROM cloud_accounts')).rows, accounts);
    assert.equal((await f.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count, '0');
  } finally {await f.close();}
});

test('control locks require transactions and missing rows fail closed without repair', async () => {
  const f = await fixture(), client = await f.pool.connect();
  try {
    const c = control(f.pool);
    await assert.rejects(c.lock(client), {code: 'transaction_required'});
    assert.deepEqual(await c.status(), {stopped: false});
    await f.pool.query('DELETE FROM relay_control');
    await unavailable(c.status()); await unavailable(c.stop()); await unavailable(c.resume());
    await client.query('BEGIN');
    await unavailable(c.lock(client));
    await client.query('ROLLBACK');
    assert.equal((await f.pool.query('SELECT count(*) FROM relay_control')).rows[0].count, '0');
  } finally {await client.query('ROLLBACK'); client.release(); await f.close();}
});

test('control schema refuses a second row and a false singleton', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await control(f.pool).status(), {stopped: false});
    await assert.rejects(f.pool.query('INSERT INTO relay_control(singleton,stopped) VALUES(false,false)'), {code: '23514'});
    await assert.rejects(f.pool.query('INSERT INTO relay_control(singleton,stopped) VALUES(true,true)'), {code: '23505'});
    assert.deepEqual((await f.pool.query('SELECT * FROM relay_control')).rows, [{singleton: true, stopped: false}]);
  } finally {await f.close();}
});

test('two shared readers block acknowledged stop until both transactions end', async () => {
  const f = await fixture(), first = await f.pool.connect(), second = await f.reader.connect();
  let stop: Promise<unknown> | undefined;
  try {
    const c = control(f.pool), writer = control(f.writer);
    await first.query('BEGIN'); await second.query('BEGIN');
    const firstPid = (await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    assert.deepEqual(await c.lock(first), {stopped: false});
    assert.deepEqual(await c.lock(second), {stopped: false});
    let acknowledged = false;
    stop = writer.stop().then(value => {acknowledged = true; return value;});
    void stop.catch(() => {});
    await waitLock(f.pool, f.schema + '_writer', 'FOR UPDATE', firstPid);
    assert.equal(acknowledged, false);
    await first.query('COMMIT');
    await waitLock(f.pool, f.schema + '_writer', 'FOR UPDATE', secondPid);
    assert.equal(acknowledged, false);
    await second.query('ROLLBACK');
    assert.deepEqual(await stop, {stopped: true});
    assert.deepEqual(await c.status(), {stopped: true});
  } finally {
    await first.query('ROLLBACK'); await second.query('ROLLBACK');
    first.release(); second.release(); await stop?.catch(() => {}); await f.close();
  }
});

test('concurrent stop and resume serialize their committed results', async () => {
  const f = await fixture(), held = await f.pool.connect();
  let stop: Promise<unknown> | undefined, resume: Promise<unknown> | undefined;
  try {
    const c = control(f.pool), writer = control(f.writer), reader = control(f.reader);
    await held.query('BEGIN');
    const blocker = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await held.query('SELECT * FROM relay_control WHERE singleton FOR UPDATE');
    stop = writer.stop(); void stop.catch(() => {});
    const stopPid = await waitLock(f.pool, f.schema + '_writer', 'FOR UPDATE', blocker);
    resume = reader.resume(); void resume.catch(() => {});
    await waitLock(f.pool, f.schema + '_reader', 'FOR UPDATE', stopPid);
    await held.query('COMMIT');
    assert.deepEqual(await stop, {stopped: true});
    assert.deepEqual(await resume, {stopped: false});
    assert.deepEqual(await c.status(), {stopped: false});
  } finally {
    await held.query('ROLLBACK'); held.release();
    await Promise.all([stop?.catch(() => {}), resume?.catch(() => {})]); await f.close();
  }
});
