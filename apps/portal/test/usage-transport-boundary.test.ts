import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {UsageController} from '../src/usage-controller.ts';
import type {UsageSummary} from '../src/usage-types.ts';

const first = '12345678-1234-4234-8234-123456789abc';
const second = '22345678-1234-4234-8234-123456789abc';
const summary = (organisationId = first, currentBytes = '9007199254740993'): UsageSummary => ({
  version: 1, organisationId,
  storage: {currentBytes, addedBytes: '9007199254740994', removedBytes: '1'},
  transfer: {uploadedBytes: '1536', restoredBytes: '2048'},
  operations: {installationCompleted: '3', monitoringProbes: '4'},
  messages: {sent: '5', failed: '6', expired: '7', cancelled: '8'},
  latestEventAt: '2026-10-28T09:00:00.000Z', measuredThrough: '2026-10-28T09:05:00.000Z',
});
type Reply = {status?: number; body?: unknown; retry?: string; unreadable?: boolean; lost?: boolean};
type Request = {url: string; init: RequestInit};

function fixture(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=usage-transport-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const replies: Array<Reply | Promise<Reply>> = [];
  const requests: Request[] = [];
  const violations: string[] = [];
  let changes = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    if (!init || !replies.length) {
      violations.push('request without an explicit HTTP outcome');
      throw new Error('fixture request has no outcome');
    }
    requests.push({url: String(url), init});
    const reply = await replies.shift()!;
    if (reply.lost) throw new TypeError('private transport detail');
    const response = new Response(reply.status === 204 ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200, headers: reply.retry ? {'Retry-After': reply.retry} : {},
    });
    if (reply.unreadable) Object.defineProperty(response, 'json', {
      value: async () => { throw new TypeError('private body detail'); },
    });
    return response;
  });
  t.after(() => {
    assert.deepEqual(violations, [], 'the client must not hide a fixture violation as a network failure');
    assert.equal(replies.length, 0, 'every planned response must be used');
  });
  const controller = new UsageController(() => { changes++; }, accountRequest);
  controller.account('owner'); controller.organisation(first);
  return {controller, replies, requests, changes: () => changes};
}

function assertRequest(request: Request, organisationId = first) {
  assert.equal(request.url, '/api/account/usage/read');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.credentials, 'same-origin');
  assert.equal(request.init.body, JSON.stringify({organisationId}));
  assert.deepEqual(request.init.headers, {
    'Content-Type': 'application/json', 'X-CSRF-Token': 'usage-transport-proof',
  });
}

for (const refresh of [false, true]) for (const entry of [
  {name: 'lost connection', reply: {lost: true}},
  {name: 'unreadable successful body', reply: {body: summary(first, '42'), unreadable: true}},
  {name: 'empty acknowledgement', reply: {status: 204}},
  {name: 'server error carrying valid totals', reply: {status: 500, body: summary(first, '42')}},
  {name: 'service refusal carrying valid totals', reply: {status: 503, body: summary(first, '42')}},
  {name: 'unknown private refusal', reply: {status: 400, body: {error: 'private provider detail'}}},
] satisfies Array<{name: string; reply: Reply}>) {
  test(`usage transport ${refresh ? 'refresh' : 'initial read'} with ${entry.name} needs an explicit retry`, async t => {
    const f = fixture(t);
    if (refresh) {
      f.replies.push({body: summary()}); await f.controller.load(); f.controller.refresh();
    }
    const before = f.requests.length;
    f.replies.push(entry.reply); await f.controller.load();
    assert.deepEqual(f.controller.summary, refresh ? summary() : undefined);
    assert.equal(f.controller.pending, false);
    assert.equal(f.controller.loaded, false);
    assert.equal(f.controller.error, 'unavailable');
    assert.equal(f.controller.waiting, 0);
    assert.equal(f.requests.length, before + 1, 'a failed read must not replay itself');
    assertRequest(f.requests[before]!);
    f.replies.push({body: summary(first, '-9007199254740993')}); await f.controller.load();
    assert.deepEqual(f.controller.summary, summary(first, '-9007199254740993'));
    assert.equal(f.controller.loaded, true); assert.equal(f.controller.pending, false);
    assert.equal(f.controller.error, undefined);
    assert.equal(f.requests.length, before + 2); assertRequest(f.requests[before + 1]!);
    const changes = f.changes();
    await f.controller.load();
    assert.equal(f.requests.length, before + 2, 'accepted totals load once until explicitly refreshed');
    assert.equal(f.changes(), changes);
  });
}

