import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import type { HttpBindings } from '@hono/node-server';
import {
  type AuthenticationResponseJSON,
  type PasskeyCeremonyAdapter,
  type RegistrationResponseJSON,
} from '@waitron-cloud/registration';
import { hashSecret } from '@waitron-cloud/identity';
import { createAccountApp } from '../src/app.ts';
import { database } from './fixtures.ts';

let db: Awaited<ReturnType<typeof database>>;
let app: ReturnType<typeof createAccountApp>;
const origin = 'https://cloud.example.test';
const password = 'A distinct account password';
const config = () => ({portalOrigin: origin, production: true, rateKey: db.rateKey, trustedProxyIps: [] as string[]});
const registrationResponse = (id = randomBytes(32).toString('base64url')): RegistrationResponseJSON => ({
  id, rawId: id, response: {clientDataJSON: 'Y2xpZW50', attestationObject: 'YXR0ZXN0YXRpb24'},
  clientExtensionResults: {}, type: 'public-key',
});
const authenticationResponse = (id: string, userHandle: string): AuthenticationResponseJSON => ({
  id, rawId: id, response: {clientDataJSON: 'Y2xpZW50', authenticatorData: 'YXV0aGVudGljYXRvcg', signature: 'c2lnbmF0dXJl', userHandle},
  clientExtensionResults: {}, type: 'public-key',
});
class FixtureAdapter implements PasskeyCeremonyAdapter {
  async registrationOptions(input: Parameters<PasskeyCeremonyAdapter['registrationOptions']>[0]) {
    return {
      rp: {name: input.rpName, id: input.rpID},
      user: {id: Buffer.from(input.userID!).toString('base64url'), name: input.userName, displayName: input.userDisplayName ?? ''},
      challenge: randomBytes(32).toString('base64url'), pubKeyCredParams: [{type: 'public-key' as const, alg: -7}],
      timeout: input.timeout, attestation: input.attestationType,
      excludeCredentials: input.excludeCredentials?.map(credential => ({type: 'public-key' as const, ...credential})),
      authenticatorSelection: input.authenticatorSelection,
    };
  }
  async verifyRegistration(input: Parameters<PasskeyCeremonyAdapter['verifyRegistration']>[0]) {
    return {verified: true as const, registrationInfo: {
      fmt: 'none' as const, aaguid: '00000000-0000-0000-0000-000000000000',
      credential: {id: input.response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0},
      credentialType: 'public-key' as const, attestationObject: new Uint8Array([1]), userVerified: true,
      credentialDeviceType: 'multiDevice' as const, credentialBackedUp: true, origin, rpID: 'cloud.example.test',
    }};
  }
  async authenticationOptions(input: Parameters<PasskeyCeremonyAdapter['authenticationOptions']>[0]) {
    return {challenge: randomBytes(32).toString('base64url'), rpId: input.rpID, timeout: input.timeout,
      userVerification: input.userVerification};
  }
  async verifyAuthentication(input: Parameters<PasskeyCeremonyAdapter['verifyAuthentication']>[0]) {
    return {verified: true, authenticationInfo: {credentialID: input.response.id,
      newCounter: input.credential.counter + 1, userVerified: true, credentialDeviceType: 'multiDevice' as const,
      credentialBackedUp: true, origin, rpID: 'cloud.example.test'}};
  }
}
before(async () => { db = await database(); });
after(async () => db?.close());
beforeEach(async () => {
  await db.pool.query('TRUNCATE account_rate_limits, organisations, cloud_accounts CASCADE');
  app = createAccountApp({pool: db.pool, outbox: db.outbox, config: config(), passkeyAdapter: new FixtureAdapter()});
});
function request(path: string, body?: unknown, options: {headers?: Record<string, string>; peer?: string; method?: string; raw?: string} = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has('origin')) headers.set('origin', origin);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  const method = options.method ?? (body === undefined ? 'GET' : 'POST');
  return app.request(`${origin}/api/account${path}`, {method, headers,
    ...((body === undefined && options.raw === undefined) ? {} : {body: options.raw ?? JSON.stringify(body)})},
  {incoming: {socket: {remoteAddress: options.peer ?? '192.0.2.4'}}} as HttpBindings);
}
function cookies(response: Response) {
  const values = response.headers.getSetCookie().map(line => line.split(';')[0]!);
  return {header: values.join('; '), csrf: values.find(value => value.startsWith('__Host-cloud_csrf='))!.split('=')[1]!};
}
async function account(email = `owner-${randomUUID()}@example.test`) {
  const accountId = randomUUID();
  await db.pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [accountId]);
  await db.pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash) VALUES ($1, $2, $3)',
    [accountId, email, await hashSecret(password)]);
  return {accountId, email};
}
async function signIn(email: string) {
  const response = await request('/login', {email, password});
  assert.equal(response.status, 200);
  return cookies(response);
}

