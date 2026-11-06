import { test } from 'node:test';
import assert from 'node:assert/strict';
import net, { createServer, connect } from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { measureRemoteBrowser } from './browser.mjs';
import { assessAccounting } from './accounting-policy.mjs';

// The browser driver is a controlled boundary; the relay, complete traffic,
// missing producer observation and cleanup are real. Genuine Chromium is covered
// separately by remote-browser-conformance.test.mjs.
for (const mode of ['clean', 'missing', 'bad-response'])
test('browserAccountingCannotRefuseCompletedActionsOrHideBadResponses_' + mode, { timeout: 5000 }, async t => {
  const sockets = new Set(), backendRequests = [];
  const server = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {});
    const parts = []; socket.on('data', chunk => parts.push(chunk));
    socket.once('end', () => { backendRequests.push(Buffer.concat(parts).toString()); socket.end('headers:reply'); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const targetPort = server.address().port;
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const originalConnect = net.connect, originalServer = net.createServer;
  const relays = [];
  net.connect = (...args) => originalConnect(args[0]?.port === 443 ? { ...args[0], port: targetPort } : args[0], ...args.slice(1));
  net.createServer = (options, handle) => {
    const relay = originalServer(options, socket => {
      if (mode !== 'clean') Object.defineProperty(socket, 'bytesWritten', { value: undefined });
      handle(socket);
    });
    relays.push(relay); return relay;
  };
  syncBuiltinESMExports();
  t.after(async () => {
    net.connect = originalConnect; net.createServer = originalServer; syncBuiltinESMExports();
    await Promise.all(relays.map(relay => new Promise(resolve => relay.close(resolve))));
  });
  const events = new Map(), clicked = [];
  let port, contextCloses = 0, browserCloses = 0, reloads = 0;
  const exchange = async () => {
    const socket = connect({ host: '127.0.0.1', port, allowHalfOpen: true });
    const parts = []; socket.on('data', chunk => parts.push(chunk)); socket.once('end', () => socket.end());
    const closed = once(socket, 'close'); socket.end('headers:request'); await closed;
    assert.equal(Buffer.concat(parts).toString(), 'headers:reply');
    const req = { url: () => 'https://staff.generated.example.test/manage/', resourceType: () => 'document',
      sizes: async () => ({ requestBodySize: 7, responseBodySize: 5 }) };
    events.get('request')(req);
    events.get('response')({ request: () => req, url: req.url, status: () => mode === 'bad-response' ? 500 : 200 });
    events.get('requestfinished')(req);
  };
  const locator = selector => ({ locator, first() { return this; }, or() { return this; },
    async fill() {}, async click() { clicked.push(selector); }, async waitFor() {}, async isVisible() { return false; } });
  const page = { locator, on() {}, setDefaultTimeout() {}, async evaluate() { return true; },
    async goto(url) { if (url !== 'about:blank') await exchange(); }, async reload() { reloads++; await exchange(); } };
  const context = { async addInitScript() {}, on: (name, listener) => events.set(name, listener),
    async newPage() { return page; }, async newCDPSession() { return { async send() {}, on() {} }; },
    async close() { contextCloses++; } };
  const chromium = { async launch(options) {
    port = Number(options.args.join(' ').match(/127\.0\.0\.1:(\d+)/)[1]);
    return { async newContext() { return context; }, async close() { browserCloses++; } };
  } };
  const run = () => measureRemoteBrowser({ chromium, staffHostname: 'staff.generated.example.test',
    email: 'generated@example.test', password: 'PRIVATE_PASSWORD' });
  if (mode === 'bad-response') await assert.rejects(run(), { message: 'Invalid cloud cost browser journey' });
  else {
    let result;
    await assert.doesNotReject(async () => { result = await run(); }, 'missing cost counts cannot refuse completed browser actions');
    assert.deepEqual(result.actions, ['login-page', 'sign-in', 'dashboard-read', 'browser-reconnect', 'sign-out']);
    assert.equal(result.completedRequests, 2); assert.equal(result.completedResponseBodyBytes, 10);
    assert.equal(reloads, 1); assert.equal(contextCloses, 1);
    assert.ok(clicked.includes('[data-test=submit]') && clicked.includes('[data-test=logout]'));
    assert.equal(result.snapshot.status, mode === 'clean' ? 'measured' : 'unknown');
    assert.equal(assessAccounting({ producer: 'remote', sources: [{ scope: 'remote', record: result.snapshot }] }).publicationEligible,
      mode === 'clean');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PASSWORD|generated@example|headers:|127\.0\.0\.1/);
  }
  assert.equal(browserCloses, 1);
  assert.equal(relays.length, 1); assert.equal(relays[0].listening, false);
  assert.deepEqual(backendRequests, ['headers:request', 'headers:request']);
});
