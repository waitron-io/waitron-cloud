import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';

function browser(t: TestContext, protocol: string, cookie: string) {
  for (const [name, value] of [['location', {protocol}], ['document', {cookie}]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

const writes = [
  {path: '/session/activity', body: {}},
  {path: '/logout', body: {}},
  {path: '/sessions/revoke', body: {id: 'other-session'}},
  {path: '/installations/revoke', body: {installationId: 'old-installation', revision: 3}},
  {path: '/pairing/inspect', body: {requestId: 'connection', code: '12345678'}},
  {path: '/pairing/approve', body: {requestId: 'connection', legalBusinessId: 'business'}},
  {path: '/passkeys/registration/options', body: {password: 'exact password ' }},
  {path: '/passkeys/registration/verify', body: {ceremonyId: 'ceremony', response: {id: 'credential'}}},
  {path: '/passkeys/remove', body: {id: 'credential', password: 'exact password '}},
  {path: '/authenticator/begin', body: {password: 'exact password '}},
  {path: '/authenticator/activate', body: {pendingToken: 'pending', code: '123456'}},
  {path: '/authenticator/regenerate', body: {password: 'exact password ', code: '123456'}},
  {path: '/authenticator/remove', body: {password: 'exact password ', code: '123456'}},
  {path: '/authenticator/cancel', body: {pendingToken: 'pending'}},
  {path: '/recovery/inspect', body: {venueId: 'venue', recoveryId: 'recovery'}},
  {path: '/remote-access/status', body: {venueId: 'venue'}},
  {path: '/remote-access/dns', body: {venueId: 'venue', hostname: 'cafe.example.test'}},
  {path: '/usage/read', body: {organisationId: 'organisation'}},
  {path: '/diagnostics/read', body: {installationId: 'installation'}},
  {path: '/backups/list', body: {venueId: 'venue', cursor: null}},
  {path: '/alerts', body: {enabled: true, locale: 'es'}},
  {path: '/translation-consent', body: {venueId: 'venue', choice: 'agree'}},
];

for (const protocol of ['https:', 'http:']) for (const {path, body} of writes) {
  test(`${protocol} protected request ${path} preserves its proof and payload on refusal`, async t => {
    browser(t, protocol, 'cloud_csrf=local-proof; __Host-cloud_csrf=secure-proof');
    const calls: {url: unknown; init: RequestInit | undefined}[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      calls.push({url, init});
      return Response.json({error: 'forbidden'}, {status: 403});
    });
    assert.deepEqual(await accountRequest(path, body), {ok: false, status: 403, code: 'forbidden', retryAfterMs: 0});
    assert.equal(calls.length, 1, 'a refused write must not repeat');
    assert.equal(calls[0]!.url, `/api/account${path}`);
    const init = calls[0]!.init!;
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'same-origin');
    assert.deepEqual(init.headers, {'Content-Type': 'application/json', 'X-CSRF-Token': protocol === 'https:' ? 'secure-proof' : 'local-proof'});
    assert.deepEqual(JSON.parse(String(init.body)), body);
  });
}

const cookieCases = [
  {name: 'missing', cookie: '', https: '', http: ''},
  {name: 'wrong protocol only', cookie: '__Host-cloud_csrf=secure-proof', https: 'secure-proof', http: ''},
  {name: 'local only', cookie: 'cloud_csrf=local-proof', https: '', http: 'local-proof'},
  {name: 'duplicate secure', cookie: '__Host-cloud_csrf=first; __Host-cloud_csrf=second; cloud_csrf=local-proof', https: '', http: 'local-proof'},
  {name: 'duplicate local', cookie: 'cloud_csrf=first; cloud_csrf=second; __Host-cloud_csrf=secure-proof', https: 'secure-proof', http: ''},
  {name: 'identical duplicates', cookie: '__Host-cloud_csrf=same; __Host-cloud_csrf=same; cloud_csrf=same; cloud_csrf=same', https: '', http: ''},
  {name: 'prefix and unrelated names', cookie: '__Host-cloud_csrf_extra=wrong; cloud_csrf_extra=wrong; other=__Host-cloud_csrf=wrong', https: '', http: ''},
  {name: 'whitespace and opaque value', cookie: 'unrelated=x;  __Host-cloud_csrf=secure%2Bproof== ; cloud_csrf=local%2Bproof==', https: 'secure%2Bproof==', http: 'local%2Bproof=='},
];
for (const protocol of ['https:', 'http:']) for (const entry of cookieCases) {
  test(`${protocol} cookie selection handles ${entry.name}`, async t => {
    browser(t, protocol, entry.cookie);
    let headers: HeadersInit | undefined;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      headers = init?.headers;
      return new Response(null, {status: 204});
    });
    assert.deepEqual(await accountRequest('/logout', {}), {ok: true, value: undefined});
    assert.equal(new Headers(headers).get('X-CSRF-Token'), protocol === 'https:' ? entry.https : entry.http);
  });
}

