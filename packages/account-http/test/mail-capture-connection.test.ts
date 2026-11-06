import assert from 'node:assert/strict';
import {createServer as createHttpServer} from 'node:http';
import {createServer as createTcpServer, type Socket} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {test, type TestContext} from 'node:test';
import {Pool} from 'pg';
import {database} from './fixtures.ts';
import {createMailCapture} from './mail-capture.ts';

const send = async () => {};
async function capture(t: TestContext, pool: Pool) {
  const server = createHttpServer((_request, response) => response.end('{"messages":[]}'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return createMailCapture({pool, inbox: `http://127.0.0.1:${address.port}`, mailer: {
    sendVerification: send, sendPasswordReset: send, sendPasswordChanged: send, sendServiceAlert: send,
  }});
}
async function within<T>(promise: Promise<T>, ms = 1600) {
  const stop = new AbortController();
  try {return await Promise.race([promise, delay(ms, 'diagnostic did not finish', {signal: stop.signal})]);}
  finally {stop.abort();}
}
function missing(c: Awaited<ReturnType<typeof capture>>) {
  return c.tokenFromMail('private-owner@example.test', 'private-subject').then(() => 'lookup unexpectedly passed', error => error);
}
function unavailable(error: unknown) {
  assert.ok(error instanceof assert.AssertionError, String(error));
  assert.match(error.message, /Mail capture:/);
  assert.equal(JSON.parse(error.message.split('Mail capture: ')[1]!).outbox, 'unavailable');
  assert.ok(!error.message.includes('private-'));
}

test('a full pool cannot hide the missing-mail assertion or accumulate diagnostic waiters', async t => {
  const db = await database(); t.after(() => db.close());
  const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${db.schema}`, max: 1});
  t.after(() => pool.end());
  const held = await pool.connect(), c = await capture(t, pool);
  const originalPid = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const first = missing(c);
  try {
    unavailable(await within(first));
    unavailable(await within(missing(c)));
    assert.equal(pool.waitingCount, 1, 'one capture must retain at most one pending acquisition');
  } finally {held.release(); await first;}
  assert.equal((await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, originalPid, 'return a late healthy client without destroying it');
  assert.deepEqual((await c.evidence()).outbox, []);
  assert.equal(pool.waitingCount, 0);
  assert.equal(pool.idleCount, 1, 'a late acquired client must be returned');
});

test('a stalled PostgreSQL handshake cannot hide the missing-mail assertion', async t => {
  const sockets = new Set<Socket>();
  const server = createTcpServer(socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const pool = new Pool({host: '127.0.0.1', port: address.port, user: 'private-user', database: 'private-db', ssl: false, max: 1});
  const c = await capture(t, pool), result = missing(c);
  try {unavailable(await within(result));}
  finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await result; await pool.end();
  }
});

test('connection acquisition and a blocked outbox read share one diagnostic deadline', async t => {
  const db = await database(); t.after(() => db.close());
  const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${db.schema}`, max: 1});
  t.after(() => pool.end());
  const held = await pool.connect(), lock = await db.secondPool.connect(), c = await capture(t, pool);
  await lock.query('BEGIN'); await lock.query('LOCK TABLE email_outbox IN ACCESS EXCLUSIVE MODE');
  const release = setTimeout(() => held.release(), 700);
  const result = missing(c);
  try {
    unavailable(await within(result, 1450));
    await delay(25);
    assert.equal(pool.totalCount, 0, 'a timed-out read must discard its still-blocked connection');
  } finally {
    clearTimeout(release);
    // The release timer has fired before either diagnostic deadline.
    await lock.query('ROLLBACK'); lock.release(); await result;
  }
  assert.equal((await pool.query('SELECT 1 AS value')).rows[0].value, 1);
});

test('a database disconnect during evidence collection preserves the mail assertion', async t => {
  const db = await database(); t.after(() => db.close());
  const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${db.schema}`, max: 1});
  t.after(() => pool.end());
  const client = await pool.connect(), pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  client.release();
  const lock = await db.secondPool.connect(), c = await capture(t, pool);
  await lock.query('BEGIN'); await lock.query('LOCK TABLE email_outbox IN ACCESS EXCLUSIVE MODE');
  const result = missing(c);
  try {
    let blocked = false;
    for (let n = 0; n < 50; n++) {
      blocked = (await db.pool.query("SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.blocked === true;
      if (blocked) break;
      await delay(10);
    }
    assert.ok(blocked, 'the actual diagnostic must be querying before its connection is stopped');
    assert.equal((await db.pool.query('SELECT pg_terminate_backend($1) AS stopped', [pid])).rows[0].stopped, true);
    unavailable(await within(result));
  } finally {await lock.query('ROLLBACK'); lock.release(); await result;}
  assert.deepEqual((await c.evidence()).outbox, []);
});

test('an unexpected socket close during the outbox read stays inside the mail diagnostic', async t => {
  const sockets = new Set<Socket>();
  const server = createTcpServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    // Complete PostgreSQL startup, then drop the transport for the actual query.
    socket.once('data', () => {
      socket.write(Buffer.from('5200000008000000005a0000000549', 'hex'));
      socket.once('data', () => socket.destroy());
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const pool = new Pool({host: '127.0.0.1', port: address.port, user: 'private-user', database: 'private-db', ssl: false, max: 1});
  const c = await capture(t, pool), result = missing(c);
  try {unavailable(await within(result));}
  finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await result; await pool.end();
  }
});
