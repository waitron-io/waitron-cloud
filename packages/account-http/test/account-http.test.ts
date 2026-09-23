import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import type { HttpBindings } from '@hono/node-server';
import { EmailWorker, createLocalAccountMailer, SignupStore } from '@waitron-cloud/registration';
import { createAccountApp } from '../src/app.ts';
import { database } from './fixtures.ts';
let db: Awaited<ReturnType<typeof database>>;
let app: ReturnType<typeof createAccountApp>;
const origin = 'https://cloud.example.test';
const password = 'A distinct café password';
const details = {password, organisationName: 'Café Sol', legalBusinessName: 'Café Sol SL', countryCode: 'ES'};
const config = () => ({portalOrigin: origin, production: true, rateKey: db.rateKey, trustedProxyIps: [] as string[]});
before(async () => {db = await database();});
after(async () => db?.close());
beforeEach(async () => {
  await db.pool.query('TRUNCATE account_rate_limits, email_outbox, signup_requests, password_reset_requests, organisations, cloud_accounts CASCADE');
  app = createAccountApp({pool: db.pool, outbox: db.outbox, config: config()});
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
async function tokenFromMail(email: string, subject: string) {
  const inbox = process.env.MAILPIT_TEST_URL!;
  const list = await (await fetch(`${inbox}/api/v1/messages`)).json() as {messages: {ID: string; Subject: string; To: {Address: string}[]}[]};
  const found = list.messages.find(message => message.Subject === subject && message.To.some(to => to.Address === email));
  assert.ok(found);
  const mail = await (await fetch(`${inbox}/api/v1/message/${found.ID}`)).json() as {Text: string};
  const token = mail.Text.match(/token=([A-Za-z0-9_-]{43})/)?.[1]; assert.ok(token); return token;
}
function protectedHeaders(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.has('access-control-allow-origin'), false);
}
test('HTTP signup and recovery through Mailpit preserve accounts, cookies and session revocation', async () => {
  const email = `journey-${randomUUID()}@example.test`;
  const worker = new EmailWorker(db.pool, db.outbox, createLocalAccountMailer({port: Number(process.env.MAILPIT_TEST_SMTP_PORT)}));
  const requested = await request('/signup/request', {email}); assert.equal(requested.status, 202);
  assert.deepEqual(await requested.json(), {status: 'accepted'}); protectedHeaders(requested);
  await worker.runOnce(); const token = await tokenFromMail(email, 'Verify your Waitron Cloud email');
  assert.equal((await request(`/signup/complete?token=${token}`)).status, 400);
  const signup = await request('/signup/complete', {token, ...details});
  assert.equal(signup.status, 201); assert.equal(signup.headers.has('set-cookie'), false);
  const created = await signup.json() as {accountId: string; organisationId: string}; assert.ok(created.organisationId);
  assert.equal((await request('/signup/complete', {token, ...details})).status, 400);
  const signedIn = await request('/login', {email, password}); assert.equal(signedIn.status, 200);
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
  const resetRequest = await request('/password-reset/request', {email}); assert.equal(resetRequest.status, 202);
  await worker.runOnce(); const resetToken = await tokenFromMail(email, 'Reset your Waitron Cloud password');
  const newPassword = 'A different long café password';
  const reset = await request('/password-reset/complete', {token: resetToken, password: newPassword});
  assert.equal(reset.status, 200); assert.equal(reset.headers.has('set-cookie'), false);
  assert.equal((await request('/password-reset/complete', {token: resetToken, password: newPassword})).status, 400);
  assert.equal((await request('/session', undefined, {headers})).status, 401);
  assert.equal((await request('/login', {email, password})).status, 401);
  assert.equal((await request('/login', {email, password: newPassword})).status, 200);
  assert.equal((await db.pool.query('SELECT count(*) FROM cloud_accounts')).rows[0].count, '1');
});
test('every mutation rejects missing, null and foreign Origin before changing state', async () => {
  const paths = ['/signup/request', '/signup/complete', '/login', '/session/activity', '/logout', '/password-reset/request', '/password-reset/complete'];
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
test('CSRF belongs to a live session; duplicate cookies cannot choose a different session', async () => {
  const owner = await account(); const first = cookies(await request('/login', {email: owner.email, password}));
  const second = cookies(await request('/login', {email: owner.email, password}));
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
      const started = performance.now(); const reset = await request('/password-reset/request', {email});
      assert.equal(reset.status, 202); assert.deepEqual(await reset.json(), {status: 'accepted'});
      assert.ok(performance.now() - started >= 285);
    }
  }
  assert.equal((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind = 'password_reset'")).rows[0].count, '1');
});
test('IP limits are shared across apps and cannot be bypassed with untrusted forwarded headers', async () => {
  const other = createAccountApp({pool: db.secondPool, outbox: db.outbox, config: config()});
  for (let i = 0; i < 10; i++) assert.equal((await request('/login', {email: 'missing@example.test', password: 'wrong'},
    {target: i % 2 ? other : app, peer: i % 2 ? '::ffff:192.0.2.4' : '192.0.2.4', headers: {'x-forwarded-for': `198.51.100.${i}`}})).status, 401);
  const blocked = await request('/login', {email: 'missing@example.test', password: 'wrong'});
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('retry-after')) > 0); protectedHeaders(blocked);
  await db.pool.query('TRUNCATE account_rate_limits');
  for (let i = 0; i < 10; i++) assert.equal((await request('/signup/request', {email: `a${i}@example.test`}, {peer: `2001:db8:1:2::${i + 1}`})).status, 202);
  assert.equal((await request('/signup/request', {email: 'more@example.test'}, {peer: '2001:db8:1:2:abcd::1'})).status, 429);
});
test('address login limits survive case changes and different IPs', async () => {
  for (let i = 0; i < 30; i++) assert.equal((await request('/login', {email: i % 2 ? 'OWNER@EXAMPLE.TEST' : ' owner@example.test ', password: 'wrong'}, {peer: `192.0.2.${i + 1}`})).status, 401);
  assert.equal((await request('/login', {email: 'owner@example.test', password: 'wrong'}, {peer: '198.51.100.1'})).status, 429);
});
test('trusted proxies must supply exactly one valid address; proxy trust cannot be mutated by the caller', async () => {
  const settings = {...config(), trustedProxyIps: ['192.0.2.4']};
  const proxied = createAccountApp({pool: db.pool, outbox: db.outbox, config: settings});
  settings.trustedProxyIps.length = 0;
  for (const value of ['', 'garbage-secret', '192.0.2.1, 192.0.2.2', '127.1', '2001:db8::1%eth0']) {
    assert.equal((await request('/session', undefined, {target: proxied, headers: {'x-forwarded-for': value}})).status, 400);
  }
  assert.equal((await request('/session', undefined, {target: proxied, headers: {'x-forwarded-for': '198.51.100.1'}})).status, 401);
});
test('configuration fails closed and database failure returns a secret-free 503', async () => {
  for (const change of [{portalOrigin: 'http://cloud.example.test'}, {portalOrigin: 'http://localhost:3000'}, {portalOrigin: 'https://user:secret@example.test'}, {rateKey: ''}, {trustedProxyIps: ['*']}]) {
    assert.throws(() => createAccountApp({pool: db.pool, outbox: db.outbox, config: {...config(), ...change}}), /Invalid account HTTP configuration/);
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
      const body = path.startsWith('/signup') ? {token, ...details} : {token, password};
      assert.equal((await request(path, body, {peer: `192.0.2.${i + 1}`})).status, 400);
    }
    const body = path.startsWith('/signup') ? {token, ...details} : {token, password};
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
  const owner = await account(); const session = cookies(await request('/login', {email: owner.email, password}));
  const before = (await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows[0].last_seen_at.getTime();
  const lock = await db.secondPool.connect(); await lock.query('BEGIN');
  await lock.query("UPDATE cloud_sessions SET absolute_expires_at = clock_timestamp() + interval '150 milliseconds'");
  const pending = request('/session/activity', {}, {headers: {cookie: session.header, 'x-csrf-token': session.csrf}});
  try {await new Promise(resolve => setTimeout(resolve, 200));}
  finally {await lock.query('COMMIT'); lock.release();}
  assert.equal((await pending).status, 401);
  assert.equal((await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows[0].last_seen_at.getTime(), before);
});
test('suspension denies an existing HTTP session and the development cookie stays separate', async () => {
  const owner = await account(); const session = cookies(await request('/login', {email: owner.email, password}));
  await db.pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp() WHERE id = $1', [owner.accountId]);
  assert.equal((await request('/session', undefined, {headers: {cookie: session.header}})).status, 401);
  await db.pool.query('UPDATE cloud_accounts SET disabled_at = NULL WHERE id = $1', [owner.accountId]);
  const dev = createAccountApp({pool: db.pool, outbox: db.outbox, config: {...config(), production: false, portalOrigin: 'http://localhost:3000'}});
  const response = await request('/login', {email: owner.email, password}, {target: dev, url: 'http://localhost:3000/api/account/login', headers: {origin: 'http://localhost:3000'}});
  assert.equal(response.status, 200);
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith('cloud_session=') && value.includes('HttpOnly') && !value.includes('Secure')));
});
test('IP-blocked login requests cannot spend another account’s address allowance', async () => {
  const owner = await account();
  const otherApp = createAccountApp({pool: db.secondPool, outbox: db.outbox, config: config()});
  const attempts = await Promise.all(Array.from({length: 31}, (_, i) => request('/login',
    {email: i % 2 ? owner.email.toUpperCase() : owner.email, password: 'a wrong password'},
    {peer: i % 2 ? '::ffff:203.0.113.8' : '203.0.113.8', target: i % 2 ? app : otherApp})));
  assert.equal(attempts.filter(response => response.status === 401).length, 10);
  assert.equal(attempts.filter(response => response.status === 429).length, 21);
  const signedIn = await request('/login', {email: owner.email, password}, {peer: '198.51.100.4'});
  assert.equal(signedIn.status, 200);
  assert.deepEqual(await signedIn.json(), {accountId: owner.accountId});
});

test('locale is optional and strictly validated only on email-producing routes', async () => {
  for (const path of ['/signup/request', '/password-reset/request']) {
    for (const locale of [null, 1, 'fr']) assert.equal((await request(path, {email: 'owner@example.test', locale})).status, 400);
    assert.equal((await request(path, {email: 'owner@example.test', locale: 'es', extra: ''})).status, 400);
    assert.equal((await request(path, {email: 'owner@example.test', locale: 'es'})).status, 202);
  }
  assert.equal((await request('/signup/complete', {token: 'a'.repeat(43), ...details, locale: 'en'})).status, 400);
  assert.equal((await request('/password-reset/complete', {token: 'a'.repeat(43), password, locale: 'fr'})).status, 400);
  const row = (await db.pool.query("SELECT * FROM email_outbox WHERE kind = 'verification'")).rows[0];
  assert.equal((db.outbox.open(row) as {locale?: string}).locale, 'es');
});
