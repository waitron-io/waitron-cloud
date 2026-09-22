import assert from 'node:assert/strict';
import crypto, { createHash, randomUUID } from 'node:crypto';
import { after, before, beforeEach, mock, test } from 'node:test';
import { Pool } from 'pg';
import { hashSecret, login, resolveSession, endSession, requirePlatformPermission, withPassiveRead } from '@waitron-cloud/identity';
import { transaction } from '../src/transaction.ts';
import { migrate } from '../src/migrate.ts';
import { RegistrationStore } from '../src/index.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Run pnpm test with Docker');
const schema = `identity_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema} -c statement_timeout=10000`, application_name: schema });
const accountId = randomUUID();
const organisationId = randomUUID();
const legalBusinessId = randomUUID();
const run = <T>(fn: (client: import('pg').PoolClient) => Promise<T>) => transaction(pool, fn);
const signIn = () => run(client => login(client, { email: 'owner@example.test', password: 'venue-owner-password' }));
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
async function expectCode(action: Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
}
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
beforeEach(async () => {
  await pool.query('TRUNCATE cloud_accounts, organisations CASCADE');
  await pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [accountId]);
  await pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash) VALUES ($1, $2, $3)',
    [accountId, 'owner@example.test', await hashSecret('venue-owner-password')]);
  await pool.query('INSERT INTO organisations (id) VALUES ($1)', [organisationId]);
  await pool.query('INSERT INTO legal_businesses (id, organisation_id) VALUES ($1, $2)', [legalBusinessId, organisationId]);
  await pool.query('INSERT INTO organisation_memberships (account_id, organisation_id, can_register_venues) VALUES ($1, $2, true)',
    [accountId, organisationId]);
});

test('email login issues fresh tokens whose stored values are hashes', async () => {
  const first = await run(client => login(client, { email: '  OWNER@EXAMPLE.TEST ', password: 'venue-owner-password' }));
  const second = await signIn();
  assert.equal(first.accountId, accountId);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.csrfToken, second.csrfToken);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, first.csrfToken);
  const rows = (await pool.query('SELECT token_hash, csrf_hash FROM cloud_sessions')).rows;
  assert.ok(rows.some(r => r.token_hash === digest(first.token) && r.csrf_hash === digest(first.csrfToken)));
  assert.ok(!JSON.stringify(rows).includes(first.token));
  assert.equal((await run(client => resolveSession(client, first.token))).accountId, accountId);
});

test('unknown, incorrect, disabled and missing-password logins fail generically and run the KDF', async () => {
  const original = crypto.scrypt;
  const spy = mock.method(crypto, 'scrypt', original);
  try {
    for (const input of [
      { email: 'unknown@example.test', password: 'venue-owner-password' },
      { email: 'owner@example.test', password: 'incorrect' },
    ]) {
      const before = spy.mock.callCount();
      await expectCode(run(client => login(client, input)), 'credentials_invalid');
      assert.equal(spy.mock.callCount(), before + 1);
    }
    await pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp()');
    let before = spy.mock.callCount();
    await expectCode(signIn(), 'credentials_invalid');
    assert.equal(spy.mock.callCount(), before + 1);
    await pool.query('UPDATE cloud_accounts SET disabled_at = NULL');
    await pool.query('UPDATE cloud_credentials SET password_hash = NULL');
    before = spy.mock.callCount();
    await expectCode(signIn(), 'credentials_invalid');
    assert.equal(spy.mock.callCount(), before + 1);
    assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count, '0');
  } finally { spy.mock.restore(); }
});

test('logout is idempotent and ended or unknown tokens cannot resolve', async () => {
  const session = await signIn();
  assert.equal(await run(client => endSession(client, session.token)), true);
  assert.equal(await run(client => endSession(client, session.token)), false);
  await expectCode(run(client => resolveSession(client, session.token)), 'session_unavailable');
  await expectCode(run(client => resolveSession(client, crypto.randomBytes(32).toString('base64url'))), 'session_unavailable');
  await expectCode(run(client => resolveSession(client, 'malformed')), 'session_unavailable');
  await expectCode(run(client => resolveSession(client, digest(session.token))), 'session_unavailable');
});

test('incorrect passwords fail generically even while the account row is locked', async () => {
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM cloud_accounts WHERE id = $1 FOR UPDATE', [accountId]);
    for (const email of ['owner@example.test', 'unknown@example.test']) {
      await expectCode(run(async client => {
        await client.query("SET LOCAL statement_timeout = '500ms'");
        return login(client, { email, password: 'incorrect' });
      }), 'credentials_invalid');
    }
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
});

