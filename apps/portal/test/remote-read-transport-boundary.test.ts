import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {RemoteController} from '../src/remote-controller.ts';
import type {RemoteView, RemoteDns} from '../src/remote-types.ts';

const id = '12345678-1234-4234-8234-123456789abc';
const other = '22345678-1234-4234-8234-123456789abc';
const assigned = 'staff.harbour.example', hostname = 'staff.cafe.example';
const stamp = '2026-10-28T12:00:00.000Z';
const view: RemoteView = {installationId: id, revision: 7, revoked: false,
  names: {staff: {assigned, current: assigned},
    public: {assigned: 'public.harbour.example', current: 'public.harbour.example'}},
  service: {state: 'ready', health: 'healthy', observedAt: stamp,
    validUntil: '2026-10-28T13:00:00.000Z'},
  publicForward: {category: 'upstream_timeout', observedAt: stamp,
    expiresAt: '2026-10-28T12:05:00.000Z'}};
const dns: RemoteDns = {installationId: id, kind: 'staff', hostname, records: [
  {type: 'CNAME', name: hostname, value: assigned},
  {type: 'CNAME', name: '_acme-challenge.' + hostname, value: '_acme-challenge.' + assigned}]};
type Reply = 'network' | {body?: unknown; status?: number; raw?: string; brokenBody?: boolean; retry?: string;
  fetchWait?: Promise<void>; bodyWait?: Promise<void>};

function fixture(t: TestContext) {
  let now = Date.parse(stamp);
  t.mock.method(Date, 'now', () => now);
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=remote-read-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const replies: Reply[] = [];
  const calls: Array<{url: string; init: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.ok(init);
    calls.push({url: String(url), init});
    assert.ok(replies.length, 'each request needs an explicit reply');
    const reply = replies.shift()!;
    if (reply === 'network') throw new TypeError('private connection detail');
    if (reply.fetchWait) await reply.fetchWait;
    const response = new Response(reply.raw ?? JSON.stringify(reply.body), {
      status: reply.status ?? 200, headers: reply.retry ? {'Retry-After': reply.retry} : {},
    });
    if (reply.bodyWait || reply.brokenBody) {
      const json = response.json.bind(response);
      Object.defineProperty(response, 'json', {value: async () => {
        if (reply.bodyWait) await reply.bodyWait;
        if (reply.brokenBody) throw new Error('private body detail');
        return json();
      }});
    }
    return response;
  });
  const c = new RemoteController(() => {});
  c.account('owner');
  return {c, replies, calls, advance: (ms: number) => {now += ms;}};
}

function assertCalls(f: ReturnType<typeof fixture>, expected: Array<[string, Record<string, string>]>) {
  assert.deepEqual(f.calls.map(call => [call.url, JSON.parse(String(call.init.body))]),
    expected.map(([path, body]) => ['/api/account/remote-access/' + path, body]));
  for (const {init} of f.calls) {
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'same-origin');
    assert.deepEqual(init.headers, {'Content-Type': 'application/json', 'X-CSRF-Token': 'remote-read-proof'});
  }
  assert.equal(f.replies.length, 0);
}
const statusCall: [string, Record<string, string>] = ['status', {installationId: id}];
const dnsCall: [string, Record<string, string>] = ['dns', {installationId: id, kind: 'staff', hostname}];

async function opened(f: ReturnType<typeof fixture>) {
  f.replies.push({body: view});
  await f.c.open(id);
  assert.deepEqual(f.c.view, view);
  f.c.edit(hostname);
}

const refusals = [
  {name: 'lost reply', reply: 'network', error: 'unavailable', clears: false},
  {name: 'invalid JSON', reply: {raw: '{unfinished'}, error: 'unavailable', clears: false},
  {name: 'unreadable body', reply: {brokenBody: true}, error: 'unavailable', clears: false},
  {name: 'success-shaped 503', reply: {status: 503}, error: 'unavailable', clears: false},
  {name: 'expired session', reply: {status: 401, body: {error: 'session_expired'}}, error: 'pairSession', clears: true},
  {name: 'lost business permission', reply: {status: 403, body: {error: 'permission_denied'}}, error: 'permissionBusiness', clears: true},
] satisfies Array<{name: string; reply: Reply; error: string; clears: boolean}>;

