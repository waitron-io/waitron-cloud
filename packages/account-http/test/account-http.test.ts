import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import type { HttpBindings } from '@hono/node-server';
import { EmailWorker, PasswordRecoveryStore, createLocalAccountMailer, SignupStore, type PasswordScreeningProvider } from '@waitron-cloud/registration';
import { createAccountApp } from '../src/app.ts';
import {database,completeEmailProof,emailLoginPolicy,signupVerification} from './fixtures.ts';
import {createMailCapture} from './mail-capture.ts';
import {solveBrowserCheck} from '../../../deploy/test-cloud/test-fixtures/browser-check.ts';
let db: Awaited<ReturnType<typeof database>>;
let app: ReturnType<typeof createAccountApp>;
const origin = 'https://cloud.example.test';
const password = 'A distinct café password';
const details = {password, organisationName: 'Café Sol', legalBusinessName: 'Café Sol SL', countryCode: 'ES'};
const config = () => ({portalOrigin: origin, production: true, rateKey: db.rateKey, trustedProxyIps: [] as string[]});
before(async () => {db = await database();});
after(async () => db?.close());
beforeEach(async () => {
  await resetSchema(db.pool);
  app = createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool: db.pool, outbox: db.outbox, config: config()});
});
function request(path: string, body?: unknown, options: {headers?: Record<string, string>; peer?: string; target?: typeof app; url?: string; method?: string} = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has('origin')) headers.set('origin', origin);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  const method = options.method ?? (body === undefined ? 'GET' : 'POST');
  const bindings = {incoming: {socket: {remoteAddress: options.peer ?? '192.0.2.4'}}} as HttpBindings;
  return (options.target ?? app).request(options.url ?? `${origin}/api/account${path}`,
    {method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)})}, bindings);
}
async function emailRequest(path: string, body: unknown, options: Parameters<typeof request>[2] = {}) {
  const challenge = await request('/browser-check', {form: path}, options);
  assert.equal(challenge.status, 200);
  return request(path, body, {...options, headers: {...options.headers, ...solveBrowserCheck(await challenge.json())}});
}
async function signIn(email:string, secret=password, options:Parameters<typeof request>[2]={}) {
  return completeEmailProof(db,await request('/login',{email,password:secret},options),body=>request('/login/email',body,
    {...options,...(options.url?{url:options.url.replace('/login','/login/email')}:{})}));
}
function cookies(response: Response) {
  const lines = response.headers.getSetCookie();
  const values = lines.map(line => line.split(';')[0]!);
  return {header: values.join('; '), csrf: values.find(value => value.startsWith('__Host-cloud_csrf='))?.split('=')[1]!,
    token: values.find(value => value.startsWith('__Host-cloud_session='))?.split('=')[1]!};
}
async function account() {
  const email = `owner-${randomUUID()}@example.test`;
  const signup = new SignupStore(db.pool, db.outbox);
  await signup.request(email);
  const queued = (await db.pool.query('SELECT * FROM email_outbox WHERE kind = $1', ['verification'])).rows[0];
  const content = db.outbox.open(queued); assert.ok('token' in content);
  const result = await signup.complete(content.token, details);
  await db.pool.query('DELETE FROM email_outbox');
  return {email, ...result};
}
function protectedHeaders(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.has('access-control-allow-origin'), false);
}
test('signup refuses business details without consuming the verification link', async () => {
  await new SignupStore(db.pool, db.outbox).request('signup-shape@example.test');
  const content = db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind = 'verification'")).rows[0]);
  assert.ok('token' in content);
  const body = {token: content.token, password};
  const response = await request('/signup/complete', {...body, organisationName: details.organisationName});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {error: 'invalid_input'});
  protectedHeaders(response);
  assert.equal(response.headers.has('set-cookie'), false);
  assert.equal((await request('/signup/complete', body)).status, 201);
});
async function signupTokens(addresses: string[]) {
  const signup = new SignupStore(db.pool, db.outbox);
  const tokens: string[] = [];
  for (const address of addresses) {
    await signup.request(address);
    tokens.push((await signupVerification(db, address)).token);
  }
  return tokens;
}

test('parallel completions share a connection cap and leave the sixth link usable on another connection', async () => {
  const tokens = await signupTokens(Array.from({length: 6}, (_, index) => `owner@venue-${index}.example.test`));
  const replies = await Promise.all(tokens.map((token, index) =>
    request('/signup/complete', {token, password}, {peer: `2001:db8:1:2::${index + 1}`})));
  assert.equal(replies.filter(reply => reply.status === 201).length, 5);
  const refusedIndex = replies.findIndex(reply => reply.status === 429);
  const refusal = replies[refusedIndex]!;
  assert.equal(refusal.headers.has('retry-after'), false);
  assert.deepEqual(await refusal.json(), {error: 'signup_rate_limited'});
  assert.equal((await db.pool.query('SELECT count(*) FROM cloud_accounts')).rows[0].count, '5');
  assert.equal((await request('/signup/complete', {token: tokens[refusedIndex], password}, {peer: '2001:db8:1:3::1'})).status, 201);
});

