import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PasskeyController, type PasskeyBrowser} from '../src/passkey-controller.ts';
import type {ApiResult} from '../src/api.ts';

const ceremony = '12345678-1234-4234-8234-123456789abc';
const key = {id: '22345678-1234-4234-8234-123456789abc', createdAt: '2026-10-28T00:00:00Z', lastUsedAt: null};
const registration = {id: 'credential', rawId: 'credential', type: 'public-key' as const, clientExtensionResults: {},
  response: {clientDataJSON: 'client', attestationObject: 'attestation'}};
const authentication = {id: 'credential', rawId: 'credential', type: 'public-key' as const, clientExtensionResults: {},
  response: {clientDataJSON: 'client', authenticatorData: 'authenticator', signature: 'signature', userHandle: 'owner'}};
const registrationOptions = {challenge: 'register', rp: {name: 'Waitron Cloud', id: 'cloud.example.test'},
  user: {id: 'owner', name: 'owner@example.test', displayName: 'owner@example.test'}, pubKeyCredParams: [{type: 'public-key', alg: -7}]};
const authenticationOptions = {challenge: 'authenticate', rpId: 'cloud.example.test'};
type Mode = 'enrollment' | 'sign-in';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

function fixture(mode: Mode, signedOut = false) {
  const calls: {path: string; body: Record<string, unknown> | undefined}[] = [];
  const prompts: ReturnType<typeof deferred<unknown>>[] = [];
  let changes = 0;
  const request = async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
    calls.push({path, body: structuredClone(body)});
    const value = path.endsWith('/options') ? {ceremonyId: ceremony, options: mode === 'enrollment' ? registrationOptions : authenticationOptions}
      : path === '/passkeys' ? {passkeys: [key]} : mode === 'enrollment' ? key : {accountId: 'owner'};
    return {ok: true, value: value as T};
  };
  const browser: PasskeyBrowser = {
    supported: async () => true,
    register: async () => {const prompt = deferred<unknown>(); prompts.push(prompt); return await prompt.promise as typeof registration;},
    authenticate: async () => {const prompt = deferred<unknown>(); prompts.push(prompt); return await prompt.promise as typeof authentication;},
  };
  const controller = new PasskeyController(() => {changes++;}, request, browser);
  controller.supported = true;
  controller.account(signedOut ? undefined : 'owner');
  const start = () => mode === 'enrollment' ? controller.enroll('Current password') : controller.signIn();
  const response = mode === 'enrollment' ? registration : authentication;
  const snapshot = () => structuredClone({passkeys: controller.passkeys, password: controller.password,
    pending: controller.pending, loaded: controller.loaded, listLoaded: controller.listLoaded,
    retryAt: controller.retryAt, error: controller.error, notice: controller.notice, changes, calls});
  return {controller, calls, prompts, start, response, snapshot};
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const pathFor = (mode: Mode) => mode === 'enrollment' ? '/passkeys/registration' : '/passkeys/authentication';

for (const mode of ['enrollment', 'sign-in'] as const) {
  for (const transition of ['other account', 'returning account', 'sign-out', 'route change'] as const) {
    for (const newer of ['idle', 'pending', 'complete'] as const) {
      if (mode === 'enrollment' && transition === 'sign-out' && newer !== 'idle') continue;
      test(`obsolete ${mode} prompt cannot verify after ${transition} with newer work ${newer}`, {timeout: 5_000}, async () => {
        const f = fixture(mode), c = f.controller;
        const old = f.start();
        await turn();
        assert.equal(f.prompts.length, 1);
        assert.deepEqual(f.calls, [{path: pathFor(mode) + '/options', body: mode === 'enrollment' ? {password: 'Current password'} : {}}]);
        if (transition === 'route change') c.fence();
        else {
          c.account(transition === 'sign-out' ? undefined : 'other');
          if (transition === 'returning account') c.account('owner');
        }
        let current: ReturnType<typeof f.start> | undefined;
        if (newer !== 'idle') {
          current = f.start();
          await turn();
          assert.equal(f.prompts.length, 2);
          assert.equal(c.pending, true);
          if (newer === 'complete') {f.prompts[1]!.resolve(f.response); await current;}
        }
        c.password = 'New draft';
        const before = f.snapshot();
        try {
          f.prompts[0]!.resolve(f.response);
          assert.equal(await old, mode === 'enrollment' ? undefined : false);
          assert.deepEqual(f.snapshot(), before, 'obsolete prompt must send no verification and preserve current work and feedback');
        } finally {
          if (current) {f.prompts[1]!.resolve(f.response); await current;}
        }
        if (current) {
          assert.equal(c.pending, false);
          assert.equal(c.error, undefined);
          if (mode === 'enrollment') {assert.deepEqual(c.passkeys, [key]); assert.equal(c.notice, 'passkeyAdded');}
          assert.equal(f.calls.filter(call => call.path.endsWith('/verify')).length, 1, 'only the current ceremony verifies');
        }
      });
    }
  }

  for (const error of [new DOMException('Cancelled', 'NotAllowedError'), new Error('Browser failed')]) {
    test(`obsolete ${mode} prompt ${error.name} preserves the next pending prompt`, {timeout: 5_000}, async () => {
      const f = fixture(mode), c = f.controller;
      const old = f.start(); await turn();
      c.fence();
      const current = f.start(); await turn();
      const before = f.snapshot();
      try {
        f.prompts[0]!.reject(error);
        assert.equal(await old, mode === 'enrollment' ? undefined : false);
        assert.deepEqual(f.snapshot(), before);
      } finally {f.prompts[1]!.resolve(f.response); await current;}
      assert.equal(c.pending, false);
      assert.equal(c.error, undefined);
      assert.equal(f.calls.filter(call => call.path.endsWith('/verify')).length, 1);
    });
  }

  test(`current ${mode} prompt verifies its exact response and completes`, {timeout: 5_000}, async () => {
    const f = fixture(mode), c = f.controller;
    const current = f.start(); await turn();
    assert.equal(c.pending, true);
    f.prompts[0]!.resolve(f.response);
    assert.equal(await current, mode === 'enrollment' ? undefined : 'authenticated');
    assert.deepEqual(f.calls, [
      {path: pathFor(mode) + '/options', body: mode === 'enrollment' ? {password: 'Current password'} : {}},
      {path: pathFor(mode) + '/verify', body: {ceremonyId: ceremony, response: f.response}},
      ...(mode === 'enrollment' ? [{path: '/passkeys', body: undefined}] : []),
    ]);
    assert.equal(c.pending, false);
    assert.equal(c.retryAt, 0);
    assert.equal(c.error, undefined);
    if (mode === 'enrollment') {assert.deepEqual(c.passkeys, [key]); assert.equal(c.notice, 'passkeyAdded');}
  });
}

for (const transition of ['account established', 'route change'] as const) {
  test(`signed-out sign-in prompt cannot verify after ${transition}`, {timeout: 5_000}, async () => {
    const f = fixture('sign-in', true), c = f.controller;
    const old = f.start(); await turn();
    assert.equal(f.prompts.length, 1);
    if (transition === 'account established') c.account('password-sign-in-owner');
    else c.fence();
    const before = f.snapshot();
    f.prompts[0]!.resolve(authentication);
    assert.equal(await old, false);
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.calls, [{path: '/passkeys/authentication/options', body: {}}]);
  });
}
