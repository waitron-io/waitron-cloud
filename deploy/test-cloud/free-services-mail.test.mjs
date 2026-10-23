import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {database} from '../../packages/account-http/test/fixtures.ts';
import {EmailWorker, SignupStore, PasswordRecoveryStore, OrganisationPlanStore} from '../../packages/registration/src/index.ts';
import {createTestCaptureMailer} from './capture-mailer.mjs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrap} from '../local-stack/bootstrap.mjs';
import {testRuntimeEnvironment} from './runtime.mjs';
import {startAccountServer} from '../../packages/account-http/src/server.ts';
import {request} from 'node:http';

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

test('deployment drops provider inputs and exposes neither address lookup nor enabled translation', async () => {
  const db = await database(), directory = await mkdtemp(join(tmpdir(), 'cloud-free-gates-'));
  let running;
  try {
    const config = await bootstrap(directory);
    const environment = testRuntimeEnvironment('account', config, {CLOUD_TEST_SERVICE_PLANS: '1', CLOUD_TRANSLATION: '1', CLOUD_ADDRESS_LOOKUP: '1', GOOGLE_MAPS_API_KEY: 'fake-only', GEOAPIFY_API_KEY: 'fake-only'});
    assert.equal(environment.CLOUD_TRANSLATION, '0');
    for (const key of ['CLOUD_ADDRESS_LOOKUP', 'GOOGLE_MAPS_API_KEY', 'GEOAPIFY_API_KEY']) assert.equal(environment[key], undefined);
    running = await startAccountServer({pool: db.pool, outbox: db.outbox, port: 0, translation: environment.CLOUD_TRANSLATION === '1',
      config: {portalOrigin: 'http://localhost', production: false, rateKey: db.rateKey, trustedProxyIps: []}});
    const post = (path, browser = true) => new Promise((resolve, reject) => {
      const req = request({hostname: '127.0.0.1', port: running.server.address().port, path, method: 'POST', timeout: 5000,
        headers: {host: 'localhost', ...(browser ? {origin: 'http://localhost'} : {}), 'content-type': 'application/json'}}, response => {
        let body = ''; response.on('data', chunk => body += chunk); response.once('error', reject);
        response.once('end', () => resolve({status: response.statusCode, body}));
      });
      req.once('error', reject); req.once('timeout', () => req.destroy(new Error('fixture request timeout'))); req.end('{}');
    });
    for (const action of ['request', 'start', 'status', 'autocomplete', 'validate', 'confirm', 'cancel']) {
      const response = await post(`/v1/address-lookup/${action}`);
      assert.equal(response.status, 404);
    }
    for (const action of ['submit', 'status', 'collect', 'release']) {
      const response = await post(`/api/installations/translation-${action}`, false);
      assert.equal(response.status, 503); assert.deepEqual(JSON.parse(response.body), {error: 'temporarily_unavailable'});
    }
  } finally {await running?.close(); await rm(directory, {recursive: true, force: true}); await db.close();}
});
