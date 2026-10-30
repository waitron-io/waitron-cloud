import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {AlertController} from '../src/alert-controller.ts';

type Reply = {status?: number; body?: unknown; retry?: string; unreadable?: boolean};
const confirmed = {enabled: true, locale: 'es'};
const updated = {enabled: false, locale: 'en'};

function fixture(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=alert-transport-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const replies: Array<Reply | Promise<Reply>> = [];
  const requests: Array<{url: string; init: RequestInit}> = [];
  let changes = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.ok(init);
    requests.push({url: String(url), init});
    assert.ok(replies.length, 'each request needs an explicit HTTP outcome');
    const reply = await replies.shift()!;
    const response = new Response(reply.status === 204 ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200, headers: reply.retry ? {'Retry-After': reply.retry} : {},
    });
    if (reply.unreadable) Object.defineProperty(response, 'json', {
      value: async () => { throw new TypeError('private body failure'); },
    });
    return response;
  });
  const controller = new AlertController(() => { changes++; }, accountRequest);
  controller.account('owner');
  return {controller, replies, requests, changes: () => changes};
}

function assertRequest(request: {url: string; init: RequestInit}, write: boolean) {
  assert.equal(request.url, '/api/account/alerts');
  assert.equal(request.init.method, write ? 'POST' : 'GET');
  assert.equal(request.init.credentials, 'same-origin');
  assert.equal(request.init.body, write ? '{"enabled":"off","locale":"en"}' : undefined);
  assert.deepEqual(request.init.headers, write
    ? {'Content-Type': 'application/json', 'X-CSRF-Token': 'alert-transport-proof'} : {});
}

const failures: Array<{name: string; reply: Reply}> = [
  {name: 'unreadable successful body', reply: {body: updated, unreadable: true}},
  {name: 'no-content acknowledgement', reply: {status: 204}},
  {name: 'server error carrying valid preferences', reply: {status: 500, body: updated}},
  {name: 'service refusal carrying valid preferences', reply: {status: 503, body: updated}},
  {name: 'unknown private refusal', reply: {status: 400, body: {error: 'private provider detail'}}},
];

for (const operation of ['initial read', 'reload', 'save'] as const) for (const entry of failures) {
  test(`alert transport ${operation} with ${entry.name} remains unconfirmed until an explicit retry`, async t => {
    const f = fixture(t);
    if (operation !== 'initial read') {
      f.replies.push({body: confirmed});
      await f.controller.load();
      f.controller.choose(false, 'en');
    }
    const before = f.requests.length;
    f.replies.push(entry.reply);
    if (operation === 'save') await f.controller.save();
    else await f.controller.load();
    assert.equal(f.controller.enabled, false);
    assert.equal(f.controller.locale, 'en');
    assert.equal(f.controller.loaded, operation !== 'initial read');
    assert.equal(f.controller.loadAttempted, true);
    assert.equal(f.controller.dirty, operation !== 'initial read');
    assert.equal(f.controller.pending, false);
    assert.equal(f.controller.saved, false);
    assert.equal(f.controller.error, operation === 'save' ? 'alertsUncertain' : 'unavailable');
    assert.equal(f.controller.waiting, 0);
    assert.equal(f.requests.length, before + 1, 'failure must not automatically replay the request');
    assertRequest(f.requests[before]!, operation === 'save');

    f.replies.push({body: updated});
    if (operation === 'save') await f.controller.save();
    else await f.controller.load();
    assert.equal(f.controller.loaded, true);
    assert.equal(f.controller.dirty, false);
    assert.equal(f.controller.pending, false);
    assert.equal(f.controller.saved, operation === 'save');
    assert.equal(f.controller.error, undefined);
    assert.equal(f.controller.enabled, false);
    assert.equal(f.controller.locale, 'en');
    assert.equal(f.requests.length, before + 2);
    assertRequest(f.requests[before + 1]!, operation === 'save');
    await f.controller.save();
    assert.equal(f.requests.length, before + 2, 'confirmed unchanged preferences must not write again');
    assert.equal(f.replies.length, 0);
  });
}

test('an unreadable alert write is reconciled by a fresh read without replaying the write', async t => {
  const f = fixture(t);
  f.replies.push({body: confirmed});
  await f.controller.load();
  f.controller.choose(false, 'en');
  f.replies.push({body: updated, unreadable: true});
  await f.controller.save();
  assert.equal(f.controller.error, 'alertsUncertain');
  f.controller.choose(true, 'es');
  assert.equal(f.controller.dirty, true, 'the previous confirmation cannot settle an uncertain server write');
  f.replies.push({body: updated});
  await f.controller.load();
  assert.equal(f.controller.enabled, false);
  assert.equal(f.controller.locale, 'en');
  assert.equal(f.controller.loaded, true);
  assert.equal(f.controller.saved, false, 'reading current state does not claim another save');
  assert.equal(f.controller.dirty, false);
  assert.equal(f.controller.error, undefined);
  await f.controller.save();
  assert.equal(f.requests.length, 3);
  f.requests.forEach((request, i) => assertRequest(request, i === 1));
});

