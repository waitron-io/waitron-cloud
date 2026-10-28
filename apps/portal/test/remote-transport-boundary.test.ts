import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {RemoteController} from '../src/remote-controller.ts';
import type {RemoteDns, RemoteView} from '../src/remote-types.ts';

const id = '12345678-1234-4234-8234-123456789abc';
const assigned = 'staff.harbour.example', hostname = 'staff.cafe.example';
const stamp = '2026-10-28T12:00:00.000Z';
const initial: RemoteView = {
  installationId: id, revision: 7, revoked: false,
  names: {staff: {assigned, current: assigned},
    public: {assigned: 'public.harbour.example', current: 'public.harbour.example'}},
  service: {state: 'ready', health: 'healthy', observedAt: stamp,
    validUntil: '2026-10-28T13:00:00.000Z'},
  publicForward: {category: 'upstream_timeout', observedAt: stamp,
    expiresAt: '2026-10-28T12:05:00.000Z'},
};
const saved: RemoteView = {...initial, revision: 8,
  names: {...initial.names!, staff: {assigned, current: hostname}}};
const dns: RemoteDns = {installationId: id, kind: 'staff', hostname, records: [
  {type: 'CNAME', name: hostname, value: assigned},
  {type: 'CNAME', name: '_acme-challenge.' + hostname, value: '_acme-challenge.' + assigned},
]};
type Reply = 'network' | {body?: unknown; status?: number; raw?: string; brokenBody?: boolean; retry?: string};

function fixture(t: TestContext) {
  let now = Date.parse(stamp);
  t.mock.method(Date, 'now', () => now);
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=remote-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const replies: Reply[] = [];
  const requests: Array<{url: string; init: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.ok(init);
    requests.push({url: String(url), init});
    assert.ok(replies.length, 'each request needs an explicit HTTP outcome');
    const reply = replies.shift()!;
    if (reply === 'network') throw new TypeError('private connection detail');
    const response = new Response(reply.raw ?? JSON.stringify(reply.body), {
      status: reply.status ?? 200, headers: reply.retry ? {'Retry-After': reply.retry} : {},
    });
    if (reply.brokenBody) Object.defineProperty(response, 'json', {value: async () => {
      throw new Error('private body detail');
    }});
    return response;
  });
  const controller = new RemoteController(() => {});
  controller.account('owner');
  return {controller, replies, requests, advance: (ms: number) => {now += ms;}};
}

async function review(f: ReturnType<typeof fixture>) {
  f.replies.push({body: initial}, {body: dns});
  await f.controller.open(id);
  f.controller.edit(hostname);
  await f.controller.preview();
  assert.deepEqual(f.controller.confirmation, {kind: 'staff', hostname, revision: 7, records: dns.records});
}

function assertRequests(f: ReturnType<typeof fixture>, paths: string[]) {
  assert.deepEqual(f.requests.map(r => r.url), paths.map(path => '/api/account/remote-access/' + path));
  for (const [i, request] of f.requests.entries()) {
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.credentials, 'same-origin');
    assert.deepEqual(request.init.headers, {'Content-Type': 'application/json', 'X-CSRF-Token': 'remote-proof'});
    assert.equal(request.init.body, JSON.stringify(paths[i] === 'status' ? {installationId: id}
      : paths[i] === 'dns' ? {installationId: id, kind: 'staff', hostname}
      : {installationId: id, kind: 'staff', hostname, expectedRevision: '7'}));
  }
  assert.equal(f.replies.length, 0);
}

const uncertainWrites = [
  {name: 'lost connection', reply: 'network', conflict: false},
  {name: 'broken JSON', reply: {raw: '{unfinished'}, conflict: false},
  {name: 'body read failure', reply: {body: saved, brokenBody: true}, conflict: false},
  {name: 'server refusal with a valid saved view', reply: {status: 500, body: saved}, conflict: false},
  {name: 'unavailable service', reply: {status: 503, body: {error: 'temporarily_unavailable'}}, conflict: false},
  {name: 'revision conflict', reply: {status: 409, body: {error: 'revision_conflict'}}, conflict: true},
] satisfies Array<{name: string; reply: Reply; conflict: boolean}>;

for (const entry of uncertainWrites) for (const committed of [false, true]) {
  test(`remote transport ${entry.name} reads back ${committed ? 'the saved' : 'the unchanged'} hostname without replaying the write`, async t => {
    const f = fixture(t);
    await review(f);
    f.replies.push(entry.reply, {body: committed ? saved : initial});
    await f.controller.apply();
    assert.equal(f.controller.notice, committed ? 'remoteSaved' : undefined);
    assert.equal(f.controller.error, committed ? undefined : entry.conflict ? 'remoteConflict' : 'remoteUncertain');
    assert.deepEqual(f.controller.view, committed ? saved : initial);
    assert.equal(f.controller.hostname, committed ? hostname : assigned);
    assert.equal(f.controller.pending, false);
    assert.equal(f.controller.confirmation, undefined);
    assert.equal(f.controller.waiting, 0);
    await f.controller.apply();
    assertRequests(f, ['status', 'dns', 'apply', 'status']);
  });
}

