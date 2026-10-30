import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {BackupController} from '../src/backup-controller.ts';
import type {BackupPage} from '../src/backup-types.ts';

const receiptTime = Date.parse('2026-10-28T10:00:00.000Z');
const venueId = '12345678-1234-4234-8234-123456789abc';
const pointId = '22345678-1234-4234-8234-123456789abc';
const page: BackupPage = {venueId, points: [{id: pointId, capturedAt: '2026-10-28T09:00:00.000Z',
  expiresAt: '2026-11-28T09:00:00.000Z', verification: 'verified', retention: 'daily', protection: 'fallback'}],
  defaultPointId: pointId, nextCursor: 'older_page', continuousRecovery: null};
function fixture(t: TestContext) {
  let wall = receiptTime, elapsed = 0;
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => elapsed);
  for (const [key, value] of [['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=backup-clock-proof'}]] as const) {
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
  const controller = new BackupController(() => {}, accountRequest);
  controller.account('owner');
  return {controller, responses, calls, wall: (value: number) => { wall = value; }, elapsed: (value: number) => { elapsed = value; }};
}
function refusal(retry?: string, date?: string) {
  return Response.json({error: 'temporarily_unavailable'}, {status: 503,
    headers: {...(retry ? {'Retry-After': retry} : {}), ...(date ? {Date: date} : {})}});
}
async function prepare(f: ReturnType<typeof fixture>) {
  f.responses.push(Response.json(page)); await f.controller.open(venueId);
  f.controller.select(pointId);
}
function assertRead(call: ReturnType<typeof fixture>['calls'][number], next: boolean) {
  assert.equal(call.url, '/api/account/backups/list');
  assert.equal(call.init!.method, 'POST');
  assert.equal(call.init!.body, JSON.stringify({venueId, ...(next ? {cursor: 'older_page'} : {})}));
  assert.equal((call.init!.headers as Record<string, string>)['X-CSRF-Token'], 'backup-clock-proof');
}

