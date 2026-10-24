import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PasskeyController, type PasskeyBrowser} from '../src/passkey-controller.ts';
import type {ApiResult} from '../src/api.ts';

const id = '12345678-1234-4234-8234-123456789abc';
const createdAt = '2026-09-26T00:00:00.000Z';
const lastUsedAt = null;
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

test('wrapped browser cancellation keeps cancellation feedback distinct from other failures', async () => {
  for (const name of ['NotAllowedError', 'AbortError', 'SecurityError']) {
    const cause = new DOMException('Browser refused the prompt', name);
    const wrapped = new Error(cause.message, {cause});
    wrapped.name = name;
    const controller = new PasskeyController(() => {}, async <T>(): Promise<ApiResult<T>> =>
      ({ok: true, value: authenticationOptions as T}), browser({authenticate: async () => {throw wrapped;}}));
    assert.equal(await controller.signIn(), false);
    assert.equal(controller.pending, false);
    assert.equal(controller.notice, name === 'SecurityError' ? undefined : 'passkeyCancelled', name);
    assert.equal(controller.error, name === 'SecurityError' ? 'passkeyUnavailable' : undefined, name);
  }
});

test('sign-in uses the browser cause and does not mistake a named JavaScript error for cancellation', async () => {
  for (const browserCause of [true, false]) {
    const cause = browserCause ? new DOMException('Prompt cancelled', 'NotAllowedError') : new Error('Other failure');
    const wrapped = new Error('Browser operation failed', {cause});
    wrapped.name = browserCause ? 'Error' : 'NotAllowedError';
    const controller = new PasskeyController(() => {}, async <T>(): Promise<ApiResult<T>> =>
      ({ok: true, value: authenticationOptions as T}), browser({authenticate: async () => {throw wrapped;}}));
    assert.equal(await controller.signIn(), false);
    assert.equal(controller.notice, browserCause ? 'passkeyCancelled' : undefined);
    assert.equal(controller.error, browserCause ? undefined : 'passkeyUnavailable');
  }
});

test('enrolment requires the current password, refreshes the list, and fences account changes', async () => {
  const calls: Array<{path: string; body: unknown}> = [];
  let wrongPassword = true;
  let finishList: ((result: ApiResult<unknown>) => void) | undefined;
  const request = async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
    calls.push({path, body});
    if (path === '/passkeys') return new Promise<ApiResult<T>>(resolve => { finishList = resolve as (result: ApiResult<unknown>) => void; });
    if (path.endsWith('/registration/options')) return wrongPassword
      ? {ok: false, status: 403, code: 'credentials_invalid', retryAfterMs: 0}
      : {ok: true, value: registrationOptions as T};
    return {ok: true, value: {id, createdAt, lastUsedAt} as T};
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
  finishList?.({ok: true, value: {passkeys: [{id, createdAt, lastUsedAt}]}});
  await enrolling;
  assert.deepEqual(controller.passkeys, []);
  assert.equal(controller.pending, false);
});

test('lost remove replies are reconciled by reloading the list', async () => {
  let list = [{id, createdAt, lastUsedAt}];
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

test('fresh-password errors stay distinct from stale CSRF authority', async () => {
  let code = 'credentials_invalid';
  const request = async <T>(): Promise<ApiResult<T>> => ({ok: false, status: 403, code, retryAfterMs: 0});
  const controller = new PasskeyController(() => {}, request, browser());
  controller.account('owner');
  await controller.enroll('wrong');
  assert.equal(controller.error, 'passkeyPasswordInvalid');
  code = 'forbidden';
  await controller.enroll('correct');
  assert.equal(controller.error, 'forbidden');
});

for (const [label, failure, notice, error] of [
  ['library-wrapped NotAllowedError', new Error('Prompt failed', {cause: new DOMException('Cancelled', 'NotAllowedError')}), 'passkeyCancelled', undefined],
  ['library-wrapped AbortError', new Error('Prompt failed', {cause: new DOMException('Aborted', 'AbortError')}), 'passkeyCancelled', undefined],
  ['direct NotAllowedError', new DOMException('Cancelled', 'NotAllowedError'), 'passkeyCancelled', undefined],
  ['direct AbortError', new DOMException('Aborted', 'AbortError'), 'passkeyCancelled', undefined],
  ['library-wrapped SecurityError', new Error('Prompt failed', {cause: new DOMException('Refused', 'SecurityError')}), undefined, 'passkeyUnavailable'],
  ['named JavaScript error', Object.assign(new Error('Other failure'), {name: 'NotAllowedError'}), undefined, 'passkeyUnavailable'],
  ['non-browser cause', new Error('Prompt failed', {cause: new Error('Other failure')}), undefined, 'passkeyUnavailable'],
] as const) {
  test(`adding a passkey reports ${label} without verifying a credential`, async () => {
    const calls: Array<{path: string; body: unknown}> = [];
    let redraws = 0;
    const request = async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
      calls.push({path, body});
      assert.equal(path, '/passkeys/registration/options');
      return {ok: true, value: registrationOptions as T};
    };
    const controller = new PasskeyController(() => {redraws++;}, request,
      browser({register: async () => {throw failure;}}));
    controller.account('owner');
    controller.password = 'Current account password';
    await controller.enroll(controller.password);
    assert.equal(controller.notice, notice);
    assert.equal(controller.error, error);
    assert.equal(controller.pending, false);
    assert.equal(redraws, 2);
    assert.deepEqual(calls, [{path: '/passkeys/registration/options', body: {password: 'Current account password'}}]);
    assert.deepEqual(controller.passkeys, []);
  });
}


test('failed passkey lists retain the attempt gate and explicit retries can establish an empty list', async () => {
  let healthy = false, calls = 0;
  const controller = new PasskeyController(() => {}, async <T>(): Promise<ApiResult<T>> => {
    calls++;
    return healthy ? {ok: true, value: {passkeys: []} as T}
      : {ok: false, status: 503, code: 'unavailable', retryAfterMs: 0};
  }, browser());
  controller.account('owner');
  await controller.load();
  assert.equal(controller.loaded, true);
  assert.equal(controller.listLoaded, false);
  assert.equal(controller.error, 'passkeyUnavailable');
  controller.fence();
  assert.equal(controller.loaded, true);
  assert.equal(controller.listLoaded, false);
  healthy = true;
  await controller.load();
  assert.equal(calls, 2);
  assert.equal(controller.listLoaded, true);
  assert.equal(controller.error, undefined);
  healthy = false;
  await controller.load();
  assert.equal(controller.listLoaded, false, 'a later failed read cannot establish emptiness');
});

test('switching accounts clears passkey list success and ignores the former account reply', async () => {
  let finish!: (result: ApiResult<unknown>) => void;
  let deferred = false;
  const controller = new PasskeyController(() => {}, async <T>(): Promise<ApiResult<T>> => deferred
    ? new Promise(resolve => {finish = resolve as (result: ApiResult<unknown>) => void;})
    : {ok: true, value: {passkeys: [{id, createdAt, lastUsedAt}]} as T}, browser());
  controller.account('owner');
  await controller.load();
  assert.equal(controller.listLoaded, true);
  deferred = true;
  const pending = controller.load();
  controller.account('different');
  assert.equal(controller.listLoaded, false);
  finish({ok: true, value: {passkeys: [{id, createdAt, lastUsedAt}]}});
  await pending;
  assert.equal(controller.loaded, false);
  assert.equal(controller.listLoaded, false);
  assert.deepEqual(controller.passkeys, []);
});
