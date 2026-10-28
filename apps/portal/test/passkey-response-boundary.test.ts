import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {PasskeyController, type PasskeyBrowser} from '../src/passkey-controller.ts';

const id = '12345678-1234-4234-8234-123456789abc';
const key = {id, createdAt: '2026-10-28T09:00:00.000Z', lastUsedAt: null};
const added = {...key, id: '22345678-1234-4234-8234-123456789abc'};
const authentication = {ceremonyId: id, options: {challenge: 'challenge', rpId: 'cloud.example.test', userVerification: 'required'}};
const registration = {ceremonyId: id, options: {challenge: 'challenge',
  rp: {id: 'cloud.example.test', name: 'Waitron Cloud'},
  user: {id: 'owner', name: 'owner@example.test', displayName: 'Owner'},
  pubKeyCredParams: [{type: 'public-key', alg: -7}]}};
const registrationReply = {id: 'credential', rawId: 'credential', type: 'public-key' as const,
  clientExtensionResults: {}, response: {clientDataJSON: 'client', attestationObject: 'attestation'}};
const authenticationReply = {id: 'credential', rawId: 'credential', type: 'public-key' as const,
  clientExtensionResults: {}, response: {clientDataJSON: 'client', authenticatorData: 'authenticator', signature: 'signature', userHandle: 'owner'}};
const invalidLists = [
  {name: 'null envelope', value: null},
  {name: 'missing list', value: {}},
  {name: 'non-array list', value: {passkeys: {key}}},
  {name: 'null key', value: {passkeys: [null]}},
  {name: 'invalid key ID', value: {passkeys: [{...key, id: 'not-a-key'}]}},
  {name: 'invalid creation time', value: {passkeys: [{...key, createdAt: 'yesterday'}]}},
  {name: 'missing last-use time', value: {passkeys: [{id, createdAt: key.createdAt}]}},
  {name: 'too many keys', value: {passkeys: Array.from({length: 101}, () => key)}},
];

function environment(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=passkey-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

function device(events: string[]): PasskeyBrowser {
  return {supported: async () => true,
    register: async options => {events.push('register'); assert.deepEqual(options, registration.options); return registrationReply;},
    authenticate: async options => {events.push('authenticate'); assert.deepEqual(options, authentication.options); return authenticationReply;}};
}

for (const entry of invalidLists) {
  test(`passkey HTTP ${entry.name} cannot supply removal targets and a valid read recovers`, async t => {
    let value: unknown = entry.value;
    const paths: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {paths.push(url); return Response.json(value);});
    const controller = new PasskeyController(() => {}, accountRequest, device([]));
    controller.account('owner');
    await controller.load();
    assert.deepEqual(controller.passkeys, []);
    assert.equal(controller.loaded, true);
    assert.equal(controller.listLoaded, false);
    assert.equal(controller.error, 'passkeyUnavailable');
    assert.equal(controller.pending, false);
    await controller.remove(id, 'current password');
    assert.deepEqual(paths, ['/api/account/passkeys']);
    value = {passkeys: [key]};
    await controller.load();
    assert.deepEqual(controller.passkeys, [key]);
    assert.equal(controller.listLoaded, true);
    assert.equal(controller.error, undefined);
    assert.equal(controller.notice, undefined);
    assert.deepEqual(paths, ['/api/account/passkeys', '/api/account/passkeys']);
  });
}

