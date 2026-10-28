import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {AuthenticatorController} from '../src/authenticator-controller.ts';

const token = 'A'.repeat(43);
const expiresAt = '2030-01-01T00:00:00.000Z';
const active = {active: true, version: 2, recoveryCodesRemaining: 8, available: true};
const enrolment = {pendingToken: token, secret: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Cloud:owner?secret=JBSWY3DPEHPK3PXP&issuer=Cloud', expiresAt};
type Reply = {status?: number; body?: unknown; retry?: string; unreadable?: boolean; lost?: boolean};

function fixture(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=factor-transport-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const replies: Reply[] = [];
  const requests: Array<{url: string; init: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.ok(init);
    requests.push({url: String(url), init});
    assert.ok(replies.length, 'each HTTP request needs an explicit outcome');
    const reply = replies.shift()!;
    if (reply.lost) throw new TypeError('private connection failure');
    const response = new Response(reply.status === 204 ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200, headers: reply.retry ? {'Retry-After': reply.retry} : {},
    });
    if (reply.unreadable) Object.defineProperty(response, 'json', {
      value: async () => { throw new TypeError('private response failure'); },
    });
    return response;
  });
  const controller = new AuthenticatorController(() => {});
  controller.account('owner');
  return {controller, replies, requests};
}

function authority(c: AuthenticatorController) {
  c.password = 'current password'; c.proofCode = '123456'; c.confirmation = '654321';
}

function cleared(c: AuthenticatorController) {
  assert.equal(c.password, ''); assert.equal(c.proofCode, ''); assert.equal(c.confirmation, '');
  assert.equal(c.pending, false); assert.equal(c.requiredField, undefined);
}

function request(actual: {url: string; init: RequestInit}, path: string, body?: Record<string, unknown>) {
  assert.equal(actual.url, `/api/account${path}`);
  assert.equal(actual.init.method, body ? 'POST' : 'GET');
  assert.equal(actual.init.credentials, 'same-origin');
  assert.deepEqual(actual.init.headers, body
    ? {'Content-Type': 'application/json', 'X-CSRF-Token': 'factor-transport-proof'} : {});
  assert.deepEqual(actual.init.body ? JSON.parse(String(actual.init.body)) : undefined, body);
}

const sessions: Array<{name: string; reply: Reply; outcome: false | 'reconcile'; error: string}> = [
  {name: 'current account', reply: {body: {accountId: 'owner', expiresAt}}, outcome: false, error: 'credentials'},
  {name: 'another account', reply: {body: {accountId: 'other', expiresAt}}, outcome: 'reconcile', error: 'factorChangeUncertain'},
  {name: 'expired with a success-shaped body', reply: {status: 401, body: {accountId: 'owner', expiresAt}}, outcome: 'reconcile', error: 'factorChangeUncertain'},
  {name: 'unreadable body', reply: {unreadable: true}, outcome: 'reconcile', error: 'factorChangeUncertain'},
  {name: 'lost connection', reply: {lost: true}, outcome: 'reconcile', error: 'factorChangeUncertain'},
];

for (const action of ['activate', 'remove', 'regenerate'] as const) for (const session of sessions) {
  test(`authenticator HTTP ${action} credentials refusal rechecks ${session.name} without replaying the change`, async t => {
    const f = fixture(t); const c = f.controller;
    f.replies.push({body: active}); await c.load();
    authority(c); f.replies.push({body: enrolment}); await c.begin();
    authority(c);
    f.replies.push({status: 403, body: {error: 'credentials_invalid'}}, session.reply);
    assert.equal(await c[action](), session.outcome);
    assert.equal(c.error, session.error);
    assert.deepEqual(c.status, active); assert.equal(c.loaded, true);
    assert.deepEqual(c.enrolment, session.outcome === false ? enrolment : undefined);
    cleared(c);
    assert.equal(f.requests.length, 4, 'one change is followed only by one session read');
    request(f.requests[0]!, '/authenticator');
    request(f.requests[1]!, '/authenticator/begin', {password: 'current password', proof: {kind: 'totp', code: '123456'}});
    request(f.requests[2]!, `/authenticator/${action}`, {
      password: 'current password', proof: {kind: 'totp', code: '123456'},
      ...(action === 'activate' ? {pendingToken: token, code: '654321'} : {}),
    });
    request(f.requests[3]!, '/session');
    assert.equal(f.replies.length, 0);
  });
}

