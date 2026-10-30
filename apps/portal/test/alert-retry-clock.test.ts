import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {AlertController} from '../src/alert-controller.ts';

const receiptTime = Date.parse('2026-10-28T10:00:00.000Z');
const confirmed = {enabled: true, locale: 'es'};
function fixture(t: TestContext) {
  let wall = receiptTime, elapsed = 0;
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => elapsed);
  for (const [key, value] of [['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=alert-clock-proof'}]] as const) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable: true, value});
    t.after(() => { if (prior) Object.defineProperty(globalThis, key, prior); else Reflect.deleteProperty(globalThis, key); });
  }
  const responses: Array<Response | Promise<Response>> = [];
  const calls: Array<{url: string; init: RequestInit | undefined}> = [], violations: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    calls.push({url: String(url), init});
    if (!responses.length) { violations.push('unplanned request'); throw new Error('unplanned request'); }
    return await responses.shift()!;
  });
  t.after(() => { assert.deepEqual(violations, []); assert.equal(responses.length, 0); });
  const controller = new AlertController(() => {}, accountRequest);
  controller.account('owner');
  return {controller, responses, calls, wall: (value: number) => { wall = value; }, elapsed: (value: number) => { elapsed = value; }};
}
function refusal(retry?: string, date?: string) {
  return Response.json({error: 'temporarily_unavailable'}, {status: 503,
    headers: {...(retry ? {'Retry-After': retry} : {}), ...(date ? {Date: date} : {})}});
}
async function prepare(f: ReturnType<typeof fixture>) {
  f.responses.push(Response.json(confirmed)); await f.controller.load();
  f.controller.choose(false, 'en');
}

