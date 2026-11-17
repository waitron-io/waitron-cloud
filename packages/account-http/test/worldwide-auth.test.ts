import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initializeConsole} from '../src/worldwide/auth.ts';
import {worldwideDatabase} from './worldwide-fixture.ts';
test('console bootstrap creates only admin tables and refuses a customer schema without changing it', async () => {
  const db = await worldwideDatabase();
  try {
    await initializeConsole(db.pool);
    assert.deepEqual((await db.pool.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename')).rows.map(r => r.tablename),
      ['account_rate_limits', 'cloud_accounts', 'cloud_sessions', 'console_ceremonies', 'console_passkeys']);
    await initializeConsole(db.pool);
    await db.pool.query('CREATE SCHEMA country; CREATE TABLE country.organisations(id text)');
    await assert.rejects(initializeConsole(db.pool), /customer database/);
    assert.equal((await db.pool.query('SELECT count(*) FROM country.organisations')).rows[0].count, '0');
    await db.pool.query('DROP SCHEMA country CASCADE');
    await db.pool.query('CREATE TABLE organisations (id text)');
    await assert.rejects(initializeConsole(db.pool), /customer database/);
    assert.equal((await db.pool.query('SELECT count(*) FROM organisations')).rows[0].count, '0');
  } finally {await db.close();}
});

import {ConsoleAuth} from '../src/worldwide/auth.ts';
import {generateAuthenticationOptions, generateRegistrationOptions, type RegistrationResponseJSON, type AuthenticationResponseJSON} from '@simplewebauthn/server';
import type {PasskeyCeremonyAdapter} from '../../registration/src/passkeys.ts';
const origin = 'https://console.example.test';
const registration = {id: 'cGFzc2tleQ'} as RegistrationResponseJSON;
const authentication = {id: 'cGFzc2tleQ'} as AuthenticationResponseJSON;
let userVerified = true;
let counter = 1;
const adapter: PasskeyCeremonyAdapter = {
  registrationOptions: generateRegistrationOptions, authenticationOptions: generateAuthenticationOptions,
  async verifyRegistration(input) {
    assert.equal(input.expectedOrigin, origin); assert.equal(input.expectedRPID, 'console.example.test');
    assert.equal(input.requireUserVerification, true); assert.ok(input.expectedChallenge);
    return {verified: true, registrationInfo: {userVerified, credential: {id: registration.id, publicKey: new Uint8Array([1, 2]), counter: 0}}} as never;
  },
  async verifyAuthentication(input) {
    assert.equal(input.expectedOrigin, origin); assert.equal(input.expectedRPID, 'console.example.test');
    assert.equal(input.requireUserVerification, true); assert.ok(input.expectedChallenge);
    return {verified: true, authenticationInfo: {userVerified, newCounter: counter}} as never;
  },
};
async function setup(t: import('node:test').TestContext) {
  const db = await worldwideDatabase(); t.after(() => db.close()); await initializeConsole(db.pool);
  userVerified = true; counter = 1;
  return {...db, auth: new ConsoleAuth(db.pool, origin, adapter)};
}
test('single-use bootstrap enrols a discoverable verified passkey and creates an ordinary bounded session', async t => {
  const {auth, pool} = await setup(t);
  const secret = await auth.admin('create', 'First admin');
  assert.match(secret!, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify((await pool.query('SELECT * FROM cloud_accounts')).rows).includes(secret!));
  const enrol = await auth.registrationOptions(secret!);
  assert.equal(enrol.options.rp.id, 'console.example.test');
  assert.equal(enrol.options.authenticatorSelection?.residentKey, 'required');
  assert.equal(enrol.options.authenticatorSelection?.userVerification, 'required');
  const session = await auth.register(secret!, enrol.ceremonyId, registration);
  assert.equal((await auth.session(session.token)).accountId, session.accountId);
  await assert.rejects(auth.register(secret!, enrol.ceremonyId, registration), /credentials_invalid/);
  await assert.rejects(auth.registrationOptions(secret!), /credentials_invalid/);
  const login = await auth.authenticationOptions();
  const signedIn = await auth.authenticate(login.ceremonyId, authentication);
  assert.equal(signedIn.accountId, session.accountId);
  await assert.rejects(auth.authenticate(login.ceremonyId, authentication), /credentials_invalid/);
  await pool.query("UPDATE cloud_sessions SET last_seen_at=clock_timestamp()-interval '31 minutes'");
  await assert.rejects(auth.session(signedIn.token), /session_expired/);
});
test('bootstrap and ceremony deadlines refuse enrolment; failed verification consumes its challenge', async t => {
  const {auth, pool} = await setup(t); const secret = await auth.admin('create', 'Admin');
  await pool.query("UPDATE cloud_accounts SET bootstrap_expires_at=clock_timestamp()-interval '1 second'");
  await assert.rejects(auth.registrationOptions(secret!), /credentials_invalid/);
  const fresh = await auth.admin('reissue', 'Admin'); const enrol = await auth.registrationOptions(fresh!);
  userVerified = false;
  await assert.rejects(auth.register(fresh!, enrol.ceremonyId, registration), /credentials_invalid/);
  userVerified = true;
  await assert.rejects(auth.register(fresh!, enrol.ceremonyId, registration), /credentials_invalid/);
  const expired = await auth.registrationOptions(fresh!);
  await pool.query("UPDATE console_ceremonies SET expires_at=clock_timestamp()-interval '1 second'");
  await assert.rejects(auth.register(fresh!, expired.ceremonyId, registration), /credentials_invalid/);
  assert.equal((await pool.query('SELECT count(*) FROM console_passkeys')).rows[0].count, '0');
});
test('reissue removes old keys and sessions; disabling refuses new sign-in and existing sessions', async t => {
  const {auth, pool} = await setup(t); const secret = await auth.admin('create', 'Admin');
  const enrol = await auth.registrationOptions(secret!); const session = await auth.register(secret!, enrol.ceremonyId, registration);
  const pending = await auth.authenticationOptions();
  const fresh = await auth.admin('reissue', 'Admin'); assert.notEqual(fresh, secret);
  assert.equal((await pool.query('SELECT count(*) FROM console_passkeys')).rows[0].count, '0');
  await assert.rejects(auth.session(session.token), /session_unavailable/);
  await assert.rejects(auth.authenticate(pending.ceremonyId, authentication), /credentials_invalid/);
  const renewed = await auth.registrationOptions(fresh!); const signedIn = await auth.register(fresh!, renewed.ceremonyId, registration);
  await auth.admin('disable', 'Admin');
  await assert.rejects(auth.admin('reissue','Admin'), /credentials_invalid/);
  await assert.rejects(auth.session(signedIn.token), /session_unavailable/);
  const login = await auth.authenticationOptions();
  await assert.rejects(auth.authenticate(login.ceremonyId, authentication), /credentials_invalid/);
});
test('sign-in refuses unverified or non-increasing authenticator counters; logout requires CSRF', async t => {
  const {auth} = await setup(t); const secret = await auth.admin('create', 'Admin');
  const enrol = await auth.registrationOptions(secret!); const session = await auth.register(secret!, enrol.ceremonyId, registration);
  let login = await auth.authenticationOptions(); await auth.authenticate(login.ceremonyId, authentication);
  login = await auth.authenticationOptions();
  await assert.rejects(auth.authenticate(login.ceremonyId, authentication), /credentials_invalid/);
  counter = 2; userVerified = false; login = await auth.authenticationOptions();
  await assert.rejects(auth.authenticate(login.ceremonyId, authentication), /credentials_invalid/);
  await assert.rejects(auth.signOut(session.token, 'bad'), /csrf_invalid/);
  await auth.signOut(session.token, session.csrfToken);
  await assert.rejects(auth.session(session.token), /session_unavailable/);
});
