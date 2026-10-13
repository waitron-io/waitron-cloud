import {resetSchema} from './fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { inspect } from 'node:util';
import { Pool } from 'pg';
import { login, requirePlatformPermission } from '@waitron-cloud/identity';
import { type SignupEmail, type SignupDetails } from '../src/index.ts';
import { signupAndDeliver } from './fixtures/delivery.ts';
import { migrate } from '../src/migrate.ts';
import { transaction } from '../src/transaction.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Run pnpm test with Docker');
const schema = `signup_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema} -c statement_timeout=10000`, application_name: schema });
const messages: SignupEmail[] = [];
const store = signupAndDeliver(pool, { async sendVerification(message) { messages.push(message); } });
const details: SignupDetails = { password: 'my long café password', organisationName: 'Café Sol', legalBusinessName: 'Café Sol SL', countryCode: 'ES' };
const email = 'owner@example.test';
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
async function request(address = email) {
  await store.request(address);
  return messages.at(-1)!;
}
async function count(table: string) {
  // Only test literals reach this helper.
  return Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
}
async function expectCode(action: Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
}
before(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool); });
after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
beforeEach(async () => { messages.length = 0; await resetSchema(pool); });

test('signup sends a committed hashed token and creates nothing before email proof', async () => {
  const sender = signupAndDeliver(pool, { async sendVerification(message) {
    const { rows } = await pool.query('SELECT * FROM signup_requests WHERE token_hash = $1', [digest(message.token)]);
    assert.equal(rows.length, 1, 'delivery sees the committed request through another connection');
    assert.equal(rows[0].email, email);
    assert.equal(new Date(message.expiresAt).getTime() - rows[0].created_at.getTime(), 30 * 60_000);
    assert.ok(!JSON.stringify(rows).includes(message.token));
    messages.push(message);
  } });
  assert.deepEqual(await sender.request('  OWNER@EXAMPLE.TEST  '), { status: 'accepted' });
  assert.match(messages[0]!.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await count('cloud_accounts'), 0);
  assert.equal(await count('organisations'), 0);
  await expectCode(transaction(pool, client => login(client, { email, password: details.password })), 'credentials_invalid');
});

test('verified signup atomically creates the first business and owner, then permits login', async () => {
  const message = await request();
  const result = await store.complete(message.token, details);
  const { rows } = await pool.query(`SELECT a.id, c.email_verified_at, c.password_hash, o.name, b.name AS business,
    b.country_code, m.is_owner, m.can_register_venues FROM cloud_accounts a
    JOIN cloud_credentials c ON c.account_id = a.id JOIN organisation_memberships m ON m.account_id = a.id
    JOIN organisations o ON o.id = m.organisation_id JOIN legal_businesses b ON b.organisation_id = o.id`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, result.accountId);
  assert.ok(rows[0].email_verified_at instanceof Date);
  assert.notEqual(rows[0].password_hash, details.password);
  assert.equal(rows[0].name, details.organisationName);
  assert.equal(rows[0].business, details.legalBusinessName);
  assert.equal(rows[0].country_code, 'ES');
  assert.equal(rows[0].is_owner, true);
  assert.equal(rows[0].can_register_venues, true);
  assert.equal(await count('platform_permissions'), 0);
  assert.equal(await count('venues'), 0);
  assert.equal(await count('cloud_sessions'), 0, 'email proof is not a session');
  const session = await transaction(pool, client => login(client, { email, password: details.password }));
  assert.equal(session.accountId, result.accountId);
  await expectCode(transaction(pool, client => requirePlatformPermission(client, session.token, 'platform.manage')), 'permission_denied');
});

test('unknown, malformed, expired and consumed tokens cannot create accounts', async () => {
  await expectCode(store.complete('malformed', details), 'verification_unavailable');
  await expectCode(store.complete(randomBytes(32).toString('base64url'), details), 'verification_unavailable');
  const expired = await request('expired@example.test');
  await pool.query("UPDATE signup_requests SET created_at = clock_timestamp() - interval '31 minutes', expires_at = clock_timestamp() - interval '1 second'");
  await expectCode(store.complete(expired.token, details), 'verification_unavailable');
  const valid = await request();
  await expectCode(store.complete(digest(valid.token), details), 'verification_unavailable');
  await store.complete(valid.token, details);
  await expectCode(store.complete(valid.token, details), 'verification_unavailable');
  assert.equal(await count('cloud_accounts'), 1);
  assert.equal(await count('organisations'), 1);
});