test('a sign-up waiting to attach a handover does not delay an unrelated sign-up', async () => {
  const sender = await account();
  const [invitee, other] = await signupTokens(['invitee@venue.example.test', 'other@example.test']);
  await db.pool.query(`INSERT INTO owner_transfers
    (id, organisation_id, sender_id, sender_email, recipient_email, recipient_needs_enrolment, locale)
    VALUES ($1,$2,$3,$4,'invitee@venue.example.test',true,'en')`, [randomUUID(), sender.organisationId, sender.accountId, sender.email]);
  const locker = await db.secondPool.connect();
  let pending: Promise<Response> | undefined;
  let unrelated: Promise<Response> | undefined;
  try {
    await locker.query('BEGIN');
    await locker.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE', [sender.organisationId]);
    pending = Promise.resolve(request('/signup/complete', {token: invitee, password}));
    let waiting = false;
    for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
      waiting = (await db.pool.query(`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'
        AND query LIKE '%FROM organisations WHERE id=$1 FOR UPDATE%'
      ) AS waiting`, [db.schema])).rows[0].waiting;
      if (!waiting) await delay(20);
    }
    assert.equal(waiting, true, 'the invitee is waiting while the organisation is locked');
    unrelated = Promise.resolve(request('/signup/complete', {token: other, password}, {peer: '198.51.100.9'}));
    const status = await Promise.race([unrelated.then(reply => reply.status), delay(3000, 'waiting on another sign-up', {ref: false})]);
    assert.equal(status, 201);
  } finally {
    await locker.query('ROLLBACK');
    locker.release();
    await Promise.allSettled([pending, unrelated]);
  }
  assert.equal((await pending!).status, 201);
});

test('the private domain cap is shared across connections and a refusal restores the connection allowance', async () => {
  const target = createAccountApp({pool: db.pool, outbox: db.outbox, config: {...config(),
    signupLimits: {accountsPerConnectionPerDay: 1}}});
  const tokens = await signupTokens(Array.from({length: 6}, (_, index) => `synthetic-${index}@company.example.test`));
  const complete = (token: string, index: number) => request('/signup/complete', {token, password}, {target, peer: `192.0.2.${index + 1}`});
  const replies = await Promise.all(tokens.map(complete));
  assert.equal(replies.filter(reply => reply.status === 201).length, 5);
  const refusedIndex = replies.findIndex(reply => reply.status === 429);
  const refusal = replies[refusedIndex]!;
  assert.equal(refusal.headers.has('retry-after'), false);
  assert.deepEqual(await refusal.json(), {error: 'signup_domain_limited'});
  const [fresh] = await signupTokens(['owner@another.example.test']);
  assert.equal((await complete(fresh!, refusedIndex)).status, 201);
});

test('public email domains in the account guide are exempt across connections', async t => {
  t.mock.method(console, 'warn', () => {});
  const domains = ['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.es', 'hotmail.com', 'hotmail.es',
    'live.com', 'live.es', 'msn.com', 'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com'];
  const target = createAccountApp({pool: db.pool, outbox: db.outbox, config: {...config(), signupLimits: {accountsPerDomainPerDay: 1}}});
  for (const [index, domain] of domains.entries()) {
    const tokens = await signupTokens([`synthetic-0@${domain}`, `synthetic-1@${domain}`]);
    for (const [address, token] of tokens.entries()) {
      assert.equal((await request('/signup/complete', {token, password}, {target, peer: `192.0.2.${2 * index + address + 1}`})).status, 201, domain);
    }
  }
});

