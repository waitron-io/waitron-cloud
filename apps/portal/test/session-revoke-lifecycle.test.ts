import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {AccountSecurityController} from '../src/account-security-controller.ts';

const now = Date.parse('2030-01-01T12:00:00Z');
const source = {id: '12345678-1234-4234-8234-123456789abc', current: true,
  createdAt: '2030-01-01T10:00:00Z', lastUsedAt: '2030-01-01T11:00:00Z', expiresAt: '2030-01-01T13:00:00Z'};
const newer = {...source, id: '22345678-1234-4234-8234-123456789abc'};
const stale = {...source, id: '32345678-1234-4234-8234-123456789abc'};
type Outcome = 'accepted' | 'lost' | 'unreadable' | 'expired' | 'forbidden' | 'limited' | 'unavailable';
type Boundary = 'headers' | 'body';
type Phase = 'revocation' | 'reconciliation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {resolve = finish;});
  return {promise, resolve};
}

function reply(phase: Phase, outcome: Outcome): Response {
  if (outcome === 'accepted') return phase === 'revocation'
    ? new Response(null, {status: 204}) : Response.json({sessions: [stale]});
  if (outcome === 'unreadable') return new Response('{unfinished');
  const status = {lost: 503, expired: 401, forbidden: 403, limited: 429, unavailable: 503}[outcome];
  const error = {lost: 'temporarily_unavailable', expired: 'unauthenticated', forbidden: 'forbidden',
    limited: 'rate_limited', unavailable: 'temporarily_unavailable'}[outcome];
  return Response.json({error}, {status, headers: {'Retry-After': '30'}});
}

function held(t: TestContext, phase: Phase, outcome: Outcome, boundary: Boundary) {
  const reached = deferred<void>();
  const release = deferred<void>();
  const response = reply(phase, outcome);
  const json = response.json.bind(response);
  let bodyReads = 0;
  if (boundary === 'body') t.mock.method(response, 'json', async () => {
    bodyReads++;
    reached.resolve();
    await release.promise;
    return json();
  });
  return {reached: reached.promise, release: () => release.resolve(), bodyReads: () => bodyReads,
    send: async () => {
      if (boundary === 'headers') {
        reached.resolve();
        await release.promise;
      }
      if (outcome === 'lost') throw new TypeError('lost revocation response');
      return response;
    }};
}

function fixture(t: TestContext) {
  t.mock.timers.enable({apis: ['Date'], now});
  for (const [key, value] of [['location', {protocol: 'https:'}],
    ['document', {cookie: '__Host-cloud_csrf=lifecycle-proof'}]] as const) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable: true, value});
    t.after(() => {
      if (before) Object.defineProperty(globalThis, key, before);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const planned: Array<() => Response | Promise<Response>> = [];
  const calls: Array<{url: string; method: string; body: unknown; csrf: string | null; credentials: RequestCredentials | undefined}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.ok(init);
    calls.push({url: String(url), method: init.method!, body: init.body ? JSON.parse(String(init.body)) : undefined,
      csrf: new Headers(init.headers).get('X-CSRF-Token'), credentials: init.credentials});
    // An unexpected stale reconciliation must finish so its outbound request can be asserted.
    return planned.shift()?.() ?? Response.json({sessions: [stale]});
  });
  let changes = 0;
  const ended: Array<'signedOut' | undefined> = [];
  const controller = new AccountSecurityController(() => {changes++;}, reason => {ended.push(reason);}, accountRequest);
  controller.account('owner');
  const snapshot = () => ({sessions: structuredClone(controller.sessions), loaded: controller.loaded,
    loadAttempted: controller.loadAttempted, pending: controller.pending, retryAt: controller.retryAt,
    error: controller.error, notice: controller.notice, changes, ended: [...ended], calls: structuredClone(calls)});
  return {controller, planned, calls, ended, snapshot};
}

