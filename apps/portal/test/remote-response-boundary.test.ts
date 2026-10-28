import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {RemoteController} from '../src/remote-controller.ts';
import type {RemoteDns, RemoteView} from '../src/remote-types.ts';

const id = '12345678-1234-4234-8234-123456789abc';
const other = '22345678-1234-4234-8234-123456789abc';
const assigned = 'staff.harbour.example', hostname = 'staff.cafe.example';
const stamp = '2026-10-28T12:00:00.000Z';
function view(): RemoteView {
  return {installationId: id, revision: 7, revoked: false,
    names: {staff: {assigned, current: assigned},
      public: {assigned: 'public.harbour.example', current: 'public.harbour.example'}},
    service: {state: 'ready', health: 'healthy', observedAt: stamp,
      validUntil: '2026-10-28T13:00:00.000Z'},
    publicForward: {category: 'upstream_timeout', observedAt: stamp,
      expiresAt: '2026-10-28T12:05:00.000Z'}};
}
function dns(): RemoteDns {
  return {installationId: id, kind: 'staff', hostname, records: [
    {type: 'CNAME', name: hostname, value: assigned},
    {type: 'CNAME', name: '_acme-challenge.' + hostname, value: '_acme-challenge.' + assigned}]};
}
function saved(): RemoteView {
  const value = view();
  return {...value, revision: 8, names: {...value.names!, staff: {assigned, current: hostname}}};
}
function harness(t: TestContext) {
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
  const replies: Record<string, {body: unknown; status?: number; retry?: string}> = {
    '/api/account/remote-access/status': {body: view()},
    '/api/account/remote-access/dns': {body: dns()},
    '/api/account/remote-access/apply': {body: saved()},
  };
  const calls: Array<{url: string; init: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(typeof url, 'string');
    assert.ok(init);
    const reply = replies[String(url)];
    assert.ok(reply, 'unexpected endpoint');
    calls.push({url: String(url), init});
    return Response.json(reply.body, {status: reply.status ?? 200,
      headers: reply.retry ? {'Retry-After': reply.retry} : {}});
  });
  const c = new RemoteController(() => {});
  c.account('owner');
  return {c, replies, calls, advance: (ms: number) => {now += ms;}};
}

const malformedViews: Array<{name: string; body: () => unknown}> = [
  {name: 'null', body: () => null},
  {name: 'negative revision', body: () => ({...view(), revision: -1})},
  {name: 'invalid hostname', body: () => ({...view(), names: {...view().names,
    staff: {assigned, current: 'javascript:alert(1)'}}})},
  {name: 'unknown service state', body: () => ({...view(), service: {...view().service, state: 'online'}})},
  {name: 'unknown service health', body: () => ({...view(), service: {...view().service, health: 'good'}})},
  {name: 'invalid lease date', body: () => ({...view(), service: {...view().service, validUntil: 'later'}})},
  {name: 'private forward detail', body: () => ({...view(), publicForward: {...view().publicForward, detail: 'private'}})},
  {name: 'overlong forward lifetime', body: () => ({...view(), publicForward: {...view().publicForward,
    expiresAt: '2026-10-28T12:05:00.001Z'}})},
];
for (const row of malformedViews) test(`remote HTTP status rejects ${row.name} without replacing confirmed setup`, async t => {
  const {c, replies, calls} = harness(t);
  await c.open(id);
  assert.equal(c.view?.publicForward?.category, 'upstream_timeout');
  replies['/api/account/remote-access/status'] = {body: row.body()};
  await c.load();
  assert.equal(c.error, 'unavailable');
  assert.equal(c.pending, false);
  assert.equal(c.confirmation, undefined);
  assert.deepEqual(c.view, {...view(), publicForward: null});
  assert.equal(c.hostname, assigned);
  assert.equal(calls.length, 2);
  replies['/api/account/remote-access/status'] = {body: saved()};
  await c.load();
  assert.equal(c.error, undefined);
  assert.equal(c.hostname, hostname);
  assert.equal(c.view?.revision, 8);
});