test('HTTP passkey journey enrols, lists, authenticates once and removes with fresh authority', async () => {
  const owner = await account();
  const session = await signIn(owner.email);
  const headers = {cookie: session.header, 'x-csrf-token': session.csrf};
  const options = await request('/passkeys/registration/options', {password}, {headers});
  assert.equal(options.status, 200);
  const registration = await options.json() as {ceremonyId: string; options: {user: {id: string}; authenticatorSelection: unknown}};
  assert.deepEqual(registration.options.authenticatorSelection, {residentKey: 'required', userVerification: 'required'});
  const response = registrationResponse();
  const verified = await request('/passkeys/registration/verify', {ceremonyId: registration.ceremonyId, response}, {headers});
  assert.equal(verified.status, 201);
  const created = await verified.json() as {id: string; createdAt: string};
  assert.ok(Number.isFinite(Date.parse(created.createdAt)));
  const list = await request('/passkeys', undefined, {headers: {cookie: session.header}});
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json() as {passkeys: {id: string}[]}).passkeys.map(item => item.id), [created.id]);

  const authOptions = await request('/passkeys/authentication/options', {});
  assert.equal(authOptions.status, 200);
  const authentication = await authOptions.json() as {ceremonyId: string; options: {rpId: string}};
  assert.equal(authentication.options.rpId, 'cloud.example.test');
  const signedIn = await request('/passkeys/authentication/verify', {ceremonyId: authentication.ceremonyId,
    response: authenticationResponse(response.id, registration.options.user.id)});
  assert.equal(signedIn.status, 200);
  assert.deepEqual(await signedIn.json(), {accountId: owner.accountId});
  assert.equal(signedIn.headers.getSetCookie().length, 2);
  const replay = await request('/passkeys/authentication/verify', {ceremonyId: authentication.ceremonyId,
    response: authenticationResponse(response.id, registration.options.user.id)});
  assert.equal(replay.status, 401);
  assert.deepEqual(await replay.json(), {error: 'credentials_invalid'});

  assert.equal((await request('/passkeys/remove', {id: created.id, password: 'wrong'}, {headers})).status, 403);
  assert.equal((await request('/passkeys/remove', {id: created.id, password}, {headers})).status, 204);
  assert.deepEqual(await (await request('/passkeys', undefined, {headers: {cookie: session.header}})).json(), {passkeys: []});
  assert.equal((await request('/login', {email: owner.email, password})).status, 200);
});

