import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {accountRequest} from '../src/api.ts';

const flows = [
  {path: '/signup/request', status: 202, body: {email: 'owner@example.test', locale: 'es'}},
  {path: '/password-reset/request', status: 202, body: {email: 'owner@example.test', locale: 'en'}},
  {path: '/signup/complete', status: 201, body: {token: 'signup-link', password: ' exact password ',
    organisationName: 'Café', legalBusinessName: 'Café SL', countryCode: 'ES'}},
  {path: '/password-reset/complete', status: 200, body: {token: 'reset-link', password: ' exact password ', locale: 'es'}},
] as const;

for (const flow of flows) {
  test(`${flow.path} does not need a signed-in management cookie`, async t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {configurable: true, get() {
      assert.fail('public account actions must not read management cookies');
    }});
    t.after(() => {if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');});
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      calls++;
      assert.equal(url, `/api/account${flow.path}`);
      assert.equal(init?.method, 'POST');
      assert.equal(init?.credentials, 'same-origin');
      assert.deepEqual(init?.headers, {'Content-Type': 'application/json'});
      assert.deepEqual(JSON.parse(String(init?.body)), flow.body);
      return Response.json({error: 'forbidden'}, {status: 403});
    });
    assert.deepEqual(await accountRequest(flow.path, flow.body), {ok: false, status: 403, code: 'forbidden', retryAfterMs: 0});
    assert.equal(calls, 1);
  });

  test(`${flow.path} refuses an empty HTTP 205 response`, async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response(null, {status: 205}));
    assert.deepEqual(await accountRequest(flow.path, flow.body), {ok: false, status: 503, code: 'unexpected_response', retryAfterMs: 0});
  });
}

for (const boundary of ['headers', 'body'] as const) {
  test(`all signup/reset calls expire at the real network ${boundary} boundary`, {timeout: 25_000}, async t => {
    const received: string[] = [];
    const server = createServer((request, response) => {
      received.push(request.url!);
      if (boundary === 'body') {
        const flow = flows.find(flow => request.url === `/api/account${flow.path}`)!;
        response.writeHead(flow.status, {'Content-Type': 'application/json'});
        response.write('{');
      }
    });
    t.after(async () => {
      const closed = once(server, 'close');
      server.close(); server.closeAllConnections(); await closed;
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const fetch = globalThis.fetch;
    const signals: AbortSignal[] = [];
    t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
      assert.ok(init.signal instanceof AbortSignal);
      signals.push(init.signal);
      return fetch(new URL(url, `http://127.0.0.1:${address.port}`), init);
    });
    const started = performance.now();
    const results = await Promise.all(flows.map(flow => accountRequest(flow.path, flow.body)));
    assert.ok(performance.now() - started >= 14_900, 'a shorter deadline must not cut off these requests');
    assert.deepEqual(results, flows.map(() => ({ok: false, status: boundary === 'headers' ? 0 : 503,
      code: boundary === 'headers' ? 'network_error' : 'unexpected_response', retryAfterMs: 0})));
    assert.deepEqual(received.sort(), flows.map(flow => `/api/account${flow.path}`).sort(), 'one request per operation');
    assert.equal(signals.length, 4);
    assert.ok(signals.every(signal => signal.aborted), 'the deadline covers headers and the complete response body');
  });
}
