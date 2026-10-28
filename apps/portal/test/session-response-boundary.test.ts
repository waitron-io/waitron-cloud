import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {AccountSecurityController} from '../src/account-security-controller.ts';

const current = {id: '12345678-1234-4234-8234-123456789abc', current: true,
  createdAt: '2026-10-28T08:00:00.000Z', lastUsedAt: '2026-10-28T09:00:00.000Z',
  expiresAt: '2026-10-28T10:00:00.000Z'};
const other = {...current, id: '22345678-1234-4234-8234-123456789abc', current: false};
const invalid = [
  {name: 'null list', value: null},
  {name: 'array envelope', value: []},
  {name: 'missing sessions', value: {}},
  {name: 'object instead of sessions', value: {sessions: {current}}},
  {name: 'empty sessions', value: {sessions: []}},
  {name: 'no current session', value: {sessions: [other]}},
  {name: 'two current sessions', value: {sessions: [current, {...other, current: true}]}},
  {name: 'null session', value: {sessions: [current, null]}},
  {name: 'array session', value: {sessions: [current, []]}},
  {name: 'missing session ID', value: {sessions: [current, {...other, id: undefined}]}},
  {name: 'malformed session ID', value: {sessions: [current, {...other, id: 'not-a-session'}]}},
  {name: 'invalid UUID variant', value: {sessions: [current, {...other, id: '22345678-1234-4234-1234-123456789abc'}]}},
  {name: 'invalid UUID version', value: {sessions: [current, {...other, id: '22345678-1234-0234-8234-123456789abc'}]}},
  {name: 'string current flag', value: {sessions: [current, {...other, current: 'false'}]}},
  {name: 'invalid creation date', value: {sessions: [current, {...other, createdAt: 'yesterday'}]}},
  {name: 'missing last-use date', value: {sessions: [current, {...other, lastUsedAt: undefined}]}},
  {name: 'numeric expiry date', value: {sessions: [current, {...other, expiresAt: 1}]}},
];

function browser(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=session-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

for (const entry of invalid) {
  test(`session HTTP list rejects ${entry.name} before it becomes a revocation target`, async t => {
    let value: unknown = entry.value;
    const paths: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      paths.push(url);
      return Response.json(value);
    });
    const ended: unknown[] = [];
    const controller = new AccountSecurityController(() => {}, reason => ended.push(reason), accountRequest);
    controller.account('owner');
    await controller.load();
    assert.deepEqual(controller.sessions, [], 'malformed HTTP sessions must never become selectable rows');
    assert.equal(controller.loaded, false);
    assert.equal(controller.loadAttempted, true);
    assert.equal(controller.pending, false);
    assert.equal(controller.error, 'unavailable');
    assert.equal(controller.notice, undefined);
    assert.equal(controller.waiting, 0);
    await controller.revoke(other.id);
    assert.deepEqual(paths, ['/api/account/sessions'], 'a rejected list provides no revocation target');
    value = {sessions: [other, current]};
    await controller.load();
    assert.deepEqual(controller.sessions, [other, current]);
    assert.equal(controller.loaded, true);
    assert.equal(controller.pending, false);
    assert.equal(controller.error, undefined);
    assert.equal(controller.notice, undefined);
    assert.deepEqual(ended, []);
    assert.deepEqual(paths, ['/api/account/sessions', '/api/account/sessions']);
  });
}

