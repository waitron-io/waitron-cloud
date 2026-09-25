import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { hashSecret, login, resolveSession } from '@waitron-cloud/identity';
import { recoveryAndDeliver, signupAndDeliver } from './fixtures/delivery.ts';
import { type SignupEmail } from '../src/signup.ts';
import { transaction } from '../src/transaction.ts';
import { migrate } from '../src/migrate.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Run pnpm test with Docker');
const schema = `recovery_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema} -c statement_timeout=10000`, application_name: schema });
const messages: SignupEmail[] = [];
const notices: {email: string}[] = [];
const mailer = { async sendPasswordReset(message: SignupEmail) { messages.push(message); },
  async sendPasswordChanged(message: {email: string}) { notices.push(message); } };
const store = recoveryAndDeliver(pool, mailer);
const email = 'owner@example.test';
const oldPassword = 'original café password';
const newPassword = 'replacement café password';
const accountId = randomUUID();
const organisationId = randomUUID();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const signIn = (password = oldPassword) => transaction(pool, client => login(client, { email, password }));
async function expectCode(action: Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
}
async function request() { await store.request(email); return messages.at(-1)!; }
async function waitForLock(fragment: string, count = 1) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await admin.query("SELECT count(*) FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND query LIKE $2", [schema, `%${fragment}%`]);
    if (Number(rows[0].count) >= count) return;
    await delay(20);
  }
  assert.fail(`Expected ${count} blocked operations: ${fragment}`);
}
before(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool); });
after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
beforeEach(async () => {
  messages.length = 0; notices.length = 0;
  await pool.query('TRUNCATE cloud_accounts, organisations, password_reset_requests, signup_requests, email_outbox CASCADE');
  await pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [accountId]);
  await pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash, email_verified_at) VALUES ($1, $2, $3, clock_timestamp())', [accountId, email, await hashSecret(oldPassword)]);
  await pool.query('INSERT INTO organisations (id) VALUES ($1)', [organisationId]);
  await pool.query('INSERT INTO organisation_memberships (account_id, organisation_id, can_register_venues, is_owner) VALUES ($1, $2, true, true)', [accountId, organisationId]);
  await pool.query("INSERT INTO platform_permissions (account_id, permission) VALUES ($1, 'platform.view_status')", [accountId]);
});

test('request stores a verification hash and leaves credentials and sessions usable', async () => {
  const session = await signIn();
  const before = (await pool.query('SELECT * FROM cloud_credentials')).rows;
  const checked = recoveryAndDeliver(pool, { ...mailer, async sendPasswordReset(message) {
    const { rows } = await pool.query('SELECT * FROM password_reset_requests WHERE token_hash = $1', [digest(message.token)]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].account_id, accountId);
    assert.equal(rows[0].expires_at.getTime() - rows[0].created_at.getTime(), 30 * 60_000);
    assert.ok(!JSON.stringify(rows).includes(message.token));
    messages.push(message);
  } });
  assert.deepEqual(await checked.request(' OWNER@EXAMPLE.TEST '), { status: 'accepted' });
  assert.match(messages[0]!.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual((await pool.query('SELECT * FROM cloud_credentials')).rows, before);
  await transaction(pool, client => resolveSession(client, session.token));
});

test('unknown, disabled, unverified and passwordless accounts return accepted without email', async () => {
  assert.deepEqual(await store.request('unknown@example.test'), { status: 'accepted' });
  await pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp()');
  assert.deepEqual(await store.request(email), { status: 'accepted' });
  await pool.query('TRUNCATE password_reset_requests');
  await pool.query('UPDATE cloud_accounts SET disabled_at = NULL');
  await pool.query('UPDATE cloud_credentials SET email_verified_at = NULL');
  assert.deepEqual(await store.request(email), { status: 'accepted' });
  await pool.query('TRUNCATE password_reset_requests');
  await pool.query('UPDATE cloud_credentials SET email_verified_at = clock_timestamp(), password_hash = NULL');
  assert.deepEqual(await store.request(email), { status: 'accepted' });
  assert.equal(messages.length, 0);
});

