import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {hashSecret} from '@waitron-cloud/identity';
import {createAccountApp} from '../src/app.ts';
import {database,completeEmailProof,emailLoginPolicy} from './fixtures.ts';
import {openProofWindow} from '../../registration/test/fixtures/action-proof.ts';

let db: Awaited<ReturnType<typeof database>>;
let app: ReturnType<typeof createAccountApp>;
const origin = 'https://cloud.example.test';
const password = 'A distinct account password';
const config = () => ({portalOrigin: origin, production: true, rateKey: db.rateKey, trustedProxyIps: [] as string[]});

before(async () => { db = await database(); });
after(async () => db?.close());
beforeEach(async () => {
  await resetSchema(db.pool);
  app = createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool: db.pool, outbox: db.outbox, config: config()});
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
  const response = await completeEmailProof(db,await request('/login', {email, password}),body=>request('/login/email',body));
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

test('password change requires session proof and exact CSRF body, then clears cookies',async()=>{
  const owner=await account('change-password@example.test'),actor=await signIn(owner.email);
  const body={password:'A synthetic replacement password',locale:'en'};
  const headers={cookie:actor.header,'x-csrf-token':actor.csrf};
  assert.equal((await request('/security/password',body,{headers:{cookie:actor.header}})).status,403);
  assert.equal((await request('/security/password',body,{headers})).status,403);
  await openProofWindow(db.pool,actor.header.match(/__Host-cloud_session=([^; ]+)/)![1]!);
  assert.equal((await request('/security/password',{...body,extra:true},{headers})).status,400);
  const response=await request('/security/password',body,{headers});assert.equal(response.status,204);
  assert.equal(response.headers.getSetCookie().length,2);assert.ok(response.headers.getSetCookie().every(v=>/Max-Age=0/.test(v)));
  assert.equal((await request('/session',undefined,{headers})).status,401);
});

test('email route queues verification, returns a generic accepted answer, verifies and clears cookies',async()=>{
  const owner=await account('change-email@example.test'),actor=await signIn(owner.email),headers={cookie:actor.header,'x-csrf-token':actor.csrf};
  await openProofWindow(db.pool,actor.header.match(/__Host-cloud_session=([^; ]+)/)![1]!);
  const response=await request('/security/email',{email:'verified-new@example.test',locale:'es'},{headers});
  assert.equal(response.status,202);assert.deepEqual(await response.json(),{status:'accepted'});
  const row=(await db.pool.query("SELECT * FROM email_outbox WHERE kind='email_change'")).rows[0];
  const message=db.outbox.open(row);assert.ok('token' in message);
  const verified=await request('/security/email/verify',{token:message.token},{headers});
  assert.equal(verified.status,204);assert.ok(verified.headers.getSetCookie().every(v=>/Max-Age=0/.test(v)));
  assert.equal((await db.pool.query('SELECT email FROM cloud_credentials WHERE account_id=$1',[owner.accountId])).rows[0].email,'verified-new@example.test');
});

test('password screening refusal has a distinct retryable answer before any credential write',async()=>{
  const owner=await account('screening@example.test'),actor=await signIn(owner.email),headers={cookie:actor.header,'x-csrf-token':actor.csrf};
  await openProofWindow(db.pool,actor.header.match(/__Host-cloud_session=([^; ]+)/)![1]!);
  app=createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool:db.pool,outbox:db.outbox,config:config(),passwordScreening:{async check(){throw new Error('synthetic unavailable screening');}}});
  const response=await request('/security/password',{password:'A synthetic replacement password'},{headers});
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'password_screening_unavailable'});
  assert.equal(response.headers.get('retry-after'),'1');assert.equal((await request('/session',undefined,{headers})).status,200);
});
