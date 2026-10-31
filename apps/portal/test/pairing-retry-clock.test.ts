import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {PairingController} from '../src/pairing-controller.ts';

const receiptTime = Date.parse('2026-10-31T10:00:00.000Z');
const requestId = '10000000-0000-4000-8000-000000000001';
const nextRequestId = '10000000-0000-4000-8000-000000000002';
const business = {organisationId: requestId, legalBusinessId: nextRequestId,
  organisationName: 'Café Sol', legalBusinessName: 'Sol SL', countryCode: 'ES'};
const view = {requestId, localVenueId: '10000000-0000-4000-8000-000000000003',
  environment: 'test', state: 'awaiting_cloud', expiresAt: '2099-01-01T00:00:00Z'};
type Operation = 'load' | 'inspect' | 'approve';
function fixture(t: TestContext) {
  let wall = receiptTime, elapsed = 0;
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => elapsed);
  for (const [key, value] of [['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=pairing-clock-proof'}]] as const) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable: true, value});
    t.after(() => {if (prior) Object.defineProperty(globalThis, key, prior); else Reflect.deleteProperty(globalThis, key);});
  }
  const replies: Array<Response | Promise<Response>> = [];
  const calls: Array<{url: string; init: RequestInit | undefined}> = [];
  const unplanned: string[] = [];
  t.after(() => assert.deepEqual(unplanned, [], 'every pairing request needs a queued reply'));
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    calls.push({url: String(url), init});
    if (!replies.length) {unplanned.push(String(url)); throw new Error('unplanned pairing request');}
    return await replies.shift()!;
  });
  const c = new PairingController(() => {});
  c.account('owner'); c.open(requestId); c.code = '01234567';
  return {c, calls, replies, wall: (value: number) => {wall = value;}, elapsed: (value: number) => {elapsed = value;}};
}
function success(operation: Operation, id = requestId) {
  return Response.json(operation === 'load' ? {businesses: [business]}
    : {...view, requestId: id, ...(operation === 'approve' ? {...business, state: 'awaiting_local'} : {})});
}
function refusal(retry?: string, date?: string) {
  return Response.json({error: 'rate_limited'}, {status: 429,
    headers: {...(retry ? {'Retry-After': retry} : {}), ...(date ? {Date: date} : {})}});
}
async function prepare(f: ReturnType<typeof fixture>) {
  f.replies.push(success('load'), success('inspect')); await f.c.load(); await f.c.inspect();
}
function assertRequest(f: ReturnType<typeof fixture>, operation: Operation) {
  const call = f.calls.at(-1)!;
  assert.equal(call.url, `/api/account/pairing/${operation === 'load' ? 'businesses' : operation}`);
  assert.equal(call.init?.method, operation === 'load' ? 'GET' : 'POST');
  assert.equal(call.init?.credentials, 'same-origin');
  if (operation !== 'load') {
    assert.equal(new Headers(call.init?.headers).get('X-CSRF-Token'), 'pairing-clock-proof');
    assert.deepEqual(JSON.parse(String(call.init?.body)), {requestId, code: '01234567',
      ...(operation === 'approve' ? {organisationId: business.organisationId, legalBusinessId: business.legalBusinessId} : {})});
  }
}

