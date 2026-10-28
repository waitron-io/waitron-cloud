import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AccountSecurityController} from '../src/account-security-controller.ts';
import type {AccountSessionSummary} from '../src/account-security-types.ts';
import type {ApiResult} from '../src/api.ts';

const earlier: AccountSessionSummary = {
  id: '12345678-1234-4234-8234-123456789abc', createdAt: '2026-09-26T00:00:00Z',
  lastUsedAt: '2026-09-26T00:20:00Z', expiresAt: '2099-01-01T00:00:00Z', current: true,
};
const current: AccountSessionSummary = {...earlier, id: '22345678-1234-4234-8234-123456789abc'};
type List = ApiResult<{sessions: AccountSessionSummary[]}>;
const outcomes: Record<string, List> = {
  success: {ok: true, value: {sessions: [earlier]}},
  network: {ok: false, status: 0, code: 'network_error', retryAfterMs: 7_000},
  unauthenticated: {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 11_000},
  forbidden: {ok: false, status: 403, code: 'forbidden', retryAfterMs: 13_000},
  limited: {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 17_000},
  unavailable: {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 19_000},
};
const now = Date.parse('2026-10-28T00:00:00Z');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {resolve = finish;});
  return {promise, resolve};
}

// Removing either reply guard lets an obsolete list change current state or end sign-in.
for (const transition of ['different account', 'returning account', 'refresh', 'sign-out'] as const) {
  for (const newer of ['pending', 'loaded'] as const) {
    if (transition === 'sign-out' && newer === 'loaded') continue;
    for (const [name, reply] of Object.entries(outcomes)) {
      test(`old initial session list ${name} cannot affect ${transition} with ${newer} view`, {timeout: 5_000}, async t => {
        t.mock.timers.enable({apis: ['Date'], now});
        const oldReply = deferred<List>();
        const newReply = deferred<List>();
        const calls: Array<{path: string; body: unknown}> = [];
        const ended: Array<'signedOut' | undefined> = [];
        let changes = 0;
        const replies = [oldReply.promise, newReply.promise];
        const controller = new AccountSecurityController(() => {changes++;}, reason => {ended.push(reason);},
          async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
            calls.push({path, body});
            const next = replies.shift();
            assert.ok(next, 'no extra request may follow an obsolete reply');
            return await next as ApiResult<T>;
          });
        controller.account('owner');
        const oldLoading = controller.load();
        assert.equal(controller.pending, true);
        if (transition === 'refresh') controller.fence();
        else controller.account(transition === 'sign-out' ? undefined : 'different');
        if (transition === 'returning account') controller.account('owner');
        assert.equal(controller.pending, false);
        assert.equal(controller.loaded, false);
        assert.equal(controller.loadAttempted, false);
        assert.deepEqual(controller.sessions, []);
        const loading = controller.load();
        const currentReply: List = {ok: true, value: {sessions: [current]}};
        try {
          if (newer === 'loaded') {
            newReply.resolve(currentReply);
            await loading;
            assert.deepEqual(controller.sessions, [current]);
            assert.equal(controller.loaded, true);
          }
          assert.equal(controller.pending, transition !== 'sign-out' && newer === 'pending');
          const snapshot = () => ({
            sessions: structuredClone(controller.sessions), pending: controller.pending,
            loaded: controller.loaded, loadAttempted: controller.loadAttempted,
            retryAt: controller.retryAt, error: controller.error, notice: controller.notice,
            changes, ended: [...ended], calls: structuredClone(calls),
          });
          const before = snapshot();
          oldReply.resolve(reply);
          await oldLoading;
          assert.deepEqual(snapshot(), before, 'obsolete list must leave current state and callbacks untouched');
          newReply.resolve(currentReply);
          await loading;
          assert.deepEqual(controller.sessions, transition === 'sign-out' ? [] : [current]);
          assert.equal(controller.loaded, transition !== 'sign-out');
          assert.equal(controller.loadAttempted, transition !== 'sign-out');
          assert.equal(controller.pending, false);
          assert.equal(controller.retryAt, 0);
          assert.equal(controller.error, undefined);
          assert.equal(controller.notice, undefined);
          assert.deepEqual(ended, []);
          assert.equal(changes, before.changes + (transition !== 'sign-out' && newer === 'pending' ? 1 : 0));
          assert.deepEqual(calls, Array.from({length: transition === 'sign-out' ? 1 : 2}, () => ({path: '/sessions', body: undefined})));
        } finally {
          oldReply.resolve(reply);
          newReply.resolve(currentReply);
          await Promise.all([oldLoading, loading]);
        }
      });
    }
  }
}

test('selecting the same account keeps its pending list and coalesces another load', {timeout: 5_000}, async () => {
  const reply = deferred<List>();
  let calls = 0;
  const controller = new AccountSecurityController(() => {}, () => {}, async <T>(): Promise<ApiResult<T>> => {
    calls++;
    return await reply.promise as ApiResult<T>;
  });
  controller.account('owner');
  const loading = controller.load();
  controller.account('owner');
  const duplicate = controller.load();
  try {
    assert.equal(calls, 1);
    assert.equal(controller.pending, true);
  } finally {
    reply.resolve({ok: true, value: {sessions: [current]}});
    await Promise.all([loading, duplicate]);
  }
  assert.deepEqual(controller.sessions, [current]);
  assert.equal(controller.pending, false);
  assert.equal(controller.loaded, true);
});

for (const [name, reply] of Object.entries(outcomes)) {
  test(`a current initial session list still handles ${name}`, async t => {
    t.mock.timers.enable({apis: ['Date'], now});
    let calls = 0;
    const ended: Array<'signedOut' | undefined> = [];
    const controller = new AccountSecurityController(() => {}, reason => {ended.push(reason);},
      async <T>(): Promise<ApiResult<T>> => {
        calls++;
        return (calls === 1 ? reply : {ok: true, value: {sessions: [current]}}) as ApiResult<T>;
      });
    controller.account('owner');
    await controller.load();
    assert.equal(controller.loaded, reply.ok);
    assert.deepEqual(controller.sessions, reply.ok ? [earlier] : []);
    assert.equal(controller.pending, false);
    assert.equal(controller.loadAttempted, true);
    assert.equal(controller.notice, undefined);
    if (reply.ok) {
      assert.equal(controller.error, undefined);
      assert.equal(controller.retryAt, 0);
      assert.deepEqual(ended, []);
    } else {
      assert.equal(controller.retryAt, now + reply.retryAfterMs);
      assert.equal(controller.error, ({401: undefined, 403: 'forbidden', 429: 'limited'} as Record<number, string | undefined>)[reply.status]
        ?? (reply.status === 401 ? undefined : 'unavailable'));
      assert.deepEqual(ended, reply.status === 401 ? [undefined] : []);
      await controller.load();
      assert.equal(calls, 1, 'the current retry wait must block another request');
      t.mock.timers.tick(reply.retryAfterMs);
      await controller.load();
      assert.deepEqual(controller.sessions, [current]);
      assert.equal(controller.loaded, true);
      assert.equal(controller.error, undefined);
      assert.equal(calls, 2);
    }
  });
}