test('request cooldown is durable, generic and shared by concurrent workers', async () => {
  const second = signupAndDeliver(pool, { async sendVerification(message) { messages.push(message); } });
  const blocker = await pool.connect();
  let requests: Promise<{status: 'accepted'}[]> | undefined;
  try {
    const workers = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
    for (const worker of workers) worker.release();
    await blocker.query('BEGIN');
    // Hold inserts until all workers overlap. Without serialisation all three read an empty history.
    await blocker.query('LOCK TABLE signup_requests IN SHARE MODE');
    requests = Promise.all([store.request(email), second.request(email), store.request(email.toUpperCase())]);
    let overlapping = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await admin.query("SELECT count(*) FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [schema]);
      if (Number(rows[0].count) === 3) { overlapping = true; break; }
      await delay(20);
    }
    await blocker.query('COMMIT');
    assert.deepEqual(await requests, Array(3).fill({ status: 'accepted' }));
    assert.ok(overlapping, 'all three requests must overlap before any insert commits');
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await requests; }
  assert.equal(messages.length, 1);
  assert.equal(await count('signup_requests'), 1);
  await pool.query("UPDATE signup_requests SET created_at = clock_timestamp() - interval '61 seconds'");
  await request();
  assert.equal(messages.length, 2);
  assert.notEqual(messages[0]!.token, messages[1]!.token);
  // A resend must not let an unauthenticated requester invalidate the owner's existing link.
  await store.complete(messages[0]!.token, details);
});

