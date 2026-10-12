import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { Pool } from 'pg';
import type {
  AuthenticationResponseJSON,
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifyAuthenticationResponseOpts,
  VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { endSession, hashSecret, login } from '@waitron-cloud/identity';
import { migrate } from '../src/migrate.ts';
import { PasskeyError, PasskeyStore, type PasskeyCeremonyAdapter } from '../src/passkeys.ts';
import { transaction } from '../src/transaction.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Run through scripts/test-postgres.mjs');
const schema = `passkeys_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const connection = { connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, application_name: schema };
const pool = new Pool(connection);
const accountId = randomUUID();
const password = 'a current account password';
const origin = 'https://cloud.example.test';
const run = <T>(fn: (client: import('pg').PoolClient) => Promise<T>) => transaction(pool, fn);
const signIn = () => run(client => login(client, { email: 'owner@example.test', password }));
const registrationResponse = (id = randomBytes(32).toString('base64url')): RegistrationResponseJSON => ({
  id, rawId: id, response: { clientDataJSON: 'Y2xpZW50', attestationObject: 'YXR0ZXN0YXRpb24' },
  clientExtensionResults: {}, type: 'public-key',
});
const authenticationResponse = (id: string, userHandle?: string): AuthenticationResponseJSON => ({
  id, rawId: id, response: { clientDataJSON: 'Y2xpZW50', authenticatorData: 'YXV0aGVudGljYXRvcg', signature: 'c2lnbmF0dXJl', ...(userHandle ? { userHandle } : {}) },
  clientExtensionResults: {}, type: 'public-key',
});

class FixtureAdapter implements PasskeyCeremonyAdapter {
  authenticationFailure = false;
  registrationFailure = false;
  fixedCounter: number | undefined;
  userVerified = true;
  async registrationOptions(input: GenerateRegistrationOptionsOpts): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return {
      rp: { name: input.rpName, id: input.rpID },
      user: { id: Buffer.from(input.userID!).toString('base64url'), name: input.userName, displayName: input.userDisplayName ?? '' },
      challenge: randomBytes(32).toString('base64url'),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: input.timeout,
      attestation: input.attestationType,
      excludeCredentials: input.excludeCredentials?.map(credential => ({type: 'public-key', ...credential})),
      authenticatorSelection: input.authenticatorSelection,
    };
  }
  async verifyRegistration(input: VerifyRegistrationResponseOpts): Promise<VerifiedRegistrationResponse> {
    if (this.registrationFailure) throw new Error('private verifier detail');
    assert.equal(input.expectedOrigin, origin);
    assert.equal(input.expectedRPID, 'cloud.example.test');
    assert.equal(input.requireUserVerification, true);
    return { verified: true, registrationInfo: {
      fmt: 'none', aaguid: '00000000-0000-0000-0000-000000000000',
      credential: { id: input.response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: input.response.response.transports },
      credentialType: 'public-key', attestationObject: new Uint8Array([1]), userVerified: this.userVerified,
      credentialDeviceType: 'multiDevice', credentialBackedUp: true, origin, rpID: 'cloud.example.test',
    }};
  }
  async authenticationOptions(input: GenerateAuthenticationOptionsOpts): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return { challenge: randomBytes(32).toString('base64url'), rpId: input.rpID, timeout: input.timeout,
      userVerification: input.userVerification };
  }
  async verifyAuthentication(input: VerifyAuthenticationResponseOpts): Promise<VerifiedAuthenticationResponse> {
    if (this.authenticationFailure) throw new Error('private verifier detail');
    assert.equal(input.expectedOrigin, origin);
    assert.equal(input.expectedRPID, 'cloud.example.test');
    assert.equal(input.requireUserVerification, true);
    return { verified: true, authenticationInfo: {
      credentialID: input.response.id,
      newCounter: this.fixedCounter ?? input.credential.counter + 1,
      userVerified: this.userVerified, credentialDeviceType: 'multiDevice', credentialBackedUp: true,
      origin, rpID: 'cloud.example.test',
    }};
  }
}

let adapter: FixtureAdapter;
let store: PasskeyStore;
async function expectPasskeyInvalid(action: Promise<unknown>) {
  await assert.rejects(action, (error: unknown) => error instanceof PasskeyError && error.code === 'passkey_invalid');
}
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
beforeEach(async () => {
  await pool.query('TRUNCATE cloud_accounts CASCADE');
  await pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [accountId]);
  await pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash) VALUES ($1, $2, $3)',
    [accountId, 'owner@example.test', await hashSecret(password)]);
  adapter = new FixtureAdapter();
  store = new PasskeyStore(pool, { rpName: 'Waitron Cloud', rpId: 'cloud.example.test', origin }, adapter);
});

test('registration options use one opaque stable handle and persist a five-minute session-bound ceremony', async () => {
  const session = await signIn();
  const first = await store.registrationOptions(session.token, session.csrfToken, password);
  const second = await store.registrationOptions(session.token, session.csrfToken, password);
  assert.equal(first.options.user.id, second.options.user.id);
  assert.notEqual(first.options.user.id, Buffer.from(accountId).toString('base64url'));
  assert.equal(Buffer.from(first.options.user.id, 'base64url').byteLength, 32);
  assert.deepEqual(first.options.authenticatorSelection, { residentKey: 'required', userVerification: 'required' });
  assert.equal(first.options.attestation, 'none');
  assert.equal(first.options.timeout, 300_000);
  const rows = (await pool.query(`SELECT kind, account_id, session_token_hash, expires_at - created_at AS lifetime
    FROM cloud_webauthn_ceremonies ORDER BY created_at`)).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.kind === 'registration' && row.account_id === accountId && row.session_token_hash));
  assert.ok(rows.every(row => row.lifetime.minutes === 5));
});

test('registration consumes its ceremony once and refuses duplicate credential IDs', async () => {
  const session = await signIn();
  let options = await store.registrationOptions(session.token, session.csrfToken, password);
  const response = registrationResponse();
  const created = await store.verifyRegistration(session.token, session.csrfToken, options.ceremonyId, response);
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  await expectPasskeyInvalid(store.verifyRegistration(session.token, session.csrfToken, options.ceremonyId, response));
  options = await store.registrationOptions(session.token, session.csrfToken, password);
  await expectPasskeyInvalid(store.verifyRegistration(session.token, session.csrfToken, options.ceremonyId, response));
  assert.equal((await pool.query('SELECT count(*) FROM cloud_passkeys')).rows[0].count, '1');
  assert.equal((await pool.query('SELECT count(*) FROM cloud_webauthn_ceremonies WHERE consumed_at IS NOT NULL')).rows[0].count, '2');
});

test('registration is bound to the initiating live session and rechecks suspension', async () => {
  const first = await signIn();
  const second = await signIn();
  let options = await store.registrationOptions(first.token, first.csrfToken, password);
  await expectPasskeyInvalid(store.verifyRegistration(second.token, second.csrfToken, options.ceremonyId, registrationResponse()));
  assert.equal((await pool.query('SELECT consumed_at FROM cloud_webauthn_ceremonies WHERE id = $1', [options.ceremonyId])).rows[0].consumed_at, null);
  await run(client => endSession(client, first.token));
  assert.equal((await pool.query('SELECT count(*) FROM cloud_webauthn_ceremonies WHERE id = $1', [options.ceremonyId])).rows[0].count, '1');
  await assert.rejects(store.verifyRegistration(first.token, first.csrfToken, options.ceremonyId, registrationResponse()));
  options = await store.registrationOptions(second.token, second.csrfToken, password);
  await pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp()');
  await assert.rejects(store.verifyRegistration(second.token, second.csrfToken, options.ceremonyId, registrationResponse()));
  assert.equal((await pool.query('SELECT count(*) FROM cloud_passkeys')).rows[0].count, '0');
});

test('authentication options reveal no account and a verified discoverable credential creates a session once', async () => {
  const enrolled = await signIn();
  const registration = await store.registrationOptions(enrolled.token, enrolled.csrfToken, password);
  const response = registrationResponse();
  await store.verifyRegistration(enrolled.token, enrolled.csrfToken, registration.ceremonyId, response);
  const handle = (await pool.query('SELECT user_handle FROM cloud_passkey_users')).rows[0].user_handle.toString('base64url');
  const options = await store.authenticationOptions();
  assert.equal(options.options.rpId, 'cloud.example.test');
  assert.equal(options.options.userVerification, 'required');
  assert.equal('allowCredentials' in options.options, false);
  const authenticated = await store.authenticate(options.ceremonyId, authenticationResponse(response.id, handle));
  assert.equal(authenticated.accountId, accountId);
  assert.equal((await pool.query('SELECT counter FROM cloud_passkeys')).rows[0].counter, '1');
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count, '2');
  await expectPasskeyInvalid(store.authenticate(options.ceremonyId, authenticationResponse(response.id, handle)));
});

test('authentication rejects absent or cross-account user handles and consumes failed verification', async () => {
  const session = await signIn();
  const registration = await store.registrationOptions(session.token, session.csrfToken, password);
  const response = registrationResponse();
  await store.verifyRegistration(session.token, session.csrfToken, registration.ceremonyId, response);
  for (const userHandle of [undefined, randomBytes(32).toString('base64url')]) {
    const options = await store.authenticationOptions();
    await expectPasskeyInvalid(store.authenticate(options.ceremonyId, authenticationResponse(response.id, userHandle)));
    assert.notEqual((await pool.query('SELECT consumed_at FROM cloud_webauthn_ceremonies WHERE id = $1', [options.ceremonyId])).rows[0].consumed_at, null);
  }
  adapter.authenticationFailure = true;
  const options = await store.authenticationOptions();
  await expectPasskeyInvalid(store.authenticate(options.ceremonyId, authenticationResponse(response.id,
    (await pool.query('SELECT user_handle FROM cloud_passkey_users')).rows[0].user_handle.toString('base64url'))));
  await expectPasskeyInvalid(store.authenticate((await store.authenticationOptions()).ceremonyId,
    authenticationResponse(randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url'))));
});

test('registration and authentication reject results without device user verification', async () => {
  const session = await signIn();
  let registration = await store.registrationOptions(session.token, session.csrfToken, password);
  adapter.userVerified = false;
  await expectPasskeyInvalid(store.verifyRegistration(session.token, session.csrfToken,
    registration.ceremonyId, registrationResponse()));
  assert.equal((await pool.query('SELECT count(*) FROM cloud_passkeys')).rows[0].count, '0');

  adapter.userVerified = true;
  registration = await store.registrationOptions(session.token, session.csrfToken, password);
  const response = registrationResponse();
  await store.verifyRegistration(session.token, session.csrfToken, registration.ceremonyId, response);
  const handle = (await pool.query('SELECT user_handle FROM cloud_passkey_users')).rows[0].user_handle.toString('base64url');
  adapter.userVerified = false;
  const authentication = await store.authenticationOptions();
  await expectPasskeyInvalid(store.authenticate(authentication.ceremonyId, authenticationResponse(response.id, handle)));
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count, '1');
});

test('credential locking serialises concurrent counters and refuses a stale counter', async () => {
  const session = await signIn();
  const registration = await store.registrationOptions(session.token, session.csrfToken, password);
  const response = registrationResponse();
  await store.verifyRegistration(session.token, session.csrfToken, registration.ceremonyId, response);
  const handle = (await pool.query('SELECT user_handle FROM cloud_passkey_users')).rows[0].user_handle.toString('base64url');
  const [first, second] = await Promise.all([store.authenticationOptions(), store.authenticationOptions()]);
  await Promise.all([
    store.authenticate(first.ceremonyId, authenticationResponse(response.id, handle)),
    store.authenticate(second.ceremonyId, authenticationResponse(response.id, handle)),
  ]);
  assert.equal((await pool.query('SELECT counter FROM cloud_passkeys')).rows[0].counter, '2');
  adapter.fixedCounter = 1;
  const stale = await store.authenticationOptions();
  await expectPasskeyInvalid(store.authenticate(stale.ceremonyId, authenticationResponse(response.id, handle)));
  assert.equal((await pool.query('SELECT counter FROM cloud_passkeys')).rows[0].counter, '2');
});

test('list and password-confirmed removal stay account-scoped', async () => {
  const owner = await signIn();
  const registration = await store.registrationOptions(owner.token, owner.csrfToken, password);
  const response = registrationResponse();
  const created = await store.verifyRegistration(owner.token, owner.csrfToken, registration.ceremonyId, response);
  assert.deepEqual((await store.list(owner.token)).map(item => item.id), [created.id]);
  await assert.rejects(store.remove(owner.token, owner.csrfToken, created.id, 'wrong'));

  const otherAccount = randomUUID();
  await pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [otherAccount]);
  await pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash) VALUES ($1, $2, $3)',
    [otherAccount, 'other@example.test', await hashSecret(password)]);
  const other = await run(client => login(client, { email: 'other@example.test', password }));
  assert.deepEqual(await store.list(other.token), []);
  assert.equal(await store.remove(other.token, other.csrfToken, created.id, password), false);
  assert.equal(await store.remove(owner.token, owner.csrfToken, created.id, password), true);
  assert.deepEqual(await store.list(owner.token), []);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_passkey_users')).rows[0].count, '1');
});

test('expired and wrong-kind ceremonies cannot be completed or revived', async () => {
  const session = await signIn();
  let registration = await store.registrationOptions(session.token, session.csrfToken, password);
  await pool.query("UPDATE cloud_webauthn_ceremonies SET expires_at = statement_timestamp() - interval '1 second', created_at = statement_timestamp() - interval '5 minutes 1 second' WHERE id = $1", [registration.ceremonyId]);
  await expectPasskeyInvalid(store.verifyRegistration(session.token, session.csrfToken, registration.ceremonyId, registrationResponse()));

  registration = await store.registrationOptions(session.token, session.csrfToken, password);
  const response = registrationResponse();
  await store.verifyRegistration(session.token, session.csrfToken, registration.ceremonyId, response);
  const handle = (await pool.query('SELECT user_handle FROM cloud_passkey_users')).rows[0].user_handle.toString('base64url');
  const expiredAuthentication = await store.authenticationOptions();
  await pool.query("UPDATE cloud_webauthn_ceremonies SET expires_at = statement_timestamp() - interval '1 second', created_at = statement_timestamp() - interval '5 minutes 1 second' WHERE id = $1", [expiredAuthentication.ceremonyId]);
  await expectPasskeyInvalid(store.authenticate(expiredAuthentication.ceremonyId, authenticationResponse(response.id, handle)));

  const wrongAuthentication = await store.authenticationOptions();
  await expectPasskeyInvalid(store.verifyRegistration(session.token, session.csrfToken,
    wrongAuthentication.ceremonyId, registrationResponse()));
  assert.equal((await pool.query('SELECT consumed_at FROM cloud_webauthn_ceremonies WHERE id = $1', [wrongAuthentication.ceremonyId])).rows[0].consumed_at, null);
  const wrongRegistration = await store.registrationOptions(session.token, session.csrfToken, password);
  await expectPasskeyInvalid(store.authenticate(wrongRegistration.ceremonyId, authenticationResponse(response.id, handle)));
  assert.equal((await pool.query('SELECT consumed_at FROM cloud_webauthn_ceremonies WHERE id = $1', [wrongRegistration.ceremonyId])).rows[0].consumed_at, null);
});

function attestedRegistration(challenge: string, algorithm: -7 | -48): RegistrationResponseJSON {
  const credentialId = randomBytes(32);
  let key: Map<number, number | Uint8Array>;
  if (algorithm === -7) {
    const {publicKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
    const jwk = publicKey.export({format: 'jwk'});
    key = new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]);
  } else {
    const {publicKey} = generateKeyPairSync('ml-dsa-44');
    const rawKey = publicKey.export({format: 'der', type: 'spki'}).subarray(-1312);
    key = new Map<number, number | Uint8Array>([[1, 7], [3, -48], [-1, rawKey]]);
  }
  const length = Buffer.alloc(2);
  length.writeUInt16BE(credentialId.length);
  const authData = Buffer.concat([createHash('sha256').update('cloud.example.test').digest(),
    Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), length, credentialId, isoCBOR.encode(key)]);
  const attestation = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, string>>([
    ['fmt', 'none'], ['authData', authData], ['attStmt', new Map()],
  ]));
  const id = credentialId.toString('base64url');
  return {id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: {
    clientDataJSON: Buffer.from(JSON.stringify({type: 'webauthn.create', challenge, origin})).toString('base64url'),
    attestationObject: Buffer.from(attestation).toString('base64url'),
  }};
}

test('real registration offers the reviewed algorithms regardless of runtime capabilities', async () => {
  const realStore = new PasskeyStore(pool, {rpName: 'Waitron Cloud', rpId: 'cloud.example.test', origin});
  const session = await signIn();
  const ceremony = await realStore.registrationOptions(session.token, session.csrfToken, password);
  assert.deepEqual(ceremony.options.pubKeyCredParams.map(key => key.alg), [-8, -7, -257]);
  assert.equal(ceremony.options.user.name, 'owner@example.test');
  assert.equal(ceremony.options.user.displayName, 'owner@example.test');
});

test('real registration refuses an unoffered algorithm but still enrols an offered key', async () => {
  const realStore = new PasskeyStore(pool, {rpName: 'Waitron Cloud', rpId: 'cloud.example.test', origin});
  const session = await signIn();
  const unexpected = await realStore.registrationOptions(session.token, session.csrfToken, password);
  await expectPasskeyInvalid(realStore.verifyRegistration(session.token, session.csrfToken, unexpected.ceremonyId,
    attestedRegistration(unexpected.options.challenge, -48)));
  assert.equal((await pool.query('SELECT count(*) FROM cloud_passkeys')).rows[0].count, '0');
  await expectPasskeyInvalid(realStore.verifyRegistration(session.token, session.csrfToken, unexpected.ceremonyId,
    attestedRegistration(unexpected.options.challenge, -7)));
  const offered = await realStore.registrationOptions(session.token, session.csrfToken, password);
  const registered = await realStore.verifyRegistration(session.token, session.csrfToken, offered.ceremonyId,
    attestedRegistration(offered.options.challenge, -7));
  assert.equal((await realStore.list(session.token))[0]?.id, registered.id);
});

test('real authentication still accepts an existing ML-DSA credential after registration is narrowed', async () => {
  const realStore = new PasskeyStore(pool, {rpName: 'Waitron Cloud', rpId: 'cloud.example.test', origin});
  const session = await signIn();
  await realStore.registrationOptions(session.token, session.csrfToken, password);
  const {publicKey, privateKey} = generateKeyPairSync('ml-dsa-44');
  const credentialId = randomBytes(32).toString('base64url');
  const key = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 7], [3, -48],
    [-1, publicKey.export({format: 'der', type: 'spki'}).subarray(-1312)]]));
  await pool.query(`INSERT INTO cloud_passkeys
    (id, account_id, credential_id, public_key, counter, transports, device_type, backed_up)
    VALUES ($1, $2, $3, $4, 0, $5, 'singleDevice', false)`,
    [randomUUID(), accountId, credentialId, Buffer.from(key), []]);
  const handle = (await pool.query('SELECT user_handle FROM cloud_passkey_users')).rows[0].user_handle.toString('base64url');
  const ceremony = await realStore.authenticationOptions();
  const clientData = Buffer.from(JSON.stringify({type: 'webauthn.get', challenge: ceremony.options.challenge, origin}));
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(1);
  const authData = Buffer.concat([createHash('sha256').update('cloud.example.test').digest(), Buffer.from([0x05]), counter]);
  const signed = Buffer.concat([authData, createHash('sha256').update(clientData).digest()]);
  const credentials = await realStore.authenticate(ceremony.ceremonyId, {
    id: credentialId, rawId: credentialId, type: 'public-key', clientExtensionResults: {}, response: {
      clientDataJSON: clientData.toString('base64url'), authenticatorData: authData.toString('base64url'),
      signature: sign(null, signed, privateKey).toString('base64url'), userHandle: handle,
    },
  });
  assert.equal(credentials.accountId, accountId);
  assert.equal((await pool.query('SELECT counter FROM cloud_passkeys WHERE credential_id = $1', [credentialId])).rows[0].counter, '1');
});
