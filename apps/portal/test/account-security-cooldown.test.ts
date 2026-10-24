import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PasskeyController, type PasskeyBrowser} from '../src/passkey-controller.ts';
import {AccountSecurityController} from '../src/account-security-controller.ts';
import type {ApiResult} from '../src/api.ts';

const id = '12345678-1234-4234-8234-123456789abc';
const at = '2026-10-24T12:00:00.000Z';
const passkey = {id, createdAt: at, lastUsedAt: null};
const session = {id, createdAt: at, lastUsedAt: at, expiresAt: '2026-10-25T12:00:00.000Z', current: false};
const browser: PasskeyBrowser = {
  supported: async () => true,
  register: async () => ({id: 'credential', rawId: 'credential', type: 'public-key', clientExtensionResults: {}, response: {clientDataJSON: 'client', attestationObject: 'attestation'}}),
  authenticate: async () => ({id: 'credential', rawId: 'credential', type: 'public-key', clientExtensionResults: {}, response: {clientDataJSON: 'client', authenticatorData: 'authenticator', signature: 'signature'}}),
};
function success(path: string): unknown {
  if (path === '/passkeys') return {passkeys: [passkey]};
  if (path === '/sessions') return {sessions: [session, {...session, id: '22345678-1234-4234-8234-123456789abc', current: true}]};
  if (path === '/passkeys/registration/options') return {ceremonyId: id, options: {challenge: 'challenge', rp: {id: 'portal.test', name: 'Waitron Cloud'}, user: {id: 'owner', name: 'owner@example.test', displayName: 'Owner'}, pubKeyCredParams: [{type: 'public-key', alg: -7}]}};
  if (path === '/passkeys/authentication/options') return {ceremonyId: id, options: {challenge: 'challenge', rpId: 'portal.test'}};
  if (path === '/passkeys/authentication/verify') return {accountId: 'owner'};
  if (path === '/passkeys/registration/verify') return passkey;
  return undefined;
}

// Without a failure deadline or any action's admission check, another request reaches the API during the wait.
for (const endpoint of ['/passkeys', '/passkeys/authentication/options', '/passkeys/authentication/verify', '/passkeys/registration/options', '/passkeys/registration/verify', '/passkeys/remove']) {
  test(`passkeys honour Retry-After from ${endpoint} across every action and navigation`, async t => {
    t.mock.timers.enable({apis: ['Date'], now: Date.parse(at)});
    const calls: string[] = [];
    const request = async <T>(path: string): Promise<ApiResult<T>> => {
      calls.push(path);
      return path === endpoint ? {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 60_000}
        : {ok: true, value: success(path) as T};
    };
    const controller = new PasskeyController(() => {}, request, browser);
    controller.account('owner'); controller.passkeys = [passkey]; controller.supported = true;
    const trigger = () => endpoint === '/passkeys' ? controller.load() : endpoint.includes('/authentication/') ? controller.signIn()
      : endpoint.includes('/registration/') ? controller.enroll('current password') : controller.remove(id, 'current password');
    await trigger();
    const before = [...calls];
    assert.equal(controller.error, 'limited');
    for (const elapsed of [0, 59_999]) {
      t.mock.timers.setTime(Date.parse(at) + elapsed);
      await controller.load(); await controller.signIn(); await controller.enroll('current password'); await controller.remove(id, 'current password');
      assert.deepEqual(calls, before, 'all passkey actions wait without contacting the API');
    }
    assert.equal(controller.waiting, 1);
    controller.fence(); controller.account('different'); controller.passkeys = [passkey];
    await trigger(); assert.deepEqual(calls, before, 'navigation and account changes cannot shorten the wait');
    t.mock.timers.setTime(Date.parse(at) + 60_000);
    assert.equal(controller.waiting, 0);
    await trigger(); assert.ok(calls.length > before.length, 'the action is available at the deadline');
  });
}

for (const endpoint of ['/sessions', '/sessions/revoke', 'reconciliation']) {
  test(`sessions honour Retry-After from ${endpoint} across reads and revocation`, async t => {
    t.mock.timers.enable({apis: ['Date'], now: Date.parse(at)});
    const calls: string[] = [];
    const request = async <T>(path: string): Promise<ApiResult<T>> => {
      calls.push(path);
      return path === endpoint || endpoint === 'reconciliation' && path === '/sessions'
        ? {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 60_000}
        : {ok: true, value: success(path) as T};
    };
    const controller = new AccountSecurityController(() => {}, () => {}, request);
    controller.account('owner'); controller.sessions = [session];
    const trigger = () => endpoint === '/sessions' ? controller.load() : controller.revoke(id);
    await trigger();
    const before = [...calls];
    // Keep a known row available so the cooldown, rather than a missing row, must block revocation.
    controller.sessions = [session];
    for (const elapsed of [0, 59_999]) {
      t.mock.timers.setTime(Date.parse(at) + elapsed);
      await controller.load(); await controller.revoke(id);
      assert.deepEqual(calls, before, 'session reads and revocations wait without contacting the API');
    }
    assert.equal(controller.waiting, 1);
    controller.fence(); controller.account('different'); controller.sessions = [session];
    await trigger(); assert.deepEqual(calls, before, 'navigation and account changes cannot shorten the wait');
    t.mock.timers.setTime(Date.parse(at) + 60_000);
    assert.equal(controller.waiting, 0);
    await trigger(); assert.ok(calls.length > before.length, 'the action is available at the deadline');
  });
}

for (const kind of ['passkeys', 'sessions'] as const) test(`${kind} reconciliation cannot shorten a write's Retry-After`, async t => {
  t.mock.timers.enable({apis: ['Date'], now: Date.parse(at)});
  const request = async <T>(path: string): Promise<ApiResult<T>> => ({ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: path.endsWith('/remove') || path.endsWith('/revoke') ? 60_000 : 1_000});
  const controller = kind === 'passkeys' ? new PasskeyController(() => {}, request, browser) : new AccountSecurityController(() => {}, () => {}, request);
  controller.account('owner');
  if (controller instanceof PasskeyController) { controller.passkeys = [passkey]; await controller.remove(id, 'current password'); }
  else { controller.sessions = [session]; await controller.revoke(id); }
  assert.equal(controller.waiting, 60);
});

for (const action of ['enroll', 'remove', 'revoke'] as const) test(`${action} keeps Retry-After even when reconciliation confirms the change`, async t => {
  t.mock.timers.enable({apis: ['Date'], now: Date.parse(at)});
  const request = async <T>(path: string): Promise<ApiResult<T>> => {
    if (path.endsWith('/options')) return {ok: true, value: success(path) as T};
    if (path === '/passkeys') return {ok: true, value: {passkeys: action === 'enroll' ? [passkey] : []} as T};
    if (path === '/sessions') return {ok: true, value: {sessions: [{...session, id: '22345678-1234-4234-8234-123456789abc', current: true}]} as T};
    return {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 60_000};
  };
  if (action === 'revoke') {
    const controller = new AccountSecurityController(() => {}, () => {}, request);
    controller.account('owner'); controller.sessions = [session];
    await controller.revoke(id);
    assert.equal(controller.notice, 'sessionRevoked');
    assert.equal(controller.waiting, 60);
  } else {
    const controller = new PasskeyController(() => {}, request, browser);
    controller.account('owner'); controller.passkeys = action === 'enroll' ? [] : [passkey];
    if (action === 'enroll') await controller.enroll('current password'); else await controller.remove(id, 'current password');
    assert.equal(controller.notice, action === 'enroll' ? 'passkeyAdded' : 'passkeyRemoved');
    assert.equal(controller.waiting, 60);
  }
});
