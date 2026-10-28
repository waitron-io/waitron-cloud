import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PasskeyController, type PasskeyBrowser} from '../src/passkey-controller.ts';
import type {ApiResult} from '../src/api.ts';
import type {PasskeySummary, RegistrationOptions} from '../src/passkey-types.ts';

const previous: PasskeySummary = {
  id: '12345678-1234-4234-8234-123456789abc', createdAt: '2026-10-24T12:00:00Z', lastUsedAt: null,
};
const added: PasskeySummary = {
  id: '22345678-1234-4234-8234-123456789abc', createdAt: '2026-10-25T12:00:00Z', lastUsedAt: null,
};
const current: PasskeySummary = {
  id: '32345678-1234-4234-8234-123456789abc', createdAt: '2026-10-26T12:00:00Z', lastUsedAt: '2026-10-27T12:00:00Z',
};
const options: RegistrationOptions = {
  ceremonyId: '42345678-1234-4234-8234-123456789abc',
  options: {challenge: 'register', rp: {name: 'Waitron Cloud', id: 'cloud.example.test'},
    user: {id: 'owner', name: 'owner@example.test', displayName: 'owner@example.test'},
    pubKeyCredParams: [{type: 'public-key', alg: -7}]},
};
const response = {id: 'credential', rawId: 'credential', type: 'public-key' as const, clientExtensionResults: {},
  response: {clientDataJSON: 'client', attestationObject: 'attestation'}};
const ok = (value: unknown): ApiResult<unknown> => ({ok: true, value});
const boundaries = ['list', 'enrollment options', 'enrollment verification', 'enrollment list', 'removal', 'removal list'] as const;
type Boundary = typeof boundaries[number];
const outcomes = ['success', 'rate limit'] as const;
const limited: ApiResult<unknown> = {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 60_000};
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture() {
  const requests: {path: string; body: Record<string, unknown> | undefined; finish: (reply: ApiResult<unknown>) => void}[] = [];
  let changes = 0, prompts = 0, refuseUnexpected = false;
  const request = <T>(path: string, body?: Record<string, unknown>) => new Promise<ApiResult<T>>(resolve => {
    requests.push({path, body: structuredClone(body), finish: reply => resolve(reply as ApiResult<T>)});
    if (refuseUnexpected) resolve({ok: false, status: 503, code: 'unavailable', retryAfterMs: 0});
  });
  const browser: PasskeyBrowser = {
    supported: async () => true,
    register: async () => {prompts++; return response;},
    authenticate: async () => {throw new Error('Management must not start sign-in');},
  };
  const controller = new PasskeyController(() => {changes++;}, request, browser);
  return {controller, requests, changes: () => changes, prompts: () => prompts,
    refuseUnexpected: (value: boolean) => {refuseUnexpected = value;}};
}
type Fixture = ReturnType<typeof fixture>;

function state(c: PasskeyController) {
  return structuredClone({passkeys: c.passkeys, password: c.password, pending: c.pending,
    loaded: c.loaded, listLoaded: c.listLoaded, error: c.error, notice: c.notice, retryAt: c.retryAt});
}
function cleared(c: PasskeyController) {
  assert.deepEqual(c.passkeys, []);
  assert.equal(c.password, '');
  assert.equal(c.pending, false);
  assert.equal(c.loaded, false);
  assert.equal(c.listLoaded, false);
  assert.equal(c.error, undefined);
  assert.equal(c.notice, undefined);
}
function success(boundary: Boundary): ApiResult<unknown> {
  if (boundary === 'enrollment options') return ok(options);
  if (boundary === 'enrollment verification') return ok(added);
  if (boundary === 'removal') return ok(undefined);
  return ok({passkeys: boundary === 'removal list' ? [added] : [previous, added]});
}
async function start(f: Fixture, boundary: Boundary) {
  const c = f.controller;
  c.account('first');
  c.passkeys = [previous]; c.loaded = true; c.listLoaded = true; c.password = 'old account password';
  c.error = 'passkeyUnavailable'; c.notice = 'passkeyAdded';
  const done = boundary === 'list' ? c.load()
    : boundary.startsWith('enrollment') ? c.enroll(c.password) : c.remove(previous.id, c.password);
  const first = boundary === 'list' ? {path: '/passkeys', body: undefined}
    : boundary.startsWith('enrollment') ? {path: '/passkeys/registration/options', body: {password: 'old account password'}}
      : {path: '/passkeys/remove', body: {id: previous.id, password: 'old account password'}};
  assert.deepEqual(f.requests.map(({path, body}) => ({path, body})), [first]);
  if (boundary === 'enrollment verification' || boundary === 'enrollment list') {
    f.requests[0]!.finish(ok(options)); await turn();
    assert.equal(f.prompts(), 1);
    assert.deepEqual(f.requests[1]!.body, {ceremonyId: options.ceremonyId, response});
    assert.equal(f.requests[1]!.path, '/passkeys/registration/verify');
  }
  if (boundary === 'enrollment list' || boundary === 'removal list') {
    f.requests.at(-1)!.finish(boundary === 'enrollment list' ? ok(added) : ok(undefined)); await turn();
    assert.equal(f.requests.at(-1)!.path, '/passkeys');
    assert.equal(f.requests.at(-1)!.body, undefined);
  }
  assert.equal(c.pending, true);
  return {done, held: f.requests.at(-1)!};
}

