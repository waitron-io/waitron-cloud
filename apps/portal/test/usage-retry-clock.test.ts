import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {UsageController} from '../src/usage-controller.ts';

const organisationId = '12345678-1234-4234-8234-123456789abc';
const receiptTime = Date.parse('2026-10-28T10:00:00.000Z');
function fixture(t: TestContext) {
  let wall = receiptTime, elapsed = 0;
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => elapsed);
  for (const [key, value] of [['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=clock-proof'}]] as const) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable: true, value});
    t.after(() => { if (prior) Object.defineProperty(globalThis, key, prior); else Reflect.deleteProperty(globalThis, key); });
  }
  const responses: Array<Response | Promise<Response>> = [];
  const calls: string[] = [], violations: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    calls.push(String(url));
    if (!responses.length) { violations.push('unplanned request'); throw new Error('unplanned request'); }
    return await responses.shift()!;
  });
  t.after(() => { assert.deepEqual(violations, []); assert.equal(responses.length, 0); });
  const controller = new UsageController(() => {}, accountRequest);
  controller.account('owner'); controller.organisation(organisationId);
  return {controller, responses, calls, wall: (value: number) => { wall = value; }, elapsed: (value: number) => { elapsed = value; }};
}
function refusal(retry?: string, date?: string) {
  return Response.json({error: 'temporarily_unavailable'}, {status: 503,
    headers: {...(retry ? {'Retry-After': retry} : {}), ...(date ? {Date: date} : {})}});
}

// A wall-clock deadline would lengthen or bypass these real HTTP read gates.
for (const correction of [-3_600_000, 3_600_000]) test(`usage two-second retry ignores wall-clock correction ${correction}`, async t => {
  const f = fixture(t);
  f.responses.push(refusal('2')); await f.controller.load();
  assert.equal(f.controller.waiting, 2);
  f.wall(receiptTime + correction);
  assert.equal(f.controller.waiting, 2);
  f.controller.account('another-owner'); f.controller.organisation(organisationId);
  f.elapsed(1_999); await f.controller.load();
  assert.equal(f.calls.length, 1); assert.equal(f.controller.waiting, 1);
  f.elapsed(2_000); assert.equal(f.controller.waiting, 0);
  f.responses.push(refusal()); await f.controller.load();
  assert.equal(f.calls.length, 2); assert.equal(f.controller.waiting, 0);
});

test('an expired usage retry cannot revive after a clock correction during a failed read', async t => {
  const f = fixture(t);
  f.responses.push(refusal('2')); await f.controller.load();
  f.elapsed(2_000); f.wall(receiptTime + 2_000);
  assert.equal(f.controller.waiting, 0);
  let release!: (response: Response) => void;
  f.responses.push(new Promise(resolve => { release = resolve; }));
  const pending = f.controller.load(); assert.equal(f.controller.pending, true);
  f.wall(receiptTime - 3_598_000); release(refusal()); await pending;
  assert.equal(f.controller.waiting, 0); assert.equal(f.controller.retryAt, 0);
  f.responses.push(refusal()); await f.controller.load();
  assert.equal(f.calls.length, 3); assert.equal(f.controller.pending, false);
});