// Removing either revocation generation check, or the list generation check, admits obsolete replies.
for (const phase of ['revocation', 'reconciliation'] as const) {
  for (const boundary of ['headers', 'body'] as const) {
    for (const outcome of ['accepted', 'lost', 'unreadable', 'expired', 'forbidden', 'limited', 'unavailable'] as const) {
      if (boundary === 'body' && (outcome === 'lost' || phase === 'revocation' && outcome === 'accepted')) continue;
      for (const lifecycle of ['signed-out', 'reset-pending', 'reset-loaded'] as const) {
        test(`${phase} ${outcome} ${boundary} reply cannot affect ${lifecycle} session view`, {timeout: 5_000}, async t => {
          const {controller, planned, calls, ended, snapshot} = fixture(t);
          const old = held(t, phase, outcome, boundary);
          const fresh = held(t, 'reconciliation', 'accepted', 'headers');
          planned.push(() => Response.json({sessions: [source]}));
          await controller.load();
          assert.deepEqual(controller.sessions, [source]);
          if (phase === 'reconciliation') planned.push(() => new Response(null, {status: 204}));
          planned.push(old.send);
          const revoking = controller.revoke(source.id);
          let loading: Promise<void> | undefined;
          try {
            await old.reached;
            assert.equal(old.bodyReads(), boundary === 'body' ? 1 : 0);
            assert.equal(controller.pending, true);
            assert.deepEqual(calls.map(call => [call.url, call.method]), [
              ['/api/account/sessions', 'GET'], ['/api/account/sessions/revoke', 'POST'],
              ...(phase === 'reconciliation' ? [['/api/account/sessions', 'GET']] : []),
            ]);
            if (lifecycle === 'signed-out') controller.account(undefined);
            else controller.fence();
            assert.equal(controller.pending, false);
            assert.equal(controller.loaded, false);
            assert.equal(controller.loadAttempted, false);
            assert.equal(controller.error, undefined);
            assert.equal(controller.notice, undefined);
            assert.deepEqual(controller.sessions, lifecycle === 'signed-out' ? [] : [source]);
            if (lifecycle === 'signed-out') {
              await controller.load();
              await controller.revoke(source.id);
            } else {
              planned.push(async () => {
                await fresh.send();
                return Response.json({sessions: [newer]});
              });
              loading = controller.load();
              await fresh.reached;
              assert.equal(controller.pending, true);
              if (lifecycle === 'reset-loaded') {
                fresh.release();
                await loading;
                assert.deepEqual(controller.sessions, [newer]);
                assert.equal(controller.loaded, true);
              }
            }
            const before = snapshot();
            old.release();
            await revoking;
            assert.deepEqual(snapshot(), before,
              'obsolete completion cannot change rows, pending work, feedback, retry waits, callbacks or requests');
            if (lifecycle === 'reset-pending') {
              await controller.load();
              await controller.revoke(source.id);
              assert.deepEqual(snapshot(), before, 'obsolete completion cannot release the newer read gate');
            }
            fresh.release();
            await loading;
            assert.deepEqual(controller.sessions, lifecycle === 'signed-out' ? [] : [newer]);
            assert.equal(controller.pending, false);
            assert.equal(controller.loaded, lifecycle !== 'signed-out');
            assert.equal(controller.loadAttempted, lifecycle !== 'signed-out');
            assert.equal(controller.retryAt, 0);
            assert.equal(controller.error, undefined);
            assert.equal(controller.notice, undefined);
            assert.deepEqual(ended, []);
            assert.equal(planned.length, 0);
            assert.equal(calls.filter(call => call.method === 'POST').length, 1);
            assert.deepEqual(calls[1], {url: '/api/account/sessions/revoke', method: 'POST', body: {id: source.id},
              csrf: 'lifecycle-proof', credentials: 'same-origin'});
          } finally {
            old.release(); fresh.release();
            await Promise.allSettled([revoking, loading]);
          }
        });
      }
    }
  }
}

// Dropping the pending gate permits duplicate writes; fencing an unchanged account loses its completion.
for (const phase of ['revocation', 'reconciliation'] as const) {
  for (const boundary of ['headers', 'body'] as const) {
    if (phase === 'revocation' && boundary === 'body') continue;
    test(`same-account ${phase} ${boundary} completion stays active and pending actions coalesce`, {timeout: 5_000}, async t => {
      const {controller, planned, calls, ended} = fixture(t);
      const old = held(t, phase, 'accepted', boundary);
      planned.push(() => Response.json({sessions: [source]}));
      await controller.load();
      if (phase === 'reconciliation') planned.push(() => new Response(null, {status: 204}));
      planned.push(old.send);
      if (phase === 'revocation') planned.push(() => Response.json({sessions: [stale]}));
      const revoking = controller.revoke(source.id);
      try {
        await old.reached;
        assert.equal(old.bodyReads(), boundary === 'body' ? 1 : 0);
        const count = calls.length;
        controller.account('owner');
        await controller.revoke(source.id);
        await controller.load();
        assert.equal(calls.length, count);
        assert.equal(controller.pending, true);
        old.release();
        await revoking;
        assert.deepEqual(controller.sessions, [stale]);
        assert.equal(controller.loaded, true);
        assert.equal(controller.pending, false);
        assert.equal(controller.notice, 'sessionRevoked');
        assert.equal(controller.error, undefined);
        assert.equal(controller.retryAt, 0);
        assert.deepEqual(ended, []);
        assert.deepEqual(calls.map(call => [call.url, call.method]), [
          ['/api/account/sessions', 'GET'], ['/api/account/sessions/revoke', 'POST'], ['/api/account/sessions', 'GET'],
        ]);
        assert.equal(planned.length, 0);
      } finally { old.release(); await revoking; }
    });
  }
}
