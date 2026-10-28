import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AuthenticatorController} from '../src/authenticator-controller.ts';
import type {accountRequest, ApiResult} from '../src/api.ts';
import type {FactorEnrolment, FactorStatus} from '../src/authenticator-types.ts';

const expiresAt = '2030-01-01T00:00:00.000Z';
const status: FactorStatus = {active: true, version: 3, recoveryCodesRemaining: 8, available: true};
const enrolment = (token: string): FactorEnrolment => ({
  pendingToken: token.repeat(43), secret: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP', expiresAt,
});
const ok = (value: unknown): ApiResult<unknown> => ({ok: true, value});
const limited: ApiResult<unknown> = {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 60_000};
const actions = ['load', 'begin', 'activate', 'remove', 'regenerate', 'cancel'] as const;
type Action = typeof actions[number];
const codes = Array.from({length: 10}, (_, i) => i.toString(16).padStart(32, '0').toUpperCase());
function success(action: Action): ApiResult<unknown> {
  if (action === 'load') return ok(status);
  if (action === 'begin') return ok(enrolment('A'));
  if (action === 'cancel') return ok(undefined);
  return ok(action === 'remove' ? {status: 'changed', active: false} : {status: 'changed', active: true, recoveryCodes: codes});
}
function fixture() {
  const requests: {path: string; body: Record<string, unknown> | undefined; finish: (reply: ApiResult<unknown>) => void}[] = [];
  let changes = 0;
  const request: typeof accountRequest = <T>(path: string, body?: Record<string, unknown>) =>
    new Promise<ApiResult<T>>(resolve => requests.push({path, body, finish: reply => resolve(reply as ApiResult<T>)}));
  const controller = new AuthenticatorController(() => {changes++;}, request);
  return {controller, requests, changes: () => changes};
}
function seed(controller: AuthenticatorController) {
  controller.challenge = {factorRequired: true, challengeToken: 'C'.repeat(43), expiresAt};
  controller.status = status;
  controller.enrolment = enrolment('A');
  controller.loaded = true;
  controller.loadAttempted = true;
  controller.password = 'old password';
  controller.proofCode = '123456';
  controller.confirmation = '654321';
}
function state(c: AuthenticatorController) {
  return {challenge: c.challenge, status: c.status, enrolment: c.enrolment,
    password: c.password, proofKind: c.proofKind, proofCode: c.proofCode, confirmation: c.confirmation,
    loaded: c.loaded, loadAttempted: c.loadAttempted, pending: c.pending,
    error: c.error, requiredField: c.requiredField, retryAt: c.retryAt};
}
function cleared(c: AuthenticatorController) {
  assert.equal(c.challenge, undefined);
  assert.equal(c.status, undefined);
  assert.equal(c.enrolment, undefined);
  assert.equal(c.password, '');
  assert.equal(c.proofCode, '');
  assert.equal(c.confirmation, '');
  assert.equal(c.loaded, false);
  assert.equal(c.loadAttempted, false);
  assert.equal(c.pending, false);
  assert.equal(c.error, undefined);
  assert.equal(c.requiredField, undefined);
}
function expectedRequest(action: Action) {
  if (action === 'load') return {path: '/authenticator', body: undefined};
  if (action === 'cancel') return {path: '/authenticator/cancel', body: {pendingToken: 'A'.repeat(43)}};
  return {path: `/authenticator/${action}`, body: {password: 'old password', proof: {kind: 'totp', code: '123456'},
    ...(action === 'activate' ? {pendingToken: 'A'.repeat(43), code: '654321'} : {})}};
}