// Wrong date origins, a missing zero clamp, or reparsing dates after receipt break these boundaries.
for (const entry of [
  {name: 'server Date ahead of local clock', retry: 'Wed, 28 Oct 2026 11:00:02 GMT', date: 'Wed, 28 Oct 2026 11:00:00 GMT', wait: 2},
  {name: 'server Date behind local clock', retry: 'Wed, 28 Oct 2026 09:00:02 GMT', date: 'Wed, 28 Oct 2026 09:00:00 GMT', wait: 2},
  {name: 'missing Date uses receipt clock', retry: 'Wed, 28 Oct 2026 10:00:02 GMT', wait: 2},
  {name: 'invalid Date uses receipt clock', retry: 'Wed, 28 Oct 2026 10:00:02 GMT', date: 'invalid', wait: 2},
  {name: 'past server date clamps to zero', retry: 'Wed, 28 Oct 2026 11:00:00 GMT', date: 'Wed, 28 Oct 2026 11:00:02 GMT', wait: 0},
  {name: 'invalid Retry-After gives no wait', retry: 'invalid', date: 'Wed, 28 Oct 2026 11:00:00 GMT', wait: 0},
  {name: 'seconds ignore server Date', retry: '2', date: 'Wed, 28 Oct 2026 11:00:00 GMT', wait: 2},
]) test(`usage Retry-After ${entry.name}`, async t => {
  const f = fixture(t);
  f.responses.push(refusal(entry.retry, entry.date)); await f.controller.load();
  assert.equal(f.controller.waiting, entry.wait);
  f.wall(receiptTime - 3_600_000);
  if (entry.wait) {
    f.elapsed(1_999); await f.controller.load();
    assert.equal(f.calls.length, 1); assert.equal(f.controller.waiting, 1);
    f.elapsed(2_000);
  }
  assert.equal(f.controller.waiting, 0);
  f.responses.push(refusal()); await f.controller.load();
  assert.equal(f.calls.length, 2); assert.equal(f.controller.waiting, 0);
});

test('usage retry timing starts when headers arrive, including time spent reading the body', async t => {
  const f = fixture(t), response = refusal('Wed, 28 Oct 2026 11:00:02 GMT', 'Wed, 28 Oct 2026 11:00:00 GMT');
  const json = response.json.bind(response);
  t.mock.method(response, 'json', async () => { f.elapsed(1_500); f.wall(receiptTime - 3_600_000); return await json(); });
  f.responses.push(response); await f.controller.load();
  assert.equal(f.controller.waiting, 1);
  f.elapsed(1_999); await f.controller.load(); assert.equal(f.calls.length, 1);
  f.elapsed(2_000); assert.equal(f.controller.waiting, 0);
  f.responses.push(refusal()); await f.controller.load(); assert.equal(f.calls.length, 2);
});

for (const path of ['/session', '/login', '/remote-access/status']) test(`${path} retains its existing date retry policy`, async t => {
  fixture(t);
  t.mock.method(globalThis, 'fetch', async () => refusal('Wed, 28 Oct 2026 11:00:02 GMT', 'Wed, 28 Oct 2026 11:00:00 GMT'));
  const result = await accountRequest(path);
  assert.ok(!result.ok); assert.equal(result.retryAfterMs, 3_602_000);
});

for (const entry of [
  {name: 'a past HTTP date', retry: 'Wed, 28 Oct 2026 10:59:58 GMT', elapsed: 0},
  {name: 'a seconds delay consumed by the body', retry: '2', elapsed: 5_000},
  {name: 'an HTTP-date delay consumed by the body', retry: 'Wed, 28 Oct 2026 11:00:02 GMT', elapsed: 5_000},
]) test(`usage API returns zero for ${entry.name}`, async t => {
  const f = fixture(t), response = refusal(entry.retry, 'Wed, 28 Oct 2026 11:00:00 GMT');
  const json = response.json.bind(response);
  t.mock.method(response, 'json', async () => { f.elapsed(entry.elapsed); return await json(); });
  f.responses.push(response);
  const result = await accountRequest('/usage/read', {organisationId});
  assert.ok(!result.ok); assert.equal(result.retryAfterMs, 0);
});

for (const date of [undefined, 'invalid']) test(`usage HTTP-date conversion freezes the local receipt clock with ${date ?? 'missing'} Date`, async t => {
  const f = fixture(t), response = refusal('Wed, 28 Oct 2026 10:00:02 GMT', date);
  const json = response.json.bind(response);
  t.mock.method(response, 'json', async () => { f.wall(receiptTime - 3_600_000); f.elapsed(1_500); return await json(); });
  f.responses.push(response);
  const result = await accountRequest('/usage/read', {organisationId});
  assert.ok(!result.ok); assert.equal(result.retryAfterMs, 500);
});