for (const stage of ['status', 'dns'] as const) for (const entry of refusals) {
  test(`remote ${stage} ${entry.name} cannot publish a review and allows an explicit read retry`, async t => {
    const f = fixture(t);
    await opened(f);
    const reply = entry.reply === 'network' ? 'network' : {body: stage === 'status' ? view : dns, ...entry.reply};
    f.replies.push(reply);
    await (stage === 'status' ? f.c.load() : f.c.preview());
    assert.equal(f.c.error, entry.error);
    assert.equal(f.c.pending, false);
    assert.equal(f.c.notice, undefined);
    assert.equal(f.c.confirmation, undefined);
    assert.equal(f.c.hostname, entry.clears ? '' : hostname);
    assert.deepEqual(f.c.view, entry.clears ? undefined : {...view, publicForward: null});
    assert.equal(f.c.waiting, 0);
    await f.c.apply();
    const expected = [statusCall, stage === 'status' ? statusCall : dnsCall];
    assertCalls(f, expected);
    f.replies.push({body: view});
    await f.c.load();
    assert.deepEqual(f.c.view, view);
    assert.equal(f.c.error, undefined);
    assert.equal(f.c.notice, undefined);
    assert.equal(f.c.hostname, assigned);
    assert.equal(f.c.confirmation, undefined);
    f.c.edit(hostname);
    f.replies.push({body: dns});
    await f.c.preview();
    assert.deepEqual(f.c.confirmation, {kind: 'staff', hostname, revision: 7, records: dns.records});
    assertCalls(f, [...expected, statusCall, dnsCall]);
  });
}

for (const stage of ['status', 'dns'] as const) for (const phase of ['fetch', 'body'] as const) {
  test(`remote ${stage} pending ${phase} blocks duplicate reads, previews and route changes`, async t => {
    const f = fixture(t);
    await opened(f);
    const deferred = Promise.withResolvers<void>();
    t.after(() => deferred.resolve());
    f.replies.push({body: stage === 'status' ? view : dns,
      ...(phase === 'fetch' ? {fetchWait: deferred.promise} : {bodyWait: deferred.promise})});
    const pending = stage === 'status' ? f.c.load() : f.c.preview();
    // Let response headers reach the real client before exercising its body-reading gate.
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.c.pending, true);
    const before = f.calls.length;
    await f.c.load();
    await f.c.preview();
    f.c.choose('public');
    assert.equal(f.calls.length, before);
    assert.equal(f.c.kind, 'staff');
    assert.equal(f.c.hostname, hostname);
    deferred.resolve();
    await pending;
    assert.equal(f.c.pending, false);
    assert.equal(f.c.error, undefined);
    assert.equal(f.c.notice, undefined);
    assert.deepEqual(f.c.view, view);
    assert.deepEqual(f.c.confirmation, stage === 'status' ? undefined
      : {kind: 'staff', hostname, revision: 7, records: dns.records});
    assertCalls(f, [statusCall, stage === 'status' ? statusCall : dnsCall]);
  });
}

for (const stage of ['status', 'dns'] as const) for (const retry of ['2', 'Wed, 28 Oct 2026 12:00:02 GMT']) {
  for (const reset of ['none', 'account', 'venue'] as const) {
    test(`remote ${stage} ${retry === '2' ? 'seconds' : 'date'} wait survives ${reset} reset until exact expiry`, async t => {
      const f = fixture(t);
      await opened(f);
      f.replies.push({status: 429, body: {error: 'rate_limited'}, retry});
      await (stage === 'status' ? f.c.load() : f.c.preview());
      assert.equal(f.c.error, 'limited');
      assert.equal(f.c.waiting, 2);
      assert.equal(f.c.retryAt, Date.parse('2026-10-28T12:00:02.000Z'));
      let selected = id;
      if (reset === 'account') {f.c.account(undefined); f.c.account('owner'); await f.c.open(id);}
      if (reset === 'venue') {selected = other; await f.c.open(other);}
      f.advance(1_999);
      await f.c.load();
      await f.c.preview();
      await f.c.apply();
      assert.equal(f.c.waiting, 1);
      assert.equal(f.c.pending, false);
      assert.equal(f.c.confirmation, undefined);
      assert.equal(f.c.notice, undefined);
      const expected = [statusCall, stage === 'status' ? statusCall : dnsCall];
      assertCalls(f, expected);
      f.advance(1);
      f.replies.push({body: {...view, installationId: selected}});
      await f.c.load();
      assert.equal(f.c.waiting, 0);
      assert.equal(f.c.error, undefined);
      assert.equal(f.c.pending, false);
      assert.equal(f.c.hostname, assigned);
      assert.equal(f.c.notice, undefined);
      assert.deepEqual(f.c.view, {...view, installationId: selected});
      f.c.edit(hostname);
      f.replies.push({body: {...dns, installationId: selected}});
      await f.c.preview();
      assert.deepEqual(f.c.confirmation, {kind: 'staff', hostname, revision: 7, records: dns.records});
      assertCalls(f, [...expected, ['status', {installationId: selected}],
        ['dns', {installationId: selected, kind: 'staff', hostname}]]);
    });
  }
}
