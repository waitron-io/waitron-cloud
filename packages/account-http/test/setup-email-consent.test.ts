import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, randomBytes, randomUUID, sign} from 'node:crypto';
import {after, before, test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createSession, endSession} from '@waitron-cloud/identity';
import {createLeaseIssuer, createLeaseTrust, encodeMachine, InstallationStore, SetupPairingStore, SignupStore, transaction} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {database, signupVerification} from './fixtures.ts';

const origin = 'https://cloud.example.test';
const route = '/api/pairing/email-grant';
const issuer = createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64url'));
let db: Awaited<ReturnType<typeof database>>;
before(async () => {db = await database();});
after(async () => {await db?.close();});

async function boundBox(redirectUri = 'https://box.local:3000/cloud/pairing/callback') {
  const signup = new SignupStore(db.pool, db.outbox), email = randomUUID() + '@example.test';
  await signup.request(email);
  const {accountId} = await signup.complete((await signupVerification(db, email)).token, {
    password: 'A synthetic owner password', organisationName: 'Café Sol', legalBusinessName: 'Café Sol', countryCode: 'ES',
  });
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({type: 'spki', format: 'der'}).toString('base64url');
  const verifier = randomBytes(32).toString('base64url'), requestId = randomUUID(), state = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  const setup = {publicKey, redirectUri}, context = {requestId, state, codeChallenge};
  const base = {origin, requestId, publicKey, version: 5 as const, issuedAt: Date.now()};
  const pairing = new SetupPairingStore(db.pool);
  await pairing.start({...base, action: 'start', args: [redirectUri, state, codeChallenge]});
  const session = await transaction(db.pool, async client => {
    const credentials = await createSession(client, accountId);
    await pairing.signIn(context, setup)(client, credentials);
    return credentials;
  });
  const {returnUrl} = await pairing.authorize(context, setup, session.token, session.csrfToken);
  const {provisionalRegistration} = await pairing.redeem({...base, action: 'redeem',
    args: [new URL(returnUrl).searchParams.get('code')!, verifier]}, setup);
  assert.ok(provisionalRegistration);
  const {installationId} = provisionalRegistration;
  const expiresAt = new Date(Date.now() + 600_000).toISOString();
  function proof(action: 'renew' | 'configuration', body: unknown, lease: string, privateKey = keys.privateKey) {
    const bytes = encodeMachine({origin, action, installationId, operationId: randomUUID(),
      issuedAt: Date.now(), lease, body: JSON.stringify(body)});
    return {payload: bytes.toString('base64url'), signature: sign(null, bytes, privateKey).toString('base64url')};
  }
  const installations = new InstallationStore(db.pool, issuer, origin, undefined, 'test-venue-levels');
  const renewed = await installations.execute('renew', proof('renew', {}, ''));
  assert.ok(renewed.lease);
  const key = {activeKeyId: 'test', keys: {test: randomBytes(32).toString('hex')}};
  const app = createAccountApp({pool: db.pool, outbox: db.outbox, planMode: 'test-venue-levels', leaseIssuer: issuer,
    config: {portalOrigin: origin, production: false, rateKey: db.rateKey, trustedProxyIps: [], setupPairing: setup},
    relay: {mode: 'local-proof', payloadKeys: key, replayKeys: key,
      bounds: {version: 'local-v1', epoch: '2026-01-01T00:00:00.000Z', windowSeconds: 3600, recipientLimit: 100,
        grantLimit: 100, queuedPayloadBytes: 1_000_000, maxCounterRows: 1000, recipientKeys: key},
      grants: {mode: 'local-proof', consentVersion: 'local-v1',
        policy: {version: 'local-v1', units: 50, periodSeconds: 3600, epoch: '2026-01-01T00:00:00.000Z', excess: 'refuse', debit: 'retain'},
        testOrigin: {environment: 'test', origin, trusted: createLeaseTrust(issuer)},
        verifyOrigin: async () => {throw Error('origin_unverified');}, setupExpiresAt: expiresAt},
    }});
  const consent = {purpose: 'waitron-cloud-setup-email-consent-v1', requestId, consent: true, consentVersion: 'local-v1'};
  function post(path = route, body: unknown = consent, headers: Record<string, string> = {}, privateKey = keys.privateKey) {
    const envelope = proof('configuration', body, JSON.stringify(renewed.lease), privateKey);
    return app.request(origin + path, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(envelope)},
      {incoming: {socket: {remoteAddress: '192.0.2.1'}}} as HttpBindings);
  }
  return {post, consent, expiresAt, requestId, installationId, session, accountId};
}

async function reply(response: Response, status: number, expected: unknown) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  assert.deepEqual(body, expected);
}

test('only the grant route accepts the exact signed version-1 staff choice', async () => {
  const box = await boundBox();
  await reply(await box.post('/api/installations/configuration'), 401, {error: 'invalid_proof'});
  await reply(await box.post(route, {servicesVersion: 2}), 400, {error: 'invalid_input'});
  await reply(await box.post(route, {...box.consent, consentVersion: 'guest-v2'}), 400, {error: 'invalid_input'});
  await reply(await box.post(route, {...box.consent, consent: false}), 400, {error: 'invalid_input'});
  await reply(await box.post(route, box.consent, {origin}), 403, {error: 'forbidden'});
  await reply(await box.post(route, box.consent, {}, generateKeyPairSync('ed25519').privateKey), 401, {error: 'invalid_proof'});
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_grants WHERE installation_id=$1', [box.installationId])).rows[0].n, 0);
  const response = await box.post(), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const row = (await db.pool.query('SELECT id,account_id,consent_version,management_origin FROM relay_grants WHERE installation_id=$1',
    [box.installationId])).rows[0];
  assert.deepEqual(row, {id: body.emailRelay.grant.id, account_id: box.accountId, consent_version: 'local-v1', management_origin: 'https://box.local:3000'});
  assert.deepEqual(body, {emailRelay: {version: 1, grant: {id: row.id, revision: 1, enabled: true, expiresAt: box.expiresAt}}});
  await db.pool.query("UPDATE relay_grants SET management_origin='https://other.local' WHERE id=$1", [row.id]);
  await reply(await box.post(), 409, {error: 'grant_conflict'});
});

for (const reason of ['expiry', 'sign-out']) {
  test(`setup grant is refused after ${reason}`, async () => {
    const box = await boundBox();
    if (reason === 'expiry') await db.pool.query("UPDATE setup_pairing_attempts SET expires_at=clock_timestamp() WHERE id=$1", [box.requestId]);
    else await transaction(db.pool, client => endSession(client, box.session.token));
    await reply(await box.post(), 400, {error: 'pairing_unavailable'});
  });
}

test('a public HTTPS callback cannot set the relay management origin', async () => {
  const box = await boundBox('https://public.example.test/cloud/pairing/callback');
  await reply(await box.post(), 403, {error: 'grant_unavailable'});
});
