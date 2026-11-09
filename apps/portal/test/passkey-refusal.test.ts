import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PasskeyController, type PasskeyBrowser} from '../src/passkey-controller.ts';
import type {ApiResult} from '../src/api.ts';

const id = '12345678-1234-4234-8234-123456789abc';
const key = {id, createdAt: '2026-09-26T00:00:00.000Z', lastUsedAt: null};
const options = {ceremonyId: id, options: {challenge: 'register', rp: {name: 'Waitron Cloud', id: 'cloud.example.test'},
  user: {id: 'user', name: 'owner@example.test', displayName: 'Owner'}, pubKeyCredParams: [{type: 'public-key', alg: -7}]}};
const response = {id: 'credential', rawId: 'credential', type: 'public-key' as const, clientExtensionResults: {},
  response: {clientDataJSON: 'client', attestationObject: 'attestation'}};
const browser: PasskeyBrowser = {supported: async () => true, register: async () => response, authenticate: async () => {throw new Error('unexpected sign-in');}};
const refusal = {ok: false, status: 400, code: 'invalid_input', retryAfterMs: 0} as const;
function fixture(stage: 'options' | 'verify' | 'remove' | 'signin-options' | 'signin-verify', failure: ApiResult<unknown> = refusal, listed = [key]) {
  const calls: {path: string; body?: Record<string, unknown>}[] = [];
  const c = new PasskeyController(() => {}, async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
    calls.push({path, body});
    if (path === '/passkeys') return {ok: true, value: {passkeys: listed} as T};
    if (path.endsWith('/options') && stage !== 'options' && stage !== 'signin-options') return {ok: true, value: options as T};
    return failure as ApiResult<T>;
  }, {...browser, authenticate: async () => ({id: 'credential', rawId: 'credential', type: 'public-key', clientExtensionResults: {}, response: {clientDataJSON: 'client', authenticatorData: 'data', signature: 'signature'}})});
  c.account('owner'); c.passkeys = [key]; c.loaded = true; c.listLoaded = true; c.password = 'Current password';
  return {c, calls};
}
for (const stage of ['options', 'verify', 'remove'] as const) {
  // Mapping these shared refusals to an outage hides the existing fresh-prompt/list path.
  test(`${stage}: a refused passkey change offers list and fresh-password guidance`, async () => {
    const {c, calls} = fixture(stage);
    if (stage === 'remove') await c.remove(id, c.password); else await c.enroll(c.password);
    assert.equal(c.error, stage === 'remove' ? 'passkeyRemovalRefused' : 'passkeyRegistrationRefused');
    assert.equal(c.notice, undefined); assert.equal(c.pending, false); assert.deepEqual(c.passkeys, [key]);
    assert.equal(calls.filter(call => call.path === '/passkeys').length, stage === 'options' ? 0 : 1);
    assert.equal(calls.filter(call => call.path === '/passkeys/registration/options').length, stage === 'remove' ? 0 : 1);
    assert.equal(calls.filter(call => call.path === '/passkeys/registration/verify').length, stage === 'verify' ? 1 : 0);
    assert.equal(calls.filter(call => call.path === '/passkeys/remove').length, stage === 'remove' ? 1 : 0);
  });
  for (const [status, code, expected] of [
    [400, 'conflict', 'passkeyUnavailable'], [422, 'invalid_input', 'passkeyUnavailable'], [403, 'invalid_input', 'forbidden'],
    [403, 'credentials_invalid', stage === 'verify' ? 'forbidden' : 'passkeyPasswordInvalid'],
    [401, 'credentials_invalid', stage === 'verify' ? 'pairSession' : 'passkeyPasswordInvalid'], [429, 'rate_limited', 'limited'],
    [503, 'unavailable', stage === 'options' ? 'passkeyUnavailable' : 'passkeyChangeUncertain'],
    [0, 'network_error', stage === 'options' ? 'passkeyUnavailable' : 'passkeyChangeUncertain'],
  ] as const) test(`${stage}: ${status} ${code} keeps its own passkey handling`, async () => {
    const {c} = fixture(stage, {ok: false, status, code, retryAfterMs: status === 429 ? 60000 : 0});
    if (stage === 'remove') await c.remove(id, c.password); else await c.enroll(c.password);
    assert.equal(c.error, expected); assert.equal(c.notice, undefined);
    if (status === 429) assert.ok(c.waiting > 0);
  });
}
test('a list refusal is not presented as a refused passkey change', async () => {
  const c = new PasskeyController(() => {}, async <T>(): Promise<ApiResult<T>> => refusal, browser);
  c.account('owner'); await c.load(); assert.equal(c.error, 'passkeyUnavailable'); assert.equal(c.listLoaded, false);
});
test('a sign-in refusal does not receive account management guidance', async () => {
  const c = new PasskeyController(() => {}, async <T>(): Promise<ApiResult<T>> => refusal, browser);
  assert.equal(await c.signIn(), false); assert.equal(c.error, 'passkeyUnavailable');
});

