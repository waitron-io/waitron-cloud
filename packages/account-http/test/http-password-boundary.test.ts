import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Pool} from 'pg';
import {IdentityError} from '@waitron-cloud/identity';
import {EmailOutbox, PasswordLoginStore, PasswordRecoveryError, PasswordRecoveryStore,
  SignupError, SignupStore} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {AccountRateLimiter} from '../src/rate-limit.ts';

const origin = 'https://cloud.example.test';
const token = 'a'.repeat(43);
const routes = ['/signup/complete', '/login', '/password-reset/complete'] as const;
const passwords = [
  {name: 'ASCII at 1024 bytes', password: 'a'.repeat(1024), allowed: true},
  {name: 'ASCII at 1025 bytes', password: 'a'.repeat(1025), allowed: false},
  {name: 'multibyte at 1024 bytes', password: 'é'.repeat(512), allowed: true},
  {name: 'multibyte at 1025 bytes', password: 'é'.repeat(512) + 'a', allowed: false},
];

for (const path of routes) for (const {name, password, allowed} of passwords) {
  test(`HTTP password boundary ${path}: ${name}`, async t => {
    let databaseCalls = 0;
    const unexpectedDatabase = () => { databaseCalls++; throw Error('Unexpected database access'); };
    const pool = {query: unexpectedDatabase, connect: unexpectedDatabase} as unknown as Pool;
    // Replace the store boundary so its own length check cannot mask a missing HTTP guard.
    t.mock.method(AccountRateLimiter.prototype, 'consume', async () => ({allowed: true, retryAfterSeconds: 0}));
    const seen: string[] = [];
    t.mock.method(SignupStore.prototype, 'complete', async (_token: string, details: {password: string}) => {
      seen.push(details.password); throw new SignupError('verification_unavailable');
    });
    t.mock.method(PasswordLoginStore.prototype, 'start', async (input: {password: string}) => {
      seen.push(input.password); throw new IdentityError('credentials_invalid');
    });
    t.mock.method(PasswordRecoveryStore.prototype, 'complete', async (_token: string, value: string) => {
      seen.push(value); throw new PasswordRecoveryError('reset_unavailable');
    });
    const app = createAccountApp({pool,
      outbox: new EmailOutbox({activeKeyId: 'test', keys: {test: 'ab'.repeat(32)}}),
      config: {portalOrigin: origin, production: true, rateKey: 'cd'.repeat(32), trustedProxyIps: []},
      factor: {keys: null, policy: null}, pairingCodeKeys: null, recoveryCodeKeys: null});
    const body = path === '/login' ? {email: 'owner@example.test', password}
      : path === '/password-reset/complete' ? {token, password}
      : {token, password, organisationName: 'Café Sol', legalBusinessName: 'Café Sol SL', countryCode: 'ES'};
    const response = await app.request(origin + '/api/account' + path, {method: 'POST',
      headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify(body)},
    {incoming: {socket: {remoteAddress: '192.0.2.10'}}});
    assert.equal(response.status, allowed && path === '/login' ? 401 : 400);
    assert.deepEqual(await response.json(), {error: allowed
      ? path === '/login' ? 'credentials_invalid' : 'link_unavailable' : 'invalid_input'});
    assert.deepEqual(seen, allowed ? [password] : [], 'only admitted passwords reach the account store');
    assert.equal(databaseCalls, 0);
    assert.deepEqual(response.headers.getSetCookie(), []);
  });
}
