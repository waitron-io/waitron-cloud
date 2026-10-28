import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AccountSecurityController} from '../src/account-security-controller.ts';
import type {AccountSessionSummary} from '../src/account-security-types.ts';
import type {ApiResult} from '../src/api.ts';

const source: AccountSessionSummary = {
  id: '12345678-1234-4234-8234-123456789abc', createdAt: '2026-09-26T00:00:00Z',
  lastUsedAt: '2026-09-26T00:20:00Z', expiresAt: '2099-01-01T00:00:00Z', current: true,
};
const replacement: AccountSessionSummary = {
  id: '22345678-1234-4234-8234-123456789abc', createdAt: '2026-09-27T00:00:00Z',
  lastUsedAt: '2026-09-27T00:20:00Z', expiresAt: '2099-01-02T00:00:00Z', current: true,
};
const staleRemaining: AccountSessionSummary = {
  id: '32345678-1234-4234-8234-123456789abc', createdAt: '2026-09-25T00:00:00Z',
  lastUsedAt: '2026-09-25T00:20:00Z', expiresAt: '2099-01-03T00:00:00Z', current: true,
};
const failures = {
  lost: {ok: false, status: 0, code: 'network_error', retryAfterMs: 7_000},
  unauthorized: {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 11_000},
  forbidden: {ok: false, status: 403, code: 'forbidden', retryAfterMs: 13_000},
  limited: {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 17_000},
  unavailable: {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 19_000},
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {resolve = finish;});
  return {promise, resolve};
}

for (const boundary of ['revoke', 'reconciliation'] as const) {
  for (const account of ['different', 'return'] as const) {
    for (const newer of ['pending', 'loaded'] as const) {
      for (const outcome of ['success', 'lost', 'unauthorized', 'forbidden', 'limited', 'unavailable'] as const) {
        test(`old session ${boundary} ${outcome} cannot affect ${account} account with ${newer} list`, {timeout: 5_000}, async t => {
          t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-28T00:00:00Z')});
          const oldReply = deferred<ApiResult<unknown>>();
          const newReply = deferred<ApiResult<unknown>>();
          const oldRequest = deferred<void>();
          const calls: Array<{path: string; body: unknown}> = [];
          const ended: Array<'signedOut' | undefined> = [];
          let changes = 0;
          const replies: Array<ApiResult<unknown> | Promise<ApiResult<unknown>>> = [
            {ok: true, value: {sessions: [source]}},
            ...(boundary === 'reconciliation' ? [{ok: true as const, value: undefined}] : []),
            oldReply.promise, newReply.promise,
          ];
          const request = async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
            calls.push({path, body: structuredClone(body)});
            const reply = replies.shift() ?? {ok: true as const, value: {sessions: [staleRemaining]}};
            if (reply === oldReply.promise) oldRequest.resolve();
            return await reply as ApiResult<T>;
          };
          const controller = new AccountSecurityController(() => {changes++;}, reason => {ended.push(reason);}, request);
          controller.account('owner');
          await controller.load();
          assert.deepEqual(controller.sessions, [source]);
          const revoking = controller.revoke(source.id);
          await oldRequest.promise;
          assert.deepEqual(calls, [
            {path: '/sessions', body: undefined},
            {path: '/sessions/revoke', body: {id: source.id}},
            ...(boundary === 'reconciliation' ? [{path: '/sessions', body: undefined}] : []),
          ]);
          controller.account('different');
          if (account === 'return') controller.account('owner');
          const loading = controller.load();
          const currentReply = {ok: true as const, value: {sessions: [replacement]}};
          const staleReply: ApiResult<unknown> = outcome === 'success'
            ? {ok: true, value: boundary === 'revoke' ? undefined : {sessions: [staleRemaining]}}
            : failures[outcome];
          try {
            assert.equal(controller.pending, true);
            assert.equal(controller.loaded, false);
            assert.deepEqual(controller.sessions, []);
            if (newer === 'loaded') {
              newReply.resolve(currentReply);
              await loading;
              assert.equal(controller.pending, false);
              assert.equal(controller.loaded, true);
              assert.deepEqual(controller.sessions, [replacement]);
            }
            const snapshot = () => ({
              sessions: structuredClone(controller.sessions), loaded: controller.loaded,
              loadAttempted: controller.loadAttempted, pending: controller.pending,
              retryAt: controller.retryAt, error: controller.error, notice: controller.notice,
              changes, ended: [...ended], calls: structuredClone(calls),
            });
            const before = snapshot();
            oldReply.resolve(staleReply);
            await revoking;
            assert.deepEqual(snapshot(), before, 'an old reply must not change current state, notify, recheck sign-in or send a list request');

            newReply.resolve(currentReply);
            await loading;
            assert.deepEqual(controller.sessions, [replacement]);
            assert.equal(controller.loaded, true);
            assert.equal(controller.loadAttempted, true);
            assert.equal(controller.pending, false);
            assert.equal(controller.retryAt, 0);
            assert.equal(controller.error, undefined);
            assert.equal(controller.notice, undefined);
            assert.deepEqual(ended, []);
            assert.equal(changes, before.changes + (newer === 'pending' ? 1 : 0));
            assert.deepEqual(calls, [
              {path: '/sessions', body: undefined},
              {path: '/sessions/revoke', body: {id: source.id}},
              ...(boundary === 'reconciliation' ? [{path: '/sessions', body: undefined}] : []),
              {path: '/sessions', body: undefined},
            ]);
          } finally {
            oldReply.resolve(staleReply);
            newReply.resolve(currentReply);
            await Promise.all([revoking, loading]);
          }
        });
      }
    }
  }
}
