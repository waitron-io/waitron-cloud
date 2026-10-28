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
const prefix = '/api/account';

function environment(t: TestContext) {
  for (const [name, value] of [['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=passkey-proof'}]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name);});
  }
}
function browser(events: string[]): PasskeyBrowser {
  return {supported: async () => true,
    register: async options => {assert.deepEqual(options, registration.options); events.push('register'); return registrationReply;},
    authenticate: async options => {assert.deepEqual(options, authentication.options); events.push('authenticate'); return authenticationReply;}};
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}

// Trusting a refused body or replaying a failed read would replace usable removal targets.
for (const failure of ['lost', 'unreadable', 'refused'] as const) {
  test(`passkey ${failure} list retains usable keys and requires an explicit read retry`, async t => {
    let failed = false;
    const paths: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      paths.push(url);
      assert.equal(url, prefix + '/passkeys');
      if (!failed) return Response.json({passkeys: [key]});
      if (failure === 'lost') throw new TypeError('fixture lost reply');
      if (failure === 'unreadable') return new Response('{');
      return Response.json({passkeys: [added]}, {status: 503});
    });
    const c = new PasskeyController(() => {}, accountRequest, browser([])); c.account('owner');
    await c.load(); failed = true; c.password = 'old password'; await c.refresh();
    assert.deepEqual(c.passkeys, [key]); assert.equal(c.password, '');
    assert.equal(c.loaded, true); assert.equal(c.listLoaded, false);
    assert.equal(c.pending, false); assert.equal(c.error, 'passkeyUnavailable'); assert.equal(c.notice, undefined);
    assert.deepEqual(paths, [prefix + '/passkeys', prefix + '/passkeys']);
    failed = false; await c.refresh();
    assert.deepEqual(c.passkeys, [key]); assert.equal(c.listLoaded, true); assert.equal(c.error, undefined);
    assert.equal(paths.length, 3);
  });
}

// Bypassing the options failure branch would open a prompt without an accepted ceremony.
for (const mode of ['sign-in', 'enroll'] as const) for (const failure of ['lost', 'unreadable', 'refused'] as const) {
  test(`passkey ${mode} ${failure} options cannot open a prompt and explicit retry succeeds`, async t => {
    environment(t);
    let failed = true, verified = false;
    const events: string[] = [], paths: unknown[] = [];
    const optionsPath = mode === 'enroll' ? '/passkeys/registration/options' : '/passkeys/authentication/options';
    const verifyPath = mode === 'enroll' ? '/passkeys/registration/verify' : '/passkeys/authentication/verify';
    const options = mode === 'enroll' ? registration : authentication;
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      paths.push(url);
      if (url === prefix + optionsPath) {
        if (!failed) return Response.json(options);
        if (failure === 'lost') throw new TypeError('fixture lost reply');
        if (failure === 'unreadable') return new Response('{');
        return Response.json(options, {status: 503});
      }
      if (url === prefix + '/passkeys') return Response.json({passkeys: verified ? [added] : []});
      assert.equal(url, prefix + verifyPath); verified = true;
      return Response.json(mode === 'enroll' ? added : {accountId: 'owner'});
    });
    const c = new PasskeyController(() => {}, accountRequest, browser(events)); c.account('owner');
    const act = () => mode === 'enroll' ? c.enroll('current password') : c.signIn();
    await act();
    assert.deepEqual(events, []); assert.equal(c.pending, false);
    assert.equal(c.error, 'passkeyUnavailable'); assert.equal(c.notice, undefined);
    assert.deepEqual(paths, [prefix + optionsPath]);
    failed = false;
    assert.equal(await act(), mode === 'enroll' ? undefined : 'authenticated');
    assert.deepEqual(events, [mode === 'enroll' ? 'register' : 'authenticate']);
    assert.equal(c.error, undefined); assert.equal(c.notice, mode === 'enroll' ? 'passkeyAdded' : undefined);
    assert.deepEqual(paths, [prefix + optionsPath, prefix + optionsPath, prefix + verifyPath,
      ...(mode === 'enroll' ? [prefix + '/passkeys'] : [])]);
  });
}