// Replacing elapsed time with the system clock bypasses or extends these waits.
for (const next of [false, true]) {
  const operation = next ? 'older page' : 'latest page';
  for (const correction of [-3_600_000, 3_600_000]) test(`backup ${operation} retry ignores clock correction ${correction}`, async t => {
    const f = fixture(t); await prepare(f);
    f.responses.push(refusal('2')); await f.controller.load(next);
    f.wall(receiptTime + correction);
    assert.equal(f.controller.waiting, 2);
    assert.equal(f.controller.retryAt, receiptTime + correction + 2_000);
    assert.deepEqual(f.controller.page, page); assert.equal(f.controller.selected, pointId);
    f.elapsed(1_999); await f.controller.load(next);
    assert.equal(f.calls.length, 2); assert.equal(f.controller.waiting, 1);
    f.elapsed(2_000); assert.equal(f.controller.waiting, 0);
    f.responses.push(Response.json(page)); await f.controller.load(next);
    assert.equal(f.calls.length, 3); assertRead(f.calls[2]!, next);
    assert.deepEqual(f.controller.page, page); assert.equal(f.controller.error, undefined);
  });

  for (const navigation of ['reopen', 'account'] as const) test(`backup ${operation} wait survives ${navigation} and expires despite a backward clock`, async t => {
    const f = fixture(t); await prepare(f);
    f.responses.push(refusal('2')); await f.controller.load(next);
    if (navigation === 'account') f.controller.account('another-owner'); else f.controller.close();
    f.wall(receiptTime - 3_600_000); await f.controller.open(venueId);
    assert.equal(f.calls.length, 2); assert.equal(f.controller.page, undefined);
    assert.equal(f.controller.selected, undefined); assert.equal(f.controller.waiting, 2);
    f.elapsed(2_000); f.responses.push(Response.json(page)); await f.controller.load();
    assert.equal(f.calls.length, 3); assert.equal(f.controller.waiting, 0); assertRead(f.calls[2]!, false);
  });

  test(`expired backup ${operation} wait cannot revive after a no-delay refusal`, async t => {
    const f = fixture(t); await prepare(f);
    f.responses.push(refusal('2')); await f.controller.load(next);
    f.elapsed(2_000); f.wall(receiptTime + 2_000);
    let release!: (response: Response) => void;
    f.responses.push(new Promise(resolve => { release = resolve; }));
    const pending = f.controller.load(next); assert.equal(f.controller.pending, true);
    f.wall(receiptTime - 3_598_000); release(refusal()); await pending;
    assert.equal(f.controller.waiting, 0); assert.equal(f.controller.retryAt, 0);
    f.responses.push(Response.json(page)); await f.controller.load(next);
    assert.equal(f.calls.length, 4); assertRead(f.calls[3]!, next);
  });

  test(`backup ${operation} refusal without Retry-After creates no revivable wait`, async t => {
    const f = fixture(t); await prepare(f);
    f.responses.push(refusal()); await f.controller.load(next);
    f.wall(receiptTime - 3_600_000);
    assert.equal(f.controller.waiting, 0); assert.equal(f.controller.retryAt, 0);
    f.responses.push(Response.json(page)); await f.controller.load(next);
    assert.equal(f.calls.length, 3);
  });

  for (const entry of [
    {name: 'server ahead', retry: 'Wed, 28 Oct 2026 11:00:02 GMT', date: 'Wed, 28 Oct 2026 11:00:00 GMT', wait: 2},
    {name: 'server behind', retry: 'Wed, 28 Oct 2026 09:00:02 GMT', date: 'Wed, 28 Oct 2026 09:00:00 GMT', wait: 2},
    {name: 'missing Date', retry: 'Wed, 28 Oct 2026 10:00:02 GMT', wait: 2},
    {name: 'invalid Date', retry: 'Wed, 28 Oct 2026 10:00:02 GMT', date: 'invalid', wait: 2},
    {name: 'past deadline', retry: 'Wed, 28 Oct 2026 11:00:00 GMT', date: 'Wed, 28 Oct 2026 11:00:02 GMT', wait: 0},
    {name: 'invalid deadline', retry: 'invalid', date: 'Wed, 28 Oct 2026 11:00:00 GMT', wait: 0},
    {name: 'seconds ignore Date', retry: '2', date: 'Wed, 28 Oct 2026 11:00:00 GMT', wait: 2},
  ]) test(`backup ${operation} Retry-After ${entry.name} respects the relative deadline`, async t => {
    const f = fixture(t); await prepare(f);
    f.responses.push(refusal(entry.retry, entry.date)); await f.controller.load(next);
    assert.equal(f.controller.waiting, entry.wait);
    f.wall(receiptTime - 3_600_000);
    if (entry.wait) { f.elapsed(1_999); await f.controller.load(next); assert.equal(f.calls.length, 2); assert.equal(f.controller.waiting, 1); }
    f.elapsed(2_000); assert.equal(f.controller.waiting, 0);
    f.responses.push(Response.json(page)); await f.controller.load(next); assert.equal(f.calls.length, 3);
  });

  // Not subtracting body time, or reading its wall clock instead of the receipt's, extends the wait.
  for (const entry of [
    {name: 'seconds', retry: '2', date: 'Wed, 28 Oct 2026 11:00:00 GMT'},
    {name: 'server Date', retry: 'Wed, 28 Oct 2026 11:00:02 GMT', date: 'Wed, 28 Oct 2026 11:00:00 GMT'},
    {name: 'missing Date', retry: 'Wed, 28 Oct 2026 10:00:02 GMT'},
    {name: 'invalid Date', retry: 'Wed, 28 Oct 2026 10:00:02 GMT', date: 'invalid'},
  ]) for (const duration of [1_500, 5_000]) test(`backup ${operation} ${entry.name} retry accounts for ${duration}ms body time`, async t => {
    const f = fixture(t); await prepare(f);
    const response = refusal(entry.retry, entry.date), json = response.json.bind(response);
    t.mock.method(response, 'json', async () => { f.elapsed(duration); f.wall(receiptTime - 3_600_000); return await json(); });
    f.responses.push(response); await f.controller.load(next);
    assert.equal(f.controller.waiting, duration === 1_500 ? 1 : 0);
    if (duration === 1_500) { f.elapsed(1_999); await f.controller.load(next); assert.equal(f.calls.length, 2); f.elapsed(2_000); }
    assert.equal(f.controller.waiting, 0); assert.equal(f.controller.retryAt, 0);
    f.responses.push(Response.json(page)); await f.controller.load(next); assert.equal(f.calls.length, 3);
  });
}