for (const [operation, valid, invalid] of [
  ['authentication', authentication, [
    {name: 'missing ceremony', value: {options: authentication.options}},
    {name: 'invalid ceremony ID', value: {...authentication, ceremonyId: 'invalid'}},
    {name: 'invalid challenge', value: {...authentication, options: {...authentication.options, challenge: 'with spaces'}}},
    {name: 'missing relying party', value: {...authentication, options: {challenge: 'challenge'}}},
    {name: 'invalid verification preference', value: {...authentication, options: {...authentication.options, userVerification: 'never'}}},
  ]],
  ['registration', registration, [
    {name: 'missing ceremony', value: {options: registration.options}},
    {name: 'invalid ceremony ID', value: {...registration, ceremonyId: 'invalid'}},
    {name: 'invalid challenge', value: {...registration, options: {...registration.options, challenge: ''}}},
    {name: 'missing relying party', value: {...registration, options: {...registration.options, rp: {name: 'Waitron Cloud'}}}},
    {name: 'invalid user encoding', value: {...registration, options: {...registration.options, user: {...registration.options.user, id: 'with spaces'}}}},
    {name: 'no algorithms', value: {...registration, options: {...registration.options, pubKeyCredParams: []}}},
    {name: 'invalid algorithm', value: {...registration, options: {...registration.options, pubKeyCredParams: [{type: 'public-key', alg: 'wrong'}]}}},
  ]],
] as const) {
  for (const entry of invalid) {
    test(`passkey HTTP ${operation} options with ${entry.name} stop before prompting and allow explicit retry`, async t => {
      environment(t);
      let value: unknown = entry.value;
      const events: string[] = [];
      const paths: unknown[] = [];
      t.mock.method(globalThis, 'fetch', async (url: unknown) => {
        paths.push(url);
        if (url === `/api/account/passkeys/${operation}/options`) return Response.json(value);
        if (url === '/api/account/passkeys/authentication/verify') return Response.json({accountId: 'owner'});
        if (url === '/api/account/passkeys/registration/verify') return Response.json(added);
        assert.equal(url, '/api/account/passkeys');
        return Response.json({passkeys: [added]});
      });
      const controller = new PasskeyController(() => {}, accountRequest, device(events));
      controller.account('owner');
      if (operation === 'authentication') assert.equal(await controller.signIn(), false);
      else await controller.enroll('current password');
      assert.deepEqual(events, []);
      assert.deepEqual(paths, [`/api/account/passkeys/${operation}/options`]);
      assert.equal(controller.error, 'passkeyUnavailable');
      assert.equal(controller.notice, undefined);
      assert.equal(controller.pending, false);
      value = valid;
      if (operation === 'authentication') assert.equal(await controller.signIn(), 'authenticated');
      else {
        await controller.enroll('current password');
        assert.deepEqual(controller.passkeys, [added]);
        assert.equal(controller.notice, 'passkeyAdded');
      }
      assert.deepEqual(events, [operation === 'authentication' ? 'authenticate' : 'register']);
      assert.equal(controller.error, undefined);
      assert.equal(controller.pending, false);
      assert.deepEqual(paths, [`/api/account/passkeys/${operation}/options`,
        `/api/account/passkeys/${operation}/options`, `/api/account/passkeys/${operation}/verify`,
        ...(operation === 'registration' ? ['/api/account/passkeys'] : [])]);
    });
  }
}

for (const [name, reply] of [
  ['missing account', () => Response.json({})],
  ['empty account', () => Response.json({accountId: ''})],
  ['broken JSON', () => new Response('{')],
  ['lost reply', () => {throw new TypeError('private transport detail');}],
] as const) {
  test(`passkey sign-in with ${name} verification needs session reconciliation, then a valid attempt succeeds`, async t => {
    let healthy = false;
    const paths: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      paths.push(url);
      if (url === '/api/account/passkeys/authentication/options') return Response.json(authentication);
      assert.equal(url, '/api/account/passkeys/authentication/verify');
      return healthy ? Response.json({accountId: 'owner'}) : reply();
    });
    const controller = new PasskeyController(() => {}, accountRequest, device([]));
    assert.equal(await controller.signIn(), 'reconcile');
    assert.equal(controller.error, 'passkeySignInUncertain');
    assert.equal(controller.notice, undefined);
    assert.equal(controller.pending, false);
    assert.equal(paths.length, 2, 'an uncertain verification is never automatically retried');
    healthy = true;
    assert.equal(await controller.signIn(), 'authenticated');
    assert.equal(controller.error, undefined);
    assert.equal(paths.length, 4);
  });
}

