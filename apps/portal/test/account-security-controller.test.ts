import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AccountSecurityController} from '../src/account-security-controller.ts';
import type {ApiResult} from '../src/api.ts';

const current = {id: '12345678-1234-4234-8234-123456789abc', createdAt: '2026-09-26T00:00:00.000Z',
  lastUsedAt: '2026-09-26T00:20:00.000Z', expiresAt: '2026-09-26T00:50:00.000Z', current: true};
const other = {id: '22345678-1234-4234-8234-123456789abc', createdAt: '2026-09-25T22:00:00.000Z',
  lastUsedAt: '2026-09-26T00:10:00.000Z', expiresAt: '2026-09-26T00:40:00.000Z', current: false};

test('account changes fence late session lists', async () => {
  let finish: ((value: ApiResult<{sessions: typeof current[]}>) => void) | undefined;
  const request = <T>(): Promise<ApiResult<T>> => new Promise(resolve => {
    finish = resolve as (value: ApiResult<{sessions: typeof current[]}>) => void;
  });
  const controller = new AccountSecurityController(() => {}, () => {}, request);
  controller.account('owner');
  const loading = controller.load();
  controller.account('different');
  finish?.({ok: true, value: {sessions: [current]}});
  await loading;
  assert.deepEqual(controller.sessions, []);
  assert.equal(controller.loaded, false);
  assert.equal(controller.pending, false);
});

test('a lost revoke reply is reconciled by the passive session list', async () => {
  let sessions = [current, other];
  const calls: {path: string; body?: Record<string, unknown>}[] = [];
  const request = async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
    calls.push({path, body});
    if (path === '/sessions') return {ok: true, value: {sessions} as T};
    sessions = [current];
    return {ok: false, status: 0, code: 'network_error', retryAfterMs: 0};
  };
  const controller = new AccountSecurityController(() => {}, () => {}, request);
  controller.account('owner');
  await controller.load();
  await controller.revoke(other.id);
  assert.deepEqual(calls.slice(-2), [{path: '/sessions/revoke', body: {id: other.id}}, {path: '/sessions', body: undefined}]);
  assert.deepEqual(controller.sessions, [current]);
  assert.equal(controller.notice, 'sessionRevoked');
  assert.equal(controller.error, undefined);
});

test('current-session loss and stale authority trigger the normal session recheck', async () => {
  let ended = 0;
  let response: ApiResult<unknown> = {ok: false, status: 0, code: 'network_error', retryAfterMs: 0};
  const request = async <T>(path: string): Promise<ApiResult<T>> => {
    if (path === '/sessions/revoke') return response as ApiResult<T>;
    return {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 0};
  };
  const controller = new AccountSecurityController(() => {}, () => { ended++; }, request);
  controller.account('owner');
  controller.sessions = [current]; controller.loaded = true;
  await controller.revoke(current.id);
  assert.equal(ended, 1);
  assert.equal(controller.error, undefined);

  response = {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 0};
  controller.sessions = [other]; controller.loaded = true;
  await controller.revoke(other.id);
  assert.equal(ended, 2);
});

test('an unavailable initial list remains explicitly retryable', async () => {
  let available = false;
  const request = async <T>(): Promise<ApiResult<T>> => available
    ? {ok: true, value: {sessions: [current]} as T}
    : {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 0};
  const controller = new AccountSecurityController(() => {}, () => {}, request);
  controller.account('owner');
  await controller.load();
  assert.equal(controller.loaded, false);
  assert.equal(controller.error, 'unavailable');
  available = true;
  await controller.load();
  assert.equal(controller.loaded, true);
  assert.deepEqual(controller.sessions, [current]);
  controller.fence();
  assert.equal(controller.loaded, false);
});