for (const failure of [
  {name: 'lost reply', reply: {lost: true}, error: 'factorUnavailable'},
  {name: 'unreadable reply', reply: {unreadable: true}, error: 'factorUnavailable'},
  {name: 'unconfirmed success', reply: {body: {status: 'cancelled'}}, error: 'factorUnavailable'},
  {name: 'permission refusal', reply: {status: 403, body: {error: 'permission_denied'}}, error: 'forbidden'},
] satisfies Array<{name: string; reply: Reply; error: string}>) {
  test(`authenticator cancellation ${failure.name} discards its secret and requires an explicit fresh setup`, async t => {
    const f = fixture(t); const c = f.controller;
    f.replies.push({body: active}); await c.load();
    authority(c); f.replies.push({body: enrolment}); await c.begin();
    authority(c); f.replies.push(failure.reply); await c.cancel();
    assert.equal(c.error, failure.error); assert.equal(c.enrolment, undefined);
    assert.deepEqual(c.status, active); cleared(c);
    assert.equal(f.requests.length, 3);
    request(f.requests[2]!, '/authenticator/cancel', {pendingToken: token});
    await c.cancel(); assert.equal(f.requests.length, 3, 'an erased setup cannot repeat its cancellation');
    f.replies.push({body: active}); await c.refresh();
    assert.equal(c.enrolment, undefined); assert.equal(c.error, undefined);
    authority(c); f.replies.push({body: enrolment}); await c.begin();
    f.replies.push({status: 204}); await c.cancel();
    assert.equal(c.error, undefined); assert.equal(c.enrolment, undefined); cleared(c);
    assert.equal(f.requests.length, 6);
    request(f.requests[3]!, '/authenticator');
    request(f.requests[4]!, '/authenticator/begin', {password: 'current password', proof: {kind: 'totp', code: '123456'}});
    request(f.requests[5]!, '/authenticator/cancel', {pendingToken: token});
    assert.equal(f.replies.length, 0);
  });
}

for (const operation of ['load', 'begin', 'cancel'] as const) for (const format of ['seconds', 'date'] as const) for (const switchAccount of [false, true]) {
  test(`authenticator HTTP ${operation} ${format} wait lasts to its boundary${switchAccount ? ' through account changes' : ''}`, async t => {
    let now = 1_800_000_000_000;
    t.mock.method(Date, 'now', () => now);
    const f = fixture(t); const c = f.controller;
    f.replies.push({body: active}); await c.load();
    authority(c); f.replies.push({body: enrolment}); await c.begin();
    authority(c);
    f.replies.push({status: 429, body: {error: 'rate_limited'}, retry: format === 'seconds' ? '30' : new Date(now + 30_000).toUTCString()});
    await c[operation]();
    assert.equal(c.retryAt, 1_800_000_030_000); assert.equal(c.error, 'limited');
    if (operation === 'load') {assert.equal(c.password, 'current password'); assert.equal(c.pending, false);}
    else cleared(c);
    assert.equal(f.requests.length, 3);
    request(f.requests[2]!, operation === 'load' ? '/authenticator' : `/authenticator/${operation}`,
      operation === 'load' ? undefined : operation === 'cancel' ? {pendingToken: token}
        : {password: 'current password', proof: {kind: 'totp', code: '123456'}});
    if (switchAccount) {c.account('other'); c.account(undefined); c.account('owner');}
    authority(c);
    now += 29_999;
    await c.load(); await c.refresh(); await c.begin(); await c.cancel();
    assert.equal(f.requests.length, 3, 'all management requests stay blocked one millisecond before the boundary');
    assert.equal(c.pending, false); assert.equal(c.password, 'current password');
    assert.equal(c.retryAt, 1_800_000_030_000);
    now++;
    f.replies.push({body: active}); await c.refresh();
    assert.equal(c.loaded, true); assert.deepEqual(c.status, active);
    assert.equal(c.error, undefined); assert.equal(c.enrolment, undefined); cleared(c);
    assert.equal(f.requests.length, 4); request(f.requests[3]!, '/authenticator');
    assert.equal(f.replies.length, 0);
  });
}