test('remote HTTP status for a different installation cannot become the selected setup', async t => {
  const {c, replies} = harness(t);
  replies['/api/account/remote-access/status'] = {body: {...view(), installationId: other}};
  await c.open(id);
  assert.equal(c.view, undefined);
  assert.equal(c.hostname, '');
  assert.equal(c.error, 'unavailable');
});

const malformedDns: Array<{name: string; body: () => unknown}> = [
  {name: 'null', body: () => null},
  {name: 'missing ACME record', body: () => ({...dns(), records: dns().records.slice(0, 1)})},
  {name: 'TXT record', body: () => ({...dns(), records: [{...dns().records[0], type: 'TXT'}, dns().records[1]]})},
  {name: 'wrong record name', body: () => ({...dns(), records: [{...dns().records[0], name: 'another.example'}, dns().records[1]]})},
  {name: 'wrong ACME target', body: () => ({...dns(), records: [dns().records[0], {...dns().records[1], value: '_acme-challenge.another.example'}]})},
  {name: 'different installation', body: () => ({...dns(), installationId: other})},
  {name: 'different route kind', body: () => ({...dns(), kind: 'public'})},
  {name: 'different requested hostname', body: () => ({...dns(), hostname: 'other.cafe.example', records: [
    {...dns().records[0], name: 'other.cafe.example'},
    {...dns().records[1], name: '_acme-challenge.other.cafe.example'}]})},
  {name: 'different assigned target', body: () => ({...dns(), records: [
    {...dns().records[0], value: 'staff.other.example'},
    {...dns().records[1], value: '_acme-challenge.staff.other.example'}]})},
];
for (const row of malformedDns) test(`remote HTTP DNS rejects ${row.name} before confirmation or save`, async t => {
  const {c, replies, calls} = harness(t);
  await c.open(id);
  c.edit(hostname);
  replies['/api/account/remote-access/dns'] = {body: row.body()};
  await c.preview();
  assert.equal(c.confirmation, undefined);
  assert.equal(c.error, 'unavailable');
  assert.equal(c.view?.publicForward, null);
  assert.equal(c.hostname, hostname);
  assert.equal(c.pending, false);
  await c.apply();
  assert.equal(calls.length, 2);
  replies['/api/account/remote-access/dns'] = {body: dns()};
  await c.preview();
  assert.deepEqual(c.confirmation, {kind: 'staff', hostname, revision: 7, records: dns().records});
  await c.apply();
  assert.equal(c.notice, 'remoteSaved');
  assert.equal(c.view?.names?.staff.current, hostname);
  assert.equal(calls.length, 4);
  const request = calls[3]!.init;
  assert.equal(request.method, 'POST');
  assert.equal(request.credentials, 'same-origin');
  assert.equal((request.headers as Record<string, string>)['X-CSRF-Token'], 'remote-proof');
  assert.deepEqual(JSON.parse(String(request.body)), {installationId: id, kind: 'staff', hostname, expectedRevision: '7'});
});

for (const committed of [false, true]) test(`malformed remote HTTP save reconciles once when change ${committed ? 'committed' : 'did not commit'}`, async t => {
  const {c, replies, calls} = harness(t);
  await c.open(id); c.edit(hostname); await c.preview();
  replies['/api/account/remote-access/apply'] = {body: {saved: true}};
  replies['/api/account/remote-access/status'] = {body: committed ? saved() : view()};
  await c.apply();
  assert.equal(c.notice, committed ? 'remoteSaved' : undefined);
  assert.equal(c.error, committed ? undefined : 'remoteUncertain');
  assert.equal(c.confirmation, undefined);
  assert.equal(c.pending, false);
  assert.equal(c.view?.names?.staff.current, committed ? hostname : assigned);
  assert.deepEqual(calls.map(call => call.url), ['/api/account/remote-access/status', '/api/account/remote-access/dns',
    '/api/account/remote-access/apply', '/api/account/remote-access/status']);
  await c.apply();
  assert.equal(calls.length, 4);
});

