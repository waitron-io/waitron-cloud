import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {hashSecret} from '@waitron-cloud/identity';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';

let db: Awaited<ReturnType<typeof database>>;
let app: ReturnType<typeof createAccountApp>;
const origin = 'https://cloud.example.test';
const password = 'A distinct account password';
const config = () => ({portalOrigin: origin, production: true, rateKey: db.rateKey, trustedProxyIps: [] as string[]});

before(async () => { db = await database(); });
after(async () => db?.close());
beforeEach(async () => {
  await resetSchema(db.pool);
  app = createAccountApp({pool: db.pool, outbox: db.outbox, config: config()});
});

function request(path: string, body?: unknown, options: {headers?: Record<string, string>; method?: string} = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has('origin')) headers.set('origin', origin);
  if (body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.request(`${origin}/api/account${path}`, {method: options.method ?? (body === undefined ? 'GET' : 'POST'), headers,
    ...(body === undefined ? {} : {body: JSON.stringify(body)})},
  {incoming: {socket: {remoteAddress: '192.0.2.10'}}} as HttpBindings);
}

function cookies(response: Response) {
  const values = response.headers.getSetCookie().map(line => line.split(';')[0]!);
  return {header: values.join('; '), csrf: values.find(value => value.startsWith('__Host-cloud_csrf='))!.split('=')[1]!};
}

async function account(email: string) {
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

test('session list is passive, account-scoped and identifies the current session', async () => {
  const owner = await account('owner@example.test');
  const current = await signIn(owner.email);
  await signIn(owner.email);
  const foreign = await account('foreign@example.test');
  await signIn(foreign.email);
  const before = (await db.pool.query('SELECT token_hash, last_seen_at FROM cloud_sessions ORDER BY token_hash')).rows;

  const response = await request('/sessions', undefined, {headers: {cookie: current.header}});

  assert.equal(response.status, 200);
  const body = await response.json() as {sessions: {id: string; createdAt: string; lastUsedAt: string; expiresAt: string; current: boolean}[]};
  assert.equal(body.sessions.length, 2);
  assert.equal(body.sessions.filter(session => session.current).length, 1);
  for (const session of body.sessions) {
    assert.match(session.id, /^[0-9a-f-]{36}$/);
    for (const value of [session.createdAt, session.lastUsedAt, session.expiresAt]) assert.ok(Number.isFinite(Date.parse(value)));
  }
  assert.deepEqual((await db.pool.query('SELECT token_hash, last_seen_at FROM cloud_sessions ORDER BY token_hash')).rows, before);
});

test('session revocation requires exact CSRF input and hides other accounts', async () => {
  const owner = await account('owner@example.test');
  const current = await signIn(owner.email);
  const target = await signIn(owner.email);
  const targetList = await (await request('/sessions', undefined, {headers: {cookie: target.header}})).json() as
    {sessions: {id: string; current: boolean}[]};
  const targetId = targetList.sessions.find(session => session.current)!.id;
  const foreign = await account('foreign@example.test');
  const foreignSession = await signIn(foreign.email);
  const foreignList = await (await request('/sessions', undefined, {headers: {cookie: foreignSession.header}})).json() as
    {sessions: {id: string; current: boolean}[]};
  const foreignId = foreignList.sessions.find(session => session.current)!.id;

  assert.equal((await request('/sessions/revoke', {id: targetId}, {headers: {cookie: current.header}})).status, 403);
  assert.equal((await request('/sessions/revoke', {id: targetId, extra: true},
    {headers: {cookie: current.header, 'x-csrf-token': current.csrf}})).status, 400);
  assert.equal((await request('/sessions/revoke', {id: 'not-a-uuid'},
    {headers: {cookie: current.header, 'x-csrf-token': current.csrf}})).status, 400);
  assert.equal((await request('/sessions/revoke', {id: foreignId},
    {headers: {cookie: current.header, 'x-csrf-token': current.csrf}})).status, 204);
  assert.equal((await request('/session', undefined, {headers: {cookie: foreignSession.header}})).status, 200);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await request('/sessions/revoke', {id: targetId},
    {headers: {cookie: current.header, 'x-csrf-token': current.csrf}})).status, 204);
  assert.equal((await request('/session', undefined, {headers: {cookie: target.header}})).status, 401);
});

test('revoking the current session clears its cookies and stale authority cannot revoke another session', async () => {
  const owner = await account('owner@example.test');
  const current = await signIn(owner.email);
  const target = await signIn(owner.email);
  const sessions = await (await request('/sessions', undefined, {headers: {cookie: current.header}})).json() as
    {sessions: {id: string; current: boolean}[]};
  const currentId = sessions.sessions.find(session => session.current)!.id;
  const targetId = sessions.sessions.find(session => !session.current)!.id;
  await db.pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp() WHERE id = $1', [owner.accountId]);
  assert.equal((await request('/sessions/revoke', {id: targetId},
    {headers: {cookie: current.header, 'x-csrf-token': current.csrf}})).status, 401);
  assert.equal((await request('/session', undefined, {headers: {cookie: target.header}})).status, 401);
  await db.pool.query('UPDATE cloud_accounts SET disabled_at = NULL WHERE id = $1', [owner.accountId]);
  assert.equal((await request('/session', undefined, {headers: {cookie: target.header}})).status, 200);

  const response = await request('/sessions/revoke', {id: currentId},
    {headers: {cookie: current.header, 'x-csrf-token': current.csrf}});
  assert.equal(response.status, 204);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.ok(response.headers.getSetCookie().every(value => /Max-Age=0/i.test(value)));
  assert.equal((await request('/session', undefined, {headers: {cookie: current.header}})).status, 401);
});

test('concurrent logout and revoke both return 204 and leave the target ended', async () => {
  const owner = await account('owner@example.test');
  const actor = await signIn(owner.email);
  const target = await signIn(owner.email);
  const targetList = await (await request('/sessions', undefined, {headers: {cookie: target.header}})).json() as
    {sessions: {id: string; current: boolean}[]};
  const targetId = targetList.sessions.find(session => session.current)!.id;
  const [revoked, loggedOut] = await Promise.all([
    request('/sessions/revoke', {id: targetId}, {headers: {cookie: actor.header, 'x-csrf-token': actor.csrf}}),
    request('/logout', {}, {headers: {cookie: target.header, 'x-csrf-token': target.csrf}}),
  ]);
  assert.equal(revoked.status, 204);
  assert.equal(loggedOut.status, 204);
  assert.equal((await request('/session', undefined, {headers: {cookie: target.header}})).status, 401);
});