// Missing pending gates duplicate a ceremony, write or reconciliation read while HTTP is unresolved.
for (const mode of ['load', 'sign-in', 'enroll', 'remove'] as const) {
  const stages = mode === 'load' ? ['list'] : mode === 'sign-in' ? ['options', 'verify']
    : mode === 'enroll' ? ['options', 'verify', 'list'] : ['verify', 'list'];
  for (const stage of stages) test(`passkey ${mode} blocks duplicate actions during pending HTTP ${stage}`, async t => {
    environment(t);
    const held = deferred<Response>(), reached = deferred<void>();
    const paths: unknown[] = [], events: string[] = [];
    let completedWrite = false;
    const stem = mode === 'sign-in' ? '/passkeys/authentication' : '/passkeys/registration';
    const heldPath = stage === 'list' ? '/passkeys' : mode === 'remove' ? '/passkeys/remove' : stem + '/' + stage;
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      paths.push(url);
      const path = String(url).slice(prefix.length);
      assert.equal(init?.credentials, 'same-origin');
      assert.equal(init?.method, path === '/passkeys' ? 'GET' : 'POST');
      const proof = path.startsWith('/passkeys/registration/') || path === '/passkeys/remove';
      assert.equal(new Headers(init?.headers).get('X-CSRF-Token'), proof ? 'passkey-proof' : null);
      if (path !== '/passkeys') assert.deepEqual(JSON.parse(String(init?.body)),
        path.endsWith('/options') ? mode === 'enroll' ? {password: 'current password'} : {}
          : mode === 'remove' ? {id, password: 'current password'}
          : {ceremonyId: id, response: mode === 'enroll' ? registrationReply : authenticationReply});
      if (path === heldPath) {reached.resolve(); return held.promise;}
      if (path === '/passkeys') return Response.json({passkeys: mode === 'remove' ? [] : [key, added]});
      if (path.endsWith('/options')) return Response.json(mode === 'enroll' ? registration : authentication);
      assert.equal(path, mode === 'remove' ? '/passkeys/remove' : stem + '/verify'); completedWrite = true;
      return mode === 'remove' ? new Response(null, {status: 204}) : Response.json(mode === 'enroll' ? added : {accountId: 'owner'});
    });
    const c = new PasskeyController(() => {}, accountRequest, browser(events));
    c.account('owner'); c.supported = true; c.passkeys = [key]; c.listLoaded = true;
    const act = () => mode === 'load' ? c.load() : mode === 'sign-in' ? c.signIn()
      : mode === 'enroll' ? c.enroll('current password') : c.remove(id, 'current password');
    const first = act(); await reached.promise;
    assert.equal(c.pending, true);
    const before = [...paths], prompts = [...events];
    // Do not await duplicate actions: a missing guard would wait on the same held response.
    const duplicates = [act(), c.refresh()];
    assert.deepEqual(paths, before); assert.deepEqual(events, prompts); assert.equal(c.pending, true);
    held.resolve(stage === 'list' ? Response.json({passkeys: mode === 'remove' ? [] : [key, added]})
      : stage === 'options' ? Response.json(mode === 'enroll' ? registration : authentication)
      : mode === 'remove' ? new Response(null, {status: 204}) : Response.json(mode === 'enroll' ? added : {accountId: 'owner'}));
    const outcome = await first; await Promise.all(duplicates);
    assert.equal(outcome, mode === 'sign-in' ? 'authenticated' : undefined);
    assert.equal(c.pending, false); assert.equal(c.error, undefined);
    assert.equal(c.notice, mode === 'enroll' ? 'passkeyAdded' : mode === 'remove' ? 'passkeyRemoved' : undefined);
    assert.deepEqual(paths, mode === 'load' ? [prefix + '/passkeys'] : mode === 'remove'
      ? [prefix + '/passkeys/remove', prefix + '/passkeys'] : [prefix + stem + '/options', prefix + stem + '/verify',
        ...(mode === 'enroll' ? [prefix + '/passkeys'] : [])]);
    if (stage === 'list' && mode !== 'load') assert.equal(completedWrite, true);
  });
}

// Losing a wait on an account change or omitting a wait gate would permit an early request.
for (const mode of ['load', 'enroll', 'remove'] as const) for (const format of ['seconds', 'date'] as const) {
  test(`passkey ${mode} respects HTTP ${format} retry expiry across account changes`, async t => {
    environment(t);
    let now = Date.parse('2026-10-28T09:00:00.000Z'), limited = true;
    t.mock.method(Date, 'now', () => now);
    const paths: unknown[] = [], events: string[] = [];
    const refusedPath = mode === 'load' ? '/passkeys' : mode === 'enroll' ? '/passkeys/registration/options' : '/passkeys/remove';
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      paths.push(url);
      if (limited && url === prefix + refusedPath) return Response.json({error: 'rate_limited'},
        {status: 429, headers: {'Retry-After': format === 'seconds' ? '7' : 'Wed, 28 Oct 2026 09:00:07 GMT'}});
      if (url === prefix + '/passkeys') return Response.json({passkeys: mode === 'remove' && !limited ? [] : [key]});
      if (url === prefix + '/passkeys/registration/options') return Response.json(registration);
      assert.equal(url, mode === 'remove' ? prefix + '/passkeys/remove' : prefix + '/passkeys/registration/verify');
      return mode === 'remove' ? new Response(null, {status: 204}) : Response.json(added);
    });
    const c = new PasskeyController(() => {}, accountRequest, browser(events)); c.account('owner'); c.passkeys = [key];
    const act = () => mode === 'load' ? c.load() : mode === 'enroll' ? c.enroll('current password') : c.remove(id, 'current password');
    await act(); assert.equal(c.error, 'limited'); assert.equal(c.waiting, 7); assert.equal(c.pending, false);
    const initial = [...paths]; c.account('next-owner'); c.passkeys = [key];
    now += 6_999; await act(); await c.refresh();
    assert.equal(c.waiting, 1); assert.deepEqual(paths, initial); assert.deepEqual(events, []);
    now++; limited = false; await act();
    assert.equal(c.waiting, 0); assert.equal(c.error, undefined); assert.equal(c.pending, false);
    assert.deepEqual(paths, [...initial, prefix + refusedPath,
      ...(mode === 'enroll' ? [prefix + '/passkeys/registration/verify', prefix + '/passkeys'] : mode === 'remove' ? [prefix + '/passkeys'] : [])]);
    assert.equal(c.notice, mode === 'enroll' ? 'passkeyAdded' : mode === 'remove' ? 'passkeyRemoved' : undefined);
  });
}
