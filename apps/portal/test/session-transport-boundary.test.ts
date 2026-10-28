import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {AccountSecurityController} from '../src/account-security-controller.ts';

const now = Date.parse('2030-01-01T12:00:00Z');
const current = {id: '12345678-1234-4234-8234-123456789abc', current: true,
  createdAt: '2030-01-01T10:00:00Z', lastUsedAt: '2030-01-01T11:00:00Z', expiresAt: '2030-01-01T13:00:00Z'};
const other = {...current, id: '22345678-1234-4234-8234-123456789abc', current: false};
const full = {sessions: [other, current]};
const remaining = {sessions: [current]};
type Reply = {status?: number; body?: unknown; raw?: string; retry?: string} | 'network';

function fixture(t: TestContext) {
  t.mock.timers.enable({apis: ['Date'], now});
  for (const [key, value] of [['location', {protocol: 'https:'}],
    ['document', {cookie: '__Host-cloud_csrf=session-proof'}]] as const) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable: true, value});
    t.after(() => {
      if (before) Object.defineProperty(globalThis, key, before);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const replies: Reply[] = [];
  const calls: Array<{url: string; init: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.ok(init);
    calls.push({url: String(url), init});
    assert.ok(replies.length, 'every request needs a planned transport outcome');
    const reply = replies.shift()!;
    if (reply === 'network') throw new TypeError('lost fixture response');
    return new Response(reply.status === 204 ? null : reply.raw ?? JSON.stringify(reply.body), {
      status: reply.status ?? 200, headers: reply.retry ? {'Retry-After': reply.retry} : {},
    });
  });
  const ended: Array<'signedOut' | undefined> = [];
  const controller = new AccountSecurityController(() => {}, reason => ended.push(reason), accountRequest);
  controller.account('owner');
  return {controller, replies, calls, ended};
}

// Removing HTTP-success admission would turn a refused list into selectable sessions.
for (const [label, reply, error, termination] of [
  ['permission refusal', {status: 403, body: {error: 'forbidden'}}, 'forbidden', false],
  ['success-shaped refusal', {status: 503, body: full}, 'unavailable', false],
  ['unreadable body', {raw: '{unfinished'}, 'unavailable', false],
  ['lost response', 'network', 'unavailable', false],
  ['expired session', {status: 401, body: {error: 'session_expired'}}, undefined, true],
] satisfies Array<[string, Reply, string | undefined, boolean]>) {
  test(`session list ${label} clears selectable rows and permits an explicit fresh read`, async t => {
    const {controller, replies, calls, ended} = fixture(t);
    replies.push({body: full});
    await controller.load();
    assert.deepEqual(controller.sessions, full.sessions);
    replies.push(reply);
    await controller.load();
    assert.deepEqual(controller.sessions, []);
    assert.equal(controller.loaded, false);
    assert.equal(controller.loadAttempted, true);
    assert.equal(controller.pending, false);
    assert.equal(controller.error, error);
    assert.equal(controller.notice, undefined);
    assert.deepEqual(ended, termination ? [undefined] : []);
    await controller.revoke(other.id);
    assert.equal(calls.length, 2, 'a failed read supplies no revocation target');
    replies.push({body: full});
    await controller.load();
    assert.deepEqual(controller.sessions, full.sessions);
    assert.equal(controller.loaded, true);
    assert.equal(controller.error, undefined);
    assert.equal(replies.length, 0);
    assert.ok(calls.every(call => call.init.method === 'GET' && call.init.body === undefined));
  });
}

// Without reconciliation, a lost/refused write could falsely confirm removal or be replayed.
for (const [label, write] of [
  ['accepted', {status: 204}], ['lost', 'network'],
  ['unreadable', {raw: '{unfinished'}],
  ['refused', {status: 503, body: {error: 'temporarily_unavailable'}}],
] satisfies Array<[string, Reply]>) for (const reconciliation of ['confirmed', 'unreadable', 'lost'] as const) {
  test(`${label} session revocation uses a ${reconciliation} passive reconciliation without write replay`, async t => {
    const {controller, replies, calls, ended} = fixture(t);
    replies.push({body: full});
    await controller.load();
    replies.push(write, reconciliation === 'confirmed' ? {body: remaining}
      : reconciliation === 'lost' ? 'network' : {raw: '{unfinished'});
    await controller.revoke(other.id);
    assert.equal(controller.pending, false);
    assert.equal(controller.notice, reconciliation === 'confirmed' ? 'sessionRevoked' : undefined);
    assert.equal(controller.error, reconciliation === 'confirmed' ? undefined : 'sessionRevokeUncertain');
    assert.equal(controller.loaded, reconciliation === 'confirmed');
    assert.deepEqual(controller.sessions, reconciliation === 'confirmed' ? remaining.sessions : []);
    assert.deepEqual(ended, []);
    assert.deepEqual(calls.map(call => [call.url, call.init.method]), [
      ['/api/account/sessions', 'GET'], ['/api/account/sessions/revoke', 'POST'], ['/api/account/sessions', 'GET'],
    ]);
    assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), {id: other.id});
    assert.equal(new Headers(calls[1]!.init.headers).get('X-CSRF-Token'), 'session-proof');
    replies.push({body: remaining});
    await controller.load();
    assert.equal(controller.notice, undefined, 'a later read does not repeat the removal confirmation');
    assert.equal(controller.error, undefined);
    assert.deepEqual(controller.sessions, remaining.sessions);
    assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
    for (const {init} of calls) {
      assert.equal(init.credentials, 'same-origin');
      if (init.method === 'GET') {
        assert.equal(init.body, undefined);
        assert.equal(new Headers(init.headers).has('X-CSRF-Token'), false);
      }
    }
    assert.equal(replies.length, 0);
  });
}

