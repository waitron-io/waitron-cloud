import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {database} from '../../packages/account-http/test/fixtures.ts';
import {EmailWorker, SignupStore, PasswordRecoveryStore, OrganisationPlanStore} from '../../packages/registration/src/index.ts';
import {createTestCaptureMailer} from './capture-mailer.mjs';

// A plan gate on account mail, a missing outbox handoff or a wrong LAN link breaks this journey.
test('both plans capture signup and recovery mail without granting venue relay', async () => {
  const db = await database();
  try {
    assert.ok(process.env.MAILPIT_TEST_URL && process.env.MAILPIT_TEST_SMTP_PORT, 'Use scripts/test-postgres.mjs');
    const worker = new EmailWorker(db.pool, db.outbox, createTestCaptureMailer({origin: 'https://waitron.local:3000', port: Number(process.env.MAILPIT_TEST_SMTP_PORT)}));
    for (const plan of ['free', 'paid']) {
      const email = `free-service-${randomUUID()}@example.test`, signup = new SignupStore(db.pool, db.outbox);
      await signup.request(email);
      const row = (await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' AND status='pending'")).rows[0];
      const {token} = db.outbox.open(row);
      assert.equal(await worker.runOnce(), true);
      const owner = await signup.complete(token, {password: 'A long enough test password', organisationName: 'Test Cafe', legalBusinessName: 'Test Cafe SL', countryCode: 'ES'});
      await new OrganisationPlanStore(db.pool).set(owner.organisationId, plan);
      await new PasswordRecoveryStore(db.pool, db.outbox).request(email, plan === 'free' ? 'en' : 'es');
      assert.equal(await worker.runOnce(), true);
      const inbox = await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/messages?limit=1000`, {signal: AbortSignal.timeout(5000)});
      assert.equal(inbox.status, 200);
      const messages = (await inbox.json()).messages.filter(message => message.To.some(to => to.Address === email));
      assert.equal(messages.length, 2);
      const texts = [];
      for (const message of messages) {
        const response = await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/message/${message.ID}`, {signal: AbortSignal.timeout(5000)});
        assert.equal(response.status, 200); texts.push((await response.json()).Text);
      }
      assert.equal(texts.filter(text => text.includes('https://waitron.local:3000/signup#token=')).length, 1);
      assert.equal(texts.filter(text => text.includes('https://waitron.local:3000/reset-password#token=')).length, 1);
      assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_grants')).rows[0].n, 0);
      assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM email_outbox WHERE status<>'sent'")).rows[0].n, 0);
    }
  } finally {await db.close();}
});