for (const [name, reply] of [
  ['invalid summary ID', () => Response.json({...added, id: 'invalid'})],
  ['invalid summary time', () => Response.json({...added, lastUsedAt: 'yesterday'})],
  ['broken JSON', () => new Response('{')],
] as const) {
  for (const changed of [false, true]) {
    test(`passkey enrollment with ${name} verification confirms only a new key in a valid list, changed=${changed}`, async t => {
      environment(t);
      let verified = false;
      const paths: unknown[] = [];
      t.mock.method(globalThis, 'fetch', async (url: unknown) => {
        paths.push(url);
        if (url === '/api/account/passkeys') return Response.json({passkeys: verified && changed ? [key, added] : [key]});
        if (url === '/api/account/passkeys/registration/options') return Response.json(registration);
        assert.equal(url, '/api/account/passkeys/registration/verify');
        verified = true;
        return reply();
      });
      const controller = new PasskeyController(() => {}, accountRequest, device([]));
      controller.account('owner');
      await controller.load();
      await controller.enroll('current password');
      assert.deepEqual(controller.passkeys, changed ? [key, added] : [key]);
      assert.equal(controller.listLoaded, true);
      assert.equal(controller.pending, false);
      assert.equal(controller.error, changed ? undefined : 'passkeyChangeUncertain');
      assert.equal(controller.notice, changed ? 'passkeyAdded' : undefined);
      assert.deepEqual(paths, ['/api/account/passkeys', '/api/account/passkeys/registration/options',
        '/api/account/passkeys/registration/verify', '/api/account/passkeys']);
    });
  }
}

for (const operation of ['enroll', 'remove'] as const) {
  for (const outcome of ['accepted', 'lost'] as const) {
    test(`passkey ${operation} ${outcome} HTTP reply cannot confirm a change from a malformed reconciliation list`, async t => {
      environment(t);
      let list: unknown = {passkeys: [key]};
      const calls: Array<{url: unknown; init?: RequestInit}> = [];
      t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
        calls.push({url, init});
        if (url === '/api/account/passkeys') return Response.json(list);
        if (url === '/api/account/passkeys/registration/options') return Response.json(registration);
        assert.equal(url, operation === 'enroll' ? '/api/account/passkeys/registration/verify' : '/api/account/passkeys/remove');
        list = {passkeys: [{...added, createdAt: 'invalid'}]};
        if (outcome === 'lost') throw new TypeError('lost fixture reply');
        return operation === 'enroll' ? Response.json(added) : new Response(null, {status: 204});
      });
      const controller = new PasskeyController(() => {}, accountRequest, device([]));
      controller.account('owner');
      await controller.load();
      if (operation === 'enroll') await controller.enroll('current password');
      else await controller.remove(id, 'current password');
      assert.deepEqual(controller.passkeys, [key], 'a rejected list cannot replace the last usable list');
      assert.equal(controller.listLoaded, false);
      assert.equal(controller.notice, undefined, 'a malformed list proves neither addition nor removal');
      assert.equal(controller.error, operation === 'enroll' && outcome === 'accepted' ? 'passkeyUnavailable' : 'passkeyChangeUncertain');
      assert.equal(controller.pending, false);
      const expectedPaths = ['/api/account/passkeys',
        ...(operation === 'enroll' ? ['/api/account/passkeys/registration/options', '/api/account/passkeys/registration/verify'] : ['/api/account/passkeys/remove']),
        '/api/account/passkeys'];
      assert.deepEqual(calls.map(call => call.url), expectedPaths);
      for (const {url, init} of calls) {
        assert.equal(init?.credentials, 'same-origin');
        assert.equal(init?.method, url === '/api/account/passkeys' ? 'GET' : 'POST');
        assert.equal(new Headers(init?.headers).get('X-CSRF-Token'), url === '/api/account/passkeys' ? null : 'passkey-proof');
      }
      const writes = calls.filter(call => call.url !== '/api/account/passkeys');
      assert.deepEqual(writes.map(call => JSON.parse(String(call.init?.body))), operation === 'enroll'
        ? [{password: 'current password'}, {ceremonyId: id, response: registrationReply}]
        : [{id, password: 'current password'}]);
      list = {passkeys: operation === 'enroll' ? [key, added] : []};
      await controller.refresh();
      assert.deepEqual(controller.passkeys, operation === 'enroll' ? [key, added] : []);
      assert.equal(controller.listLoaded, true);
      assert.equal(controller.error, undefined);
      assert.equal(controller.notice, undefined, 'a passive refresh does not repeat or claim the earlier write');
      assert.deepEqual(calls.map(call => call.url), [...expectedPaths, '/api/account/passkeys']);
    });
  }
}

