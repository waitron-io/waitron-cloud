import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {PortalSession, type SessionState} from '../src/session.ts';

const now = Date.parse('2030-01-01T12:00:00Z');
const owner = {accountId: 'current-owner', expiresAt: '2030-01-01T12:30:00Z'};
const activity = {isTrusted: true, type: 'keydown'} as Event;
type Reply = {status: number; body?: unknown; retry?: string} | 'network';
const accepted: Reply = {status: 200, body: owner};
const lateReplies: Array<[string, Reply]> = [
  ['a different account', {status: 200, body: {...owner, accountId: 'former-owner'}}],
  ['expiry', {status: 401, body: {error: 'session_expired'}}],
  ['a retry wait', {status: 429, body: {error: 'rate_limited'}, retry: '90'}],
  ['a lost connection', 'network'],
];

function fixture(t: TestContext) {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now});
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible', cookie: '__Host-cloud_csrf=activity-proof',
  });
  const restore: Array<() => void> = [];
  for (const [key, value] of [['document', document], ['location', {protocol: 'https:'}]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable: true, value});
    restore.push(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const requests: Array<{url: string; init: RequestInit; finished: boolean; finish(reply: Reply): void}> = [];
  const entered = new Map<number, () => void>();
  let answerFurtherRequests = false;
  t.mock.method(globalThis, 'fetch', (url: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    assert.ok(init);
    const request = {url: String(url), init, finished: false, finish(reply: Reply) {
      assert.equal(request.finished, false, 'a held HTTP request completes once');
      request.finished = true;
      if (reply === 'network') {reject(new TypeError('Connection lost')); return;}
      resolve(new Response(reply.status === 204 ? null : JSON.stringify(reply.body), {
        status: reply.status, headers: reply.retry ? {'Retry-After': reply.retry} : {},
      }));
    }};
    requests.push(request);
    entered.get(requests.length - 1)?.();
    if (answerFurtherRequests) request.finish(accepted);
  }));
  const changes: SessionState[] = [];
  const session = new PortalSession(state => changes.push(structuredClone(state)));
  t.after(() => {
    session.dispose();
    for (const reset of restore) reset();
    assert.ok(requests.every(request => request.finished), 'all held HTTP requests must be collected');
  });
  return {session, requests, changes, document,
    answerFurtherRequests() {answerFurtherRequests = true;},
    async signedIn() {
      const pending = session.check(); requests.at(-1)!.finish(accepted); await pending;
      assert.deepEqual(session.state, {kind: 'authenticated', ...owner});
    },
    async requestAt(index: number) {
      if (!requests[index]) await new Promise<void>(resolve => {entered.set(index, resolve);});
      return requests[index]!;
    },
  };
}

// Removing the shared result sequence check lets an older activity/read replace the newer result.
for (const first of ['activity', 'read'] as const) {
  for (const [newLabel, reply, state, retryAt] of [
    ['authenticated', accepted, {kind: 'authenticated', ...owner}, 0],
    ['unavailable', {status: 503, body: {error: 'temporarily_unavailable'}, retry: '30'}, {kind: 'unavailable'}, now + 30_000],
  ] satisfies Array<[string, Reply, SessionState, number]>) {
    for (const [oldLabel, oldReply] of lateReplies) {
      test(`older session ${first} with ${oldLabel} cannot replace a newer ${newLabel} ${first === 'activity' ? 'read' : 'activity'}`, {timeout: 2_000}, async t => {
        const f = fixture(t); await f.signedIn();
        const old = first === 'activity' ? f.session.activity(activity) : f.session.check();
        const current = first === 'activity' ? f.session.check({fresh: true}) : f.session.activity(activity);
        assert.deepEqual(f.requests.slice(1).map(request => request.url), first === 'activity'
          ? ['/api/account/session/activity', '/api/account/session']
          : ['/api/account/session', '/api/account/session/activity']);
        f.requests[2]!.finish(reply); await current;
        assert.deepEqual(f.session.state, state); assert.equal(f.session.retryAt, retryAt);
        const changes = structuredClone(f.changes);
        f.requests[1]!.finish(oldReply); await old;
        assert.deepEqual(f.session.state, state);
        assert.equal(f.session.retryAt, retryAt);
        assert.deepEqual(f.changes, changes, 'a discarded reply must not notify the app');
      });
    }
  }
}

