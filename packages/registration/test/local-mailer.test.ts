import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { login, resolveSession } from '@waitron-cloud/identity';
import { SignupStore, PasswordRecoveryStore } from '../src/index.ts';
import { createLocalAccountMailer } from '../src/local-mailer.ts';
import { migrate } from '../src/migrate.ts';
import { transaction } from '../src/transaction.ts';

if (!process.env.TEST_DATABASE_URL || !process.env.MAILPIT_TEST_URL || !process.env.MAILPIT_TEST_SMTP_PORT) throw new Error('Run pnpm test with Docker');
const inbox = process.env.MAILPIT_TEST_URL;
const schema = `mail_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
before(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool); });
after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
async function captured(subject: string) {
  const response = await fetch(`${inbox}/api/v1/messages`);
  assert.equal(response.status, 200);
  const list = await response.json() as {messages: {ID: string; Subject: string}[]};
  const summary = list.messages.find(message => message.Subject === subject);
  assert.ok(summary, `Expected captured email: ${subject}`);
  const detail = await fetch(`${inbox}/api/v1/message/${summary.ID}`);
  assert.equal(detail.status, 200);
  return await detail.json() as { Text: string; To: {Address: string}[] };
}

test('signup and recovery travel through SMTP and can be read in the local inbox', async () => {
  const mailer = createLocalAccountMailer({ port: Number(process.env.MAILPIT_TEST_SMTP_PORT), portalOrigin: 'http://localhost:3000' });
  const signup = new SignupStore(pool, mailer);
  const recovery = new PasswordRecoveryStore(pool, mailer);
  const email = 'cafe-owner@example.test';
  await signup.request(email);
  const verification = await captured('Verify your Waitron Cloud email');
  assert.equal(verification.To[0]?.Address, email);
  const signupLink = verification.Text.match(/http:\/\/localhost:3000\/signup\?token=([A-Za-z0-9_-]{43})/);
  assert.ok(signupLink);
  await signup.complete(signupLink[1]!, { password: 'original café password', organisationName: 'Café Sol', legalBusinessName: 'Café Sol SL', countryCode: 'ES' });
  const session = await transaction(pool, client => login(client, { email, password: 'original café password' }));
  await recovery.request(email);
  const reset = await captured('Reset your Waitron Cloud password');
  const resetLink = reset.Text.match(/http:\/\/localhost:3000\/reset-password\?token=([A-Za-z0-9_-]{43})/);
  assert.ok(resetLink);
  await recovery.complete(resetLink[1]!, 'replacement café password');
  const notification = await captured('Your Waitron Cloud password changed');
  assert.equal(notification.To[0]?.Address, email);
  assert.ok(!notification.Text.includes('replacement café password'));
  assert.ok(!notification.Text.includes(resetLink[1]!));
  await assert.rejects(transaction(pool, client => resolveSession(client, session.token)), { code: 'session_unavailable' });
  await transaction(pool, client => login(client, { email, password: 'replacement café password' }));
});

test('local mailer rejects external portal origins and invalid ports', () => {
  for (const portalOrigin of ['', 'not a url', 'https://example.com', 'http://localhost:3000/path', 'http://user:secret@localhost:3000']) {
    assert.throws(() => createLocalAccountMailer({ portalOrigin }), /local mail configuration/);
  }
  for (const port of [0, 65536, NaN, 1.5]) assert.throws(() => createLocalAccountMailer({ port }), /local mail configuration/);
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => createLocalAccountMailer(), /local mail configuration/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