for (const operation of ['enroll', 'remove'] as const) {
  for (const changed of [false, true]) {
    test(`passkey ${operation} lost HTTP reply uses the valid reconciliation list with changed=${changed}`, async t => {
      environment(t);
      let list = [key];
      t.mock.method(globalThis, 'fetch', async (url: unknown) => {
        if (url === '/api/account/passkeys') return Response.json({passkeys: list});
        if (url === '/api/account/passkeys/registration/options') return Response.json(registration);
        assert.equal(url, operation === 'enroll' ? '/api/account/passkeys/registration/verify' : '/api/account/passkeys/remove');
        list = changed ? operation === 'enroll' ? [key, added] : [] : [key];
        throw new TypeError('lost fixture reply');
      });
      const controller = new PasskeyController(() => {}, accountRequest, device([]));
      controller.account('owner');
      await controller.load();
      if (operation === 'enroll') await controller.enroll('current password');
      else await controller.remove(id, 'current password');
      assert.deepEqual(controller.passkeys, changed ? operation === 'enroll' ? [key, added] : [] : [key]);
      assert.equal(controller.listLoaded, true);
      assert.equal(controller.pending, false);
      assert.equal(controller.error, changed ? undefined : 'passkeyChangeUncertain');
      assert.equal(controller.notice, changed ? operation === 'enroll' ? 'passkeyAdded' : 'passkeyRemoved' : undefined);
    });
  }
}

for (const [status, code, error] of [
  [401, 'unauthenticated', 'pairSession'],
  [403, 'credentials_invalid', 'passkeyPasswordInvalid'],
  [403, 'forbidden', 'forbidden'],
  [400, 'invalid_input', 'passkeyRegistrationRefused'],
] as const) {
  test(`passkey registration HTTP ${status}/${code} keeps its refusal distinct and never opens a prompt`, async t => {
    environment(t);
    const paths: unknown[] = [], events: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      paths.push(url);
      return Response.json({error: code}, {status});
    });
    const controller = new PasskeyController(() => {}, accountRequest, device(events));
    controller.account('owner');
    await controller.enroll('current password');
    assert.equal(controller.error, error);
    assert.equal(controller.notice, undefined);
    assert.equal(controller.pending, false);
    assert.deepEqual(events, []);
    assert.deepEqual(paths, ['/api/account/passkeys/registration/options']);
  });
}

test('passkey HTTP rate limits block another browser prompt until the advertised wait ends', async t => {
  let now = Date.parse('2026-10-28T09:00:00.000Z');
  t.mock.method(Date, 'now', () => now);
  const events: string[] = [], paths: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    paths.push(url);
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(new Headers(init?.headers).has('X-CSRF-Token'), false);
    if (paths.length === 1) return Response.json({error: 'rate_limited'}, {status: 429, headers: {'Retry-After': '30'}});
    if (url === '/api/account/passkeys/authentication/options') return Response.json(authentication);
    assert.equal(url, '/api/account/passkeys/authentication/verify');
    assert.deepEqual(JSON.parse(String(init?.body)), {ceremonyId: id, response: authenticationReply});
    return Response.json({accountId: 'owner'});
  });
  const controller = new PasskeyController(() => {}, accountRequest, device(events));
  assert.equal(await controller.signIn(), false);
  assert.equal(controller.error, 'limited');
  assert.equal(controller.waiting, 30);
  assert.equal(await controller.signIn(), false);
  assert.deepEqual(events, []);
  assert.deepEqual(paths, ['/api/account/passkeys/authentication/options']);
  now += 30_000;
  assert.equal(await controller.signIn(), 'authenticated');
  assert.equal(controller.waiting, 0);
  assert.equal(controller.error, undefined);
  assert.deepEqual(events, ['authenticate']);
  assert.deepEqual(paths, ['/api/account/passkeys/authentication/options', '/api/account/passkeys/authentication/options', '/api/account/passkeys/authentication/verify']);
});