for (const outcome of ['accepted', 'lost'] as const) {
  for (const entry of invalid) {
    test(`${outcome} revocation with ${entry.name} reconciliation stays uncertain until a read-only retry`, async t => {
      browser(t);
      let list: unknown = {sessions: [other, current]};
      const calls: Array<{url: unknown; init: RequestInit | undefined}> = [];
      t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
        calls.push({url, init});
        if (url === '/api/account/sessions') return Response.json(list);
        assert.equal(url, '/api/account/sessions/revoke');
        if (outcome === 'lost') throw new TypeError('lost fixture reply');
        return new Response(null, {status: 204});
      });
      const ended: unknown[] = [];
      const controller = new AccountSecurityController(() => {}, reason => ended.push(reason), accountRequest);
      controller.account('owner');
      await controller.load();
      assert.deepEqual(controller.sessions, [other, current]);
      list = entry.value;
      await controller.revoke(other.id);
      assert.equal(controller.notice, undefined, 'an invalid list cannot prove the selected session disappeared');
      assert.equal(controller.error, 'sessionRevokeUncertain');
      assert.deepEqual(controller.sessions, []);
      assert.equal(controller.loaded, false);
      assert.equal(controller.pending, false);
      assert.equal(controller.waiting, 0);
      list = {sessions: [current]};
      await controller.load();
      assert.deepEqual(controller.sessions, [current]);
      assert.equal(controller.loaded, true);
      assert.equal(controller.pending, false);
      assert.equal(controller.error, undefined);
      assert.equal(controller.notice, undefined);
      assert.deepEqual(ended, []);
      assert.deepEqual(calls.map(call => call.url), ['/api/account/sessions', '/api/account/sessions/revoke',
        '/api/account/sessions', '/api/account/sessions']);
      const write = calls[1]!.init!;
      assert.equal(write.method, 'POST');
      assert.deepEqual(JSON.parse(String(write.body)), {id: other.id});
      assert.equal(new Headers(write.headers).get('X-CSRF-Token'), 'session-proof');
      for (const [index, {init}] of calls.entries()) {
        assert.equal(init?.credentials, 'same-origin');
        if (index !== 1) {
          assert.equal(init?.method, 'GET');
          assert.equal(init.body, undefined);
          assert.equal(new Headers(init.headers).has('X-CSRF-Token'), false);
        }
      }
    });
  }
}

for (const outcome of ['accepted', 'lost'] as const) {
  test(`${outcome} revocation confirms removal only after a valid passive list excludes its target`, async t => {
    browser(t);
    let list = {sessions: [other, current]};
    const paths: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      paths.push(url);
      if (url === '/api/account/sessions') return Response.json(list);
      list = {sessions: [current]};
      if (outcome === 'lost') throw new TypeError('lost fixture reply');
      return new Response(null, {status: 204});
    });
    const controller = new AccountSecurityController(() => {}, () => assert.fail('another session was revoked'), accountRequest);
    controller.account('owner');
    await controller.load();
    await controller.revoke(other.id);
    assert.deepEqual(controller.sessions, [current]);
    assert.equal(controller.notice, 'sessionRevoked');
    assert.equal(controller.error, undefined);
    assert.equal(controller.loaded, true);
    assert.equal(controller.pending, false);
    assert.deepEqual(paths, ['/api/account/sessions', '/api/account/sessions/revoke', '/api/account/sessions']);
  });
}

test('HTTP session lists retain more than 100 sessions and find the current one beyond the first page', async t => {
  const sessions = Array.from({length: 101}, (_, i) => ({...other,
    id: `${String(i + 1).padStart(8, '0')}-1234-4234-8234-123456789abc`}));
  sessions.push(current);
  t.mock.method(globalThis, 'fetch', async () => Response.json({sessions}));
  const controller = new AccountSecurityController(() => {}, () => assert.fail('valid account'), accountRequest);
  controller.account('owner');
  await controller.load();
  assert.deepEqual(controller.sessions, sessions);
  assert.equal(controller.sessions.length, 102);
  assert.equal(controller.sessions[101]!.current, true);
  assert.equal(controller.loaded, true);
  assert.equal(controller.error, undefined);
});

for (const outcome of ['accepted', 'lost'] as const) {
  test(`${outcome} revocation cannot confirm removal while a valid list still contains its target`, async t => {
    browser(t);
    const paths: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      paths.push(url);
      if (url === '/api/account/sessions') return Response.json({sessions: [other, current]});
      if (outcome === 'lost') throw new TypeError('lost fixture reply');
      return new Response(null, {status: 204});
    });
    const controller = new AccountSecurityController(() => {}, () => assert.fail('valid account'), accountRequest);
    controller.account('owner');
    await controller.load();
    await controller.revoke(other.id);
    assert.deepEqual(controller.sessions, [other, current]);
    assert.equal(controller.notice, undefined, 'a selected session still listed must never be confirmed as removed');
    assert.equal(controller.error, 'sessionRevokeUncertain');
    assert.equal(controller.loaded, true);
    assert.equal(controller.pending, false);
    assert.deepEqual(paths, ['/api/account/sessions', '/api/account/sessions/revoke', '/api/account/sessions']);
  });
}