test('login rechecks credentials and suspension after waiting for the account lock', async () => {
  const { setTimeout: delay } = await import('node:timers/promises');
  for (const change of ['password', 'suspension']) {
    await pool.query('UPDATE cloud_accounts SET disabled_at = NULL');
    await pool.query('UPDATE cloud_credentials SET password_hash = $1', [await hashSecret('venue-owner-password')]);
    const blocker = await pool.connect();
    let completion: Promise<void> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM cloud_accounts WHERE id = $1 FOR UPDATE', [accountId]);
      completion = expectCode(signIn(), 'credentials_invalid');
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const { rows } = await admin.query(`SELECT query FROM pg_stat_activity WHERE query LIKE '%cloud_accounts%FOR SHARE%'
          AND wait_event_type = 'Lock' AND application_name = $1`, [schema]);
        if (rows.length) { blocked = true; break; }
        await delay(20);
      }
      if (change === 'password') {
        await blocker.query('UPDATE cloud_credentials SET password_hash = $1', [await hashSecret('new-password')]);
      } else {
        await blocker.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp()');
      }
      await blocker.query('COMMIT');
      await completion;
      assert.ok(blocked, 'login must wait for the account lock');
      assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count, '0');
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await completion;
    }
  }
});

test('passive reads do not extend idle expiry while human activity does', async () => {
  const session = await signIn();
  await pool.query("UPDATE cloud_sessions SET last_seen_at = clock_timestamp() - interval '10 minutes'");
  const before = await run(client => resolveSession(client, session.token, { touch: false }));
  const passive = await withPassiveRead(() => run(client => resolveSession(client, session.token)));
  assert.equal(passive.expiresAt, before.expiresAt);
  const active = await run(client => resolveSession(client, session.token));
  assert.ok(Date.parse(active.expiresAt) > Date.parse(before.expiresAt) + 9 * 60_000);
});

test('idle expiry and absolute expiry reject sessions without reviving them', async () => {
  let session = await signIn();
  await pool.query("UPDATE cloud_sessions SET last_seen_at = clock_timestamp() - interval '31 minutes'");
  await expectCode(run(client => resolveSession(client, session.token)), 'session_expired');
  session = await signIn();
  await pool.query("UPDATE cloud_sessions SET absolute_expires_at = clock_timestamp() - interval '1 second'");
  await expectCode(run(client => resolveSession(client, session.token)), 'session_expired');
});

test('suspension denies existing sessions on the next request', async () => {
  const session = await signIn();
  await pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp()');
  await expectCode(run(client => resolveSession(client, session.token)), 'session_unavailable');
});

test('organisation membership never grants platform permission and platform grants are rechecked', async () => {
  const session = await signIn();
  await expectCode(run(client => requirePlatformPermission(client, session.token, 'platform.view_status')), 'permission_denied');
  await pool.query('INSERT INTO platform_permissions (account_id, permission) VALUES ($1, $2)', [accountId, 'platform.view_status']);
  assert.equal((await run(client => requirePlatformPermission(client, session.token, 'platform.view_status'))).accountId, accountId);
  await pool.query('DELETE FROM platform_permissions');
  await expectCode(run(client => requirePlatformPermission(client, session.token, 'platform.view_status')), 'permission_denied');
});

test('platform mutation permission checks require the supplied session CSRF token', async () => {
  const session = await signIn();
  const another = await signIn();
  await pool.query('INSERT INTO platform_permissions (account_id, permission) VALUES ($1, $2)', [accountId, 'platform.manage']);
  for (const csrfToken of ['incorrect', undefined, another.csrfToken, session.token]) {
    await expectCode(run(client => requirePlatformPermission(client, session.token, 'platform.manage', { csrfToken })), 'csrf_invalid');
  }
  assert.equal((await run(client => requirePlatformPermission(client, session.token, 'platform.manage', { csrfToken: session.csrfToken }))).accountId, accountId);
});

test('Cloud approval takes the account from the session and requires its CSRF token', async () => {
  const store = new RegistrationStore(pool);
  const input = { operationId: randomUUID(), installationKey: `key:${randomUUID()}`, localVenueId: randomUUID(),
    environment: 'test', organisationId, legalBusinessId };
  await store.start(input);
  const session = await signIn();
  await expectCode(store.approveCloudWithSession(input, session.token, 'incorrect'), 'csrf_invalid');
  await expectCode(store.approveCloudWithSession(input, session.token, undefined as unknown as string), 'csrf_invalid');
  assert.equal((await pool.query('SELECT cloud_account_id FROM connection_requests')).rows[0].cloud_account_id, null);
  const another = await signIn();
  await expectCode(store.approveCloudWithSession(input, session.token, another.csrfToken), 'csrf_invalid');
  await store.approveCloudWithSession(input, session.token, session.csrfToken);
  assert.equal((await pool.query('SELECT cloud_account_id FROM connection_requests')).rows[0].cloud_account_id, accountId);
  await pool.query('UPDATE organisation_memberships SET can_register_venues = false');
  await pool.query('INSERT INTO platform_permissions (account_id, permission) VALUES ($1, $2)', [accountId, 'platform.view_status']);
  await expectCode(store.approveCloudWithSession(input, session.token, session.csrfToken), 'permission_denied');
});