test('passkey bodies are exact, bounded JSON and every mutation requires the configured Origin', async () => {
  for (const [path, body] of [
    ['/passkeys/authentication/options', {extra: 'private'}],
    ['/passkeys/authentication/verify', {ceremonyId: randomUUID(), response: {...authenticationResponse('a', 'b'), extra: 'private'}}],
    ['/passkeys/registration/options', {password, extra: 'private'}],
    ['/passkeys/registration/verify', {ceremonyId: randomUUID(), response: {...registrationResponse(), extra: 'private'}}],
    ['/passkeys/remove', {id: randomUUID(), password, extra: 'private'}],
  ] as const) assert.equal((await request(path, body)).status, 400);
  assert.equal((await request('/passkeys/authentication/options', {}, {headers: {'content-type': 'text/plain'}})).status, 415);
  assert.equal((await request('/passkeys/authentication/options', {}, {headers: {'content-encoding': 'gzip'}})).status, 415);
  assert.equal((await request('/passkeys/authentication/options', {}, {headers: {'content-length': '16385'}})).status, 413);
  assert.equal((await request('/passkeys/authentication/options', undefined, {method: 'POST', raw: `{"padding":"${'x'.repeat(17000)}"}`})).status, 413);
  for (const path of ['/passkeys/authentication/options', '/passkeys/authentication/verify', '/passkeys/registration/options',
    '/passkeys/registration/verify', '/passkeys/remove']) {
    const response = await app.request(`${origin}/api/account${path}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'},
      {incoming: {socket: {remoteAddress: '192.0.2.4'}}} as HttpBindings);
    assert.equal(response.status, 403);
  }
});

test('registration requires its live initiating session and CSRF proof', async () => {
  const owner = await account();
  const first = await signIn(owner.email);
  const second = await signIn(owner.email);
  const firstHeaders = {cookie: first.header, 'x-csrf-token': first.csrf};
  const registration = await (await request('/passkeys/registration/options', {password}, {headers: firstHeaders})).json() as {ceremonyId: string};
  const invalidHeaders: Record<string, string>[] = [
    {cookie: first.header},
    {cookie: first.header, 'x-csrf-token': second.csrf},
    {cookie: second.header, 'x-csrf-token': second.csrf},
  ];
  for (const headers of invalidHeaders) assert.equal((await request('/passkeys/registration/verify',
    {ceremonyId: registration.ceremonyId, response: registrationResponse()}, {headers})).status, headers.cookie === second.header ? 400 : 403);
  const completed = await request('/passkeys/registration/verify',
    {ceremonyId: registration.ceremonyId, response: registrationResponse()}, {headers: firstHeaders});
  assert.equal(completed.status, 201);
  await db.pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp() WHERE id = $1', [owner.accountId]);
  assert.equal((await request('/passkeys/registration/options', {password}, {headers: firstHeaders})).status, 401);
});

test('missing and cross-account removals are the same confirmed no-op', async () => {
  const owner = await account();
  const first = await signIn(owner.email);
  const headers = {cookie: first.header, 'x-csrf-token': first.csrf};
  const registration = await (await request('/passkeys/registration/options', {password}, {headers})).json() as {ceremonyId: string};
  const created = await (await request('/passkeys/registration/verify',
    {ceremonyId: registration.ceremonyId, response: registrationResponse()}, {headers})).json() as {id: string};
  const other = await account();
  const second = await signIn(other.email);
  const otherHeaders = {cookie: second.header, 'x-csrf-token': second.csrf};
  assert.equal((await request('/passkeys/remove', {id: created.id, password}, {headers: otherHeaders})).status, 204);
  assert.equal((await request('/passkeys/remove', {id: randomUUID(), password}, {headers: otherHeaders})).status, 204);
  assert.equal((await request('/passkeys', undefined, {headers: {cookie: second.header}})).status, 200);
  assert.equal((await db.pool.query('SELECT count(*) FROM cloud_passkeys')).rows[0].count, '1');
});

test('lost successful replies reconcile through session and list reads without replaying ceremonies', async () => {
  const owner = await account();
  const session = await signIn(owner.email);
  const headers = {cookie: session.header, 'x-csrf-token': session.csrf};
  const registration = await (await request('/passkeys/registration/options', {password}, {headers})).json() as {ceremonyId: string; options: {user: {id: string}}};
  const credential = registrationResponse();
  assert.equal((await request('/passkeys/registration/verify', {ceremonyId: registration.ceremonyId, response: credential}, {headers})).status, 201);
  assert.equal((await request('/passkeys/registration/verify', {ceremonyId: registration.ceremonyId, response: credential}, {headers})).status, 400);
  assert.equal((await (await request('/passkeys', undefined, {headers: {cookie: session.header}})).json() as {passkeys: unknown[]}).passkeys.length, 1);
  const authentication = await (await request('/passkeys/authentication/options', {})).json() as {ceremonyId: string};
  const signedIn = await request('/passkeys/authentication/verify', {ceremonyId: authentication.ceremonyId,
    response: authenticationResponse(credential.id, registration.options.user.id)});
  const authCookies = cookies(signedIn);
  assert.equal((await request('/session', undefined, {headers: {cookie: authCookies.header}})).status, 200);
});

test('passkey authentication options and failed completions have shared request limits', async () => {
  for (let index = 0; index < 10; index++) assert.equal((await request('/passkeys/authentication/options', {})).status, 200);
  const blocked = await request('/passkeys/authentication/options', {});
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  await db.pool.query('TRUNCATE account_rate_limits');
  const missing = randomUUID();
  for (let index = 0; index < 5; index++) assert.equal((await request('/passkeys/authentication/verify',
    {ceremonyId: missing, response: authenticationResponse('a', 'b')})).status, 401);
  assert.equal((await request('/passkeys/authentication/verify',
    {ceremonyId: missing, response: authenticationResponse('a', 'b')})).status, 429);
});

test('listing passkeys is passive and suspension invalidates it', async () => {
  const owner = await account();
  const session = await signIn(owner.email);
  await db.pool.query("UPDATE cloud_sessions SET last_seen_at = clock_timestamp() - interval '10 minutes'");
  const before = (await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows[0].last_seen_at.toISOString();
  assert.equal((await request('/passkeys', undefined, {headers: {cookie: session.header}})).status, 200);
  assert.equal((await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows[0].last_seen_at.toISOString(), before);
  await db.pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp() WHERE id = $1', [owner.accountId]);
  assert.equal((await request('/passkeys', undefined, {headers: {cookie: session.header}})).status, 401);
});
