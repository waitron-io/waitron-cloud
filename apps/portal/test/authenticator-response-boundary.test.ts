import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {AuthenticatorController} from '../src/authenticator-controller.ts';

const token = 'A'.repeat(43);
const expiresAt = '2030-01-01T00:00:00.000Z';
const status = {active: true, version: 2, recoveryCodesRemaining: 8, available: true};
const enrolment = {pendingToken: token, secret: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Cloud:owner?secret=JBSWY3DPEHPK3PXP&issuer=Cloud', expiresAt};
const codes = Array.from({length: 10}, (_, i) => i.toString(16).padStart(32, '0').toUpperCase());
const changed = {status: 'changed', active: true, recoveryCodes: codes};
type Reply = {body?: unknown; status?: number; retry?: string; brokenJson?: boolean; network?: boolean};

function harness(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=factor-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const replies: Record<string, Reply> = {
    '/authenticator': {body: status}, '/authenticator/begin': {body: enrolment},
    '/authenticator/activate': {body: changed}, '/authenticator/regenerate': {body: changed},
    '/authenticator/remove': {body: {status: 'changed', active: false}},
  };
  const calls: Array<{path: string; init: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(typeof url, 'string');
    assert.ok(init);
    const path = String(url).replace('/api/account', '');
    const reply = replies[path];
    assert.ok(reply, 'unexpected endpoint');
    calls.push({path, init});
    if (reply.network) throw new Error('connection lost');
    const options: ResponseInit = {status: reply.status ?? 200, headers: reply.retry ? {'Retry-After': reply.retry} : {}};
    return reply.brokenJson ? new Response('{', options) : Response.json(reply.body, options);
  });
  const controller = new AuthenticatorController(() => {});
  controller.account('owner');
  return {controller, replies, calls};
}

function authority(c: AuthenticatorController) {
  c.password = 'current password'; c.proofCode = '123456'; c.confirmation = '654321';
}

function cleared(c: AuthenticatorController) {
  assert.equal(c.password, ''); assert.equal(c.proofCode, ''); assert.equal(c.confirmation, '');
  assert.equal(c.pending, false);
}

const badStatuses = [
  {name: 'null', body: null},
  {name: 'missing availability', body: {active: true, version: 2, recoveryCodesRemaining: 8}},
  {name: 'string active flag', body: {...status, active: 'true'}},
  {name: 'active zero version', body: {...status, version: 0}},
  {name: 'unsafe version', body: {...status, version: Number.MAX_SAFE_INTEGER + 1}},
  {name: 'negative remaining codes', body: {...status, recoveryCodesRemaining: -1}},
  {name: 'fractional remaining codes', body: {...status, recoveryCodesRemaining: 1.5}},
  {name: 'too many remaining codes', body: {...status, recoveryCodesRemaining: 11}},
  {name: 'unexpected secret', body: {...status, secret: enrolment.secret}},
  {name: 'unexpected success status', body: status, status: 202},
  {name: 'broken JSON', brokenJson: true},
  {name: 'lost connection', network: true},
];

for (const entry of badStatuses) {
  test(`authenticator HTTP status ${entry.name} cannot replace a confirmed factor state`, async t => {
    const {controller: c, replies, calls} = harness(t);
    await c.load();
    replies['/authenticator'] = entry;
    await c.load();
    assert.deepEqual(c.status, status);
    assert.equal(c.loaded, false);
    assert.equal(c.loadAttempted, true);
    assert.equal(c.error, 'factorUnavailable');
    assert.equal(c.pending, false);
    assert.equal(calls.length, 2);
    replies['/authenticator'] = {body: {active: false, version: 0, recoveryCodesRemaining: 0, available: false}};
    await c.load();
    assert.deepEqual(c.status, {active: false, version: 0, recoveryCodesRemaining: 0, available: false});
    assert.equal(c.loaded, true); assert.equal(c.error, undefined);
    assert.equal(calls.length, 3);
  });
}

const badSetups = [
  {name: 'null', body: null},
  {name: 'short token', body: {...enrolment, pendingToken: 'short'}},
  {name: 'invalid expiry', body: {...enrolment, expiresAt: 'later'}},
  {name: 'invalid secret', body: {...enrolment, secret: 'lowercase'}},
  {name: 'web URI', body: {...enrolment, uri: 'https://totp/Cloud?secret=JBSWY3DPEHPK3PXP'}},
  {name: 'counter URI', body: {...enrolment, uri: 'otpauth://hotp/Cloud?secret=JBSWY3DPEHPK3PXP'}},
  {name: 'different URI secret', body: {...enrolment, uri: 'otpauth://totp/Cloud?secret=AAAAAAAAAAAAAAAA'}},
  {name: 'URI credentials', body: {...enrolment, uri: 'otpauth://user@totp/Cloud?secret=JBSWY3DPEHPK3PXP'}},
  {name: 'URI fragment', body: {...enrolment, uri: enrolment.uri + '#extra'}},
  {name: 'unexpected recovery codes', body: {...enrolment, recoveryCodes: codes}},
  {name: 'unexpected success status', body: enrolment, status: 202},
  {name: 'broken JSON', brokenJson: true},
  {name: 'lost connection', network: true},
];