test('Cloud approval rejects ended and expired sessions and foreign organisations', async () => {
  const store = new RegistrationStore(pool);
  const foreignOrg = randomUUID();
  const foreignBusiness = randomUUID();
  await pool.query('INSERT INTO organisations (id) VALUES ($1)', [foreignOrg]);
  await pool.query('INSERT INTO legal_businesses (id, organisation_id) VALUES ($1, $2)', [foreignBusiness, foreignOrg]);
  const input = { operationId: randomUUID(), installationKey: `key:${randomUUID()}`, localVenueId: randomUUID(),
    environment: 'test', organisationId: foreignOrg, legalBusinessId: foreignBusiness };
  await store.start(input);
  let session = await signIn();
  await expectCode(store.approveCloudWithSession(input, session.token, session.csrfToken), 'permission_denied');
  await run(client => endSession(client, session.token));
  await expectCode(store.approveCloudWithSession(input, session.token, session.csrfToken), 'session_unavailable');
  session = await signIn();
  await pool.query("UPDATE cloud_sessions SET last_seen_at = clock_timestamp() - interval '31 minutes'");
  await expectCode(store.approveCloudWithSession(input, session.token, session.csrfToken), 'session_expired');
  assert.equal((await pool.query('SELECT cloud_account_id FROM connection_requests')).rows[0].cloud_account_id, null);
});

test('session expiry during permission contention rolls back Cloud approval', async () => {
  const { setTimeout: delay } = await import('node:timers/promises');
  const store = new RegistrationStore(pool);
  const input = { operationId: randomUUID(), installationKey: `key:${randomUUID()}`, localVenueId: randomUUID(),
    environment: 'test', organisationId, legalBusinessId };
  await store.start(input);
  const session = await signIn();
  await pool.query("UPDATE cloud_sessions SET absolute_expires_at = clock_timestamp() + interval '1 second'");
  const blocker = await pool.connect();
  let completion: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT 1 FROM organisation_memberships FOR UPDATE');
    completion = expectCode(store.approveCloudWithSession(input, session.token, session.csrfToken), 'session_expired');
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await admin.query(`SELECT query FROM pg_stat_activity WHERE query LIKE '%FOR SHARE OF a, m%'
        AND wait_event_type = 'Lock' AND application_name = $1`, [schema]);
      if (rows.length) { blocked = true; break; }
      await delay(20);
    }
    await delay(1100);
    await blocker.query('COMMIT');
    await completion;
    assert.ok(blocked, 'approval must wait for membership permission after session validation');
    assert.equal((await pool.query('SELECT cloud_account_id FROM connection_requests')).rows[0].cloud_account_id, null);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await completion;
  }
});

test('human activity cannot extend the absolute session deadline', async () => {
  const session = await signIn();
  const { rows } = await pool.query(`UPDATE cloud_sessions SET absolute_expires_at = clock_timestamp() + interval '5 minutes'
    RETURNING absolute_expires_at`);
  const deadline = rows[0].absolute_expires_at.toISOString();
  const resolved = await run(client => resolveSession(client, session.token));
  assert.equal(resolved.expiresAt, deadline);
  assert.equal((await pool.query('SELECT absolute_expires_at FROM cloud_sessions')).rows[0].absolute_expires_at.toISOString(), deadline);
});

test('logout committed while a resolver waits cannot revive the session', async () => {
  const { setTimeout: delay } = await import('node:timers/promises');
  const session = await signIn();
  const blocker = await pool.connect();
  let resolution: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN');
    await endSession(blocker, session.token);
    resolution = expectCode(run(client => resolveSession(client, session.token)), 'session_unavailable');
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [schema]);
      if (rows.length) { blocked = true; break; }
      await delay(20);
    }
    await blocker.query('COMMIT');
    await resolution;
    assert.ok(blocked, 'the resolver must reach the session row held by logout');
    assert.notEqual((await pool.query('SELECT ended_at FROM cloud_sessions')).rows[0].ended_at, null);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await resolution;
  }
});

test('platform authorisation rejects a session that expires during a permission wait', async () => {
  const { setTimeout: delay } = await import('node:timers/promises');
  const session = await signIn();
  await pool.query('INSERT INTO platform_permissions (account_id, permission) VALUES ($1, $2)', [accountId, 'platform.view_status']);
  await pool.query("UPDATE cloud_sessions SET absolute_expires_at = clock_timestamp() + interval '1 second'");
  const blocker = await pool.connect();
  let result: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT 1 FROM platform_permissions FOR UPDATE');
    result = expectCode(run(client => requirePlatformPermission(client, session.token, 'platform.view_status')), 'session_expired');
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [schema]);
      if (rows.length) { blocked = true; break; }
      await delay(20);
    }
    await delay(1100);
    await blocker.query('COMMIT');
    await result;
    assert.ok(blocked, 'platform authorisation must reach the contested permission lock');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await result;
  }
});