for (const entry of [
  {name: 'lost connection', reply: 'network', error: 'unavailable', wait: 0, clears: false},
  {name: 'broken JSON', reply: {raw: '{unfinished'}, error: 'unavailable', wait: 0, clears: false},
  {name: 'body read failure', reply: {body: saved, brokenBody: true}, error: 'unavailable', wait: 0, clears: false},
  {name: 'lost session', reply: {status: 401, body: {error: 'unauthenticated'}}, error: 'pairSession', wait: 0, clears: true},
  {name: 'lost business permission', reply: {status: 403, body: {error: 'permission_denied'}}, error: 'permissionBusiness', wait: 0, clears: true},
  {name: 'rate limit', reply: {status: 429, retry: '2', body: {error: 'rate_limited'}}, error: 'limited', wait: 2, clears: false},
] satisfies Array<{name: string; reply: Reply; error: string; wait: number; clears: boolean}>) {
  test(`remote transport ${entry.name} during lost-save read-back keeps the outcome unconfirmed and permits only a status retry`, async t => {
    const f = fixture(t);
    await review(f);
    f.replies.push('network', entry.reply);
    await f.controller.apply();
    assert.equal(f.controller.view, undefined);
    assert.equal(f.controller.notice, undefined);
    assert.equal(f.controller.error, entry.error);
    assert.equal(f.controller.hostname, entry.clears ? '' : hostname);
    assert.equal(f.controller.confirmation, undefined);
    assert.equal(f.controller.pending, false);
    assert.equal(f.controller.waiting, entry.wait);
    await f.controller.apply();
    await f.controller.preview();
    assertRequests(f, ['status', 'dns', 'apply', 'status']);
    if (entry.wait) {
      f.advance(1_999);
      await f.controller.load();
      assert.equal(f.controller.waiting, 1);
      assertRequests(f, ['status', 'dns', 'apply', 'status']);
      f.advance(1);
    }
    f.replies.push({body: saved});
    await f.controller.load();
    assert.deepEqual(f.controller.view, saved);
    assert.equal(f.controller.hostname, hostname);
    assert.equal(f.controller.error, undefined);
    assert.equal(f.controller.notice, undefined, 'an explicit status retry must not announce a save');
    assert.equal(f.controller.pending, false);
    assert.equal(f.controller.waiting, 0);
    await f.controller.apply();
    assertRequests(f, ['status', 'dns', 'apply', 'status', 'status']);
  });
}

for (const retry of ['2', 'Wed, 28 Oct 2026 12:00:02 GMT']) for (const committed of [false, true]) {
  test(`remote transport save Retry-After ${retry === '2' ? 'seconds' : 'date'} permits one immediate read-back of ${committed ? 'the saved' : 'the unchanged'} name and blocks later requests`, async t => {
    const f = fixture(t);
    await review(f);
    f.replies.push({status: 503, body: {error: 'temporarily_unavailable'}, retry}, {body: committed ? saved : initial});
    await f.controller.apply();
    assert.equal(f.controller.notice, committed ? 'remoteSaved' : undefined);
    assert.equal(f.controller.error, committed ? undefined : 'remoteUncertain');
    assert.deepEqual(f.controller.view, committed ? saved : initial);
    assert.equal(f.controller.confirmation, undefined);
    assert.equal(f.controller.pending, false);
    assert.equal(f.controller.retryAt, Date.parse('2026-10-28T12:00:02.000Z'));
    assert.equal(f.controller.waiting, 2);
    f.controller.edit(hostname);
    f.advance(1_999);
    await f.controller.load();
    await f.controller.preview();
    await f.controller.apply();
    assert.equal(f.controller.waiting, 1);
    assert.equal(f.controller.pending, false);
    assertRequests(f, ['status', 'dns', 'apply', 'status']);
    f.advance(1);
    f.replies.push({body: saved});
    await f.controller.load();
    assert.equal(f.controller.waiting, 0);
    assert.equal(f.controller.hostname, hostname);
    assert.equal(f.controller.error, undefined);
    assert.equal(f.controller.confirmation, undefined);
    await f.controller.apply();
    assertRequests(f, ['status', 'dns', 'apply', 'status', 'status']);
  });
}
