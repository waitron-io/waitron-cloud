import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AccountSecurityController} from '../src/account-security-controller.ts';
import type {ApiResult} from '../src/api.ts';

const session = {id: '12345678-1234-4234-8234-123456789abc', createdAt: '2026-09-26T00:00:00Z',
  lastUsedAt: '2026-09-26T00:20:00Z', expiresAt: '2099-01-01T00:00:00Z', current: true};
const unauthorized = {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 0} as const;
const unavailable = {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 0} as const;
for (const current of [true, false]) for (const reply of ['success', 'lost', 'unauthorized'] as const) {
  test(`${current ? 'current' : 'other'} revoke with ${reply} reply labels only reconciled current-session sign-out`, async () => {
    const reasons: unknown[] = [];
    const request = async <T>(path: string): Promise<ApiResult<T>> => path === '/sessions/revoke'
      ? reply === 'success' ? {ok: true, value: undefined as T}
        : reply === 'lost' ? {ok: false, status: 0, code: 'network_error', retryAfterMs: 0} : unauthorized
      : unauthorized;
    const controller = new AccountSecurityController(() => {}, (...args: unknown[]) => {reasons.push(args[0]);}, request);
    controller.account('owner'); controller.sessions = [{...session, current}];
    await controller.revoke(session.id);
    assert.deepEqual(reasons, [current && reply !== 'unauthorized' ? 'signedOut' : undefined]);
    assert.equal(controller.error, undefined);
  });
}

test('a passive unauthorized list rechecks without a sign-out reason', async () => {
  const reasons: unknown[] = [];
  const controller = new AccountSecurityController(() => {}, (...args: unknown[]) => {reasons.push(args[0]);}, async () => unauthorized);
  controller.account('owner'); await controller.load();
  assert.deepEqual(reasons, [undefined]);
});

test('an unavailable reconciliation does not claim current-session sign-out', async () => {
  const reasons: unknown[] = [];
  const request = async <T>(path: string): Promise<ApiResult<T>> => path === '/sessions/revoke'
    ? {ok: true, value: undefined as T} : unavailable;
  const controller = new AccountSecurityController(() => {}, (...args: unknown[]) => {reasons.push(args[0]);}, request);
  controller.account('owner'); controller.sessions = [session];
  await controller.revoke(session.id);
  assert.deepEqual(reasons, []);
  assert.equal(controller.error, 'sessionRevokeUncertain');
});

test('changing account fences a delayed unauthorized reconciliation', async () => {
  let finish!: (value: ApiResult<never>) => void;
  let entered!: () => void;
  const listing = new Promise<void>(resolve => {entered = resolve;});
  const reasons: unknown[] = [];
  const request = async <T>(path: string): Promise<ApiResult<T>> => {
    if (path === '/sessions/revoke') return {ok: true, value: undefined as T};
    entered(); return new Promise<ApiResult<never>>(resolve => {finish = resolve;});
  };
  const controller = new AccountSecurityController(() => {}, (...args: unknown[]) => {reasons.push(args[0]);}, request);
  controller.account('owner'); controller.sessions = [session];
  const revoking = controller.revoke(session.id);
  await listing; controller.account('different'); finish(unauthorized); await revoking;
  assert.deepEqual(reasons, []);
  assert.deepEqual(controller.sessions, []);
});
