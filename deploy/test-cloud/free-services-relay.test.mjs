import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, randomBytes, randomUUID, sign} from 'node:crypto';
import {createServer, request} from 'node:https';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createAccountApp} from '../../packages/account-http/src/app.ts';
import {createSession} from '../../packages/identity/src/index.ts';
import {createLeaseIssuer, encodeMachine, OrganisationPlanStore, SetupPairingStore, SignupStore, transaction} from '../../packages/registration/src/index.ts';
import {RelayGrantStore} from '../../packages/registration/src/relay-grants.ts';
import {RelayMessages} from '../../packages/registration/src/relay-messages.ts';
import {RelayWorker} from '../../packages/registration/src/relay-worker.ts';
import {connectedVenue, database} from '../../packages/translation/test/fixtures.ts';
import {bootstrapTestCloud} from './bootstrap.mjs';
import {openTestRelayRuntime} from './relay-runtime.mjs';
import {executeTestServiceCommand} from './service-controls.mjs';
import {testRelaySettings} from './relay-settings.mjs';

// Paid status must create neither consent nor a grant; revocation must win before SMTP.
test('both plans need fixture-bound TLS origin evidence and explicit relay consent at handoff', async () => {
  const db = await database(), directory = await mkdtemp(join(tmpdir(), 'cloud-free-relay-'));
  let server;
  try {
    await bootstrapTestCloud(directory);
    const ca = await readFile(join(directory, 'lan/ca.pem'));
    let boundInstallation, trustedCA = ca;
    const challenges = [];
    server = createServer({key: await readFile(join(directory, 'lan/key.pem')), cert: await readFile(join(directory, 'lan/cert.pem'))}, (req, res) => {
      const url = new URL(req.url, 'https://waitron.local');
      if (url.pathname !== '/challenge' || !boundInstallation) {res.writeHead(404); res.end(); return;}
      challenges.push({installationId: boundInstallation, challenge: url.searchParams.get('challenge')});
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({installationId: boundInstallation, challenge: url.searchParams.get('challenge')}));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const managementOrigin = `https://waitron.local:${server.address().port}`;
    const grants = {mode: 'local-proof', ...testRelaySettings,
      async verifyOrigin(input) {
        assert.equal(input.installationId, boundInstallation); assert.equal(input.managementOrigin, managementOrigin);
        const evidence = await new Promise((resolve, reject) => {
          const req = request(`${managementOrigin}/challenge?challenge=${encodeURIComponent(input.challenge)}`, {ca: trustedCA, lookup: (_host, _options, callback) => callback(null, [{address: '127.0.0.1', family: 4}]), timeout: 5000}, response => {
            let body = ''; response.on('data', chunk => body += chunk);
            response.once('error', reject); response.once('end', () => {try {assert.equal(response.statusCode, 200); resolve(JSON.parse(body));} catch (error) {reject(error);}});
          });
          req.once('error', reject); req.once('timeout', () => req.destroy(new Error('fixture origin timeout'))); req.end();
        });
        assert.equal(evidence.installationId, input.installationId); assert.equal(evidence.challenge, input.challenge);
        return {...input, domainControl: true, httpsEndpoint: true, expiresAt: new Date(Date.now() + 3600000).toISOString()};
      }};
    const secret = () => ({activeKeyId: 'test', keys: {test: randomBytes(32).toString('hex')}});
    const payloadKeys = secret(), relay = {mode: 'local-proof', grants, payloadKeys, replayKeys: secret(), bounds: {version: 'local-v1', epoch: '2026-01-01T00:00:00.000Z', windowSeconds: 3600, recipientLimit: 100, grantLimit: 100, queuedPayloadBytes: 1000000, maxCounterRows: 1000, recipientKeys: secret()}};
    const origin = 'https://cloud.example.test', issuer = createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64url'));
    const messages = new RelayMessages(db.pool, issuer, origin, relay), store = new RelayGrantStore(db.pool, grants);
    const worker = new RelayWorker(db.pool, {mode: 'local-proof', grants, payloadKeys, suppressionKeys: secret(), smtpPort: Number(process.env.MAILPIT_TEST_SMTP_PORT)});
    for (const plan of ['free', 'paid']) {
      const venue = await connectedVenue(db, issuer, origin);
      boundInstallation = venue.installationId;
      await new OrganisationPlanStore(db.pool).set(venue.organisationId, plan);
      const session = await transaction(db.pool, client => createSession(client, venue.accountId));
      const approval = {installationId: venue.installationId, expectedRevision: 0, consent: true, consentVersion: 'local-v1', managementOrigin, expiresAt: new Date(Date.now() + 1800000).toISOString()};
      assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_grants WHERE organisation_id=$1', [venue.organisationId])).rows[0].n, 0);
      await assert.rejects(new RelayGrantStore(db.pool).approve(session.token, session.csrfToken, approval), error => error.code === 'relay_disabled');
      await assert.rejects(store.approve(session.token, session.csrfToken, {...approval, consent: false}), error => error.code === 'invalid_input');
      await assert.rejects(store.approve(session.token, session.csrfToken, {...approval, managementOrigin: 'https://foreign.example.test'}), error => error.code === 'origin_unverified');
      const priorChallenges = challenges.length;
      trustedCA = Buffer.alloc(0);
      await assert.rejects(store.approve(session.token, session.csrfToken, approval), error => error.code === 'origin_unverified');
      trustedCA = ca;
      assert.equal(challenges.length, priorChallenges);
      const grant = await store.approve(session.token, session.csrfToken, approval);
      assert.equal(challenges.length, priorChallenges + 1);
      assert.equal(challenges.at(-1).installationId, venue.installationId);
      assert.ok(challenges.at(-1).challenge);
      assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM installation_services WHERE installation_id=$1 AND service='remote_access' AND state='ready'", [venue.installationId])).rows[0].n, 0);
      const recipient = `${randomUUID()}@example.test`;
      const body = () => ({version: 1, messageId: randomUUID(), grantId: grant.id, grantRevision: grant.revision, class: 'password_reset', recipient, displayName: 'Test', locale: 'en', timeZone: 'Europe/Rome', expiresAt: new Date(Date.now() + 1800000).toISOString(), token: randomBytes(32).toString('base64url')});
      const send = async input => messages.execute('email-submit', venue.proof('email-submit', input, input.messageId, venue.lease));
      const first = body(); await send(first); assert.equal(await worker.runOnce(), true);
      assert.equal((await db.pool.query('SELECT state FROM relay_messages WHERE message_id=$1', [first.messageId])).rows[0].state, 'accepted');
      const second = body(); await send(second); await store.revoke(session.token, session.csrfToken, grant.id);
      assert.equal(await worker.runOnce(), true);
      assert.equal((await db.pool.query('SELECT state FROM relay_messages WHERE message_id=$1', [second.messageId])).rows[0].state, 'cancelled');
      const response = await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/messages?limit=1000`, {signal: AbortSignal.timeout(5000)});
      assert.equal(response.status, 200);
      assert.equal((await response.json()).messages.filter(message => message.To.some(to => to.Address === recipient)).length, 1);
    }
  } finally {
    if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
    await rm(directory, {recursive: true, force: true}); await db.close();
  }
});


test('a provisional setup box discovers its prepared grant and sends staff email before saving the venue', async () => {
  const db = await database(), directory = await mkdtemp(join(tmpdir(), 'cloud-setup-relay-'));
  try {
    const origin = 'https://cloud.example.test', mode = 'test-venue-levels';
    const issuer = createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64url'));
    const {admission, worker} = await openTestRelayRuntime({pool: db.pool, directory, issuer, origin, mode,
      smtpPort: Number(process.env.MAILPIT_TEST_SMTP_PORT)});
    const app = createAccountApp({pool: db.pool, outbox: db.outbox, relay: admission, leaseIssuer: issuer,
      planMode: mode, config: {portalOrigin: origin, production: false, rateKey: db.rateKey, trustedProxyIps: []}});
    const signup = new SignupStore(db.pool, db.outbox);
    await signup.request(`setup-owner-${randomUUID()}@example.test`);
    const verification = db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification'")).rows[0]);
    const owner = await signup.complete(verification.token, {password: 'A synthetic setup owner password',
      organisationName: 'Café Sol', legalBusinessName: 'Café Sol', countryCode: 'ES'});
    const key = generateKeyPairSync('ed25519'), publicKey = key.publicKey.export({type: 'spki', format: 'der'}).toString('base64url');
    const redirectUri = 'https://waitron.local:3000/cloud/pairing/callback', pairing = new SetupPairingStore(db.pool);
    const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url'), requestId = randomUUID();
    const base = {origin, requestId, publicKey, version: 5, issuedAt: Date.now()};
    const setup = {publicKey, redirectUri}, context = {requestId, state, codeChallenge};
    await pairing.start({...base, action: 'start', args: [redirectUri, state, codeChallenge]});
    const session = await transaction(db.pool, async client => {
      const session = await createSession(client, owner.accountId);
      await pairing.signIn(context, setup)(client, session);
      return session;
    });
    const {returnUrl} = await pairing.authorize(context, setup, session.token, session.csrfToken);
    const code = new URL(returnUrl).searchParams.get('code');
    const {provisionalRegistration: {installationId}} = await pairing.redeem({...base, action: 'redeem', args: [code, verifier]}, setup);
    function proof(action, body, lease, operationId = randomUUID()) {
      const payload = encodeMachine({origin, action, installationId, operationId, issuedAt: Date.now(),
        lease: lease ? JSON.stringify(lease) : '', body: JSON.stringify(body)});
      return {payload: payload.toString('base64url'), signature: sign(null, payload, key.privateKey).toString('base64url')};
    }
    async function post(path, envelope, status) {
      const response = await app.request(origin + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(envelope)},
        {incoming: {socket: {remoteAddress: '192.0.2.10'}}});
      const result = await response.json();
      assert.equal(response.status, status, result.error);
      return result;
    }
    const {lease} = await post('/api/installations/renew', proof('renew', {}), 200);
    const managementOrigin = 'https://waitron.local:3000';
    const configuration = () => proof('configuration', {servicesVersion: 2, managementOrigin}, lease);
    const statement = configuration();
    assert.deepEqual((await post('/api/installations/configuration', statement, 200)).emailRelay, {version: 1, grant: null});
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    const grant = await executeTestServiceCommand({pool: db.pool, issuer, origin,
      environment: {CLOUD_VENUE_SERVICE_LEVELS: 'test', CLOUD_TEST_SERVICE_PLANS: '0'}},
    {command: 'relay-approve', session, statement,
      approval: {installationId, expectedRevision: 0, consent: true, consentVersion: 'local-v1', managementOrigin, expiresAt}});
    const {emailRelay} = await post('/api/installations/configuration', configuration(), 200);
    assert.deepEqual(emailRelay, {version: 1, grant: {id: grant.id, revision: 1, enabled: true, expiresAt}});
    const recipient = `setup-staff-${randomUUID()}@example.test`, messageId = randomUUID();
    const message = {version: 1, messageId, grantId: emailRelay.grant.id, grantRevision: emailRelay.grant.revision,
      class: 'password_reset', recipient, displayName: 'Test', locale: 'en', timeZone: 'Europe/Rome',
      expiresAt: new Date(Date.now() + 300_000).toISOString(), token: randomBytes(32).toString('base64url')};
    await post('/v1/installations/email/submit', proof('email-submit', message, lease, messageId), 202);
    assert.equal(await worker.runOnce(), true);
    const response = await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/messages?limit=1000`, {signal: AbortSignal.timeout(5000)});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).messages.filter(mail => mail.To.some(to => to.Address === recipient)).length, 1);
  } finally { await rm(directory, {recursive: true, force: true}); await db.close(); }
});