test('a completion refused at the connection cap can use the same live link after midnight UTC', async t => {
  const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${db.schema},pg_catalog`});
  t.after(() => pool.end());
  // Use one day throughout so running at real midnight cannot change the fixture.
  const day = new Date().toISOString().slice(0, 10);
  const setTime = (offset: string) => pool.query(`CREATE OR REPLACE FUNCTION ${db.schema}.clock_timestamp()
    RETURNS timestamptz LANGUAGE sql AS $$ SELECT '${day}T00:00:00Z'::timestamptz + interval '${offset}' $$`);
  const [first, next] = await signupTokens(['first@venue-one.example.test', 'next@venue-two.example.test']);
  await db.pool.query("UPDATE signup_requests SET expires_at = clock_timestamp() + interval '3 days'");
  const target = createAccountApp({pool, outbox: db.outbox, config: {...config(), signupLimits: {accountsPerConnectionPerDay: 1}}});
  await setTime('23 hours 59 minutes');
  assert.equal((await request('/signup/complete', {token: first, password}, {target})).status, 201);
  assert.equal((await request('/signup/complete', {token: next, password}, {target})).status, 429);
  await setTime('24 hours 1 minute');
  assert.equal((await request('/signup/complete', {token: next, password}, {target})).status, 201);
});

test('the eleventh committed sign-up warns once even without an operator and further sign-ups still succeed', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const tokens = await signupTokens(Array.from({length: 12}, (_, index) => `owner@venue-${index}.example.test`));
  const complete = (token: string, index: number) => request('/signup/complete', {token, password}, {peer: `192.0.2.${index + 1}`});
  assert.deepEqual((await Promise.all(tokens.slice(0, 10).map(complete))).map(reply => reply.status), Array(10).fill(201));
  assert.equal(warn.mock.callCount(), 0);
  const outcomes = await Promise.all(tokens.slice(10).map((token, index) => complete(token, index + 10)));
  assert.deepEqual(outcomes.map(reply => reply.status), [201, 201]);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0]!.arguments.join(' '), /\d{4}-\d{2}-\d{2}.*10/);
  assert.equal((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind = 'operator_notice'")).rows[0].count, '0');
});

for (const queueFailure of [false, true]) {
  test(`a configured operator warning ${queueFailure ? 'cannot undo signup if the queue fails' : 'is queued once after signup'}`, async t => {
    const operator = await account();
    const target = createAccountApp({pool: db.pool, outbox: db.outbox, operatorAccountId: operator.accountId,
      config: {...config(), signupLimits: {operatorWarningThreshold: 1}}});
    const warn = t.mock.method(console, 'warn', () => {});
    const tokens = await signupTokens(['first@example.test', 'second@example.test', 'third@example.test']);
    if (queueFailure) await db.pool.query("ALTER TABLE email_outbox ADD CONSTRAINT reject_warning CHECK (kind <> 'operator_notice')");
    try {
      for (const token of tokens) assert.equal((await request('/signup/complete', {token, password}, {target})).status, 201);
    } finally {
      if (queueFailure) await db.pool.query('ALTER TABLE email_outbox DROP CONSTRAINT reject_warning');
    }
    assert.equal(warn.mock.callCount(), 1);
    const notices = (await db.pool.query("SELECT * FROM email_outbox WHERE kind = 'operator_notice'")).rows;
    assert.equal(notices.length, queueFailure ? 0 : 1);
    if (!queueFailure) assert.deepEqual(db.outbox.open(notices[0]), {
      email: operator.email, locale: 'en', event: 'signup_volume', accountId: operator.accountId,
      day: (await db.pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day")).rows[0].day,
      threshold: 1,
    });
  });
}

for (const state of ['disabled', 'unverified']) {
  test(`a sign-up warning skips a configured ${state} operator and still logs once`, async t => {
    const operator = await account();
    await db.pool.query(state === 'disabled'
      ? 'UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1'
      : 'UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1', [operator.accountId]);
    const target = createAccountApp({pool: db.pool, outbox: db.outbox, operatorAccountId: operator.accountId,
      config: {...config(), signupLimits: {operatorWarningThreshold: 1}}});
    const warn = t.mock.method(console, 'warn', () => {});
    for (const token of await signupTokens(['first@example.test', 'second@example.test'])) {
      assert.equal((await request('/signup/complete', {token, password}, {target})).status, 201);
    }
    assert.equal(warn.mock.callCount(), 1);
    assert.equal((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind='operator_notice'")).rows[0].count, '0');
  });
}

test('HTTP signup and recovery through Mailpit preserve accounts, cookies and session revocation', async () => {
  const email = `journey-${randomUUID()}@example.test`;
  const capture = createMailCapture({pool: db.pool, inbox: process.env.MAILPIT_TEST_URL!,
    mailer: createLocalAccountMailer({port: Number(process.env.MAILPIT_TEST_SMTP_PORT)})});
  const worker = new EmailWorker(db.pool, db.outbox, capture.mailer);
  const requested = await emailRequest('/signup/request', {email}); assert.equal(requested.status, 202);
  assert.deepEqual(await requested.json(), {status: 'accepted'}); protectedHeaders(requested);
  await capture.runOnce(worker); const token = await capture.tokenFromMail(email, 'Verify your Waitron Cloud email');
  assert.equal((await request(`/signup/complete?token=${token}`)).status, 400);
  const signup = await request('/signup/complete', {token, password});
  assert.equal(signup.status, 201); assert.equal(signup.headers.has('set-cookie'), false);
  const created = await signup.json() as {accountId: string};
  assert.ok(created.accountId); assert.deepEqual(Object.keys(created), ['accountId']);
  for (const table of ['organisations', 'legal_businesses', 'organisation_memberships']) {
    assert.equal((await db.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count, '0');
  }
  const replay = await request('/signup/complete', {token, password});
  assert.equal(replay.status, 400);
  assert.deepEqual(await replay.json(), {error: 'link_unavailable'});
  const signedIn = await signIn(email); assert.equal(signedIn.status, 200);
  assert.deepEqual(await signedIn.json(), {accountId: created.accountId});
  const session = cookies(signedIn); assert.ok(session.token); assert.ok(session.csrf);
  for (const line of signedIn.headers.getSetCookie()) {
    assert.ok(line.includes('Secure')); assert.ok(line.includes('SameSite=Lax')); assert.ok(line.includes('Path=/')); assert.ok(!line.includes('Domain='));
    assert.equal(line.includes('HttpOnly'), line.startsWith('__Host-cloud_session='));
  }
  const headers = {cookie: session.header};
  const read = await request('/session', undefined, {headers}); assert.equal(read.status, 200);
  const storedSession = (await db.pool.query('SELECT created_at, last_seen_at, absolute_expires_at FROM cloud_sessions')).rows[0];
  const oldSeen = storedSession.last_seen_at.getTime();
  assert.equal(Date.parse((await read.json() as {expiresAt: string}).expiresAt), oldSeen + 30 * 60_000);
  assert.ok(Math.abs(storedSession.absolute_expires_at.getTime() - storedSession.created_at.getTime() - 12 * 60 * 60_000) < 1000);
  await request('/session', undefined, {headers});
  assert.equal((await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows[0].last_seen_at.getTime(), oldSeen);
  const activity = await request('/session/activity', {}, {headers: {...headers, 'x-csrf-token': session.csrf}});
  assert.equal(activity.status, 200);
  assert.ok((await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows[0].last_seen_at.getTime() > oldSeen);
  const resetRequest = await emailRequest('/password-reset/request', {email}); assert.equal(resetRequest.status, 202);
  while(await capture.runOnce(worker)) {} const resetToken = await capture.tokenFromMail(email, 'Reset your Waitron Cloud password');
  const newPassword = 'A different long café password';
  const reset = await request('/password-reset/complete', {token: resetToken, password: newPassword});
  assert.equal(reset.status, 200); assert.equal(reset.headers.has('set-cookie'), false);
  assert.equal((await request('/password-reset/complete', {token: resetToken, password: newPassword})).status, 400);
  assert.equal((await request('/session', undefined, {headers})).status, 401);
  assert.equal((await request('/login', {email, password})).status, 401);
  assert.equal((await signIn(email,newPassword)).status, 200);
  assert.equal((await db.pool.query('SELECT count(*) FROM cloud_accounts')).rows[0].count, '1');
});
test('a forced reset-mail miss reports real queue and SMTP outcomes without private values', async () => {
  const {email} = await account();
  const capture = createMailCapture({pool: db.pool, inbox: process.env.MAILPIT_TEST_URL!,
    mailer: createLocalAccountMailer({port: Number(process.env.MAILPIT_TEST_SMTP_PORT)})});
  const worker = new EmailWorker(db.pool, db.outbox, capture.mailer);
  assert.equal((await emailRequest('/password-reset/request', {email})).status, 202);
  assert.equal(await capture.runOnce(worker), true);
  const missingRecipient = `missing-${randomUUID()}@example.test`;
  await assert.rejects(capture.tokenFromMail(missingRecipient, 'Reset your Waitron Cloud password'), error => {
    assert.ok(error instanceof assert.AssertionError);
    assert.ok(!error.message.includes(email) && !error.message.includes(missingRecipient));
    assert.ok(error.message.startsWith('Mail capture: '));
    const diagnostic = JSON.parse(error.message.slice('Mail capture: '.length));
    assert.equal(diagnostic.worker[0].result, 'handled');
    assert.deepEqual(diagnostic.smtp.map((event: {kind: string; result: string}) => [event.kind, event.result]), [['password_reset', 'accepted']]);
    assert.deepEqual(diagnostic.outbox, [{kind: 'password_reset', status: 'sent', attempts: 1, failures: 0,
      lastError: null, transport: 'none', hasMessageId: false}]);
    assert.equal(diagnostic.inbox.status, 200);
    assert.ok(diagnostic.inbox.subjectMatches >= 1);
    assert.equal(diagnostic.inbox.recipientMatches, 0);
    assert.equal(diagnostic.inbox.combinedMatches, 0);
    return true;
  });
});
test('every mutation rejects missing, null and foreign Origin before changing state', async () => {
  const paths = ['/browser-check', '/signup/request', '/signup/complete', '/login', '/session/activity', '/logout', '/password-reset/request', '/password-reset/complete'];
  for (const path of paths) for (const badOrigin of [undefined, 'null', 'https://elsewhere.example.test']) {
    const headers = new Headers({'content-type': 'application/json'});
    if (badOrigin) headers.set('origin', badOrigin);
    const response = await app.request(`${origin}/api/account${path}`, {method: 'POST', headers, body: '{}'},
      {incoming: {socket: {remoteAddress: '192.0.2.1'}}} as HttpBindings);
    assert.equal(response.status, 403); protectedHeaders(response);
  }
  assert.equal((await db.pool.query('SELECT count(*) FROM cloud_accounts')).rows[0].count, '0');
  assert.equal((await db.pool.query('SELECT count(*) FROM email_outbox')).rows[0].count, '0');
});
test('strict request shape, authority and body bounds fail without exposing submitted values', async () => {
  const bad = [null, [], 3, 'private-input-sentinel', {email: 7}, {email: 'a@example.test', password: 'extra-field-secret'}];
  for (const body of bad) assert.equal((await request('/signup/request', body)).status, 400);
  assert.equal((await request('/signup/request', {email: 'a@example.test'}, {headers: {'content-type': 'text/plain'}})).status, 415);
  assert.equal((await request('/signup/request', {email: 'a'.repeat(20000)})).status, 413);
  assert.equal((await request('/session', undefined, {url: 'https://attacker.example/api/account/session'})).status, 403);
  for (const raw of ['', '{bad-json-secret']) {
    const response = await app.request(`${origin}/api/account/signup/request`, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: raw},
      {incoming: {socket: {remoteAddress: '192.0.2.1'}}} as HttpBindings);
    assert.equal(response.status, 400); assert.ok(!(await response.text()).includes('bad-json-secret')); protectedHeaders(response);
  }
  assert.equal((await request('/login', {}, {method: 'PUT'})).status, 405);
  assert.equal((await request('/missing')).status, 404);
  assert.equal((await db.pool.query('SELECT count(*) FROM email_outbox')).rows[0].count, '0');
});
test('health routes separate process liveness from migration-backed readiness', async () => {
  const live = await request('', undefined, {url: `${origin}/api/health/live`});
  assert.equal(live.status, 200); assert.deepEqual(await live.json(), {status: 'live'}); protectedHeaders(live);
  const ready = await request('', undefined, {url: `${origin}/api/health/ready`});
  assert.equal(ready.status, 200); assert.deepEqual(await ready.json(), {status: 'ready'}); protectedHeaders(ready);
  assert.equal((await db.pool.query('SELECT sum(attempts)::integer AS attempts FROM account_rate_limits')).rows[0].attempts, 1);
  for (const path of ['/api/health/live', '/api/health/ready']) {
    assert.equal((await request('', {}, {url: `${origin}${path}`, method: 'POST'})).status, 405);
    assert.equal((await request('', undefined, {url: `${origin}${path}?private=1`})).status, 400);
  }
  const unavailable = createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool: {query: async () => {throw new Error('private database detail');}} as unknown as typeof db.pool,
    outbox: db.outbox, config: config()});
  const liveWithoutDatabase = await request('', undefined, {url: `${origin}/api/health/live`, target: unavailable});
  assert.equal(liveWithoutDatabase.status, 200); assert.deepEqual(await liveWithoutDatabase.json(), {status: 'live'});
  const notReady = await request('', undefined, {url: `${origin}/api/health/ready`, target: unavailable});
  assert.equal(notReady.status, 503); const notReadyBody=await notReady.text();
  assert.deepEqual(JSON.parse(notReadyBody), {status: 'unavailable'});
  assert.equal(notReadyBody.includes('private database detail'), false); protectedHeaders(notReady);
});
test('HTTP signup accepts a 1024-byte password and rejects a longer password without consuming its token', async () => {
  const signup = new SignupStore(db.pool, db.outbox);
  const issue = async (email: string) => {
    await signup.request(email);
    const queued = (await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0];
    const content = db.outbox.open(queued); assert.ok('token' in content); return content.token;
  };
  const exactToken = await issue('exact-password@example.test');
  const exact = await request('/signup/complete', {token: exactToken, password: 'é'.repeat(512)});
  assert.equal(exact.status, 201);

  const longToken = await issue('long-password@example.test');
  const rejected = await request('/signup/complete', {token: longToken, password: `${'é'.repeat(512)}a`});
  assert.equal(rejected.status, 400);
  assert.deepEqual(await rejected.json(), {error: 'invalid_input'});
  assert.equal((await db.pool.query('SELECT count(*) FROM cloud_accounts')).rows[0].count, '1');
  assert.equal((await request('/signup/complete', {token: longToken, password})).status, 201);
});
test('HTTP password screening reports compromised input and retryable provider failure without consuming links', async () => {
  let mode: 'compromised' | 'unavailable' | 'acceptable' = 'compromised';
  const screening: PasswordScreeningProvider = {async check() {
    if (mode === 'unavailable') throw new Error('private provider detail');
    return mode;
  }};
  const screened = createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool: db.pool, outbox: db.outbox, config: config(), passwordScreening: screening});
  const signup = new SignupStore(db.pool, db.outbox);
  await signup.request('screened@example.test');
  let queued = (await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0];
  let content = db.outbox.open(queued); assert.ok('token' in content);
  const compromised = await request('/signup/complete', {token: content.token, password}, {target: screened});
  assert.equal(compromised.status, 400);
  assert.deepEqual(await compromised.json(), {error: 'password_compromised'});
  mode = 'acceptable';
  assert.equal((await request('/signup/complete', {token: content.token, password}, {target: screened})).status, 201);

  const recovery = new PasswordRecoveryStore(db.pool, db.outbox);
  await recovery.request('screened@example.test');
  queued = (await db.pool.query("SELECT * FROM email_outbox WHERE kind='password_reset' ORDER BY created_at DESC LIMIT 1")).rows[0];
  content = db.outbox.open(queued); assert.ok('token' in content);
  mode = 'unavailable';
  const unavailable = await request('/password-reset/complete', {token: content.token, password: 'a replacement café password'}, {target: screened});
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {error: 'temporarily_unavailable'});
  assert.equal(unavailable.headers.get('retry-after'), '1');
  mode = 'acceptable';
  assert.equal((await request('/password-reset/complete', {token: content.token, password: 'a replacement café password'}, {target: screened})).status, 200);
});
test('CSRF belongs to a live session; duplicate cookies cannot choose a different session', async () => {
  const owner = await account(); const first = cookies(await signIn(owner.email));
  const second = cookies(await signIn(owner.email));
  for (const csrf of ['', second.csrf]) {
    assert.equal((await request('/session/activity', {}, {headers: {cookie: first.header, 'x-csrf-token': csrf}})).status, 403);
    assert.equal((await request('/logout', {}, {headers: {cookie: first.header, 'x-csrf-token': csrf}})).status, 403);
  }
  assert.equal((await request('/session', undefined, {headers: {cookie: `${first.header}; __Host-cloud_session=${second.token}`}})).status, 400);
  const ended = await request('/logout', {}, {headers: {cookie: first.header, 'x-csrf-token': first.csrf}});
  assert.equal(ended.status, 204); assert.equal(ended.headers.getSetCookie().length, 2);
  assert.ok(ended.headers.getSetCookie().every(value => value.includes('Max-Age=0') && value.includes('Path=/')));
  assert.equal((await request('/session', undefined, {headers: {cookie: first.header}})).status, 401);
  assert.equal((await request('/session', undefined, {headers: {cookie: second.header}})).status, 200);
  assert.equal((await request('/logout', {}, {headers: {cookie: first.header}})).status, 204);
  assert.equal((await request('/logout', {})).status, 204);
  await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at = clock_timestamp() - interval '1 second'");
  assert.equal((await request('/session/activity', {}, {headers: {cookie: second.header, 'x-csrf-token': second.csrf}})).status, 401);
});
test('unknown/wrong logins and eligible/ineligible/cooldown email requests have generic responses and a timing floor', async () => {
  const owner = await account();
  for (const email of [owner.email, 'missing@example.test']) {
    const start = performance.now(); const response = await request('/login', {email, password: 'wrong'});
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), {error: 'credentials_invalid'});
    assert.ok(performance.now() - start >= 285);
    for (let i = 0; i < 2; i++) {
      const challenge = await request('/browser-check', {form: '/password-reset/request'});
      const headers = solveBrowserCheck(await challenge.json());
      const started = performance.now(); const reset = await request('/password-reset/request', {email}, {headers});
      assert.equal(reset.status, 202); assert.deepEqual(await reset.json(), {status: 'accepted'});
      assert.ok(performance.now() - started >= 285);
    }
  }
  assert.equal((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind = 'password_reset'")).rows[0].count, '1');
});
test('IP limits are shared across apps and cannot be bypassed with untrusted forwarded headers', async () => {
  const other = createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool: db.secondPool, outbox: db.outbox, config: config()});
  for (let i = 0; i < 10; i++) assert.equal((await request('/login', {email: 'missing@example.test', password: 'wrong'},
    {target: i % 2 ? other : app, peer: i % 2 ? '::ffff:192.0.2.4' : '192.0.2.4', headers: {'x-forwarded-for': `198.51.100.${i}`}})).status, 401);
  const blocked = await request('/login', {email: 'missing@example.test', password: 'wrong'});
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('retry-after')) > 0); protectedHeaders(blocked);
  await db.pool.query('TRUNCATE account_rate_limits');
  for (let i = 0; i < 5; i++) assert.equal((await emailRequest('/signup/request', {email: `a${i}@example.test`}, {peer: `2001:db8:1:2::${i + 1}`})).status, 202);
  const refusal = await emailRequest('/signup/request', {email: 'more@example.test'}, {peer: '2001:db8:1:2:abcd::1'});
  assert.equal(refusal.status, 429);
  assert.deepEqual(await refusal.json(), {error: 'signup_rate_limited'});
  const retryAfter = Number(refusal.headers.get('retry-after'));
  assert.ok(retryAfter > 3500 && retryAfter <= 3600);
  assert.equal((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind = 'verification'")).rows[0].count, '5');
  assert.equal((await emailRequest('/signup/request', {email: 'more@example.test'}, {peer: '2001:db8:1:3::1'})).status, 202);
});
test('each email form requires a browser proof before spending any form allowance', async () => {
  const owner = await account();
  const signup = await request('/signup/request', {email: 'new@example.test'});
  const reset = await request('/password-reset/request', {email: owner.email});
  assert.deepEqual([signup.status, reset.status], [403, 403]);
  for (const response of [signup, reset]) assert.deepEqual(await response.json(), {error: 'browser_check_required'});
  assert.equal((await db.pool.query('SELECT count(*) FROM email_outbox')).rows[0].count, '0');
  assert.deepEqual((await db.pool.query('SELECT attempts FROM account_rate_limits')).rows, [{attempts: 2}]);
});
test('a browser proof is bound to the form, portal origin and IPv6 connection group', async () => {
  const alternateOrigin = 'https://other.example.test';
  const alternateApp = createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool: db.secondPool, outbox: db.outbox,
    config: {...config(), portalOrigin: alternateOrigin}});
  const peer = '2001:db8:1:2::1';
  const challenge = await request('/browser-check', {form: '/signup/request'}, {peer});
  assert.equal(challenge.status, 200);
  const headers = solveBrowserCheck(await challenge.json());
  const body = {email: 'proof@example.test'};
  assert.equal((await request('/password-reset/request', body, {headers, peer})).status, 403);
  assert.equal((await request('/signup/request', body, {headers, peer: '2001:db8:1:3::1'})).status, 403);
  assert.equal((await request('/signup/request', body, {headers: {...headers, origin: alternateOrigin}, peer,
    target: alternateApp, url: `${alternateOrigin}/api/account/signup/request`})).status, 403);
  assert.equal((await request('/signup/request', body, {headers, peer: '2001:db8:1:2::2'})).status, 202);
  assert.equal((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind = 'verification'")).rows[0].count, '1');
});
test('two account servers can spend a browser proof only once', async () => {
  const other = createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool: db.secondPool, outbox: db.outbox, config: config()});
  const challenge = await request('/browser-check', {form: '/signup/request'});
  assert.equal(challenge.status, 200);
  const headers = solveBrowserCheck(await challenge.json());
  const responses = await Promise.all([app, other].map((target, index) =>
    request('/signup/request', {email: `proof-${index}@example.test`}, {target, headers})));
  assert.deepEqual(responses.map(response => response.status).sort(), [202, 403]);
  // The duplicate is the only counter spent twice, and its row must outlive a two-minute challenge.
  const claim = await db.pool.query("SELECT expires_at > clock_timestamp() + interval '2 minutes' AS live FROM account_rate_limits WHERE attempts = 2");
  assert.deepEqual(claim.rows, [{live: true}]);
  const {challenge: token, nonce} = JSON.parse(headers['x-waitron-browser-proof']);
  const reordered = {'x-waitron-browser-proof': JSON.stringify({nonce, challenge: token})};
  assert.equal((await request('/signup/request', {email: 'later@example.test'}, {headers: reordered})).status, 403);
  assert.equal((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind = 'verification'")).rows[0].count, '1');
});
test('address login limits survive case changes and different IPs', async () => {
  for (let i = 0; i < 30; i++) assert.equal((await request('/login', {email: i % 2 ? 'OWNER@EXAMPLE.TEST' : ' owner@example.test ', password: 'wrong'}, {peer: `192.0.2.${i + 1}`})).status, 401);
  assert.equal((await request('/login', {email: 'owner@example.test', password: 'wrong'}, {peer: '198.51.100.1'})).status, 429);
});
test('trusted proxies must supply exactly one valid address; proxy trust cannot be mutated by the caller', async () => {
  const settings = {...config(), trustedProxyIps: ['192.0.2.4']};
  const proxied = createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool: db.pool, outbox: db.outbox, config: settings});
  settings.trustedProxyIps.length = 0;
  for (const value of ['', 'garbage-secret', '192.0.2.1, 192.0.2.2', '127.1', '2001:db8::1%eth0']) {
    assert.equal((await request('/session', undefined, {target: proxied, headers: {'x-forwarded-for': value}})).status, 400);
  }
  assert.equal((await request('/session', undefined, {target: proxied, headers: {'x-forwarded-for': '198.51.100.1'}})).status, 401);
});
test('configuration fails closed and database failure returns a secret-free 503', async () => {
  for (const change of [{portalOrigin: 'http://cloud.example.test'}, {portalOrigin: 'http://localhost:3000'}, {portalOrigin: 'https://user:secret@example.test'}, {rateKey: ''}, {trustedProxyIps: ['*']}]) {
    assert.throws(() => createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool: db.pool, outbox: db.outbox, config: {...config(), ...change}}), /Invalid account HTTP configuration/);
  }
  await db.pool.query('ALTER TABLE account_rate_limits RENAME TO hidden_rate_limits');
  try {
  const response = await request('/signup/request', {email: 'private-owner@example.test'});
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), {error: 'temporarily_unavailable'}); protectedHeaders(response);
  assert.equal((await db.pool.query('SELECT count(*) FROM email_outbox')).rows[0].count, '0');
  } finally {await db.pool.query('ALTER TABLE hidden_rate_limits RENAME TO account_rate_limits');}
});
test('completion attempts share token limits across IPs and IP limits across tokens', async () => {
  const token = 'a'.repeat(43);
  for (const path of ['/signup/complete', '/password-reset/complete']) {
    for (let i = 0; i < 10; i++) {
      const body = {token, password};
      assert.equal((await request(path, body, {peer: `192.0.2.${i + 1}`})).status, 400);
    }
    const body = {token, password};
    assert.equal((await request(path, body, {peer: '198.51.100.8'})).status, 429);
    await db.pool.query('TRUNCATE account_rate_limits');
    for (let i = 0; i < 10; i++) assert.equal((await request(path, {...body, token: String(i).repeat(43)})).status, 400);
    assert.equal((await request(path, {...body, token: 'z'.repeat(43)})).status, 429);
    await db.pool.query('TRUNCATE account_rate_limits');
  }
});
test('the general request allowance also bounds passive session reads', async () => {
  for (let i = 0; i < 120; i++) assert.equal((await request('/session')).status, 401);
  assert.equal((await request('/session')).status, 429);
  assert.equal((await request('/session', undefined, {peer: '192.0.2.5'})).status, 401);
});
test('session expiry after an HTTP request waits on its row cannot extend activity', async () => {
  const owner = await account(); const session = cookies(await signIn(owner.email));
  const before = (await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows[0].last_seen_at.getTime();
  const lock = await db.secondPool.connect(); await lock.query('BEGIN');
  await lock.query("UPDATE cloud_sessions SET absolute_expires_at = clock_timestamp() + interval '150 milliseconds'");
  const pending = request('/session/activity', {}, {headers: {cookie: session.header, 'x-csrf-token': session.csrf}});
  try {await new Promise(resolve => setTimeout(resolve, 200));}
  finally {await lock.query('COMMIT'); lock.release();}
  const expired = await pending;
  assert.equal(expired.status, 401);
  assert.deepEqual(await expired.json(), {error: 'session_expired'});
  assert.equal((await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows[0].last_seen_at.getTime(), before);
});
test('suspension denies an existing HTTP session and the development cookie stays separate', async () => {
  const owner = await account(); const session = cookies(await signIn(owner.email));
  await db.pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp() WHERE id = $1', [owner.accountId]);
  const suspended = await request('/session', undefined, {headers: {cookie: session.header}});
  assert.equal(suspended.status, 401); assert.deepEqual(await suspended.json(), {error: 'unauthenticated'});
  await db.pool.query('UPDATE cloud_accounts SET disabled_at = NULL WHERE id = $1', [owner.accountId]);
  const dev = createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool: db.pool, outbox: db.outbox, config: {...config(), production: false, portalOrigin: 'http://localhost:3000'}});
  const response = await signIn(owner.email,password, {target: dev, url: 'http://localhost:3000/api/account/login', headers: {origin: 'http://localhost:3000'}});
  assert.equal(response.status, 200);
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith('cloud_session=') && value.includes('HttpOnly') && !value.includes('Secure')));
});
test('IP-blocked login requests cannot spend another account’s address allowance', async () => {
  const owner = await account();
  const otherApp = createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool: db.secondPool, outbox: db.outbox, config: config()});
  const attempts = await Promise.all(Array.from({length: 31}, (_, i) => request('/login',
    {email: i % 2 ? owner.email.toUpperCase() : owner.email, password: 'a wrong password'},
    {peer: i % 2 ? '::ffff:203.0.113.8' : '203.0.113.8', target: i % 2 ? app : otherApp})));
  assert.equal(attempts.filter(response => response.status === 401).length, 10);
  assert.equal(attempts.filter(response => response.status === 429).length, 21);
  const signedIn = await signIn(owner.email,password, {peer: '198.51.100.4'});
  assert.equal(signedIn.status, 200);
  assert.deepEqual(await signedIn.json(), {accountId: owner.accountId});
});

test('locale is optional and strictly validated only on email-producing routes', async () => {
  for (const path of ['/signup/request', '/password-reset/request']) {
    for (const locale of [null, 1, 'fr']) assert.equal((await request(path, {email: 'owner@example.test', locale})).status, 400);
    assert.equal((await request(path, {email: 'owner@example.test', locale: 'es', extra: ''})).status, 400);
    assert.equal((await emailRequest(path, {email: 'owner@example.test', locale: 'es'})).status, 202);
  }
  assert.equal((await request('/signup/complete', {token: 'a'.repeat(43), password, locale: 'en'})).status, 400);
  assert.equal((await request('/password-reset/complete', {token: 'a'.repeat(43), password, locale: 'fr'})).status, 400);
  const row = (await db.pool.query("SELECT * FROM email_outbox WHERE kind = 'verification'")).rows[0];
  assert.equal((db.outbox.open(row) as {locale?: string}).locale, 'es');
});