for (const mismatch of ['installation', 'hostname'] as const) test(`remote HTTP save with a different ${mismatch} cannot confirm success`, async t => {
  const {c, replies, calls} = harness(t);
  await c.open(id); c.edit(hostname); await c.preview();
  const value = saved();
  replies['/api/account/remote-access/apply'] = {body: mismatch === 'installation'
    ? {...value, installationId: other} : {...value, names: {...value.names!, staff: {assigned, current: assigned}}}};
  await c.apply();
  assert.equal(c.notice, undefined);
  assert.equal(c.error, 'remoteUncertain');
  assert.equal(c.view, undefined);
  assert.equal(c.confirmation, undefined);
  assert.equal(calls.length, 3);
  replies['/api/account/remote-access/status'] = {body: saved()};
  await c.load();
  assert.equal(c.hostname, hostname);
  assert.deepEqual(c.view, saved());
  assert.equal(c.error, undefined);
});

for (const operation of ['preview', 'apply'] as const) test(`remote HTTP ${operation} permission refusal clears the reviewed setup`, async t => {
  const {c, replies, calls} = harness(t);
  await c.open(id); c.edit(hostname);
  if (operation === 'apply') await c.preview();
  replies['/api/account/remote-access/' + (operation === 'preview' ? 'dns' : 'apply')] = {
    body: {error: 'permission_denied'}, status: 403};
  await c[operation]();
  assert.equal(c.error, 'permissionBusiness');
  assert.equal(c.view, undefined);
  assert.equal(c.hostname, '');
  assert.equal(c.confirmation, undefined);
  assert.equal(c.notice, undefined);
  const count = calls.length;
  await c.preview(); await c.apply();
  assert.equal(calls.length, count);
});

test('remote HTTP DNS retry wait blocks review and load until the server deadline', async t => {
  const {c, replies, calls, advance} = harness(t);
  await c.open(id); c.edit(hostname);
  replies['/api/account/remote-access/dns'] = {body: {error: 'rate_limited'}, status: 429, retry: '30'};
  await c.preview();
  assert.equal(c.error, 'limited');
  assert.equal(c.waiting, 30);
  assert.equal(c.confirmation, undefined);
  replies['/api/account/remote-access/dns'] = {body: dns()};
  advance(29_999);
  await c.preview(); await c.load(); await c.apply();
  assert.equal(calls.length, 2);
  advance(1);
  await c.preview();
  assert.equal(calls.length, 3);
  assert.deepEqual(c.confirmation, {kind: 'staff', hostname, revision: 7, records: dns().records});
});

for (const [path, rows] of [
  ['/remote-access/status', malformedViews], ['/remote-access/apply', malformedViews],
  ['/remote-access/dns', malformedDns.slice(0, 5)],
] as const) for (const row of rows) test(`remote HTTP client rejects ${row.name} at ${path}`, async t => {
  const {replies} = harness(t);
  replies['/api/account' + path] = {body: row.body()};
  assert.deepEqual(await accountRequest(path, {installationId: id}),
    {ok: false, status: 503, code: 'unexpected_response', retryAfterMs: 0});
});

test('malformed remote HTTP reconciliation cannot confirm a save or replay it', async t => {
  const {c, replies, calls} = harness(t);
  await c.open(id); c.edit(hostname); await c.preview();
  replies['/api/account/remote-access/apply'] = {body: {saved: true}};
  replies['/api/account/remote-access/status'] = {body: {saved: true}};
  await c.apply();
  assert.equal(c.view, undefined);
  assert.equal(c.notice, undefined);
  assert.equal(c.error, 'unavailable');
  assert.equal(c.confirmation, undefined);
  assert.equal(c.pending, false);
  assert.equal(calls.length, 4);
  await c.apply();
  assert.equal(calls.length, 4);
  replies['/api/account/remote-access/status'] = {body: saved()};
  await c.load();
  assert.equal(c.hostname, hostname);
  assert.equal(c.error, undefined);
  assert.equal(calls.length, 5);
});