// A wall-clock gate would lengthen or bypass the delay, or revive it after expiry.
for (const operation of ['load', 'save'] as const) {
  for (const correction of [-3_600_000, 3_600_000]) test(`alert ${operation} retry ignores wall-clock correction ${correction}`, async t => {
    const f = fixture(t); await prepare(f);
    f.responses.push(refusal('2')); await f.controller[operation]();
    assert.equal(f.controller.waiting, 2);
    assert.equal(f.controller.dirty, true);
    f.wall(receiptTime + correction);
    assert.equal(f.controller.waiting, 2);
    assert.equal(f.controller.retryAt, receiptTime + correction + 2_000);
    f.elapsed(1_999); await f.controller.load(); await f.controller.save();
    assert.equal(f.calls.length, 2); assert.equal(f.controller.waiting, 1);
    f.elapsed(2_000); assert.equal(f.controller.waiting, 0);
    f.responses.push(Response.json({enabled: false, locale: 'en'})); await f.controller[operation]();
    assert.equal(f.calls.length, 3); assert.equal(f.controller.dirty, false);
    assert.equal(f.controller.saved, operation === 'save');
    assert.equal(f.calls[2]!.init!.method, operation === 'save' ? 'POST' : 'GET');
    if (operation === 'save') assert.equal((f.calls[2]!.init!.headers as Record<string, string>)['X-CSRF-Token'], 'alert-clock-proof');
  });

  test(`expired alert ${operation} retry stays expired during a no-delay refusal and account navigation`, async t => {
    const f = fixture(t); await prepare(f);
    f.responses.push(refusal('2')); await f.controller[operation]();
    f.elapsed(2_000); f.wall(receiptTime + 2_000);
    assert.equal(f.controller.waiting, 0);
    let release!: (response: Response) => void;
    f.responses.push(new Promise(resolve => { release = resolve; }));
    const pending = f.controller[operation](); assert.equal(f.controller.pending, true);
    f.wall(receiptTime - 3_598_000); release(refusal()); await pending;
    assert.equal(f.controller.waiting, 0); assert.equal(f.controller.retryAt, 0);
    f.controller.account('another-owner');
    f.responses.push(Response.json(confirmed)); await f.controller.load();
    assert.equal(f.calls.length, 4); assert.equal(f.controller.loaded, true);
  });

  test(`alert ${operation} refusal without Retry-After creates no revivable wait`, async t => {
    const f = fixture(t); await prepare(f);
    f.responses.push(refusal()); await f.controller[operation]();
    f.wall(receiptTime - 3_600_000);
    assert.equal(f.controller.waiting, 0); assert.equal(f.controller.retryAt, 0);
    f.responses.push(Response.json(confirmed)); await f.controller[operation]();
    assert.equal(f.calls.length, 3);
  });

  // Wrong date origins or ignoring body-reading time would extend these HTTP waits.
  for (const entry of [
    {name: 'server Date ahead', retry: 'Wed, 28 Oct 2026 11:00:02 GMT', date: 'Wed, 28 Oct 2026 11:00:00 GMT', wait: 2},
    {name: 'server Date behind', retry: 'Wed, 28 Oct 2026 09:00:02 GMT', date: 'Wed, 28 Oct 2026 09:00:00 GMT', wait: 2},
    {name: 'missing Date', retry: 'Wed, 28 Oct 2026 10:00:02 GMT', wait: 2},
    {name: 'invalid Date', retry: 'Wed, 28 Oct 2026 10:00:02 GMT', date: 'invalid', wait: 2},
    {name: 'past server date', retry: 'Wed, 28 Oct 2026 11:00:00 GMT', date: 'Wed, 28 Oct 2026 11:00:02 GMT', wait: 0},
    {name: 'invalid retry date', retry: 'invalid', date: 'Wed, 28 Oct 2026 11:00:00 GMT', wait: 0},
    {name: 'seconds ignore Date', retry: '2', date: 'Wed, 28 Oct 2026 11:00:00 GMT', wait: 2},
  ]) test(`alert ${operation} Retry-After ${entry.name} expires at its relative boundary`, async t => {
    const f = fixture(t); await prepare(f);
    f.responses.push(refusal(entry.retry, entry.date)); await f.controller[operation]();
    assert.equal(f.controller.waiting, entry.wait);
    f.controller.account('another-owner');
    f.wall(receiptTime - 3_600_000);
    if (entry.wait) {
      f.elapsed(1_999); await f.controller.load();
      assert.equal(f.calls.length, 2); assert.equal(f.controller.waiting, 1);
      f.elapsed(2_000);
    }
    assert.equal(f.controller.waiting, 0);
    f.responses.push(Response.json(confirmed)); await f.controller.load();
    assert.equal(f.calls.length, 3); assert.equal(f.controller.loaded, true);
  });

  for (const retry of ['2', 'Wed, 28 Oct 2026 11:00:02 GMT']) test(`alert ${operation} ${retry} retry includes body-reading time`, async t => {
    const f = fixture(t); await prepare(f);
    const response = refusal(retry, 'Wed, 28 Oct 2026 11:00:00 GMT'), json = response.json.bind(response);
    t.mock.method(response, 'json', async () => { f.elapsed(1_500); f.wall(receiptTime - 3_600_000); return await json(); });
    f.responses.push(response); await f.controller[operation]();
    assert.equal(f.controller.waiting, 1);
    f.elapsed(1_999); await f.controller[operation](); assert.equal(f.calls.length, 2);
    f.elapsed(2_000); assert.equal(f.controller.waiting, 0);
    f.responses.push(Response.json(confirmed)); await f.controller[operation]();
    assert.equal(f.calls.length, 3);
  });

  for (const date of [undefined, 'invalid']) test(`alert ${operation} freezes the receipt clock with ${date ?? 'missing'} Date`, async t => {
    const f = fixture(t); await prepare(f);
    const response = refusal('Wed, 28 Oct 2026 10:00:02 GMT', date), json = response.json.bind(response);
    t.mock.method(response, 'json', async () => { f.elapsed(1_500); f.wall(receiptTime - 3_600_000); return await json(); });
    f.responses.push(response); await f.controller[operation]();
    assert.equal(f.controller.waiting, 1);
    f.elapsed(2_000); assert.equal(f.controller.waiting, 0);
    f.responses.push(Response.json(confirmed)); await f.controller[operation]();
    assert.equal(f.calls.length, 3);
  });

  for (const retry of ['2', 'Wed, 28 Oct 2026 11:00:02 GMT']) test(`alert ${operation} ${retry} body consumes the entire wait`, async t => {
    const f = fixture(t); await prepare(f);
    const response = refusal(retry, 'Wed, 28 Oct 2026 11:00:00 GMT'), json = response.json.bind(response);
    t.mock.method(response, 'json', async () => { f.elapsed(5_000); f.wall(receiptTime - 3_600_000); return await json(); });
    f.responses.push(response); await f.controller[operation]();
    assert.equal(f.controller.waiting, 0); assert.equal(f.controller.retryAt, 0);
    f.responses.push(Response.json(confirmed)); await f.controller[operation]();
    assert.equal(f.calls.length, 3);
  });
}
