import assert from 'node:assert/strict';
import crypto, { createHash, randomUUID } from 'node:crypto';
import { after, before, beforeEach, mock, test } from 'node:test';
import { Pool } from 'pg';
import { createSession, endSession, hashSecret, IdentityError, listAccountSessions, login, requireCurrentPassword,
  requirePlatformPermission, resolveSession, revokeAccountSession, withPassiveRead } from '@waitron-cloud/identity';
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

test('fresh account authority verifies the current password without issuing a session', async () => {
  await run(client => requireCurrentPassword(client, accountId, 'venue-owner-password'));
  for (const candidate of ['incorrect', 'é'.repeat(513)]) {
    await expectCode(run(client => requireCurrentPassword(client, accountId, candidate)), 'credentials_invalid');
  }
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count, '0');
  await pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp()');
  await expectCode(run(client => requireCurrentPassword(client, accountId, 'venue-owner-password')), 'credentials_invalid');
});

test('fresh account authority rejects a password changed while it waits for the account lock', async () => {
  const { setTimeout: delay } = await import('node:timers/promises');
  const blocker = await pool.connect();
  let completion: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM cloud_accounts WHERE id = $1 FOR UPDATE', [accountId]);
    completion = expectCode(run(client => requireCurrentPassword(client, accountId, 'venue-owner-password')), 'credentials_invalid');
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await admin.query(`SELECT 1 FROM pg_stat_activity WHERE query LIKE '%cloud_accounts%FOR SHARE%'
        AND wait_event_type = 'Lock' AND application_name = $1`, [schema]);
      if (rows.length) { blocked = true; break; }
      await delay(20);
    }
    await blocker.query('UPDATE cloud_credentials SET password_hash = $1', [await hashSecret('replacement-password')]);
    await blocker.query('COMMIT');
    await completion;
    assert.ok(blocked, 'fresh authority must recheck after acquiring the account lock');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await completion;
  }
});

test('session creation checks current account state and stores only token hashes', async () => {
  const created = await run(client => createSession(client, accountId));
  assert.equal(created.accountId, accountId);
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
  const row = (await pool.query('SELECT token_hash, csrf_hash FROM cloud_sessions')).rows[0];
  assert.equal(row.token_hash, digest(created.token));
  assert.equal(row.csrf_hash, digest(created.csrfToken));
  await pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp()');
  await expectCode(run(client => createSession(client, accountId)), 'credentials_invalid');
});

