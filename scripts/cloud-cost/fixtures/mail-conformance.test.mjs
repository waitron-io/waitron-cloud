// Explicit PostgreSQL/Mailpit proof using generated state; no venue data or outside mail server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { EmailOutbox, EmailWorker } from '../../../packages/registration/src/email-outbox.ts';
import { createLocalAccountMailer } from '../../../packages/registration/src/local-mailer.ts';
import { migrate } from '../../../packages/registration/src/migrate.ts';
import { transaction } from '../../../packages/registration/src/transaction.ts';
import { SignupStore } from '../../../packages/registration/src/signup.ts';
import { PasswordRecoveryStore } from '../../../packages/registration/src/password-recovery.ts';
import { openMailMeasurement } from '../local.mjs';
const { Pool } = createRequire(new URL('../../../packages/registration/package.json', import.meta.url))('pg');

if (!process.env.TEST_DATABASE_URL || !process.env.MAILPIT_TEST_URL || !process.env.MAILPIT_TEST_SMTP_PORT)
  throw Error('Run with scripts/test-postgres.mjs');

// Inject one observable SMTP refusal; every later connection reaches the genuine capture server.
async function capture() {
  const sockets = new Set(); let connections = 0;
  const server = createServer(client => {
    sockets.add(client); client.on('error', () => {}); client.once('close', () => sockets.delete(client));
    if (++connections === 1) { client.end('421 temporary local capture refusal\r\n'); return; }
    const upstream = connect(Number(process.env.MAILPIT_TEST_SMTP_PORT), '127.0.0.1');
    sockets.add(upstream); upstream.on('error', () => client.destroy());
    upstream.once('close', () => { sockets.delete(upstream); client.destroy(); });
    client.once('close', () => upstream.destroy());
    client.pipe(upstream); upstream.pipe(client);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { target: `smtp://127.0.0.1:${server.address().port}`, connections: () => connections,
    async close() { for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

test('genuineEmailQueueRetryAndBilingualMailpitDeliveryReconcileWithoutRawExport', async t => {
  const schema = `cost_mail_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  let proxy, run;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
    const outbox = new EmailOutbox({ activeKeyId: 'generated', keys: { generated: randomBytes(32).toString('hex') } });
    const email = `synthetic-${randomUUID()}@example.test`;
    const ids = await transaction(pool, async client => {
      const result = [];
      for (const locale of ['en', 'es', 'es']) result.push(await outbox.enqueue(client, 'password_changed', { email, locale }));
      return result;
    });
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM email_outbox')).rows[0].n, 3);
    proxy = await capture();
    run = await openMailMeasurement({ target: proxy.target });
    const worker = new EmailWorker(pool, outbox, run.wrapMailer(createLocalAccountMailer({ port: run.port })));
    assert.equal(await worker.runOnce(), true);
    const refused = await worker.status();
    assert.equal(refused.attempts, 1); assert.equal(refused.failures, 1);
    assert.equal(refused.counts.pending, 3); assert.equal(refused.counts.sent, 0);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM email_outbox WHERE available_at > clock_timestamp()')).rows[0].n, 1,
      'the real worker schedules the refused message for a later retry');
    // Advance only this generated fixture's retry availability; preserve the worker's actual scheduling rule.
    await pool.query('UPDATE email_outbox SET available_at = clock_timestamp()');
    for (let n = 0; n < 3; n++) assert.equal(await worker.runOnce(), true);
    assert.equal(await worker.runOnce(), false);
    await run.close();
    const delivered = await worker.status();
    assert.deepEqual(delivered.counts, { pending: 0, processing: 0, sent: 3, expired: 0, cancelled: 0, failed: 0 });
    assert.equal(delivered.attempts, 4); assert.equal(delivered.failures, 1);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM email_outbox WHERE payload IS NOT NULL OR key_id IS NOT NULL')).rows[0].n, 0);
    const response = await fetch(process.env.MAILPIT_TEST_URL + '/api/v1/messages', { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    const captured = (await response.json()).messages.filter(m => m.To.some(to => to.Address === email));
    assert.equal(captured.length, 3);
    assert.deepEqual(captured.map(m => m.Subject).sort(), ['Tu contraseña de Waitron Cloud ha cambiado',
      'Tu contraseña de Waitron Cloud ha cambiado', 'Your Waitron Cloud password changed']);
    assert.equal(proxy.connections(), 4);
    const snapshot = run.snapshot();
    assert.deepEqual(snapshot.producer, { attempts: 4, accepted: 3, refused: 1, retried: 1 });
    assert.deepEqual(snapshot.observer, { attempts: 4, accepted: 3, refused: 1 });
    assert.deepEqual(snapshot.discrepancy, { attempts: 0, accepted: 0, refused: 0 });
    const text = JSON.stringify(snapshot);
    assert.equal([email, schema, ...ids, 'Subject', 'Text', 'token', '127.0.0.1'].some(s => text.includes(s)), false);
    t.diagnostic(JSON.stringify({ scope: 'synthetic-local-mail-queue', enqueued: 3, sent: 3, failures: 1, snapshot }));
  } finally {
    await run?.close().catch(() => {}); await proxy?.close(); await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  }
});

test('genuineSignupAndPasswordRecoveryQueueExactlyThreeCapturedOperations', async t => {
  const schema = `cost_mail_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  let run;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
    const outbox = new EmailOutbox({ activeKeyId: 'generated', keys: { generated: randomBytes(32).toString('hex') } });
    const signup = new SignupStore(pool, outbox), recovery = new PasswordRecoveryStore(pool, outbox);
    run = await openMailMeasurement({ target: `smtp://127.0.0.1:${process.env.MAILPIT_TEST_SMTP_PORT}` });
    const worker = new EmailWorker(pool, outbox, run.wrapMailer(createLocalAccountMailer({ port: run.port })));
    const email = `synthetic-${randomUUID()}@example.test`;
    const capturedToken = async path => {
      const response = await fetch(process.env.MAILPIT_TEST_URL + '/api/v1/messages', { signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 200);
      const rows = (await response.json()).messages.filter(m => m.To.some(to => to.Address === email));
      for (const row of rows) {
        const detail = await fetch(process.env.MAILPIT_TEST_URL + '/api/v1/message/' + row.ID, { signal: AbortSignal.timeout(3000) });
        assert.equal(detail.status, 200);
        const match = (await detail.json()).Text.match(new RegExp('/' + path + '#token=([A-Za-z0-9_-]{43})'));
        if (match) return match[1];
      }
      assert.fail('Missing generated capture link');
    };
    await signup.request(email, 'es'); assert.equal(await worker.runOnce(), true);
    await signup.complete(await capturedToken('signup'), { password: 'Generated local fixture password',
      organisationName: 'Synthetic venue', legalBusinessName: 'Synthetic SL', countryCode: 'ES' });
    await recovery.request(email, 'en'); assert.equal(await worker.runOnce(), true);
    await recovery.complete(await capturedToken('reset-password'), 'Different generated fixture password', 'es');
    assert.equal(await worker.runOnce(), true); assert.equal(await worker.runOnce(), false);
    await run.close();
    const rows = (await pool.query('SELECT kind,status,attempts,failures,payload,key_id FROM email_outbox')).rows;
    assert.deepEqual(rows.map(r => r.kind).sort(), ['password_changed', 'password_reset', 'verification']);
    assert.equal(rows.every(r => r.status === 'sent' && r.attempts === 1 && r.failures === 0 && r.payload === null && r.key_id === null), true);
    const snapshot = run.snapshot();
    assert.deepEqual(snapshot.producer, { attempts: 3, accepted: 3, refused: 0, retried: 0 });
    assert.deepEqual(snapshot.observer, { attempts: 3, accepted: 3, refused: 0 });
    assert.deepEqual(snapshot.operations.map(r => [r.action, r.retryOrdinal, r.attempts]),
      [['verification', 0, 1], ['password_reset', 0, 1], ['password_changed', 0, 1]]);
    assert.equal(JSON.stringify(snapshot).includes(email), false);
    t.diagnostic(JSON.stringify({ scope: 'synthetic-local-signup-recovery', enqueued: 3, snapshot }));
  } finally {
    await run?.close().catch(() => {}); await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  }
});