async function switched(boundary: Boundary, reply: ApiResult<unknown>, returning: boolean, loaded: boolean) {
  const f = fixture(), c = f.controller;
  const old = await start(f, boundary);
  c.account('second');
  if (returning) c.account('first');
  cleared(c);
  const reading = c.load(), read = f.requests.at(-1)!;
  assert.equal(c.pending, true);
  if (loaded) {
    read.finish(ok({passkeys: [current]})); await reading;
    assert.deepEqual(c.passkeys, [current]);
    c.password = 'current account password'; c.error = 'passkeyPasswordInvalid'; c.notice = 'passkeyRemoved';
  }
  const before = state(c), changes = f.changes(), prompts = f.prompts(), count = f.requests.length;
  // Unexpected continuations terminate so deleting a guard fails an assertion instead of hanging.
  f.refuseUnexpected(true);
  old.held.finish(reply); await old.done;
  assert.deepEqual(state(c), before, 'an old reply must preserve the current account state');
  assert.equal(f.changes(), changes, 'an old reply must not repaint the current account');
  assert.equal(f.prompts(), prompts, 'old options must not open a registration prompt');
  assert.equal(f.requests.length, count, 'an old reply must not verify or reconcile for the new account');
  f.refuseUnexpected(false);
  if (!loaded) {
    await c.load(); assert.equal(f.requests.length, count, 'the current read still owns the pending gate');
    read.finish(ok({passkeys: [current]})); await reading;
    assert.deepEqual(c.passkeys, [current]);
    assert.equal(c.loaded, true); assert.equal(c.listLoaded, true); assert.equal(c.pending, false);
    assert.equal(c.error, undefined); assert.equal(c.notice, undefined);
  }
  const refresh = c.refresh();
  assert.equal(f.requests.length, count + 1, 'the current account can explicitly refresh after completion');
  assert.equal(c.password, '');
  f.requests.at(-1)!.finish(ok({passkeys: [current]})); await refresh;
  assert.deepEqual(c.passkeys, [current]); assert.equal(c.pending, false);
}

for (const boundary of boundaries) for (const outcome of outcomes) {
  for (const returning of [false, true]) for (const loaded of [false, true]) {
    test(`late passkey ${boundary} ${outcome} preserves ${loaded ? 'loaded' : 'pending'} ${returning ? 'returning' : 'other'} account`, async () => {
      await switched(boundary, outcome === 'success' ? success(boundary) : limited, returning, loaded);
    });
  }
  test(`signed-out passkey management ignores late ${boundary} ${outcome}`, async () => {
    const f = fixture(), c = f.controller, old = await start(f, boundary);
    c.account(undefined); cleared(c);
    const before = state(c), changes = f.changes(), prompts = f.prompts(), count = f.requests.length;
    f.refuseUnexpected(true);
    old.held.finish(outcome === 'success' ? success(boundary) : limited); await old.done;
    assert.deepEqual(state(c), before); assert.equal(f.changes(), changes);
    assert.equal(f.prompts(), prompts);
    await c.load(); await c.refresh(); await c.enroll('password'); await c.remove(previous.id, 'password');
    assert.equal(f.requests.length, count, 'signed-out management cannot send another request');
  });
}

for (const boundary of boundaries) for (const status of [0, 401, 403, 503]) {
  test(`late passkey ${boundary} refusal ${status} preserves the next account's pending read`, async () => {
    await switched(boundary, {ok: false, status, code: status === 0 ? 'network_error' : 'unavailable', retryAfterMs: 0}, false, false);
  });
}

for (const boundary of boundaries) {
  test(`selecting the same account preserves its pending passkey ${boundary} and accepts completion`, async () => {
    const f = fixture(), c = f.controller, old = await start(f, boundary), count = f.requests.length;
    c.account('first');
    assert.equal(c.pending, true); assert.deepEqual(c.passkeys, [previous]); assert.equal(c.password, 'old account password');
    await c.load(); assert.equal(f.requests.length, count);
    old.held.finish(success(boundary));
    if (boundary === 'enrollment options') {
      await turn(); assert.equal(f.requests.at(-1)!.path, '/passkeys/registration/verify');
      f.requests.at(-1)!.finish(ok(added));
    }
    if (['enrollment options', 'enrollment verification', 'removal'].includes(boundary)) {
      await turn(); assert.equal(f.requests.at(-1)!.path, '/passkeys');
      f.requests.at(-1)!.finish(ok({passkeys: boundary === 'removal' ? [added] : [previous, added]}));
    }
    await old.done;
    assert.equal(c.pending, false); assert.equal(c.loaded, true); assert.equal(c.listLoaded, true);
    assert.equal(c.error, undefined);
    assert.deepEqual(c.passkeys, boundary.startsWith('removal') ? [added] : [previous, added]);
    assert.equal(c.notice, boundary.startsWith('enrollment') ? 'passkeyAdded' : boundary.startsWith('removal') ? 'passkeyRemoved' : undefined);
    assert.equal(c.password, boundary === 'list' ? 'old account password' : '');
  });
}
