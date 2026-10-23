import assert from 'node:assert/strict';
import {generateKeyPairSync, randomBytes, randomUUID} from 'node:crypto';
import {createServer, request} from 'node:https';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createSession} from '../../packages/identity/src/index.ts';
import {createLeaseIssuer, OrganisationPlanStore, transaction} from '../../packages/registration/src/index.ts';
import {RelayGrantStore} from '../../packages/registration/src/relay-grants.ts';
import {RelayMessages} from '../../packages/registration/src/relay-messages.ts';
import {RelayWorker} from '../../packages/registration/src/relay-worker.ts';
import {connectedVenue, database} from '../../packages/translation/test/fixtures.ts';
import {bootstrapTestCloud} from './bootstrap.mjs';

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
    const grants = {mode: 'local-proof', consentVersion: 'local-v1', policy: {version: 'local-v1', units: 3, periodSeconds: 3600, epoch: '2026-01-01T00:00:00.000Z', excess: 'refuse', debit: 'retain'},
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