// Removing any reply's generation check must expose old secrets, feedback or a released pending guard.
for (const action of actions) for (const outcome of ['success', 'rate limit'] as const) {
  for (const destination of ['another account', 'returning account'] as const) {
    for (const current of ['pending read', 'setup draft'] as const) {
      test(`late authenticator ${action} ${outcome} preserves ${current} for ${destination}`, async () => {
        const f = fixture(), c = f.controller;
        c.account('first'); seed(c);
        const old = c[action]();
        assert.deepEqual(f.requests.map(({path, body}) => ({path, body})), [expectedRequest(action)]);
        assert.equal(c.pending, true);
        c.account('second');
        if (destination === 'returning account') c.account('first');
        cleared(c);
        const read = c.load();
        assert.equal(f.requests.length, 2);
        assert.equal(c.pending, true);
        if (current === 'setup draft') {
          f.requests[1]!.finish(ok({...status, version: 4, recoveryCodesRemaining: 6})); await read;
          c.password = 'new password'; c.proofCode = '234567';
          const begin = c.begin();
          assert.equal(f.requests.length, 3);
          f.requests[2]!.finish(ok(enrolment('B'))); await begin;
          c.password = 'new draft password'; c.proofCode = '345678'; c.confirmation = '456789';
          c.error = 'factorConfirmationInvalid'; c.requiredField = 'confirmation';
        }
        const before = structuredClone(state(c)), changes = f.changes(), count = f.requests.length;
        f.requests[0]!.finish(outcome === 'success' ? success(action) : limited);
        assert.equal(await old, ['activate', 'remove', 'regenerate'].includes(action) ? false : undefined,
          'stale management results cannot return recovery codes to the caller');
        assert.deepEqual(state(c), before);
        assert.equal(f.changes(), changes, 'a stale reply cannot repaint the current settings');
        assert.equal(f.requests.length, count, 'a stale reply cannot start reconciliation');
        if (current === 'pending read') {
          await c.load(); assert.equal(f.requests.length, 2, 'the newer pending guard is still held');
          f.requests[1]!.finish(ok({...status, version: 4, recoveryCodesRemaining: 6})); await read;
          assert.equal(c.pending, false); assert.equal(c.loaded, true);
          assert.equal(c.status?.version, 4); assert.equal(c.status?.recoveryCodesRemaining, 6);
        } else {
          const cancel = c.cancel(); assert.equal(f.requests.length, 4, 'the current draft remains usable');
          assert.deepEqual(f.requests[3]!.body, {pendingToken: 'B'.repeat(43)});
          f.requests[3]!.finish(ok(undefined)); await cancel;
          assert.equal(c.enrolment, undefined); assert.equal(c.pending, false); assert.equal(c.error, undefined);
        }
      });
    }
  }
  test(`signed-out authenticator ignores late ${action} ${outcome}`, async () => {
    const f = fixture(), c = f.controller;
    c.account('first'); seed(c); const old = c[action]();
    assert.equal(f.requests.length, 1); c.account(undefined); cleared(c);
    const before = state(c), changes = f.changes();
    f.requests[0]!.finish(outcome === 'success' ? success(action) : limited);
    assert.equal(await old, ['activate', 'remove', 'regenerate'].includes(action) ? false : undefined);
    assert.deepEqual(state(c), before); assert.equal(f.changes(), changes);
    for (const next of actions) await c[next]();
    assert.equal(f.requests.length, 1, 'signed-out management cannot send another request');
  });
}

for (const action of ['activate', 'remove', 'regenerate'] as const) {
  for (const outcome of ['live old account', 'expired session'] as const) {
    test(`late ${action} reconciliation with ${outcome} preserves a later account's pending read`, async () => {
      const f = fixture(), c = f.controller;
      c.account('first'); seed(c); const old = c[action]();
      f.requests[0]!.finish({ok: false, status: 403, code: 'credentials_invalid', retryAfterMs: 0});
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(f.requests.length, 2); assert.equal(f.requests[1]!.path, '/session');
      c.account('second'); cleared(c); const read = c.load();
      const before = state(c), changes = f.changes();
      f.requests[1]!.finish(outcome === 'live old account' ? ok({accountId: 'first'}) :
        {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 0});
      assert.equal(await old, false); assert.deepEqual(state(c), before); assert.equal(f.changes(), changes);
      await c.load(); assert.equal(f.requests.length, 3);
      f.requests[2]!.finish(ok(status)); await read;
      assert.equal(c.loaded, true); assert.equal(c.pending, false); assert.equal(c.error, undefined);
    });
  }
}

test('selecting the same account keeps its pending authenticator read and accepts its result', async () => {
  const f = fixture(), c = f.controller;
  c.account('first'); const read = c.load(); c.account('first');
  assert.equal(c.pending, true); await c.load(); assert.equal(f.requests.length, 1);
  f.requests[0]!.finish(ok(status)); await read;
  assert.deepEqual(c.status, status); assert.equal(c.loaded, true); assert.equal(c.pending, false);
});