test('an accepted activity expiry fences a newer pending authenticated read and permits a later explicit sign-in check', {timeout: 2_000}, async t => {
  const f = fixture(t); await f.signedIn();
  const renewal = f.session.activity(activity), read = f.session.check();
  f.requests[1]!.finish({status: 401, body: {error: 'session_expired'}}); await renewal;
  f.requests[2]!.finish(accepted); await read;
  assert.deepEqual(f.session.state, {kind: 'anonymous', expired: true});
  assert.deepEqual(f.changes, [{kind: 'authenticated', ...owner}, {kind: 'anonymous', expired: true}]);
  await f.signedIn();
  assert.equal(f.session.retryAt, 0);
  assert.equal(f.requests.length, 4);
});

// The logout generation fence must apply even when its HTTP acknowledgement is lost or refused.
for (const [label, logoutReply, success] of [
  ['acknowledged', {status: 204}, true],
  ['lost', 'network', false],
  ['refused', {status: 503, body: {error: 'temporarily_unavailable'}, retry: '30'}, false],
] satisfies Array<[string, Reply, boolean]>) {
  for (const [oldLabel, oldReply] of [lateReplies[0]!, lateReplies[1]!]) {
    for (const when of ['before', 'after'] as const) {
      test(`${label} logout drops activity carrying ${oldLabel} ${when} its HTTP reply`, {timeout: 2_000}, async t => {
        const f = fixture(t); await f.signedIn();
        const logout = f.session.logout(), renewal = f.session.activity(activity);
        f.requests[1]!.finish(accepted);
        const write = await f.requestAt(3);
        assert.equal(write.url, '/api/account/logout');
        assert.equal(write.init.method, 'POST');
        assert.equal(write.init.body, '{}');
        assert.equal(write.init.credentials, 'same-origin');
        assert.deepEqual(write.init.headers, {'Content-Type': 'application/json', 'X-CSRF-Token': 'activity-proof'});
        if (when === 'before') {
          const changes = structuredClone(f.changes);
          f.requests[2]!.finish(oldReply); await renewal;
          assert.deepEqual(f.session.state, {kind: 'authenticated', ...owner});
          assert.equal(f.session.retryAt, 0);
          assert.deepEqual(f.changes, changes, 'activity cannot change the account while logout is pending');
        }
        write.finish(logoutReply); assert.equal(await logout, success);
        const expected = success ? {kind: 'anonymous'} : {kind: 'authenticated', ...owner};
        assert.deepEqual(f.session.state, expected);
        const changes = structuredClone(f.changes), retryAt = f.session.retryAt;
        assert.equal(retryAt, label === 'refused' ? now + 30_000 : success ? 0 : now);
        if (when === 'after') {f.requests[2]!.finish(oldReply); await renewal;}
        assert.deepEqual(f.session.state, expected);
        assert.equal(f.session.retryAt, retryAt);
        assert.deepEqual(f.changes, changes);
        assert.deepEqual(f.requests.map(request => request.url), [
          '/api/account/session', '/api/account/session', '/api/account/session/activity', '/api/account/logout',
        ], 'a lost or refused sign-out must not replay a write');
      });
    }
  }
}

for (const [label, reply] of lateReplies) {
  test(`disposed session drops delayed activity carrying ${label}`, {timeout: 2_000}, async t => {
    const f = fixture(t); await f.signedIn();
    const pending = f.session.activity(activity);
    const changes = structuredClone(f.changes);
    f.session.dispose();
    f.requests[1]!.finish(reply); await pending;
    assert.deepEqual(f.session.state, {kind: 'authenticated', ...owner});
    assert.equal(f.session.retryAt, 0);
    assert.deepEqual(f.changes, changes);
    f.answerFurtherRequests();
    t.mock.timers.tick(60_000);
    await f.session.activity(activity); await f.session.check({fresh: true});
    assert.equal(f.requests.length, 2);
  });
}