// Using wall time for a relative wait would extend, bypass or revive the request gate.
for (const operation of ['load', 'inspect', 'approve'] as const) {
  for (const correction of [-3_600_000, 3_600_000]) test(`pairing ${operation} retry survives wall-clock correction ${correction}`, async t => {
    const f = fixture(t); await prepare(f);
    f.replies.push(refusal('2')); await f.c[operation]();
    f.wall(receiptTime + correction);
    assert.equal(f.c.waiting, 2); assert.equal(f.c.retryAt, receiptTime + correction + 2_000);
    assert.deepEqual(f.c.view, view); assert.equal(f.c.selected, business.legalBusinessId); assert.equal(f.c.code, '01234567');
    f.elapsed(1_999); await f.c.load(); await f.c.inspect(); await f.c.approve();
    assert.equal(f.calls.length, 3); assert.equal(f.c.waiting, 1);
    f.elapsed(2_000); assert.equal(f.c.waiting, 0);
    f.replies.push(success(operation)); await f.c[operation]();
    assert.equal(f.calls.length, 4); assert.equal(f.c.error, undefined); assertRequest(f, operation);
    assert.equal(f.c.view?.state, operation === 'approve' ? 'awaiting_local' : 'awaiting_cloud');
  });

  test(`pairing ${operation} expired wait cannot revive through a pending refusal and navigation`, async t => {
    const f = fixture(t); await prepare(f);
    f.replies.push(refusal('2')); await f.c[operation]();
    f.elapsed(2_000); f.wall(receiptTime + 2_000);
    assert.equal(f.c.waiting, 0);
    let release!: (response: Response) => void;
    f.replies.push(new Promise(resolve => {release = resolve;}));
    const pending = f.c[operation](); assert.equal(f.c.pending, true);
    f.wall(receiptTime - 3_598_000); release(refusal()); await pending;
    assert.equal(f.c.waiting, 0); assert.equal(f.c.retryAt, 0);
    f.c.account('next-owner'); f.c.open(nextRequestId);
    f.replies.push(success('load', nextRequestId)); await f.c.load();
    assert.equal(f.calls.length, 5); assert.equal(f.c.loaded, true); assert.equal(f.c.view, undefined);
  });

  test(`pairing ${operation} no-delay refusal has no revivable countdown`, async t => {
    const f = fixture(t); await prepare(f);
    f.replies.push(refusal()); await f.c[operation](); f.wall(receiptTime - 3_600_000);
    assert.equal(f.c.waiting, 0); assert.equal(f.c.retryAt, 0);
    f.replies.push(success(operation)); await f.c[operation](); assert.equal(f.calls.length, 4);
  });

  for (const entry of [
    {name: 'server ahead', retry: 'Sat, 31 Oct 2026 11:00:02 GMT', date: 'Sat, 31 Oct 2026 11:00:00 GMT', wait: 2},
    {name: 'server behind', retry: 'Sat, 31 Oct 2026 09:00:02 GMT', date: 'Sat, 31 Oct 2026 09:00:00 GMT', wait: 2},
    {name: 'missing Date', retry: 'Sat, 31 Oct 2026 10:00:02 GMT', wait: 2},
    {name: 'invalid Date', retry: 'Sat, 31 Oct 2026 10:00:02 GMT', date: 'invalid', wait: 2},
    {name: 'expired date', retry: 'Sat, 31 Oct 2026 11:00:00 GMT', date: 'Sat, 31 Oct 2026 11:00:02 GMT', wait: 0},
    {name: 'invalid retry', retry: 'invalid', date: 'Sat, 31 Oct 2026 11:00:00 GMT', wait: 0},
    {name: 'seconds', retry: '2', date: 'Sat, 31 Oct 2026 11:00:00 GMT', wait: 2},
  ]) test(`pairing ${operation} ${entry.name} wait survives account and request changes`, async t => {
    const f = fixture(t); await prepare(f);
    f.replies.push(refusal(entry.retry, entry.date)); await f.c[operation]();
    assert.equal(f.c.waiting, entry.wait);
    f.c.account('next-owner'); f.c.open(nextRequestId); f.wall(receiptTime - 3_600_000);
    if (entry.wait) {
      f.elapsed(1_999); await f.c.load(); await f.c.inspect(); await f.c.approve();
      assert.equal(f.calls.length, 3); assert.equal(f.c.waiting, 1); f.elapsed(2_000);
    }
    assert.equal(f.c.waiting, 0); f.replies.push(success('load')); await f.c.load();
    assert.equal(f.calls.length, 4); assert.equal(f.c.selected, business.legalBusinessId);
  });

  // Converting the date after reading the body, or starting a fresh delay there, would extend the wait.
  for (const entry of [
    {name: 'seconds', retry: '2', date: 'Sat, 31 Oct 2026 11:00:00 GMT'},
    {name: 'server date', retry: 'Sat, 31 Oct 2026 11:00:02 GMT', date: 'Sat, 31 Oct 2026 11:00:00 GMT'},
    {name: 'receipt date', retry: 'Sat, 31 Oct 2026 10:00:02 GMT'},
    {name: 'invalid server date', retry: 'Sat, 31 Oct 2026 10:00:02 GMT', date: 'invalid'},
  ]) for (const consumed of [1_500, 5_000]) test(`pairing ${operation} ${entry.name} body consumes ${consumed}ms of its wait`, async t => {
    const f = fixture(t); await prepare(f);
    const response = refusal(entry.retry, entry.date), json = response.json.bind(response);
    t.mock.method(response, 'json', async () => {f.elapsed(consumed); f.wall(receiptTime - 3_600_000); return await json();});
    f.replies.push(response); await f.c[operation]();
    assert.equal(f.c.waiting, consumed === 1_500 ? 1 : 0);
    if (consumed === 1_500) {
      f.elapsed(1_999); await f.c[operation](); assert.equal(f.calls.length, 3); f.elapsed(2_000);
    }
    assert.equal(f.c.waiting, 0); assert.equal(f.c.retryAt, 0);
    f.replies.push(success(operation)); await f.c[operation]();
    assert.equal(f.calls.length, 4); assertRequest(f, operation);
  });
}

for (const correction of [-3_600_000, 3_600_000]) test(`native elapsed pairing wait expires through wall-clock correction ${correction}`, async t => {
  let wall = receiptTime, requests = 0;
  t.mock.method(Date, 'now', () => wall);
  const c = new PairingController(() => {}, async <T>() => ++requests === 1
    ? {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 1_000}
    : {ok: true, value: {businesses: [business]} as T});
  c.account('owner'); c.open(requestId); await c.load(); wall += correction;
  assert.equal(c.waiting, 1); await c.load(); assert.equal(requests, 1);
  await new Promise(resolve => setTimeout(resolve, 1_050));
  assert.equal(c.waiting, 0); assert.equal(c.retryAt, 0);
  await c.load(); assert.equal(requests, 2); assert.equal(c.loaded, true);
});