for (const [label, write, reason] of [
  ['accepted current removal', {status: 204}, 'signedOut'],
  ['lost current removal', 'network', 'signedOut'],
  ['refused current removal', {status: 403, body: {error: 'forbidden'}}, undefined],
] satisfies Array<[string, Reply, 'signedOut' | undefined]>) {
  test(`${label} followed by HTTP 401 reports only the supported termination reason`, async t => {
    const {controller, replies, calls, ended} = fixture(t);
    replies.push({body: full});
    await controller.load();
    replies.push(write, {status: 401, body: {error: 'unauthenticated'}});
    await controller.revoke(current.id);
    assert.deepEqual(ended, [reason]);
    assert.equal(controller.notice, undefined);
    assert.equal(controller.error, undefined);
    assert.equal(controller.pending, false);
    assert.deepEqual(controller.sessions, []);
    assert.equal(calls.length, 3);
    assert.equal(replies.length, 0);
  });
}

// Removing either wait gate, date parsing or deadline retention admits requests before expiry.
for (const boundary of ['list', 'write', 'reconciliation'] as const) {
  for (const status of [429, 503]) for (const [label, retry] of [
    ['seconds', '30'], ['date', 'Tue, 01 Jan 2030 12:00:30 GMT'],
  ] as const) test(`session ${boundary} HTTP ${status} ${label} retry wait survives account changes to exact expiry`, async t => {
    const {controller, replies, calls, ended} = fixture(t);
    replies.push({body: full});
    await controller.load();
    const refusal = {status, body: {error: status === 429 ? 'rate_limited' : 'temporarily_unavailable'}, retry};
    if (boundary === 'list') {
      replies.push(refusal);
      await controller.load();
    } else {
      replies.push(boundary === 'write' ? refusal : {status: 204},
        boundary === 'reconciliation' ? refusal : {body: full});
      await controller.revoke(other.id);
    }
    assert.equal(controller.retryAt, now + 30_000);
    assert.equal(controller.waiting, 30);
    assert.equal(controller.notice, undefined);
    const count = calls.length;
    controller.account(undefined);
    controller.account('different-owner');
    // A retained target makes the deadline, rather than a missing row, block a write.
    controller.sessions = full.sessions;
    for (const elapsed of [0, 29_999]) {
      t.mock.timers.setTime(now + elapsed);
      await controller.load();
      await controller.revoke(other.id);
      assert.equal(calls.length, count);
    }
    assert.equal(controller.waiting, 1);
    t.mock.timers.setTime(now + 30_000);
    assert.equal(controller.waiting, 0);
    replies.push({body: full}, {status: 204}, {body: remaining});
    await controller.load();
    await controller.revoke(other.id);
    assert.equal(calls.length, count + 3);
    assert.equal(controller.notice, 'sessionRevoked');
    assert.equal(controller.error, undefined);
    assert.deepEqual(controller.sessions, remaining.sessions);
    assert.deepEqual(ended, []);
    assert.equal(replies.length, 0);
  });
}

test('a shorter reconciliation wait cannot replace the revocation HTTP deadline', async t => {
  const {controller, replies, calls} = fixture(t);
  replies.push({body: full});
  await controller.load();
  replies.push({status: 503, body: {error: 'temporarily_unavailable'}, retry: '60'},
    {status: 503, body: {error: 'temporarily_unavailable'}, retry: '1'});
  await controller.revoke(other.id);
  assert.equal(controller.waiting, 60);
  assert.equal(controller.retryAt, now + 60_000);
  t.mock.timers.setTime(now + 1_000);
  replies.push({body: full});
  await controller.load();
  assert.equal(calls.length, 3);
  t.mock.timers.setTime(now + 60_000);
  await controller.load();
  assert.equal(calls.length, 4);
  assert.deepEqual(controller.sessions, full.sessions);
  assert.equal(replies.length, 0);
});