test('reset replaces the password, revokes every session and preserves memberships and permissions', async () => {
  const first = await signIn(); const second = await signIn();
  const otherAccount = randomUUID();
  await pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [otherAccount]);
  await pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash, email_verified_at) VALUES ($1, $2, $3, clock_timestamp())', [otherAccount, 'other@example.test', await hashSecret(oldPassword)]);
  const otherSession = await transaction(pool, client => login(client, { email: 'other@example.test', password: oldPassword }));
  const memberships = (await pool.query('SELECT * FROM organisation_memberships')).rows;
  const permissions = (await pool.query('SELECT * FROM platform_permissions')).rows;
  const token = (await request()).token;
  assert.deepEqual(await store.complete(token, newPassword), { status: 'completed' });
  await expectCode(signIn(), 'credentials_invalid');
  for (const session of [first, second]) await expectCode(transaction(pool, client => resolveSession(client, session.token)), 'session_unavailable');
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions WHERE account_id = $1 AND ended_at IS NULL', [accountId])).rows[0].count, '0');
  assert.equal((await transaction(pool, client => resolveSession(client, otherSession.token))).accountId, otherAccount);
  assert.equal((await signIn(newPassword)).accountId, accountId);
  assert.deepEqual((await pool.query('SELECT * FROM organisation_memberships')).rows, memberships);
  assert.deepEqual((await pool.query('SELECT * FROM platform_permissions')).rows, permissions);
  assert.deepEqual(notices, [{ email, locale: 'en' }]);
  await expectCode(store.complete(token, newPassword), 'reset_unavailable');
});

test('malformed, unknown, expired and signup tokens cannot reset a password', async () => {
  for (const token of ['bad', randomBytes(32).toString('base64url')]) await expectCode(store.complete(token, newPassword), 'reset_unavailable');
  const message = await request();
  await expectCode(store.complete(digest(message.token), newPassword), 'reset_unavailable');
  await pool.query("UPDATE password_reset_requests SET created_at = clock_timestamp() - interval '31 minutes', expires_at = clock_timestamp() - interval '1 second'");
  await expectCode(store.complete(message.token, newPassword), 'reset_unavailable');
  let signupToken = '';
  const signup = signupAndDeliver(pool, { async sendVerification(message) { signupToken = message.token; } });
  await signup.request(email);
  await expectCode(store.complete(signupToken, newPassword), 'reset_unavailable');
  await signIn();
});

test('cooldown is shared across overlapping requests and resending preserves live links', async () => {
  const blocker = await pool.connect(); let requests: Promise<unknown> | undefined;
  try {
    const workers = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
    workers.forEach(worker => worker.release());
    await blocker.query('BEGIN'); await blocker.query('LOCK TABLE password_reset_requests IN SHARE MODE');
    requests = Promise.all([store.request(email), store.request(email.toUpperCase()), store.request(email)]);
    await waitForLock('', 3);
    await blocker.query('COMMIT'); await requests;
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await requests; }
  assert.equal(messages.length, 1);
  const first = messages[0]!;
  await pool.query("UPDATE password_reset_requests SET created_at = clock_timestamp() - interval '61 seconds'");
  await request();
  assert.equal(messages.length, 2);
  await store.complete(first.token, newPassword);
  await expectCode(store.complete(messages[1]!.token, oldPassword), 'reset_unavailable');
});

