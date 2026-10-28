import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {PortalSession, type SessionState} from '../src/session.ts';

const now = Date.parse('2030-01-01T12:00:00Z');
const expiresAt = '2030-01-01T12:30:00Z';
const owner = {accountId: 'current-owner', expiresAt};
type Reply = {status?: number; body?: unknown; raw?: string; retry?: string} | 'network';
const activity = {isTrusted: true, type: 'keydown'} as Event;

function fixture(t: TestContext) {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now});
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible', cookie: '__Host-cloud_csrf=session-proof',
  });
  const location = {protocol: 'https:'};
  const restore: Array<() => void> = [];
  for (const [name, value] of [['document', document], ['location', location]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    restore.push(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const replies: Reply[] = [];
  const requests: Array<{url: string; init: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.ok(init);
    requests.push({url: String(url), init});
    assert.ok(replies.length, 'every request needs an explicit HTTP outcome');
    const reply = replies.shift()!;
    if (reply === 'network') throw new TypeError('Connection lost');
    return new Response(reply.status === 204 ? null : reply.raw ?? JSON.stringify(reply.body), {
      status: reply.status ?? 200, headers: reply.retry ? {'Retry-After': reply.retry} : {},
    });
  });
  const changes: SessionState[] = [];
  const session = new PortalSession(state => changes.push(structuredClone(state)));
  t.after(() => {session.dispose(); for (const reset of restore) reset();});
  return {session, replies, requests, changes, document, location};
}

const malformed: Array<[string, Reply]> = [
  ['null', {body: null}],
  ['array', {body: []}],
  ['empty account', {body: {...owner, accountId: ''}}],
  ['numeric account', {body: {...owner, accountId: 42}}],
  ['missing account', {body: {expiresAt}}],
  ['missing expiry', {body: {accountId: owner.accountId}}],
  ['invalid expiry', {body: {...owner, expiresAt: 'later'}}],
  ['numeric expiry', {body: {...owner, expiresAt: now + 1_800_000}}],
  ['invalid JSON', {raw: '{unfinished'}],
  ['empty body', {raw: ''}],
  ['empty 204', {status: 204}],
];

for (const [label, reply] of malformed) for (const boundary of ['passive', 'activity'] as const) {
  test(`session ${boundary} HTTP rejects ${label} and can recover on a later read`, async t => {
    const {session, replies, requests, changes} = fixture(t);
    if (boundary === 'activity') {
      replies.push({body: owner});
      await session.check();
      assert.deepEqual(session.state, {kind: 'authenticated', ...owner});
    }
    replies.push(reply);
    if (boundary === 'activity') await session.activity(activity);
    else await session.check();
    assert.deepEqual(session.state, {kind: 'unavailable'});
    assert.equal(session.retryAt, now);
    assert.deepEqual(changes.at(-1), {kind: 'unavailable'});
    assert.equal(requests.at(-1)!.url, '/api/account/session' + (boundary === 'activity' ? '/activity' : ''));
    replies.push({body: owner});
    await session.check();
    assert.deepEqual(session.state, {kind: 'authenticated', ...owner});
    assert.deepEqual(changes.at(-1), {kind: 'authenticated', ...owner});
    assert.equal(replies.length, 0);
  });
}

for (const boundary of ['passive', 'activity'] as const) {
  for (const [label, retry, wait] of [
    ['seconds', '30', 30_000],
    ['HTTP date', 'Tue, 01 Jan 2030 12:00:30 GMT', 30_000],
  ] as const) test(`session ${boundary} HTTP respects a ${label} retry wait before another read`, async t => {
    const {session, replies, requests, document} = fixture(t);
    replies.push({body: owner});
    await session.check();
    replies.push({status: 429, body: {error: 'rate_limited'}, retry});
    if (boundary === 'activity') await session.activity(activity);
    else await session.check();
    assert.deepEqual(session.state, {kind: 'unavailable'});
    assert.equal(session.retryAt, now + wait);
    await session.check({fresh: true});
    document.dispatchEvent(new Event('visibilitychange'));
    await session.activity(activity);
    assert.equal(requests.length, 2, 'explicit and visibility reads must respect the server wait');
    t.mock.timers.tick(wait - 1);
    await session.check();
    assert.equal(requests.length, 2);
    t.mock.timers.tick(1);
    replies.push({body: owner});
    await session.check();
    assert.deepEqual(session.state, {kind: 'authenticated', ...owner});
    assert.equal(session.retryAt, 0);
    assert.equal(requests.length, 3);
  });

  for (const code of ['session_expired', 'unauthenticated', 'private-server-detail']) {
    test(`session ${boundary} HTTP 401 ${code} ends authentication with only the recognised expiry flag`, async t => {
      const {session, replies, changes} = fixture(t);
      replies.push({body: owner});
      await session.check();
      replies.push({status: 401, body: {error: code}});
      if (boundary === 'activity') await session.activity(activity);
      else await session.check();
      const expected = code === 'session_expired' ? {kind: 'anonymous', expired: true} : {kind: 'anonymous'};
      assert.deepEqual(session.state, expected);
      assert.deepEqual(changes.at(-1), expected);
      assert.equal(JSON.stringify(session.state).includes('private-server-detail'), false);
    });
  }
}

for (const [label, reply] of [
  ['network failure', 'network'],
  ['JSON success instead of acknowledgement', {body: {status: 'completed'}}],
  ['session-shaped success', {body: owner}],
  ['empty 200', {raw: ''}],
  ['invalid JSON', {raw: '{unfinished'}],
  ['permission refusal', {status: 403, body: {error: 'forbidden'}}],
  ['server refusal with retry', {status: 503, body: {error: 'temporarily_unavailable'}, retry: '30'}],
] satisfies Array<[string, Reply]>) {
  test(`logout HTTP ${label} cannot claim the account signed out`, async t => {
    const {session, replies, requests, changes} = fixture(t);
    replies.push({body: owner});
    await session.check();
    replies.push({body: owner}, reply);
    assert.equal(await session.logout(), false);
    assert.deepEqual(session.state, {kind: 'authenticated', ...owner});
    assert.equal(changes.some(state => state.kind === 'anonymous'), false);
    assert.equal(session.retryAt, label === 'server refusal with retry' ? now + 30_000 : now);
    assert.deepEqual(requests.map(request => request.url), [
      '/api/account/session', '/api/account/session', '/api/account/logout',
    ], 'an uncertain write must not be replayed');
    t.mock.timers.tick(label === 'server refusal with retry' ? 30_000 : 0);
    replies.push({body: owner}, {status: 204});
    assert.equal(await session.logout(), true);
    assert.deepEqual(session.state, {kind: 'anonymous'});
    assert.equal(requests.length, 5);
  });
}

test('an unavailable session preflight refuses logout before any cookie-changing request', async t => {
  const {session, replies, requests, changes} = fixture(t);
  replies.push({status: 503, body: {error: 'temporarily_unavailable'}, retry: '30'});
  assert.equal(await session.logout(), false);
  assert.deepEqual(session.state, {kind: 'unavailable'});
  assert.equal(session.retryAt, now + 30_000);
  assert.deepEqual(changes, [{kind: 'unavailable'}]);
  assert.deepEqual(requests.map(request => request.url), ['/api/account/session']);
});

for (const [label, protocol, cookie, token] of [
  ['secure cookie', 'https:', 'cloud_csrf=insecure; __Host-cloud_csrf=session-proof', 'session-proof'],
  ['local cookie', 'http:', '__Host-cloud_csrf=secure; cloud_csrf=local-proof', 'local-proof'],
  ['duplicate secure cookie', 'https:', '__Host-cloud_csrf=one; __Host-cloud_csrf=two', ''],
  ['missing secure cookie', 'https:', 'cloud_csrf=insecure', ''],
] as const) test(`session activity and logout HTTP use the ${label} without renewing passive reads`, async t => {
  const {session, replies, requests, document, location} = fixture(t);
  document.cookie = cookie; location.protocol = protocol;
  replies.push({body: owner}, {body: owner}, {body: owner}, {status: 204});
  await session.check();
  await session.activity(activity);
  assert.equal(await session.logout(), true);
  assert.deepEqual(session.state, {kind: 'anonymous'});
  assert.deepEqual(requests.map(request => [request.url, request.init.method]), [
    ['/api/account/session', 'GET'], ['/api/account/session/activity', 'POST'],
    ['/api/account/session', 'GET'], ['/api/account/logout', 'POST'],
  ]);
  for (const {init} of requests) assert.equal(init.credentials, 'same-origin');
  for (const index of [1, 3]) {
    const init = requests[index]!.init;
    assert.equal(init.body, '{}');
    assert.deepEqual(init.headers, {'Content-Type': 'application/json', 'X-CSRF-Token': token});
  }
  assert.deepEqual(requests[0]!.init.headers, {});
  assert.deepEqual(requests[2]!.init.headers, {});
});
