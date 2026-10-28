import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {PortalSession, type SessionState} from '../src/session.ts';

const now = Date.parse('2030-01-01T12:00:00Z');
const expiresAt = '2030-01-01T12:30:00Z';
type Reply = {status: number; body: unknown; retry?: string} | 'network';
const authenticated: Reply = {status: 200, body: {accountId: 'current-owner', expiresAt}};
const unavailable: Reply = {status: 503, body: {error: 'temporarily_unavailable'}, retry: '30'};
const expired: Reply = {status: 401, body: {error: 'session_expired'}};
const oldReplies: Array<[string, Reply]> = [
  ['authenticated', {status: 200, body: {accountId: 'former-owner', expiresAt}}],
  ['expired', expired],
  ['limited', {status: 429, body: {error: 'rate_limited'}, retry: '90'}],
  ['unavailable', unavailable],
  ['network failure', 'network'],
];

function fixture(t: TestContext) {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now});
  const document = Object.assign(new EventTarget(), {visibilityState: 'visible'});
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable: true, value: document});
  const added = t.mock.method(document, 'addEventListener');
  const removed = t.mock.method(document, 'removeEventListener');
  const requests: Array<{url: string; finish(reply: Reply): void}> = [];
  t.mock.method(globalThis, 'fetch', (input: string | URL | Request) => new Promise<Response>((resolve, reject) => {
    requests.push({url: String(input), finish(reply) {
      if (reply === 'network') { reject(new TypeError('Connection lost')); return; }
      resolve(new Response(JSON.stringify(reply.body), {
        status: reply.status, headers: reply.retry ? {'Retry-After': reply.retry} : {},
      }));
    }});
  }));
  const changes: SessionState[] = [];
  const session = new PortalSession(state => {changes.push(structuredClone(state));});
  t.after(() => {
    session.dispose();
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  return {session, requests, changes, document, added, removed};
}

for (const [currentLabel, currentReply, state, retryAt] of [
  ['authenticated', authenticated, {kind: 'authenticated', accountId: 'current-owner', expiresAt}, 0],
  ['unavailable', unavailable, {kind: 'unavailable'}, now + 30_000],
] as const) for (const [oldLabel, oldReply] of oldReplies) {
  test(`an older ${oldLabel} session reply cannot replace the newer ${currentLabel} result`, async t => {
    const {session, requests, changes} = fixture(t);
    const old = session.check();
    const current = session.check({fresh: true});
    assert.deepEqual(requests.map(request => request.url), ['/api/account/session', '/api/account/session']);
    requests[1]!.finish(currentReply);
    await current;
    assert.deepEqual(session.state, state);
    assert.equal(session.retryAt, retryAt);
    assert.deepEqual(changes, [state]);

    requests[0]!.finish(oldReply);
    await old;
    assert.deepEqual(session.state, state, 'late replies must retain the newer accepted state');
    assert.equal(session.retryAt, retryAt, 'late replies must retain the current retry wait');
    assert.deepEqual(changes, [state], 'discarded replies must not notify the app');
  });
}

test('an accepted expiry refuses an older authenticated reply and a later explicit check can sign in', async t => {
  const {session, requests, changes} = fixture(t);
  const old = session.check();
  const current = session.check({fresh: true});
  requests[1]!.finish(expired);
  await current;
  requests[0]!.finish({status: 200, body: {accountId: 'former-owner', expiresAt}});
  await old;
  assert.deepEqual(session.state, {kind: 'anonymous', expired: true});
  assert.deepEqual(changes, [{kind: 'anonymous', expired: true}]);
  const next = session.check();
  requests[2]!.finish(authenticated);
  await next;
  assert.deepEqual(session.state, {kind: 'authenticated', accountId: 'current-owner', expiresAt});
  assert.equal(session.retryAt, 0);
  assert.equal(changes.length, 2);
});

test('completing an older check cannot release the newer pending check that ordinary callers share', async t => {
  const {session, requests, changes} = fixture(t);
  const old = session.check();
  assert.equal(session.check(), old, 'ordinary checks share the pending read');
  const current = session.check({fresh: true});
  assert.notEqual(current, old);
  requests[0]!.finish({status: 200, body: {accountId: 'former-owner', expiresAt}});
  await old;
  assert.deepEqual(session.state, {kind: 'authenticated', accountId: 'former-owner', expiresAt},
    'an earlier result may apply before any newer result is accepted');
  const shared = session.check();
  assert.equal(shared, current, 'the older completion must not release the newer pending read');
  assert.equal(requests.length, 2);
  requests[1]!.finish(authenticated);
  await shared;
  assert.deepEqual(changes, [
    {kind: 'authenticated', accountId: 'former-owner', expiresAt},
    {kind: 'authenticated', accountId: 'current-owner', expiresAt},
  ]);
  const next = session.check();
  assert.equal(requests.length, 3, 'completion permits another real read');
  requests[2]!.finish(authenticated);
  await next;
});

for (const [label, reply] of oldReplies) {
  test(`disposing a session drops a late ${label} reply and removes visibility observation`, async t => {
    const {session, requests, changes, document, added, removed} = fixture(t);
    const pending = session.check();
    session.dispose();
    requests[0]!.finish(reply);
    await pending;
    assert.deepEqual(session.state, {kind: 'checking'});
    assert.equal(session.retryAt, 0);
    assert.deepEqual(changes, []);
    assert.equal(removed.mock.calls.length, 1);
    assert.deepEqual(removed.mock.calls[0]!.arguments, added.mock.calls[0]!.arguments);
    document.dispatchEvent(new Event('visibilitychange'));
    const fresh = session.check({fresh: true});
    assert.equal(requests.length, 1, 'a disposed instance must refuse a fresh check');
    await fresh;
    t.mock.timers.tick(3_600_000);
    assert.equal(requests.length, 1, 'a disposed instance sends no new session requests');
  });
}

test('disposing an authenticated session cancels its scheduled expiry read', async t => {
  const {session, requests, changes} = fixture(t);
  const checks = t.mock.method(session, 'check');
  const checking = session.check();
  requests[0]!.finish(authenticated);
  await checking;
  session.dispose();
  t.mock.timers.tick(3_600_000);
  assert.equal(checks.mock.calls.length, 1, 'the discarded expiry timer must not call the session again');
  assert.equal(requests.length, 1);
  assert.deepEqual(changes, [{kind: 'authenticated', accountId: 'current-owner', expiresAt}]);
});

test('a current session rechecks at expiry and on visibility without renewing through activity', async t => {
  const {session, requests, changes, document} = fixture(t);
  const initial = session.check();
  requests[0]!.finish(authenticated);
  await initial;
  t.mock.timers.tick(30 * 60_000);
  assert.deepEqual(requests.map(request => request.url), ['/api/account/session', '/api/account/session']);
  requests[1]!.finish(expired);
  await session.check();
  assert.deepEqual(session.state, {kind: 'anonymous', expired: true});
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(requests.length, 3);
  requests[2]!.finish({status: 200, body: {accountId: 'current-owner', expiresAt: '2030-01-01T13:00:00Z'}});
  await session.check();
  assert.deepEqual(changes, [
    {kind: 'authenticated', accountId: 'current-owner', expiresAt},
    {kind: 'anonymous', expired: true},
    {kind: 'authenticated', accountId: 'current-owner', expiresAt: '2030-01-01T13:00:00Z'},
  ]);
});