test('two valid links for one email and concurrent repeats create only one customer', async () => {
  const first = await request();
  await pool.query("UPDATE signup_requests SET created_at = clock_timestamp() - interval '61 seconds'");
  const second = await request();
  const results = await Promise.allSettled([store.complete(first.token, details), store.complete(second.token, details), store.complete(first.token, details)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'verification_unavailable');
  for (const table of ['cloud_accounts', 'cloud_credentials', 'organisations', 'legal_businesses', 'organisation_memberships']) assert.equal(await count(table), 1);
});

test('a new verification request never replaces or re-enables an existing account', async () => {
  const original = await store.complete((await request()).token, details);
  await pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp()');
  const before = (await pool.query('SELECT * FROM cloud_credentials')).rows;
  await pool.query("UPDATE signup_requests SET created_at = clock_timestamp() - interval '61 seconds'");
  assert.deepEqual(await store.request(email), { status: 'accepted' });
  await expectCode(store.complete(messages.at(-1)!.token, { ...details, password: 'attacker replacement password' }), 'verification_unavailable');
  assert.deepEqual((await pool.query('SELECT * FROM cloud_credentials')).rows, before);
  assert.ok((await pool.query('SELECT disabled_at FROM cloud_accounts WHERE id = $1', [original.accountId])).rows[0].disabled_at);
  assert.equal(await count('organisations'), 1);
  assert.equal(await count('cloud_accounts'), 1, 'failed duplicate signup leaves no orphan account');
});

test('delivery failure exposes no provider detail and can retry the original request', async () => {
  let deliveredToken = '';
  const broken = signupAndDeliver(pool, { async sendVerification(message) {
    deliveredToken = message.token;
    throw new Error(`provider secret ${message.token}`);
  } });
  assert.deepEqual(await broken.request(email), {status: 'accepted'});
  const queued = (await pool.query('SELECT * FROM email_outbox')).rows[0];
  assert.equal(queued.status, 'pending');
  assert.equal(queued.last_error, 'delivery_failed');
  assert.ok(deliveredToken);
  assert.ok(!inspect(queued).includes(deliveredToken));
  assert.ok(!inspect(queued).includes('provider secret'));
  assert.equal(await count('signup_requests'), 1);
  assert.equal(await count('cloud_accounts'), 0);
  // An uncertain send can still arrive; its original link remains valid.
  await store.complete(deliveredToken, details);
  assert.equal(await count('cloud_accounts'), 1);
});

test('invalid signup details do not consume the link or create partial records', async () => {
  for (const address of ['invalid', 'a@', 'a\r\n@example.test', '.a@example.test', 'a..b@example.test', 'a@-invalid.test']) {
    await expectCode(store.request(address), 'signup_invalid');
  }
  assert.equal(messages.length, 0);
  const message = await request();
  for (const invalid of [
    { password: 'short' }, { password: 'é'.repeat(513) }, { organisationName: ' ' },
    { legalBusinessName: 'x'.repeat(201) }, { countryCode: 'Spain' },
  ]) await expectCode(store.complete(message.token, { ...details, ...invalid }), 'signup_invalid');
  assert.equal(await count('cloud_accounts'), 0);
  await store.complete(message.token, { ...details, password: '🔑'.repeat(15), countryCode: 'es' });
});

test('compromised password refusal leaves the signup link usable for an acceptable password', async () => {
  const screened = signupAndDeliver(pool, { async sendVerification(message) { messages.push(message); } }, {
    async check(password) { return password === details.password ? 'compromised' : 'acceptable'; },
  });
  await screened.request(email);
  const message = messages.at(-1)!;
  await expectCode(screened.complete(message.token, details), 'password_compromised');
  assert.equal(await count('cloud_accounts'), 0);
  assert.equal((await pool.query('SELECT consumed_at FROM signup_requests')).rows[0].consumed_at, null);
  await screened.complete(message.token, {...details, password: 'an acceptable café password'});
});

test('unavailable password screening leaves the signup link and database unchanged', async () => {
  let available = false;
  const screened = signupAndDeliver(pool, { async sendVerification(message) { messages.push(message); } }, {
    async check() { if (!available) throw new Error('private provider detail'); return 'acceptable'; },
  });
  await screened.request(email);
  const message = messages.at(-1)!;
  await expectCode(screened.complete(message.token, details), 'password_screening_unavailable');
  assert.equal(await count('cloud_accounts'), 0);
  assert.equal((await pool.query('SELECT consumed_at FROM signup_requests')).rows[0].consumed_at, null);
  available = true;
  await screened.complete(message.token, details);
});

test('a database failure rolls back all signup records and leaves its link usable', async () => {
  const message = await request();
  await pool.query("ALTER TABLE organisations ADD CONSTRAINT simulate_failure CHECK (name <> 'Café Sol')");
  try {
    await assert.rejects(store.complete(message.token, details), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23514');
    for (const table of ['cloud_accounts', 'cloud_credentials', 'organisations', 'legal_businesses', 'organisation_memberships']) assert.equal(await count(table), 0);
    assert.equal((await pool.query('SELECT consumed_at FROM signup_requests')).rows[0].consumed_at, null);
  } finally { await pool.query('ALTER TABLE organisations DROP CONSTRAINT simulate_failure'); }
  await store.complete(message.token, details);
});

test('a fresh process completes a stored request and a lost reply is recovered by login', async () => {
  const message = await request();
  execFileSync(process.execPath, ['test/fixtures/signup-restart.ts'], {
    env: { ...process.env, SIGNUP_TEST_SCHEMA: schema, SIGNUP_TEST_TOKEN: message.token, SIGNUP_TEST_DETAILS: JSON.stringify(details) },
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
  });
  await expectCode(store.complete(message.token, details), 'verification_unavailable');
  const session = await transaction(pool, client => login(client, { email, password: details.password }));
  assert.ok(session.accountId);
  assert.equal(await count('organisations'), 1);
});

test('a token expiring while waiting for its own row lock cannot create an account', async () => {
  const message = await request();
  await pool.query("UPDATE signup_requests SET expires_at = clock_timestamp() + interval '1 second'");
  const blocker = await pool.connect();
  let completion: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT token_hash FROM signup_requests FOR UPDATE');
    completion = expectCode(store.complete(message.token, details), 'verification_unavailable');
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND query LIKE '%signup_requests%FOR UPDATE%'", [schema]);
      if (rows.length) { blocked = true; break; }
      await delay(20);
    }
    await delay(1100);
    await blocker.query('COMMIT');
    await completion;
    assert.ok(blocked);
    assert.equal(await count('cloud_accounts'), 0);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await completion; }
});

test('expiry during a database wait rolls back account and business creation', async () => {
  const message = await request();
  await pool.query("UPDATE signup_requests SET expires_at = clock_timestamp() + interval '1 second'");
  const blocker = await pool.connect();
  let completion: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE organisations IN SHARE MODE');
    completion = expectCode(store.complete(message.token, details), 'verification_unavailable');
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND query LIKE 'INSERT INTO organisations%'", [schema]);
      if (rows.length) { blocked = true; break; }
      await delay(20);
    }
    await delay(1100);
    await blocker.query('COMMIT');
    await completion;
    assert.ok(blocked, 'signup must wait after initially verifying the token');
    assert.equal(await count('cloud_accounts'), 0);
    assert.equal(await count('organisations'), 0);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await completion; }
});
