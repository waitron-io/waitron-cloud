// Explicit local PostgreSQL/Mailpit integration. Every account, message and ledger
// here is generated; no private venue source or provider endpoint is opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as tcpServer, connect } from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { EmailOutbox, EmailWorker } from '../../../packages/registration/src/email-outbox.ts';
import { createLocalAccountMailer } from '../../../packages/registration/src/local-mailer.ts';
import { transaction } from '../../../packages/registration/src/transaction.ts';
import { SignupStore } from '../../../packages/registration/src/signup.ts';
import { PasswordRecoveryStore } from '../../../packages/registration/src/password-recovery.ts';
import { database } from '../../../packages/account-http/test/fixtures.ts';
import { startAccountServer } from '../../../packages/account-http/src/server.ts';
import { openMailMeasurement } from '../mail.mjs';
const { Pool } = createRequire(new URL('../../../packages/registration/package.json', import.meta.url))('pg');

if (!process.env.TEST_DATABASE_URL || !process.env.MAILPIT_TEST_URL || !process.env.MAILPIT_TEST_SMTP_PORT)
  throw Error('Run with scripts/test-postgres.mjs');

async function refusedOnceSmtp() {
  const sockets = new Set(); let connections = 0;
  const server = tcpServer(client => {
    sockets.add(client); client.on('error', () => {}); client.once('close', () => sockets.delete(client));
    if (++connections === 1) { client.end('421 temporary generated capture refusal\r\n'); return; }
    const upstream = connect(Number(process.env.MAILPIT_TEST_SMTP_PORT), '127.0.0.1');
    sockets.add(upstream); upstream.on('error', () => client.destroy());
    upstream.once('close', () => { sockets.delete(upstream); client.destroy(); });
    client.once('close', () => upstream.destroy()); client.pipe(upstream); upstream.pipe(client);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { target: `smtp://127.0.0.1:${server.address().port}`, connections: () => connections,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
async function mailFixture() {
  const f = await database();
  try {
    const running = await startAccountServer({pool: f.pool, outbox: f.outbox,
      config: {portalOrigin: 'http://localhost', production: false, rateKey: f.rateKey, trustedProxyIps: []}, port: 0});
    const address = running.server.address(); assert.ok(address && typeof address !== 'string');
    return {f, port: address.port, async close() {try {await running.close();} finally {await f.close();}}};
  } catch (error) {await f.close(); throw error;}
}
async function collect(s, meters, proxies = []) {
  const results = [];
  for (const group of [meters, proxies, [s]]) results.push(...await Promise.allSettled(group.filter(Boolean).map(resource => resource.close())));
  for (const result of results) assert.equal(result.status, 'fulfilled', 'every owned resource must close before exporting');
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try { assert.equal((await admin.query('SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname=$1', [s.f.schema])).rows[0].n, 0); }
  finally { await admin.end(); }
  await assert.rejects(fetch(`http://127.0.0.1:${s.port}`, { signal: AbortSignal.timeout(1000) }));
}

// Queue retries and SMTP observations must agree after every owned resource closes.
test('genuineQueueDeliveryRetainsRetryRefusalPrivacyAndOwnedCleanup', { timeout: 60000 }, async t => {
  const s = await mailFixture();
  let mailRun, smtp, mail, sent;
  const email = `generated-${randomUUID()}@example.test`;
  try {
    smtp = await refusedOnceSmtp();
    mailRun = await openMailMeasurement({ target: smtp.target });
    const outbox = new EmailOutbox({ activeKeyId: 'generated', keys: { generated: randomBytes(32).toString('hex') } });
    await transaction(s.f.pool, async client => {
      for (const locale of ['en', 'es', 'es']) await outbox.enqueue(client, 'password_changed', { email, locale });
    });
    const worker = new EmailWorker(s.f.pool, outbox, mailRun.wrapMailer(createLocalAccountMailer({ port: mailRun.port })));
    assert.equal(await worker.runOnce(), true);
    const failed = await worker.status(); assert.equal(failed.failures, 1); assert.equal(failed.counts.sent, 0);
    await s.f.pool.query('UPDATE email_outbox SET available_at=clock_timestamp()');
    for (let n = 0; n < 3; n++) assert.equal(await worker.runOnce(), true);
    assert.equal(await worker.runOnce(), false);
    const status = await worker.status(); assert.equal(status.counts.sent, 3); assert.equal(status.attempts, 4);
    assert.equal((await s.f.pool.query('SELECT count(*)::integer AS n FROM email_outbox WHERE payload IS NOT NULL OR key_id IS NOT NULL')).rows[0].n, 0);
    const captured = await fetch(process.env.MAILPIT_TEST_URL + '/api/v1/messages', { signal: AbortSignal.timeout(3000) });
    assert.equal(captured.status, 200);
    const messages = (await captured.json()).messages.filter(message => message.To.some(to => to.Address === email));
    assert.deepEqual(messages.map(message => message.Subject).sort(), ['Tu contraseña de Waitron Cloud ha cambiado',
      'Tu contraseña de Waitron Cloud ha cambiado', 'Your Waitron Cloud password changed']);
    await mailRun.close(); mail = mailRun.snapshot();
    sent = smtp.connections();
  } finally {
    await collect(s, [mailRun], [smtp]);
  }
  assert.equal(sent, 4);
  assert.deepEqual(mail.producer, {attempts: 4, accepted: 3, refused: 1, retried: 1});
  assert.deepEqual(mail.observer, {attempts: 4, accepted: 3, refused: 1});
  assert.equal(mail.reconciled, true);
  assert.deepEqual(mail.discrepancy, {attempts: 0, accepted: 0, refused: 0});
  assert.equal([email, 'payload', 'signature', '127.0.0.1'].some(value => JSON.stringify(mail).includes(value)), false);
  t.diagnostic(JSON.stringify(mail));
});

test('signupRecoveryRetainsCapturedMailPrivacyAndOwnedCleanup', { timeout: 60000 }, async t => {
  const s = await mailFixture();
  const email = `generated-${randomUUID()}@example.test`; let mailRun, mail;
  try {
    mailRun = await openMailMeasurement({ target: `smtp://127.0.0.1:${process.env.MAILPIT_TEST_SMTP_PORT}` });
    const outbox = new EmailOutbox({ activeKeyId: 'generated', keys: { generated: randomBytes(32).toString('hex') } });
    const signup = new SignupStore(s.f.pool, outbox), recovery = new PasswordRecoveryStore(s.f.pool, outbox);
    const worker = new EmailWorker(s.f.pool, outbox, mailRun.wrapMailer(createLocalAccountMailer({ port: mailRun.port })));
    const capturedToken = async path => {
      const response = await fetch(process.env.MAILPIT_TEST_URL + '/api/v1/messages', { signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 200);
      for (const row of (await response.json()).messages.filter(m => m.To.some(to => to.Address === email))) {
        const detail = await fetch(process.env.MAILPIT_TEST_URL + '/api/v1/message/' + row.ID, { signal: AbortSignal.timeout(3000) });
        assert.equal(detail.status, 200);
        const match = (await detail.json()).Text.match(new RegExp('/' + path + '#token=([A-Za-z0-9_-]{43})'));
        if (match) return match[1];
      }
      assert.fail('Missing generated capture link');
    };
    await signup.request(email, 'es'); assert.equal(await worker.runOnce(), true);
    await signup.complete(await capturedToken('signup'), { password: 'Generated local fixture password',
      organisationName: 'Generated venue', legalBusinessName: 'Generated SL', countryCode: 'ES' });
    await recovery.request(email, 'en'); assert.equal(await worker.runOnce(), true);
    await recovery.complete(await capturedToken('reset-password'), 'Different generated fixture password', 'es');
    assert.equal(await worker.runOnce(), true); assert.equal(await worker.runOnce(), false);
    const status = await worker.status(); assert.equal(status.counts.sent, 3); assert.equal(status.attempts, 3); assert.equal(status.failures, 0);
    await mailRun.close(); mail = mailRun.snapshot();
  } finally { await collect(s, [mailRun]); }
  assert.deepEqual(mail.producer, {attempts: 3, accepted: 3, refused: 0, retried: 0});
  assert.deepEqual(mail.observer, {attempts: 3, accepted: 3, refused: 0});
  assert.deepEqual(mail.operations.map(r => [r.action, r.retryOrdinal, r.attempts]),
    [['verification', 0, 1], ['password_reset', 0, 1], ['password_changed', 0, 1]]);
  assert.equal(mail.reconciled, true);
  assert.deepEqual(mail.discrepancy, {attempts: 0, accepted: 0, refused: 0});
  assert.equal(JSON.stringify(mail).includes(email), false);
  t.diagnostic(JSON.stringify(mail));
});