for (const entry of [
  {status: 401, code: 'session_expired', error: 'pairSession'},
  {status: 403, code: 'permission_denied', error: 'permissionBusiness'},
  {status: 403, code: 'forbidden', error: 'forbidden'},
]) {
  test(`usage transport ${entry.status} ${entry.code} clears private totals before a valid retry`, async t => {
    const f = fixture(t);
    f.replies.push({body: summary()}); await f.controller.load();
    assert.equal(f.controller.summary?.storage.currentBytes, '9007199254740993');
    f.controller.refresh();
    f.replies.push({status: entry.status, body: {error: entry.code}}); await f.controller.load();
    assert.equal(f.controller.summary, undefined);
    assert.equal(f.controller.loaded, false); assert.equal(f.controller.pending, false);
    assert.equal(f.controller.error, entry.error); assert.equal(f.requests.length, 2);
    f.replies.push({body: summary(first, '42')}); await f.controller.load();
    assert.deepEqual(f.controller.summary, summary(first, '42'));
    assert.equal(f.controller.loaded, true); assert.equal(f.controller.error, undefined);
    assert.equal(f.requests.length, 3); f.requests.forEach(request => assertRequest(request));
  });
}

for (const entry of [
  {name: 'seconds', status: 429, retry: '2', error: 'limited'},
  {name: 'HTTP date', status: 503, retry: 'Wed, 28 Oct 2026 10:00:02 GMT', error: 'unavailable'},
]) for (const navigation of ['same selection', 'account change', 'organisation change'] as const) {
  test(`usage transport Retry-After ${entry.name} survives ${navigation} and a backward clock until exact expiry`, async t => {
    const f = fixture(t);
    let now = Date.parse('2026-10-28T10:00:00.000Z');
    t.mock.method(Date, 'now', () => now);
    let elapsed = 0; t.mock.method(performance, 'now', () => elapsed);
    f.replies.push({body: summary()}); await f.controller.load(); f.controller.refresh();
    f.replies.push({status: entry.status, body: {error: 'temporarily_unavailable'}, retry: entry.retry});
    await f.controller.load();
    assert.deepEqual(f.controller.summary, summary());
    assert.equal(f.controller.error, entry.error); assert.equal(f.controller.loaded, false);
    assert.equal(f.controller.retryAt, Date.parse('2026-10-28T10:00:02.000Z'));
    assert.equal(f.controller.waiting, 2);
    if (navigation === 'account change') {
      f.controller.account(undefined); f.controller.account('another-owner'); f.controller.organisation(second);
    } else if (navigation === 'organisation change') f.controller.organisation(second);
    if (navigation !== 'same selection') {
      assert.equal(f.controller.summary, undefined); assert.equal(f.controller.error, undefined);
    }
    assert.equal(f.controller.waiting, 2);
    const changes = f.changes();
    await f.controller.load();
    now -= 1_000; await f.controller.load(); assert.equal(f.controller.waiting, 2);
    elapsed = 1_999; now += 2_999; await f.controller.load(); assert.equal(f.controller.waiting, 1);
    assert.equal(f.requests.length, 2); assert.equal(f.changes(), changes);
    assert.equal(f.controller.pending, false);
    elapsed++; now++;
    assert.equal(f.controller.waiting, 0);
    const organisationId = navigation === 'same selection' ? first : second;
    f.replies.push({body: summary(organisationId, '42')}); await f.controller.load();
    assert.deepEqual(f.controller.summary, summary(organisationId, '42'));
    assert.equal(f.controller.loaded, true); assert.equal(f.controller.pending, false);
    assert.equal(f.controller.error, undefined); assert.equal(f.changes(), changes + 2);
    assert.equal(f.requests.length, 3); assertRequest(f.requests[2]!, organisationId);
  });
}

test('a pending usage HTTP read blocks duplicate loads and refresh until its response arrives', async t => {
  const f = fixture(t);
  f.replies.push({body: summary()}); await f.controller.load(); f.controller.refresh();
  let release!: (reply: Reply) => void;
  f.replies.push(new Promise<Reply>(resolve => { release = resolve; }));
  const pending = f.controller.load();
  assert.equal(f.controller.pending, true); assert.deepEqual(f.controller.summary, summary());
  const changes = f.changes();
  await f.controller.load(); f.controller.refresh(); await f.controller.load();
  assert.equal(f.requests.length, 2); assert.equal(f.changes(), changes);
  assert.equal(f.controller.pending, true); assert.equal(f.controller.loaded, false);
  release({body: summary(first, '42')}); await pending;
  assert.deepEqual(f.controller.summary, summary(first, '42'));
  assert.equal(f.controller.pending, false); assert.equal(f.controller.loaded, true);
  assert.equal(f.controller.error, undefined); assert.equal(f.requests.length, 2);
  f.requests.forEach(request => assertRequest(request));
});
