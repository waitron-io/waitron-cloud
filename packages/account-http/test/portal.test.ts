import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { request, type ClientRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { startAccountServer } from '../src/server.ts';
import { database } from './fixtures.ts';
let db: Awaited<ReturnType<typeof database>>;
before(async () => { db = await database(); });
after(async () => { await db.close(); });
const assets = new Map([
  ['/index.html', {body: Buffer.from('<!doctype html><title>Cloud</title>'), contentType: 'text/html; charset=utf-8'}],
  ['/app.js', {body: Buffer.from('/* portal */'), contentType: 'text/javascript; charset=utf-8'}],
  ['/app.css', {body: Buffer.from('body {}'), contentType: 'text/css; charset=utf-8'}],
]);
async function host() {
  const running = await startAccountServer({pool: db.pool, outbox: db.outbox,
    config: {portalOrigin: 'http://localhost', production: false, rateKey: db.rateKey, trustedProxyIps: []},
    port: 0, portalAssets: assets});
  const address = running.server.address(); assert.ok(address && typeof address !== 'string');
  return {...running, port: address.port};
}
function send(port: number, path: string, method = 'GET', host = 'localhost', stall = false) {
  let req: ClientRequest;
  const result = new Promise<{status: number; headers: import('node:http').IncomingHttpHeaders; body: string}>((resolve, reject) => {
    req = request({host: '127.0.0.1', port, path, method,
      headers: {host, origin: 'http://localhost', 'content-type': 'application/json'}}, res => {
      let body = ''; res.on('data', data => {body += data;});
      res.on('end', () => resolve({status: res.statusCode!, headers: res.headers, body}));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (stall) req.write('{'); else req.end();
  });
  void result.catch(() => {});
  return {result, abort() { req.destroy(); }};
}
test('portal serves only named documents and assets with host, method and security checks', async () => {
  const running = await host();
  try {
    for (const path of ['/', '/signup', '/login', '/forgot-password', '/reset-password', '/account', '/signup?token=old', '/reset-password?token=old']) {
      const res = await send(running.port, path).result;
      assert.equal(res.status, 200, path); assert.match(res.headers['content-type']!, /text\/html/);
      assert.equal(res.headers['cache-control'], 'no-store'); assert.equal(res.headers['referrer-policy'], 'no-referrer');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.match(String(res.headers['content-security-policy']), /script-src 'self'/);
      assert.match(String(res.headers['content-security-policy']), /frame-ancestors 'none'/);
      assert.equal((await send(running.port, path, 'HEAD').result).body, '');
    }
    for (const [path, mime] of [['/app.js', 'text/javascript'], ['/app.css', 'text/css']]) {
      const res = await send(running.port, path!).result;
      assert.equal(res.status, 200); assert.ok(String(res.headers['content-type']).startsWith(mime!));
    }
    for (const path of ['/missing', '/index.html', '/package.json', '/%2e%2e/package.json', '/app.js.map'])
      assert.equal((await send(running.port, path).result).status, 404, path);
    assert.equal((await send(running.port, '/login?token=secret').result).status, 400);
    assert.equal((await send(running.port, '/login', 'POST').result).status, 405);
    assert.equal((await send(running.port, '/', 'GET', 'evil.example').result).status, 403);
    assert.equal((await send(running.port, '/api/account/session?x=1').result).status, 400);
  } finally { await running.close(); }
});
test('portal traffic spends neither database limits nor the eight account slots', async () => {
  await db.pool.query('TRUNCATE account_rate_limits');
  const running = await host(); const pending: ReturnType<typeof send>[] = [];
  try {
    for (let i = 0; i < 8; i++) pending.push(send(running.port, '/api/account/signup/request', 'POST', 'localhost', true));
    const deadline = Date.now() + 3000;
    while (Number((await db.pool.query('SELECT sum(attempts) AS n FROM account_rate_limits')).rows[0].n) < 8) {
      assert.ok(Date.now() < deadline); await delay(20);
    }
    const before = (await db.pool.query('SELECT * FROM account_rate_limits ORDER BY key')).rows;
    for (const path of ['/', '/app.js', '/app.css', '/missing'])
      assert.equal((await send(running.port, path).result).status, path === '/missing' ? 404 : 200);
    assert.deepEqual((await db.pool.query('SELECT * FROM account_rate_limits ORDER BY key')).rows, before);
    assert.equal((await send(running.port, '/api/account/session').result).status, 503);
  } finally { pending.forEach(p => p.abort()); await running.close(); }
});