test('passkey schema enforces opaque handles, credential counters and bound ceremony lifetimes', async () => {
  const secondAccount = randomUUID();
  const session = await signIn();
  await pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [secondAccount]);
  const handle = crypto.randomBytes(32);
  await pool.query('INSERT INTO cloud_passkey_users (account_id, user_handle) VALUES ($1, $2)', [accountId, handle]);
  await assert.rejects(pool.query('INSERT INTO cloud_passkey_users (account_id, user_handle) VALUES ($1, $2)', [secondAccount, handle]),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23505');
  const credentialId = crypto.randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO cloud_passkeys
    (id, account_id, credential_id, public_key, counter, transports, device_type, backed_up)
    VALUES ($1, $2, $3, $4, 4294967295, $5, 'multiDevice', true)`,
    [randomUUID(), accountId, credentialId, crypto.randomBytes(64), ['internal']]);
  await assert.rejects(pool.query(`INSERT INTO cloud_passkeys
    (id, account_id, credential_id, public_key, counter, transports, device_type, backed_up)
    VALUES ($1, $2, $3, $4, 4294967296, $5, 'singleDevice', false)`,
    [randomUUID(), accountId, crypto.randomBytes(32).toString('base64url'), crypto.randomBytes(64), []]),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23514');
  const now = new Date();
  await pool.query(`INSERT INTO cloud_webauthn_ceremonies
    (id, kind, challenge, account_id, session_token_hash, created_at, expires_at)
    VALUES ($1, 'registration', $2, $3, $4, $5, $6)`,
    [randomUUID(), crypto.randomBytes(32).toString('base64url'), accountId, digest(session.token), now, new Date(now.getTime() + 300_000)]);
  await assert.rejects(pool.query(`INSERT INTO cloud_webauthn_ceremonies
    (id, kind, challenge, created_at, expires_at) VALUES ($1, 'registration', $2, $3, $4)`,
    [randomUUID(), crypto.randomBytes(32).toString('base64url'), now, new Date(now.getTime() + 300_000)]),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23514');
  await assert.rejects(pool.query(`INSERT INTO cloud_webauthn_ceremonies
    (id, kind, challenge, created_at, expires_at) VALUES ($1, 'authentication', $2, $3, $4)`,
    [randomUUID(), crypto.randomBytes(32).toString('base64url'), now, new Date(now.getTime() + 300_001)]),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23514');
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

test('account session summaries are passive, account-scoped and identify the current live session', async () => {
  const current = await signIn();
  const other = await signIn();
  const ended = await signIn();
  const expired = await signIn();
  await run(client => endSession(client, ended.token));
  await pool.query("UPDATE cloud_sessions SET last_seen_at = clock_timestamp() - interval '31 minutes' WHERE token_hash = $1", [digest(expired.token)]);
  await pool.query("UPDATE cloud_sessions SET last_seen_at = clock_timestamp() - interval '1 minute', absolute_expires_at = clock_timestamp() + interval '10 minutes' WHERE token_hash = $1", [digest(current.token)]);
  await pool.query("UPDATE cloud_sessions SET last_seen_at = clock_timestamp() - interval '5 minutes', absolute_expires_at = clock_timestamp() + interval '10 hours' WHERE token_hash = $1", [digest(other.token)]);
  const foreignAccount = randomUUID();
  await pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [foreignAccount]);
  await pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash) VALUES ($1, $2, $3)',
    [foreignAccount, 'other@example.test', await hashSecret('other-account-password')]);
  const foreign = await run(client => login(client, {email: 'other@example.test', password: 'other-account-password'}));
  const before = (await pool.query(`SELECT id, token_hash, created_at, last_seen_at,
    LEAST(last_seen_at + interval '30 minutes', absolute_expires_at) AS expires_at
    FROM cloud_sessions ORDER BY token_hash`)).rows;

  const sessions = await run(client => listAccountSessions(client, current.token));

  assert.equal(sessions.length, 2);
  const currentSummary = sessions.find(session => session.current);
  const otherSummary = sessions.find(session => !session.current);
  assert.ok(currentSummary && otherSummary);
  assert.match(currentSummary.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(currentSummary.id, current.token);
  assert.notEqual(currentSummary.id, digest(current.token));
  const expectedCurrent = before.find(row => row.token_hash === digest(current.token));
  const expectedOther = before.find(row => row.token_hash === digest(other.token));
  const excludedIds = before.filter(row => [digest(ended.token), digest(expired.token), digest(foreign.token)].includes(row.token_hash))
    .map(row => row.id);
  assert.deepEqual(currentSummary, {id: expectedCurrent.id, createdAt: expectedCurrent.created_at.toISOString(),
    lastUsedAt: expectedCurrent.last_seen_at.toISOString(), expiresAt: expectedCurrent.expires_at.toISOString(), current: true});
  assert.deepEqual(otherSummary, {id: expectedOther.id, createdAt: expectedOther.created_at.toISOString(),
    lastUsedAt: expectedOther.last_seen_at.toISOString(), expiresAt: expectedOther.expires_at.toISOString(), current: false});
  assert.ok(!sessions.some(session => excludedIds.includes(session.id)));
  const after = (await pool.query('SELECT token_hash, last_seen_at FROM cloud_sessions ORDER BY token_hash')).rows;
  assert.deepEqual(after, before.map(({token_hash, last_seen_at}) => ({token_hash, last_seen_at})));
});

test('account session revocation is idempotent, account-scoped and can end the current session', async () => {
  const current = await signIn();
  const target = await signIn();
  const foreignAccount = randomUUID();
  await pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [foreignAccount]);
  await pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash) VALUES ($1, $2, $3)',
    [foreignAccount, 'foreign@example.test', await hashSecret('foreign-account-password')]);
  const foreign = await run(client => login(client, {email: 'foreign@example.test', password: 'foreign-account-password'}));
  const ids = new Map((await pool.query('SELECT token_hash, id FROM cloud_sessions')).rows.map(row => [row.token_hash, row.id]));

  assert.deepEqual(await run(client => revokeAccountSession(client, current.token, current.csrfToken, ids.get(digest(target.token)))),
    {revoked: true, current: false});
  await expectCode(run(client => resolveSession(client, target.token)), 'session_unavailable');
  assert.deepEqual(await run(client => revokeAccountSession(client, current.token, current.csrfToken, ids.get(digest(target.token)))),
    {revoked: false, current: false});
  assert.deepEqual(await run(client => revokeAccountSession(client, current.token, current.csrfToken, ids.get(digest(foreign.token)))),
    {revoked: false, current: false});
  assert.equal((await run(client => resolveSession(client, foreign.token))).accountId, foreignAccount);
  assert.deepEqual(await run(client => revokeAccountSession(client, current.token, current.csrfToken, ids.get(digest(current.token)))),
    {revoked: true, current: true});
  await expectCode(run(client => resolveSession(client, current.token)), 'session_unavailable');
});

test('two sessions revoking each other serialize without deadlock or stale authority', async () => {
  for (let iteration = 0; iteration < 30; iteration++) {
    const first = await run(client => createSession(client, accountId));
    const second = await run(client => createSession(client, accountId));
    const ids = new Map((await pool.query('SELECT token_hash, id FROM cloud_sessions')).rows.map(row => [row.token_hash, row.id]));
    const results = await Promise.allSettled([
      run(client => revokeAccountSession(client, first.token, first.csrfToken, ids.get(digest(second.token)))),
      run(client => revokeAccountSession(client, second.token, second.csrfToken, ids.get(digest(first.token)))),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected'
      && result.reason instanceof IdentityError && result.reason.code === 'session_unavailable').length, 1);
  }
});

test('session revocation rechecks authority after waiting for the target row', async () => {
  const {setTimeout: delay} = await import('node:timers/promises');
  const current = await signIn();
  const target = await signIn();
  const targetId = (await pool.query('SELECT id FROM cloud_sessions WHERE token_hash = $1', [digest(target.token)])).rows[0].id;
  await pool.query("UPDATE cloud_sessions SET absolute_expires_at = clock_timestamp() + interval '1 second' WHERE token_hash = $1", [digest(current.token)]);
  const blocker = await pool.connect();
  let completion: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM cloud_sessions WHERE id = $1 FOR UPDATE', [targetId]);
    completion = expectCode(run(client => revokeAccountSession(client, current.token, current.csrfToken, targetId)), 'session_expired');
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const {rows} = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [schema]);
      if (rows.length) { blocked = true; break; }
      await delay(20);
    }
    await delay(1100);
    await blocker.query('COMMIT');
    await completion;
    assert.ok(blocked, 'revocation must wait for the target row before rechecking the actor');
    assert.equal((await pool.query('SELECT ended_at FROM cloud_sessions WHERE id = $1', [targetId])).rows[0].ended_at, null);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await completion;
  }
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