for (const entry of badSetups) {
  test(`authenticator HTTP setup ${entry.name} cannot publish a setup secret`, async t => {
    const {controller: c, replies, calls} = harness(t);
    await c.load(); authority(c);
    replies['/authenticator/begin'] = entry;
    await c.begin();
    assert.equal(c.enrolment, undefined);
    assert.deepEqual(c.status, status);
    assert.equal(c.error, 'factorChangeUncertain'); cleared(c);
    assert.equal(calls.length, 2, 'uncertain setup must not automatically repeat its write');
    replies['/authenticator/begin'] = {body: enrolment}; authority(c);
    await c.begin();
    assert.deepEqual(c.enrolment, enrolment);
    assert.equal(c.error, undefined); cleared(c);
    assert.equal(calls.length, 3);
    const write = calls.at(-1)!;
    assert.equal(write.path, '/authenticator/begin');
    assert.equal(write.init.method, 'POST'); assert.equal(write.init.credentials, 'same-origin');
    assert.equal(new Headers(write.init.headers).get('X-CSRF-Token'), 'factor-proof');
    assert.deepEqual(JSON.parse(String(write.init.body)), {password: 'current password', proof: {kind: 'totp', code: '123456'}});
  });
}

const actions = ['activate', 'regenerate', 'remove'] as const;
for (const action of actions) {
  const valid = action === 'remove' ? {status: 'changed', active: false} : changed;
  const invalid: Array<Reply & {name: string}> = [
    {name: 'null', body: null},
    {name: 'wrong active state', body: {...valid, active: action === 'remove'}},
    {name: 'wrong outcome', body: {...valid, status: 'pending'}},
    {name: 'unexpected secret', body: {...valid, secret: enrolment.secret}},
    {name: 'unexpected success status', body: valid, status: 202},
    {name: 'broken JSON', brokenJson: true},
    {name: 'lost connection', network: true},
    {name: 'service refusal', status: 503, body: {error: 'temporarily_unavailable'}},
    ...(action === 'remove' ? [{name: 'unexpected recovery codes', body: {...valid, recoveryCodes: codes}}] : [
      {name: 'missing recovery codes', body: {status: 'changed', active: true}},
      {name: 'too few recovery codes', body: {...changed, recoveryCodes: codes.slice(1)}},
      {name: 'duplicate recovery codes', body: {...changed, recoveryCodes: [...codes.slice(1), codes[1]]}},
      {name: 'invalid recovery code', body: {...changed, recoveryCodes: [...codes.slice(1), 'not-a-code']}},
    ]),
  ];
  for (const entry of invalid) {
    test(`authenticator HTTP ${action} ${entry.name} requires reconciliation without publishing recovery codes`, async t => {
      const {controller: c, replies, calls} = harness(t);
      await c.load();
      if (action === 'activate') {authority(c); await c.begin();}
      authority(c);
      const before = calls.length;
      replies[`/authenticator/${action}`] = entry;
      assert.equal(await c[action](), 'reconcile');
      assert.equal(c.error, 'factorChangeUncertain');
      assert.equal(c.enrolment, undefined); assert.equal(c.challenge, undefined);
      assert.deepEqual(c.status, status); cleared(c);
      assert.equal(calls.length, before + 1, 'uncertain change must not automatically retry or reload');
      await c.refresh();
      assert.deepEqual(c.status, status);
      if (action === 'activate') {authority(c); await c.begin();}
      replies[`/authenticator/${action}`] = {body: valid}; authority(c);
      assert.deepEqual(await c[action](), valid);
      assert.equal(c.status, undefined); assert.equal(c.loaded, false);
      assert.equal(c.enrolment, undefined); assert.equal(c.error, undefined); cleared(c);
      const write = calls.at(-1)!;
      assert.equal(write.path, `/authenticator/${action}`);
      assert.equal(write.init.method, 'POST'); assert.equal(write.init.credentials, 'same-origin');
      assert.equal(new Headers(write.init.headers).get('X-CSRF-Token'), 'factor-proof');
      assert.deepEqual(JSON.parse(String(write.init.body)), {password: 'current password', proof: {kind: 'totp', code: '123456'},
        ...(action === 'activate' ? {pendingToken: token, code: '654321'} : {})});
    });
  }

  test(`authenticator HTTP ${action} keeps a refused change blocked until Retry-After ends`, async t => {
    const {controller: c, replies, calls} = harness(t);
    let now = 1_800_000_000_000;
    t.mock.method(Date, 'now', () => now);
    await c.load();
    if (action === 'activate') {authority(c); await c.begin();}
    authority(c);
    const before = calls.length;
    replies[`/authenticator/${action}`] = {status: 429, body: {error: 'rate_limited'}, retry: '30'};
    assert.equal(await c[action](), false);
    assert.equal(c.error, 'limited'); assert.equal(c.retryAt, now + 30_000); cleared(c);
    assert.deepEqual(c.status, status);
    authority(c); assert.equal(await c[action](), false);
    assert.equal(calls.length, before + 1);
    now += 30_000; replies[`/authenticator/${action}`] = {body: valid};
    assert.deepEqual(await c[action](), valid);
    assert.equal(calls.length, before + 2); assert.equal(c.error, undefined); cleared(c);
  });
}
