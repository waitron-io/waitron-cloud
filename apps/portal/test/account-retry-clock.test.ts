import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {PasskeyController} from '../src/passkey-controller.ts';
import {AuthenticatorController} from '../src/authenticator-controller.ts';
import {AccountSecurityController} from '../src/account-security-controller.ts';
import {PortalSession} from '../src/session.ts';

const start = Date.parse('2026-11-04T12:00:00Z');
function clock(t: TestContext) {
  const cleanups: Array<() => void> = [];
  t.after(() => {for (const cleanup of cleanups) cleanup();});
  let wall = start, elapsed = 0;
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => elapsed);
  const document = Object.assign(new EventTarget(), {visibilityState: 'visible', cookie: '__Host-cloud_csrf=clock-proof'});
  for (const [name, value] of [['location', {protocol: 'https:'}], ['document', document]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name);});
  }
  const replies: Array<Response | Promise<Response>> = [], calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    calls.push(String(url));
    assert.ok(replies.length, 'every request needs a planned response');
    return await replies.shift()!;
  });
  t.after(() => assert.equal(replies.length, 0));
  return {replies, calls, document, cleanups, wall: (value: number) => {wall = value;}, elapsed: (value: number) => {elapsed = value;}};
}
function refused(retry?: string, date?: string) {
  return Response.json({error: 'rate_limited'}, {status: 429,
    headers: {...(retry ? {'Retry-After': retry} : {}), ...(date ? {Date: date} : {})}});
}
const panels = ['passkey', 'authenticator', 'security'] as const;
function panel(t: TestContext, name: typeof panels[number]) {
  const f = clock(t);
  const c = name === 'passkey' ? new PasskeyController(() => {})
    : name === 'authenticator' ? new AuthenticatorController(() => {}) : new AccountSecurityController(() => {}, () => {});
  c.account('owner');
  return {...f, c, perform: () => c.load()};
}

// Replacing an elapsed deadline with Date.now() extends, bypasses or revives the request gate.
for (const name of panels) for (const correction of [-3_600_000, 3_600_000]) {
  test(`${name}: a clock correction cannot change a live retry or revive its expired wait`, async t => {
    const f = panel(t, name);
    f.replies.push(refused('2')); await f.perform();
    f.c.account('next-owner'); f.wall(start + correction);
    assert.equal(f.c.retryAt, start + correction + 2_000);
    f.elapsed(1_999); await f.perform(); assert.equal(f.calls.length, 1);
    assert.equal(f.c.retryAt, start + correction + 1);
    f.elapsed(2_000); assert.equal(f.c.retryAt, 0);
    f.wall(start - 7_200_000); assert.equal(f.c.retryAt, 0);
    assert.equal(f.calls.length, 1, 'expiry does not retry automatically');
    f.replies.push(refused()); await f.perform(); assert.equal(f.calls.length, 2);
  });
  test(`${name}: a refusal without a new wait cannot revive the old deadline`, async t => {
    const f = panel(t, name);
    f.replies.push(refused('2')); await f.perform();
    f.elapsed(2_000); f.wall(start + 2_000);
    let release!: (value: Response) => void;
    f.replies.push(new Promise(resolve => {release = resolve;}));
    const pending = f.perform();
    f.wall(start + correction); release(refused()); await pending;
    assert.equal(f.c.retryAt, 0);
    f.replies.push(refused()); await f.perform(); assert.equal(f.calls.length, 3);
  });
}

const owner = {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'};
const activity = {isTrusted: true, type: 'keydown'} as Event;
test('session activity throttle measures a minute of elapsed time through a backward clock correction', async t => {
  const f = clock(t), session = new PortalSession(() => {});
  f.cleanups.push(() => session.dispose());
  f.replies.push(Response.json(owner), Response.json(owner));
  await session.check(); await session.activity(activity);
  f.wall(start - 3_600_000); f.elapsed(59_999);
  await session.activity(activity); assert.equal(f.calls.length, 2);
  f.elapsed(60_000); f.replies.push(Response.json(owner));
  await session.activity(activity); assert.equal(f.calls.length, 3);
});
for (const action of ['check', 'activity', 'logout'] as const) for (const correction of [-3_600_000, 3_600_000]) {
  test(`session ${action}: clock correction keeps explicit and visibility retries behind the elapsed wait`, async t => {
    const f = clock(t), session = new PortalSession(() => {});
    f.cleanups.push(() => session.dispose());
    if (action !== 'check') {f.replies.push(Response.json(owner)); await session.check();}
    if (action === 'logout') f.replies.push(Response.json(owner));
    f.replies.push(refused('2'));
    await (action === 'check' ? session.check() : action === 'activity' ? session.activity(activity) : session.logout());
    const before = f.calls.length;
    f.wall(start + correction);
    assert.equal(session.retryAt, start + correction + 2_000);
    f.elapsed(1_999);
    await session.check(); await session.activity(activity); await session.logout();
    f.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(f.calls.length, before);
    f.elapsed(2_000); assert.equal(session.retryAt, 0);
    f.wall(start - 7_200_000); assert.equal(session.retryAt, 0);
    assert.equal(f.calls.length, before);
    f.replies.push(Response.json(owner)); await session.check();
    assert.equal(f.calls.length, before + 1); assert.equal(session.state.kind, 'authenticated');
  });
}

// Every account endpoint must subtract response-body time and use the server's Date when supplied.
const paths = ['/passkeys', '/passkeys/authentication/options', '/passkeys/authentication/verify',
  '/passkeys/registration/options', '/passkeys/registration/verify', '/passkeys/remove', '/authenticator',
  '/authenticator/begin', '/authenticator/activate', '/authenticator/remove', '/authenticator/regenerate',
  '/authenticator/cancel', '/login', '/login/factor', '/sessions', '/sessions/revoke', '/session',
  '/session/activity', '/logout', '/signup/request', '/signup/complete', '/password-reset/request', '/password-reset/complete'];
for (const path of paths) for (const entry of [
  {name: 'seconds', retry: '2', date: undefined},
  {name: 'server ahead', retry: 'Wed, 04 Nov 2026 13:00:02 GMT', date: 'Wed, 04 Nov 2026 13:00:00 GMT'},
  {name: 'server behind', retry: 'Wed, 04 Nov 2026 11:00:02 GMT', date: 'Wed, 04 Nov 2026 11:00:00 GMT'},
  {name: 'missing Date', retry: 'Wed, 04 Nov 2026 12:00:02 GMT', date: undefined},
  {name: 'invalid Date', retry: 'Wed, 04 Nov 2026 12:00:02 GMT', date: 'invalid'},
]) for (const consumed of [1_500, 5_000]) test(`${path}: ${entry.name} body consumes ${consumed}ms of retry wait`, async t => {
  const f = clock(t), response = refused(entry.retry, entry.date), json = response.json.bind(response);
  t.mock.method(response, 'json', async () => {f.elapsed(consumed); f.wall(start - 3_600_000); return await json();});
  f.replies.push(response);
  const result = await accountRequest(path, path === '/session' ? undefined : {});
  assert.equal(result.ok, false); if (result.ok) assert.fail('refusal accepted');
  assert.equal(result.retryAfterMs, consumed === 1_500 ? 500 : 0);
  assert.equal(result.code, 'rate_limited'); assert.equal(f.calls.length, 1);
});