test('different reset links racing can change the password only once', async () => {
  const first = await request();
  await pool.query("UPDATE password_reset_requests SET created_at = clock_timestamp() - interval '61 seconds'");
  const second = await request();
  const results = await Promise.allSettled([store.complete(first.token, newPassword), store.complete(second.token, newPassword), store.complete(first.token, newPassword)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'reset_unavailable');
  assert.equal(notices.length, 1); await signIn(newPassword);
});

test('reset to the same password still invalidates other previously issued links', async () => {
  const first = await request();
  await pool.query("UPDATE password_reset_requests SET created_at = clock_timestamp() - interval '61 seconds'");
  const second = await request();
  await store.complete(first.token, oldPassword);
  await expectCode(store.complete(second.token, newPassword), 'reset_unavailable');
});

test('changed email, verification, suspension or password invalidates an outstanding link', async () => {
  for (const change of ["UPDATE cloud_accounts SET disabled_at = clock_timestamp()", "UPDATE cloud_credentials SET email = 'changed@example.test'", 'UPDATE cloud_credentials SET email_verified_at = NULL', 'UPDATE cloud_credentials SET password_hash = NULL']) {
    await pool.query('UPDATE cloud_accounts SET disabled_at = NULL');
    await pool.query('UPDATE cloud_credentials SET email = $1, email_verified_at = clock_timestamp(), password_hash = $2', [email, await hashSecret(oldPassword)]);
    await pool.query('TRUNCATE password_reset_requests');
    const message = await request();
    await pool.query(change);
    await expectCode(store.complete(message.token, newPassword), 'reset_unavailable');
  }
});

test('invalid new passwords leave the reset usable', async () => {
  const message = await request();
  for (const password of ['short', '🔑'.repeat(14), 'é'.repeat(513)]) await expectCode(store.complete(message.token, password), 'recovery_invalid');
  await store.complete(message.token, '🔑'.repeat(15));
  await signIn('🔑'.repeat(15));
});

test('compromised or unavailable screening leaves the reset link and current password usable', async () => {
  let mode: 'compromised' | 'unavailable' | 'acceptable' = 'compromised';
  const screened = recoveryAndDeliver(pool, mailer, {
    async check() { if (mode === 'unavailable') throw new Error('private provider detail'); return mode; },
  });
  await screened.request(email);
  const message = messages.at(-1)!;
  await expectCode(screened.complete(message.token, newPassword), 'password_compromised');
  await signIn();
  mode = 'unavailable';
  await expectCode(screened.complete(message.token, newPassword), 'password_screening_unavailable');
  await signIn();
  assert.equal((await pool.query('SELECT consumed_at FROM password_reset_requests WHERE token_hash = $1', [digest(message.token)])).rows[0].consumed_at, null);
  mode = 'acceptable';
  await screened.complete(message.token, newPassword);
  await signIn(newPassword);
});

test('mail failures reveal no account status and notification failure cannot undo a reset', async () => {
  const broken = recoveryAndDeliver(pool, {
    async sendPasswordReset(message) { throw new Error(`secret ${message.token}`); },
    async sendPasswordChanged() { throw new Error('provider secret'); },
  });
  assert.deepEqual(await broken.request(email), { status: 'accepted' });
  assert.deepEqual(await broken.request('unknown@example.test'), { status: 'accepted' });
  await pool.query("UPDATE password_reset_requests SET created_at = clock_timestamp() - interval '61 seconds'");
  const message = await request();
  assert.deepEqual(await broken.complete(message.token, newPassword), { status: 'completed' });
  await signIn(newPassword);
});

test('database failure rolls back password and session changes and does not consume the token', async () => {
  const session = await signIn(); const message = await request();
  await pool.query('ALTER TABLE cloud_sessions ADD CONSTRAINT test_no_end CHECK (ended_at IS NULL)');
  try {
    await assert.rejects(store.complete(message.token, newPassword), { code: '23514' });
    await signIn(); await transaction(pool, client => resolveSession(client, session.token));
    assert.equal(notices.length, 0);
  } finally { await pool.query('ALTER TABLE cloud_sessions DROP CONSTRAINT test_no_end'); }
  await store.complete(message.token, newPassword);
});

test('expiry during a session-row wait rolls back the reset and keeps the session live', async () => {
  const session = await signIn(); const message = await request();
  await pool.query("UPDATE password_reset_requests SET expires_at = clock_timestamp() + interval '1 second'");
  const blocker = await pool.connect(); let completion: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT token_hash FROM cloud_sessions FOR UPDATE');
    completion = expectCode(store.complete(message.token, newPassword), 'reset_unavailable');
    await waitForLock('UPDATE cloud_sessions'); await delay(1100);
    await blocker.query('COMMIT'); await completion;
    await signIn(); await transaction(pool, client => resolveSession(client, session.token));
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await completion; }
});

test('a login committed while reset waits is revoked by that reset', async () => {
  const message = await request(); const blocker = await pool.connect(); let completion: Promise<unknown> | undefined;
  try {
    await blocker.query('BEGIN');
    const session = await login(blocker, { email, password: oldPassword });
    completion = store.complete(message.token, newPassword);
    await waitForLock('cloud_accounts'); await blocker.query('COMMIT'); await completion;
    await expectCode(transaction(pool, client => resolveSession(client, session.token)), 'session_unavailable');
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await completion; }
});

test('an old-password login waiting behind a reset cannot issue a surviving session', async () => {
  await signIn(); const message = await request();
  const blocker = await pool.connect(); let reset: Promise<unknown> | undefined; let attempt: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT token_hash FROM cloud_sessions FOR UPDATE');
    reset = store.complete(message.token, newPassword);
    await waitForLock('UPDATE cloud_sessions');
    attempt = expectCode(signIn(), 'credentials_invalid');
    await waitForLock('cloud_accounts');
    await blocker.query('COMMIT'); await reset; await attempt;
    assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions WHERE ended_at IS NULL')).rows[0].count, '0');
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await reset; await attempt; }
});

test('expiry while queuing the notification rolls back password and session changes', async () => {
  const session = await signIn(); const message = await request();
  await pool.query("UPDATE password_reset_requests SET expires_at = clock_timestamp() + interval '1 second'");
  const blocker = await pool.connect(); let completion: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN'); await blocker.query('LOCK TABLE email_outbox IN SHARE MODE');
    completion = expectCode(store.complete(message.token, newPassword), 'reset_unavailable');
    await waitForLock('INSERT INTO email_outbox'); await delay(1100);
    await blocker.query('COMMIT'); await completion;
    await signIn(); await transaction(pool, client => resolveSession(client, session.token));
    assert.equal((await pool.query("SELECT count(*) FROM email_outbox WHERE kind = 'password_changed'")).rows[0].count, '0');
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await completion; }
});
