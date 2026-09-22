import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { after, before, beforeEach, test } from 'node:test';
import { Pool } from 'pg';
import { EmailDeliveryError, type EmailDeliveryContext } from '../src/email-delivery.ts';
import { EmailOutbox, EmailWorker } from '../src/email-outbox.ts';
import { SignupStore } from '../src/signup.ts';
import { PasswordRecoveryStore } from '../src/password-recovery.ts';
import { login, resolveSession } from '@waitron-cloud/identity';
import { migrate } from '../src/migrate.ts';
import { transaction } from '../src/transaction.ts';
import type { AccountEmail } from '../src/account-input.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Run pnpm test with Docker');
const schema = `outbox_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, application_name: schema });
const keys = { first: randomBytes(32).toString('hex'), second: randomBytes(32).toString('hex') };
const outbox = new EmailOutbox({activeKeyId: 'first', keys});
const delivered: (AccountEmail | {email: string})[] = [];
const mailer = { async sendVerification(message: AccountEmail) { delivered.push(message); },
  async sendPasswordReset(message: AccountEmail) { delivered.push(message); },
  async sendPasswordChanged(message: {email: string}) { delivered.push(message); } };
const worker = new EmailWorker(pool, outbox, mailer);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
async function enqueue(email = 'owner@example.test', ttlMs = 1800000) {
  const message = {email, token: randomBytes(32).toString('base64url'), expiresAt: new Date(Date.now() + ttlMs).toISOString()};
  await transaction(pool, async client => {
    await client.query('INSERT INTO signup_requests (token_hash, email, expires_at, created_at) VALUES ($1,$2,$3,clock_timestamp())', [digest(message.token), email, message.expiresAt]);
    await outbox.enqueue(client, 'verification', message);
  });
  return message;
}
const row = async () => (await pool.query('SELECT * FROM email_outbox ORDER BY created_at LIMIT 1')).rows[0];
const due = () => pool.query("UPDATE email_outbox SET available_at = clock_timestamp() - interval '1 second'");
before(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool); });
after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
beforeEach(async () => { delivered.length = 0; await pool.query('TRUNCATE signup_requests, email_outbox, cloud_accounts, organisations CASCADE'); });
async function clean() { await pool.query('DELETE FROM email_outbox'); }

test('rollback removes the message with its request; commit stores no plaintext token or recipient', async () => {
  await assert.rejects(transaction(pool, async client => {
    await outbox.enqueue(client, 'password_changed', {email: 'private@example.test'});
    throw new Error('rollback probe');
  }), /rollback probe/);
  assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count, '0');
  const message = await enqueue();
  const record = await row();
  assert.ok(!record.payload.includes(Buffer.from(message.token)));
  assert.ok(!record.payload.includes(Buffer.from(message.email)));
  const stored = JSON.stringify(record);
  assert.ok(!stored.includes(message.token)); assert.ok(!stored.includes(message.email));
  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(delivered, [message]);
  assert.equal((await row()).status, 'sent'); assert.equal((await row()).payload, null);
  assert.equal(await worker.runOnce(), false);
  await clean();
});

test('provider failures retry the same link, keep only fixed diagnostics and stop at the limit', async () => {
  const message = await enqueue();
  const broken = new EmailWorker(pool, outbox, { ...mailer, async sendVerification() { throw new Error(`secret ${message.token}`); } });
  for (let i = 1; i <= 8; i++) {
    assert.equal(await broken.runOnce(), true);
    const record = await row();
    assert.equal(record.attempts, i); assert.equal(record.failures, i);
    assert.equal(record.last_error, 'delivery_failed');
    assert.ok(!JSON.stringify(record).includes(message.token));
    assert.equal(record.status, i === 8 ? 'failed' : 'pending');
    const delaySeconds = (record.available_at.getTime() - Date.now()) / 1000;
    assert.ok(delaySeconds > Math.min(900, 30 * 2 ** (i - 1)) - 5);
    assert.ok(delaySeconds <= Math.min(900, 30 * 2 ** (i - 1)) + 1);
    assert.equal(await worker.runOnce(), false, 'retry must wait for its due time');
    await due();
  }
  assert.equal((await row()).payload, null); await clean();
  const retry = await enqueue();
  await broken.runOnce(); await due(); await worker.runOnce();
  assert.deepEqual(delivered, [retry]); await clean();
});

test('expiry and consumed requests are discarded before transport, even when retry is scheduled later', async () => {
  await enqueue();
  await pool.query("UPDATE email_outbox SET expires_at = clock_timestamp() - interval '1 second', available_at = clock_timestamp() + interval '1 hour'");
  await worker.runOnce(); assert.equal((await row()).status, 'expired'); assert.equal((await row()).payload, null); await clean();
  await enqueue('second@example.test');
  await pool.query('UPDATE signup_requests SET consumed_at = clock_timestamp()');
  await worker.runOnce(); assert.equal((await row()).status, 'cancelled');
  assert.equal(delivered.length, 0); await clean();
});

test('concurrent workers cannot send the same live claim', async () => {
  await enqueue();
  let release!: () => void; let started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const sending = new Promise<void>(resolve => { started = resolve; });
  const slow = new EmailWorker(pool, outbox, { ...mailer, async sendVerification(message) { started(); await held; delivered.push(message); } });
  const first = slow.runOnce();
  try { await sending; assert.equal(await worker.runOnce(), false); }
  finally { release(); await first; }
  assert.equal(delivered.length, 1); assert.equal((await row()).attempts, 1); await clean();
});

test('abandoned claims resume and a late old worker cannot overwrite the new result', async () => {
  await enqueue();
  let release!: () => void; let started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const sending = new Promise<void>(resolve => { started = resolve; });
  const slow = new EmailWorker(pool, outbox, { ...mailer, async sendVerification() { started(); await held; throw new Error('late failure'); } });
  const first = slow.runOnce();
  try {
    await sending;
    await pool.query("UPDATE email_outbox SET lease_until = clock_timestamp() - interval '1 second'");
    assert.equal(await worker.runOnce(), true);
  } finally { release(); await first; }
  assert.equal((await row()).status, 'sent'); assert.equal((await row()).attempts, 2);
  assert.equal((await row()).failures, 0); assert.equal(delivered.length, 1); await clean();
});

test('key rotation reads old messages, tampering fails closed and missing keys are retried', async () => {
  const message = await enqueue();
  const rotated = new EmailOutbox({activeKeyId: 'second', keys});
  await new EmailWorker(pool, rotated, mailer).runOnce();
  assert.deepEqual(delivered, [message]); await clean();
  await enqueue('tampered@example.test');
  await pool.query("UPDATE email_outbox SET payload = set_byte(payload, 15, get_byte(payload, 15) # 1)");
  await worker.runOnce(); assert.equal((await row()).last_error, 'payload_unavailable');
  assert.equal(delivered.length, 1); await clean();
  await enqueue('missing-key@example.test');
  await new EmailWorker(pool, new EmailOutbox({activeKeyId: 'second', keys: {second: keys.second}}), mailer).runOnce();
  assert.equal((await row()).last_error, 'payload_unavailable');
  await due(); await worker.runOnce(); assert.equal(delivered.length, 2); await clean();
});

test('invalid key configuration fails with a fixed diagnostic', () => {
  const configs: {activeKeyId: string; keys: Record<string, string>}[] = [{activeKeyId: 'missing', keys}, {activeKeyId: 'bad', keys: {bad: 'secret'}}, {activeKeyId: '', keys: {'': keys.first}}];
  for (const config of configs) {
    assert.throws(() => new EmailOutbox(config), {message: 'Invalid email key configuration'});
  }
});

test('stores enqueue without delivery; queue insertion failure rolls back requests and password/session changes', async () => {
  const signup = new SignupStore(pool, outbox);
  const recovery = new PasswordRecoveryStore(pool, outbox);
  const email = 'owner@example.test';
  const password = 'original café password';
  assert.deepEqual(await signup.request(email), {status: 'accepted'});
  assert.equal(delivered.length, 0);
  await worker.runOnce();
  const first = delivered[0] as AccountEmail;
  await signup.complete(first.token, {password, organisationName: 'Café Sol', legalBusinessName: 'Café Sol SL', countryCode: 'ES'});
  const session = await transaction(pool, client => login(client, {email, password}));
  await recovery.request(email); await worker.runOnce();
  const reset = delivered[1] as AccountEmail;
  await pool.query("ALTER TABLE email_outbox ADD CONSTRAINT simulate_failure CHECK (kind <> 'password_changed')");
  try {
    await assert.rejects(recovery.complete(reset.token, 'replacement café password'), {code: '23514'});
    await transaction(pool, client => resolveSession(client, session.token));
    await transaction(pool, client => login(client, {email, password}));
    assert.equal((await pool.query('SELECT consumed_at FROM password_reset_requests')).rows[0].consumed_at, null);
  } finally { await pool.query('ALTER TABLE email_outbox DROP CONSTRAINT simulate_failure'); }
  await recovery.complete(reset.token, 'replacement café password');
  assert.equal(delivered.length, 2);
  await worker.runOnce(); assert.deepEqual(delivered[2], {email});
  await assert.rejects(transaction(pool, client => resolveSession(client, session.token)), {code: 'session_unavailable'});
  await clean();
  await pool.query("ALTER TABLE email_outbox ADD CONSTRAINT simulate_failure CHECK (kind = 'password_changed')");
  try {
    await assert.rejects(signup.request('new@example.test'), {code: '23514'});
    assert.equal((await pool.query("SELECT count(*) FROM signup_requests WHERE email = 'new@example.test'")).rows[0].count, '0');
    await pool.query('TRUNCATE password_reset_requests');
    await assert.rejects(recovery.request(email), {code: '23514'});
    assert.equal((await pool.query('SELECT count(*) FROM password_reset_requests')).rows[0].count, '0');
  } finally { await pool.query('ALTER TABLE email_outbox DROP CONSTRAINT simulate_failure'); }
  assert.deepEqual(await recovery.request('unknown@example.test'), {status: 'accepted'});
  assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count, '0');
});

test('timeout releases work for retry and status exposes counts without tokens or recipients', async () => {
  const message = await enqueue();
  const hanging = new EmailWorker(pool, outbox, {...mailer, sendVerification: () => new Promise<void>(() => {})}, {sendTimeoutMs: 10});
  await hanging.runOnce();
  const status = await worker.status();
  assert.equal(status.counts.pending, 1); assert.equal(status.attempts, 1); assert.equal(status.failures, 1);
  assert.ok(status.oldestPendingAt);
  assert.ok(!JSON.stringify(status).includes(message.email)); assert.ok(!JSON.stringify(status).includes(message.token));
  await due(); await worker.runOnce(); assert.deepEqual(delivered, [message]);
});

test('delayed recovery skips links invalidated by a reset, email change or suspension', async () => {
  const signup = new SignupStore(pool, outbox); const recovery = new PasswordRecoveryStore(pool, outbox);
  const email = 'owner@example.test';
  await signup.request(email); await worker.runOnce();
  const account = await signup.complete((delivered[0] as AccountEmail).token, {
    password: 'original café password', organisationName: 'Café Sol', legalBusinessName: 'Café Sol SL', countryCode: 'ES',
  });
  await recovery.request(email); await worker.runOnce();
  const reset = delivered[1] as AccountEmail;
  await pool.query("UPDATE password_reset_requests SET created_at = clock_timestamp() - interval '61 seconds'");
  await recovery.request(email);
  await recovery.complete(reset.token, 'replacement café password');
  assert.equal(await worker.runOnce(), true);
  assert.equal((await pool.query("SELECT status FROM email_outbox WHERE kind = 'password_reset' AND attempts = 1 ORDER BY created_at DESC LIMIT 1")).rows[0].status, 'cancelled');
  assert.equal(delivered.length, 2);
  await worker.runOnce(); assert.deepEqual(delivered[2], {email});
  for (const change of ["UPDATE cloud_credentials SET email = 'changed@example.test'", 'UPDATE cloud_credentials SET email_verified_at = NULL', 'UPDATE cloud_accounts SET disabled_at = clock_timestamp()']) {
    await pool.query('UPDATE cloud_credentials SET email = $1, email_verified_at = clock_timestamp()', [email]);
    await pool.query('UPDATE cloud_accounts SET disabled_at = NULL WHERE id = $1', [account.accountId]);
    await pool.query("UPDATE password_reset_requests SET created_at = clock_timestamp() - interval '61 seconds'");
    await recovery.request(email); await pool.query(change);
    await worker.runOnce();
    assert.equal((await pool.query('SELECT status FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0].status, 'cancelled');
    assert.equal(delivered.length, 3);
  }
});

test('a process dying after claim leaves durable work for a fresh worker and crashes exhaust the limit', async () => {
  const message = await enqueue();
  assert.throws(() => execFileSync(process.execPath, ['test/fixtures/email-crash.ts'], {
    env: {...process.env, PGOPTIONS: `-c search_path=${schema}`, EMAIL_TEST_KEYS: JSON.stringify(keys)},
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
  }), {status: 23});
  assert.equal((await row()).status, 'processing');
  assert.equal(await worker.runOnce(), false);
  await pool.query("UPDATE email_outbox SET lease_until = clock_timestamp() - interval '1 second'");
  await new EmailWorker(pool, new EmailOutbox({activeKeyId: 'first', keys}), mailer).runOnce();
  assert.deepEqual(delivered, [message]); await clean();
  await enqueue('crashing@example.test');
  assert.throws(() => execFileSync(process.execPath, ['test/fixtures/email-crash.ts'], {
    env: {...process.env, PGOPTIONS: `-c search_path=${schema}`, EMAIL_TEST_KEYS: JSON.stringify(keys)},
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
  }), {status: 23});
  await pool.query("UPDATE email_outbox SET attempts = 8, lease_until = clock_timestamp() - interval '1 second'");
  await worker.runOnce();
  assert.equal((await row()).status, 'failed'); assert.equal((await row()).last_error, 'attempts_exhausted');
  assert.equal((await row()).payload, null); assert.equal(delivered.length, 1);
});

test('competing claims skip a locked row rather than claiming it twice', async () => {
  await enqueue();
  const blocker = await pool.connect(); let first: Promise<boolean> | undefined; let second: Promise<boolean> | undefined;
  try {
    await blocker.query('BEGIN'); await blocker.query('LOCK TABLE email_outbox IN SHARE MODE');
    first = worker.runOnce();
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = (await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND query LIKE 'UPDATE email_outbox%'", [schema])).rows;
      if (rows.length) { blocked = true; break; }
      await delay(20);
    }
    assert.ok(blocked, 'the first worker must hold its row lock while waiting to commit the claim');
    second = new EmailWorker(pool, outbox, mailer).runOnce();
    assert.equal(await Promise.race([second, delay(500).then(() => 'blocked')]), false);
  } finally {
    await blocker.query('ROLLBACK'); blocker.release(); await first; await second;
  }
  assert.equal((await row()).attempts, 1); assert.equal(delivered.length, 1);
});

test('ciphertext copied into another message cannot be delivered under its identity', async () => {
  await enqueue('first@example.test'); await enqueue('second@example.test');
  const rows = (await pool.query('SELECT * FROM email_outbox ORDER BY created_at')).rows;
  await pool.query('UPDATE email_outbox SET payload = $2, token_hash = $3, expires_at = $4 WHERE id = $1',
    [rows[1].id, rows[0].payload, rows[0].token_hash, rows[0].expires_at]);
  await worker.runOnce(); await worker.runOnce();
  assert.equal(delivered.length, 1);
  assert.equal((await pool.query('SELECT last_error FROM email_outbox WHERE id = $1', [rows[1].id])).rows[0].last_error, 'payload_unavailable');
});

// Hold only this worker after its real eligibility query; replacement workers use the ordinary pool.
function pauseEligibility() {
  let resume!: () => void; let reached!: () => void;
  const held = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { reached = resolve; });
  const paused = new Proxy(pool, {get(target, property) {
    if (property === 'query') return async (sql: string, values?: unknown[]) => {
      const result = await target.query(sql, values);
      if (sql.startsWith('SELECT 1 FROM signup_requests')) { reached(); await held; }
      return result;
    };
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  return {pool: paused, started, resume};
}

test('a worker superseded during eligibility lookup cannot hand the message to the transport', async () => {
  await enqueue();
  const paused = pauseEligibility();
  const first = new EmailWorker(paused.pool, outbox, mailer).runOnce();
  try {
    await paused.started;
    await pool.query("UPDATE email_outbox SET lease_until = clock_timestamp() - interval '1 second'");
    await worker.runOnce(); assert.equal(delivered.length, 1);
  } finally { paused.resume(); await first; }
  assert.equal(delivered.length, 1); assert.equal((await row()).status, 'sent');
});

test('a link expiring during eligibility lookup is discarded before transport', async () => {
  const message = await enqueue('owner@example.test', 1500);
  const paused = pauseEligibility();
  const sending = new EmailWorker(paused.pool, outbox, mailer).runOnce();
  try {
    await paused.started;
    await delay(Math.max(0, Date.parse(message.expiresAt) - Date.now()) + 30);
  } finally { paused.resume(); await sending; }
  assert.equal(delivered.length, 0); assert.equal((await row()).status, 'expired');
  assert.equal((await row()).payload, null);
});

test('token-hash and expiry metadata cannot redirect eligibility checks for intact ciphertext', async () => {
  const first = await enqueue('owner@example.test');
  const second = await enqueue('owner@example.test');
  await pool.query('UPDATE signup_requests SET consumed_at = clock_timestamp() WHERE token_hash = $1', [digest(first.token)]);
  await pool.query('UPDATE email_outbox SET token_hash = $2 WHERE token_hash = $1', [digest(first.token), digest(second.token)]);
  await worker.runOnce();
  assert.equal(delivered.length, 0); assert.equal((await row()).last_error, 'payload_unavailable');
  await clean();
  await enqueue('expiry@example.test');
  await pool.query("UPDATE email_outbox SET expires_at = expires_at + interval '1 hour'");
  await worker.runOnce(); assert.equal(delivered.length, 0);
  assert.equal((await row()).last_error, 'payload_unavailable');
});

test('permanent SMTP rejection stops retrying and erases the payload; temporary responses retry', async () => {
  await enqueue();
  const rejected = new EmailWorker(pool, outbox, {...mailer, async sendVerification() {throw new EmailDeliveryError('delivery_rejected');}});
  await rejected.runOnce();
  assert.equal((await row()).status, 'failed'); assert.equal((await row()).attempts, 1);
  assert.equal((await row()).last_error, 'delivery_rejected'); assert.equal((await row()).payload, null);
  assert.equal(await worker.runOnce(), false);
  await clean(); await enqueue('temporary@example.test');
  const deferred = new EmailWorker(pool, outbox, {...mailer, async sendVerification() {throw new EmailDeliveryError('delivery_deferred');}});
  await deferred.runOnce(); assert.equal((await row()).status, 'pending');
  assert.equal((await row()).last_error, 'delivery_deferred');
  await due(); await worker.runOnce(); assert.equal((await row()).status, 'sent');
});

test('worker timeout aborts the adapter and passes a stable queue delivery ID', async () => {
  await enqueue(); const id = (await row()).id;
  let seen: EmailDeliveryContext | undefined; let aborted = false;
  const hanging = new EmailWorker(pool, outbox, {...mailer, async sendVerification(_message, context?: EmailDeliveryContext) {
    seen = context;
    if (!context) throw new Error('Missing delivery context');
    await new Promise<void>((_, reject) => context.signal.addEventListener('abort', () => {aborted = true; reject(new Error('raw transport cancellation'));}, {once: true}));
  }}, {sendTimeoutMs: 10});
  await hanging.runOnce();
  assert.equal(seen?.deliveryId, id); assert.equal(aborted, true);
  assert.equal((await row()).last_error, 'delivery_timeout'); assert.equal((await row()).failures, 1);
});

test('accepted SMTP receipts are retained only by the current claim', async () => {
  await enqueue(); const id = (await row()).id;
  const receipt = {transport: 'smtp' as const, messageId: `<${id}@example.test>`};
  const accepted = new EmailWorker(pool, outbox, {...mailer, async sendVerification() {return receipt;}});
  await accepted.runOnce();
  assert.equal((await row()).transport, 'smtp'); assert.equal((await row()).message_id, receipt.messageId);
  assert.equal((await row()).payload, null);
  await clean(); await enqueue('superseded@example.test');
  let resume!: () => void; let reached!: () => void;
  const held = new Promise<void>(resolve => {resume = resolve;}); const started = new Promise<void>(resolve => {reached = resolve;});
  const stale = new EmailWorker(pool, outbox, {...mailer, async sendVerification() {reached(); await held; return receipt;}}).runOnce();
  try {
    await started; await pool.query("UPDATE email_outbox SET lease_until = clock_timestamp() - interval '1 second'");
    await worker.runOnce();
  } finally {resume(); await stale;}
  assert.equal((await row()).status, 'sent'); assert.equal((await row()).message_id, null);
});

test('status command works in production without delivery credentials or encryption keys', async () => {
  const env = {...process.env, NODE_ENV: 'production', DATABASE_URL: process.env.TEST_DATABASE_URL, PGOPTIONS: `-c search_path=${schema}`};
  for (const key of ['CLOUD_EMAIL_KEYS', 'CLOUD_EMAIL_ACTIVE_KEY_ID', 'CLOUD_SMTP_PASSWORD', 'CLOUD_SMTP_USER', 'CLOUD_SMTP_HOST']) delete env[key as keyof typeof env];
  const output = execFileSync(process.execPath, ['src/email-worker-cli.ts', '--status'], {env, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe']});
  assert.equal(JSON.parse(output).counts.pending, 0);
});