for (const entry of [
  {name: 'seconds', status: 429, retry: '2', readError: 'limited', writeError: 'limited'},
  {name: 'HTTP date', status: 503, retry: 'Wed, 28 Oct 2026 10:00:02 GMT', readError: 'unavailable', writeError: 'alertsUncertain'},
]) for (const write of [false, true]) for (const switchAccount of [false, true]) {
  test(`alert transport ${write ? 'save' : 'read'} Retry-After ${entry.name} blocks requests ${switchAccount ? 'across an account change' : 'for the same account'} until exact expiry`, async t => {
    const f = fixture(t);
    let now = Date.parse('2026-10-28T10:00:00.000Z');
    t.mock.method(Date, 'now', () => now);
    t.mock.method(performance, 'now', () => now - Date.parse('2026-10-28T10:00:00.000Z'));
    f.replies.push({body: confirmed});
    await f.controller.load();
    f.controller.choose(false, 'en');
    f.replies.push({status: entry.status, body: {error: 'temporarily_unavailable'}, retry: entry.retry});
    if (write) await f.controller.save();
    else await f.controller.load();
    assert.equal(f.controller.retryAt, Date.parse('2026-10-28T10:00:02.000Z'));
    assert.equal(f.controller.waiting, 2);
    assert.equal(f.controller.error, write ? entry.writeError : entry.readError);
    assert.equal(f.controller.loaded, true);
    assert.equal(f.controller.dirty, true);
    assert.equal(f.controller.saved, false);
    assert.equal(f.controller.pending, false);
    if (switchAccount) {
      f.controller.account(undefined);
      f.controller.account('another-owner');
      assert.equal(f.controller.loaded, false);
      assert.equal(f.controller.dirty, false);
      assert.equal(f.controller.loadAttempted, false);
      assert.equal(f.controller.error, undefined);
      assert.equal(f.controller.waiting, 2);
    }
    const changes = f.changes();
    await f.controller.load();
    await f.controller.save();
    now += 1_999;
    await f.controller.load();
    await f.controller.save();
    assert.equal(f.controller.waiting, 1);
    assert.equal(f.controller.pending, false);
    assert.equal(f.requests.length, 2);
    assert.equal(f.changes(), changes, 'a blocked operation must not publish pending state');
    now++;
    assert.equal(f.controller.waiting, 0);
    f.replies.push({body: updated});
    if (write && !switchAccount) await f.controller.save();
    else await f.controller.load();
    assert.equal(f.controller.enabled, false);
    assert.equal(f.controller.locale, 'en');
    assert.equal(f.controller.loaded, true);
    assert.equal(f.controller.dirty, false);
    assert.equal(f.controller.saved, write && !switchAccount);
    assert.equal(f.controller.error, undefined);
    assert.equal(f.controller.pending, false);
    assert.equal(f.changes(), changes + 2);
    assert.equal(f.requests.length, 3);
    assertRequest(f.requests[0]!, false);
    assertRequest(f.requests[1]!, write);
    assertRequest(f.requests[2]!, write && !switchAccount);
    assert.equal(f.replies.length, 0);
  });
}

for (const write of [false, true]) {
  test(`a pending alert transport ${write ? 'save' : 'read'} prevents duplicate reads, writes and choice changes`, async t => {
    const f = fixture(t);
    f.replies.push({body: confirmed});
    await f.controller.load();
    f.controller.choose(false, 'en');
    let release!: (reply: Reply) => void;
    f.replies.push(new Promise<Reply>(resolve => { release = resolve; }));
    const pending = write ? f.controller.save() : f.controller.load();
    assert.equal(f.controller.pending, true);
    assert.equal(f.requests.length, 2);
    await f.controller.load();
    await f.controller.save();
    f.controller.choose(true, 'es');
    assert.equal(f.controller.enabled, false);
    assert.equal(f.controller.locale, 'en');
    assert.equal(f.requests.length, 2);
    release({body: updated});
    await pending;
    assert.equal(f.controller.pending, false);
    assert.equal(f.controller.dirty, false);
    assert.equal(f.controller.saved, write);
    assert.equal(f.controller.error, undefined);
    assert.equal(f.requests.length, 2);
    assertRequest(f.requests[1]!, write);
  });
}
