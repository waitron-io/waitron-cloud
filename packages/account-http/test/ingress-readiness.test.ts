import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer, request, type ClientRequest, type Server} from 'node:http';
import {after, before, test} from 'node:test';
import {SignupStore} from '@waitron-cloud/registration';
import {startAccountServer} from '../src/server.ts';
import {database} from './fixtures.ts';

const origin = 'https://cloud.example.test';
const password = 'A distinct café password';
let db: Awaited<ReturnType<typeof database>>;

before(async () => { db = await database(); });
after(async () => { await db.close(); });

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function ingress() {
  const config = {portalOrigin: origin, production: true, rateKey: db.rateKey, trustedProxyIps: ['127.0.0.1']};
  const upstreams = await Promise.all([
    startAccountServer({pool: db.pool, outbox: db.outbox, config, port: 0}),
    startAccountServer({pool: db.secondPool, outbox: db.outbox, config, port: 0}),
  ]);
  const ports = upstreams.map(upstream => {
    const address = upstream.server.address(); assert.ok(address && typeof address !== 'string'); return address.port;
  });
  let turn = 0;
  const proxy = createServer((incoming, response) => {
    const clientAddress = String(incoming.headers['x-fixture-client-address'] ?? incoming.socket.remoteAddress);
    const {'x-fixture-client-address': _fixtureClientAddress, ...forwardedHeaders} = incoming.headers;
    const headers = {...forwardedHeaders, host: new URL(origin).host,
      'x-forwarded-for': clientAddress, 'x-forwarded-proto': 'https'};
    const upstream = request({host: '127.0.0.1', port: ports[turn++ % ports.length], method: incoming.method,
      path: incoming.url, headers}, result => {
      response.writeHead(result.statusCode ?? 502, result.headers); result.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    incoming.on('aborted', () => upstream.destroy()); incoming.pipe(upstream);
  });
  const port = await listen(proxy);
  return {port, upstreams, async close() { await close(proxy); await Promise.all(upstreams.map(item => item.close())); }};
}

function send(port: number, path: string, options: {body?: string; headers?: Record<string, string>; clientAddress?: string; end?: boolean} = {}) {
  let outgoing!: ClientRequest;
  const result = new Promise<{status: number; headers: import('node:http').IncomingHttpHeaders; body: string}>((resolve, reject) => {
    outgoing = request({host: '127.0.0.1', port, path, method: options.body === undefined ? 'GET' : 'POST',
      headers: {...options.headers, 'x-fixture-client-address': options.clientAddress ?? '192.0.2.10'}}, response => {
      let body = ''; response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({status: response.statusCode!, headers: response.headers, body}));
      response.on('error', reject);
    });
    outgoing.on('error', reject);
    if (options.body !== undefined) outgoing.write(options.body);
    if (options.end !== false) outgoing.end();
  });
  void result.catch(() => {});
  return {result, abort() { outgoing.destroy(); }};
}

test('real account instances behind a streaming proxy preserve ingress authority and bounds', async () => {
  const email = `ingress-${randomUUID()}@example.test`;
  const signup = new SignupStore(db.pool, db.outbox);
  await signup.request(email);
  const queued = (await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification'")).rows[0];
  const message = db.outbox.open(queued); assert.ok('token' in message);
  await signup.complete(message.token, {password, organisationName: 'Café Sol', legalBusinessName: 'Café Sol SL', countryCode: 'ES'});
  await db.pool.query('TRUNCATE account_rate_limits, email_outbox CASCADE');
  const running = await ingress();
  const json = {'content-type': 'application/json', origin};
  try {
    assert.equal((await send(running.port, '/api/account/login', {body: JSON.stringify({email, password}), headers: {...json, origin: 'https://other.example.test'}}).result).status, 403);
    assert.equal((await send(running.port, '/api/account/login', {body: JSON.stringify({email, password}), headers: {'content-type': 'application/json'}}).result).status, 403);

    const login = await send(running.port, '/api/account/login', {body: JSON.stringify({email, password}), headers: json}).result;
    assert.equal(login.status, 200);
    const setCookies = login.headers['set-cookie']; assert.ok(setCookies);
    for (const cookie of setCookies) {
      assert.match(cookie, /^__Host-cloud_(?:session|csrf)=/); assert.match(cookie, /; Secure/);
      assert.match(cookie, /; SameSite=Lax/); assert.match(cookie, /; Path=\//); assert.doesNotMatch(cookie, /; Domain=/);
    }
    const values = setCookies.map(cookie => cookie.split(';')[0]!);
    const cookie = values.join('; '); const csrf = values.find(value => value.startsWith('__Host-cloud_csrf='))!.split('=')[1]!;
    assert.equal((await send(running.port, '/api/account/session/activity', {body: '{}', headers: {...json, cookie}}).result).status, 403);
    assert.equal((await send(running.port, '/api/account/session/activity', {body: '{}', headers: {...json, cookie, 'x-csrf-token': csrf}}).result).status, 200);

    await db.pool.query('TRUNCATE account_rate_limits');
    const wrong = JSON.stringify({email, password: 'wrong password'});
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await send(running.port, '/api/account/login', {body: wrong,
        headers: {...json, 'x-forwarded-for': `198.51.100.${attempt + 1}`}}).result;
      assert.equal(response.status, 401);
    }
    const blocked = await send(running.port, '/api/account/login', {body: wrong, headers: json}).result;
    assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers['retry-after']) > 0);
    assert.equal((await send(running.port, '/api/account/login', {body: wrong, headers: json, clientAddress: '192.0.2.11'}).result).status, 401);

    await db.pool.query('TRUNCATE account_rate_limits');
    const declared = send(running.port, '/api/account/signup/request', {body: '{', end: false,
      headers: {...json, 'content-length': '16385'}});
    const declaredStarted = performance.now();
    assert.equal((await declared.result).status, 413); assert.ok(performance.now() - declaredStarted < 2000);
    declared.abort();
    assert.equal((await send(running.port, '/api/account/signup/request', {body: JSON.stringify({email: `${'x'.repeat(17000)}@example.test`}), headers: json}).result).status, 413);
    const slow = send(running.port, '/api/account/signup/request', {body: '{', end: false, headers: json});
    const slowStarted = performance.now();
    assert.equal((await slow.result).status, 408);
    assert.ok(performance.now() - slowStarted >= 4500 && performance.now() - slowStarted < 7500);
    slow.abort();
  } finally { await running.close(); }
});