for (const entry of [
  {path: '/session', body: undefined}, {path: '/sessions', body: undefined},
  {path: '/installations', body: undefined}, {path: '/pairing/businesses', body: undefined},
  {path: '/passkeys', body: undefined}, {path: '/authenticator', body: undefined},
  {path: '/alerts', body: undefined}, {path: '/translation-consent', body: undefined},
  {path: '/login', body: {email: 'owner@example.test', password: 'exact password '}},
  {path: '/login/factor', body: {challengeToken: 'challenge', code: '123456'}},
  {path: '/passkeys/authentication/options', body: {}},
  {path: '/passkeys/authentication/verify', body: {ceremonyId: 'ceremony', response: {id: 'credential'}}},
]) {
  test(`unprotected request ${entry.path} does not read or send a management proof`, async t => {
    browser(t, 'https:', '');
    Object.defineProperty(document, 'cookie', {get() { assert.fail('this request must not read management cookies'); }});
    let init: RequestInit | undefined;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
      init = options;
      return Response.json({error: 'unauthenticated'}, {status: 401});
    });
    assert.deepEqual(await accountRequest(entry.path, entry.body), {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 0});
    assert.equal(new Headers(init?.headers).has('X-CSRF-Token'), false);
    assert.equal(init?.method, entry.body ? 'POST' : 'GET');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.body, entry.body ? JSON.stringify(entry.body) : undefined);
  });
}

for (const mode of ['network rejection', 'invalid JSON', 'body rejection', 'private refusal'] as const) {
  test(`request ${mode} has one attempt and returns no private error detail`, async t => {
    browser(t, 'https:', '__Host-cloud_csrf=secure-proof');
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      if (mode === 'network rejection') throw new Error('private credential and internal address');
      if (mode === 'invalid JSON') return new Response('private non-JSON detail');
      if (mode === 'body rejection') {
        const response = new Response('{}');
        Object.defineProperty(response, 'json', {value: async () => {throw new Error('private body detail');}});
        return response;
      }
      return Response.json({error: 'private database detail', token: 'private token'}, {status: 503});
    });
    assert.deepEqual(await accountRequest('/sessions/revoke', {id: 'other-session'}), {
      ok: false, status: mode === 'network rejection' ? 0 : 503,
      code: mode === 'network rejection' ? 'network_error' : 'unexpected_response', retryAfterMs: 0,
    });
    assert.equal(calls, 1, 'transport and parsing failures must not repeat a write');
  });
}

for (const boundary of ['headers', 'body'] as const) {
  test(`request expires while waiting for ${boundary}, without repeating its write`, {timeout: 20_000}, async t => {
    browser(t, 'http:', 'cloud_csrf=local-proof');
    let received = 0;
    const server = createServer((_request, response) => {
      received++;
      if (boundary === 'body') {
        response.writeHead(200, {'Content-Type': 'application/json'});
        response.write('{"sessions":');
      }
    });
    t.after(async () => {
      const closed = once(server, 'close');
      server.close(); server.closeAllConnections();
      await closed;
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const fetch = globalThis.fetch;
    let signal: AbortSignal | null | undefined;
    t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
      signal = init.signal;
      assert.ok(signal instanceof AbortSignal, 'the real network request must receive the deadline signal');
      return fetch(new URL(url, `http://127.0.0.1:${address.port}`), init);
    });
    assert.deepEqual(await accountRequest('/sessions/revoke', {id: 'other-session'}), {
      ok: false, status: boundary === 'headers' ? 0 : 503,
      code: boundary === 'headers' ? 'network_error' : 'unexpected_response', retryAfterMs: 0,
    });
    assert.equal(received, 1);
    assert.equal(signal?.aborted, true, 'the request deadline must also cover reading its body');
  });
}