test('checking passkeys clears the old password and reads the current list without a change', async () => {
  const {c, calls} = fixture('verify');
  assert.equal(typeof c.refresh, 'function', 'offer an explicit read-only passkey check');
  await c.refresh();
  assert.deepEqual(calls, [{path: '/passkeys', body: undefined}]);
  assert.equal(c.password, ''); assert.equal(c.listLoaded, true); assert.deepEqual(c.passkeys, [key]);
  await c.enroll(c.password); await c.remove(id, c.password); assert.equal(calls.length, 1, 'another change needs a fresh password');
});
for (const gate of ['anonymous', 'pending', 'cooldown'] as const) test(`checking passkeys respects ${gate}`, async () => {
  const {c, calls} = fixture('options', {ok:false,status:429,code:'rate_limited',retryAfterMs:60000});
  if (gate === 'anonymous') c.account(undefined); else if (gate === 'pending') c.pending = true; else {await c.enroll(c.password); calls.length = 0;}
  const before = c.password;
  assert.equal(typeof c.refresh, 'function', 'offer an explicit read-only passkey check');
  await c.refresh(); assert.deepEqual(calls, []); assert.equal(c.password, before);
});
test('checking passkeys ignores a former account reply and clears stale list authority', async () => {
  let finish!: (result: ApiResult<unknown>) => void;
  const c = new PasskeyController(() => {}, async <T>(): Promise<ApiResult<T>> => new Promise(resolve => {finish = resolve as typeof finish;}), browser);
  c.account('owner'); c.passkeys = [key]; c.listLoaded = true; c.password = 'old password';
  assert.equal(typeof c.refresh, 'function', 'offer an explicit read-only passkey check');
  const pending = c.refresh(); assert.equal(c.pending, true); assert.equal(c.password, '');
  c.account('other'); finish({ok: true, value: {passkeys: [key]}}); await pending;
  assert.deepEqual(c.passkeys, []); assert.equal(c.listLoaded, false); assert.equal(c.password, ''); assert.equal(c.pending, false);
});
test('a failed passkey check keeps list retry available and does not claim an empty list', async () => {
  let healthy = false;
  const calls: string[] = [];
  const c = new PasskeyController(() => {}, async <T>(path: string): Promise<ApiResult<T>> => {
    calls.push(path); return healthy ? {ok: true, value: {passkeys: []} as T} : {ok: false, status: 503, code: 'unavailable', retryAfterMs: 0};
  }, browser);
  c.account('owner'); c.passkeys = [key]; c.listLoaded = true; c.password = 'old password';
  assert.equal(typeof c.refresh, 'function', 'offer an explicit read-only passkey check');
  await c.refresh(); assert.equal(c.password, ''); assert.equal(c.listLoaded, false); assert.equal(c.error, 'passkeyUnavailable');
  assert.deepEqual(c.passkeys, [key]); healthy = true; await c.load();
  assert.equal(c.listLoaded, true); assert.deepEqual(c.passkeys, []); assert.equal(c.error, undefined); assert.deepEqual(calls, ['/passkeys', '/passkeys']);
});
test('a refused change retains its retry delay before a read-only check', async () => {
  const {c, calls} = fixture('options', {...refusal, retryAfterMs: 60000});
  await c.enroll(c.password); assert.equal(c.error, 'passkeyRegistrationRefused'); assert.ok(c.waiting > 0);
  const before = c.password; await c.refresh(); assert.equal(c.password, before); assert.equal(calls.length, 1);
});
for (const wrapped of [false, true]) test(`an already-registered browser passkey offers a list check, wrapped=${wrapped}`, async () => {
  const cause = new DOMException('Already registered', 'InvalidStateError');
  const calls: string[] = [];
  const c = new PasskeyController(() => {}, async <T>(path: string): Promise<ApiResult<T>> => {
    calls.push(path); return {ok: true, value: options as T};
  }, {...browser, register: async () => {throw wrapped ? new Error('Browser refused', {cause}) : cause;}});
  c.account('owner'); await c.enroll('Current password');
  assert.equal(c.error, 'passkeyRegistrationRefused'); assert.equal(c.notice, undefined); assert.equal(c.pending, false);
  assert.deepEqual(calls, ['/passkeys/registration/options'], 'a browser refusal never submits a verification');
});
test('a JavaScript error named InvalidStateError does not claim a browser duplicate', async () => {
  const c = new PasskeyController(() => {}, async <T>(): Promise<ApiResult<T>> => ({ok: true, value: options as T}),
    {...browser, register: async () => {throw Object.assign(new Error('Other failure'), {name: 'InvalidStateError'});}});
  c.account('owner'); await c.enroll('Current password'); assert.equal(c.error, 'passkeyUnavailable');
});

