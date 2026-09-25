import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PasskeyController, type PasskeyBrowser} from '../src/passkey-controller.ts';
import type {ApiResult} from '../src/api.ts';

const id = '12345678-1234-4234-8234-123456789abc';
const createdAt = '2026-09-26T00:00:00.000Z';
const registrationOptions = {ceremonyId: id, options: {challenge: 'register', rp: {name: 'Waitron Cloud', id: 'cloud.example.test'},
  user: {id: 'user', name: 'owner@example.test', displayName: 'owner@example.test'}, pubKeyCredParams: [{type: 'public-key', alg: -7}]}};
const authenticationOptions = {ceremonyId: id, options: {challenge: 'authenticate', rpId: 'cloud.example.test'}};
const registrationResponse = {id: 'credential', rawId: 'credential', type: 'public-key' as const, clientExtensionResults: {},
  response: {clientDataJSON: 'client', attestationObject: 'attestation'}};
const authenticationResponse = {id: 'credential', rawId: 'credential', type: 'public-key' as const, clientExtensionResults: {},
  response: {clientDataJSON: 'client', authenticatorData: 'authenticator', signature: 'signature', userHandle: 'user'}};

function browser(overrides: Partial<PasskeyBrowser> = {}): PasskeyBrowser {
  return {
    supported: async () => true,
    register: async () => registrationResponse,
    authenticate: async () => authenticationResponse,
    ...overrides,
  };
}

test('passkey sign-in is deliberate, reports cancellation, and returns confirmed or uncertain outcomes', async () => {
  const calls: Array<{path: string; body: unknown}> = [];
  let cancelled = true;
  let lost = false;
  const client = browser({authenticate: async () => {
    if (cancelled) throw new DOMException('cancelled', 'NotAllowedError');
    return authenticationResponse;
  }});
  const request = async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
    calls.push({path, body});
    if (path.endsWith('/options')) return {ok: true, value: authenticationOptions as T};
    return lost ? {ok: false, status: 0, code: 'network_error', retryAfterMs: 0}
      : {ok: true, value: {accountId: 'owner'} as T};
  };
  const controller = new PasskeyController(() => {}, request, client);
  await controller.checkSupport();
  assert.equal(await controller.signIn(), false);
  assert.equal(controller.notice, 'passkeyCancelled');
  assert.deepEqual(calls.map(call => call.path), ['/passkeys/authentication/options']);

  cancelled = false;
  assert.equal(await controller.signIn(), 'authenticated');
  assert.deepEqual(calls.at(-1), {path: '/passkeys/authentication/verify', body: {ceremonyId: id, response: authenticationResponse}});
  lost = true;
  assert.equal(await controller.signIn(), 'reconcile');
  assert.equal(controller.error, 'passkeySignInUncertain');
});

test('unsupported browsers retain password sign-in and do not start ceremonies', async () => {
  let calls = 0;
  const controller = new PasskeyController(() => {}, async <T>(): Promise<ApiResult<T>> => {
    calls++;
    throw new Error('must not request');
  }, browser({supported: async () => false}));
  await controller.checkSupport();
  assert.equal(controller.supported, false);
  assert.equal(await controller.signIn(), false);
  assert.equal(controller.notice, 'passkeyUnsupported');
  assert.equal(calls, 0);
});

test('enrolment requires the current password, refreshes the list, and fences account changes', async () => {
  const calls: Array<{path: string; body: unknown}> = [];
  let wrongPassword = true;
  let finishList: ((result: ApiResult<unknown>) => void) | undefined;
  const request = async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
    calls.push({path, body});
    if (path === '/passkeys') return new Promise<ApiResult<T>>(resolve => { finishList = resolve as (result: ApiResult<unknown>) => void; });
    if (path.endsWith('/registration/options')) return wrongPassword
      ? {ok: false, status: 403, code: 'forbidden', retryAfterMs: 0}
      : {ok: true, value: registrationOptions as T};
    return {ok: true, value: {id, createdAt} as T};
  };
  const controller = new PasskeyController(() => {}, request, browser());
  controller.account('owner');
  await controller.enroll('wrong');
  assert.equal(controller.error, 'passkeyPasswordInvalid');
  assert.deepEqual(calls.at(-1), {path: '/passkeys/registration/options', body: {password: 'wrong'}});

  wrongPassword = false;
  const enrolling = controller.enroll('correct');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.at(-2), {path: '/passkeys/registration/verify', body: {ceremonyId: id, response: registrationResponse}});
  controller.account('different');
  finishList?.({ok: true, value: {passkeys: [{id, createdAt}]}});
  await enrolling;
  assert.deepEqual(controller.passkeys, []);
  assert.equal(controller.pending, false);
});

test('lost remove replies are reconciled by reloading the list', async () => {
  let list = [{id, createdAt}];
  const request = async <T>(path: string): Promise<ApiResult<T>> => {
    if (path === '/passkeys') return {ok: true, value: {passkeys: list} as T};
    list = [];
    return {ok: false, status: 0, code: 'network_error', retryAfterMs: 0};
  };
  const controller = new PasskeyController(() => {}, request, browser());
  controller.account('owner');
  await controller.load();
  await controller.remove(id, 'current password');
  assert.deepEqual(controller.passkeys, []);
  assert.equal(controller.notice, 'passkeyRemoved');
  assert.equal(controller.error, undefined);
});