for (const stage of ['options', 'verify', 'remove', 'signin-options', 'signin-verify'] as const) for (const [status, name] of [[408, 'Interrupted'], [413, 'Size'], [415, 'Format']] as const) {
  test(`${stage}: ${status} body refusal names its cause and the next action`, async () => {
    const {c, calls} = fixture(stage, {ok: false, status, code: 'invalid_input', retryAfterMs: 0});
    if (stage.startsWith('signin')) assert.equal(await c.signIn(), false);
    else if (stage === 'remove') await c.remove(id, c.password); else await c.enroll(c.password);
    assert.equal(c.error, `passkeyRequest${name}${stage.startsWith('signin') ? 'SignIn' : ''}`);
    assert.equal(c.notice, undefined); assert.equal(c.pending, false);
    assert.equal(calls.filter(call => call.body !== undefined).length, stage === 'verify' || stage === 'signin-verify' ? 2 : 1);
  });
}
for (const status of [400, 408, 413, 415, 431]) test(`list ${status} is a read refusal, with no body-change guidance`, async () => {
  const c = new PasskeyController(() => {}, async <T>(): Promise<ApiResult<T>> => ({ok: false, status, code: 'invalid_input', retryAfterMs: 0}), browser);
  c.account('owner'); await c.load(); assert.equal(c.error, 'passkeyUnavailable'); assert.equal(c.listLoaded, false);
});
for (const [status, code, expected] of [[408, 'unavailable', 'passkeyUnavailable'], [415, 'other', 'passkeyUnavailable'], [431, 'invalid_input', 'passkeyUnavailable'], [413, 'credentials_invalid', 'passkeyPasswordInvalid']] as const) test(`body guidance keeps ${status} ${code} handling`, async () => {
  const {c} = fixture('options', {ok: false, status, code, retryAfterMs: 0}); await c.enroll(c.password); assert.equal(c.error, expected);
});
for (const stage of ['verify', 'remove'] as const) for (const status of [408, 413, 415]) test(`${stage}: ${status} keeps reconciled success`, async () => {
  const listed = stage === 'remove' ? [] : [key, {...key, id: '22345678-1234-4234-8234-123456789abc'}];
  const {c} = fixture(stage, {ok: false, status, code: 'invalid_input', retryAfterMs: 0}, listed);
  if (stage === 'remove') await c.remove(id, c.password); else await c.enroll(c.password);
  assert.equal(c.error, undefined); assert.equal(c.notice, stage === 'remove' ? 'passkeyRemoved' : 'passkeyAdded');
});
