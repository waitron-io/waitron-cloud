import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {DiagnosticController} from '../src/diagnostic-controller.ts';
import type {DiagnosticExport} from '../src/diagnostic-types.ts';

const installationId = '12345678-1234-4234-8234-123456789abc';
const stamp = '2026-10-28T10:00:00.000Z';
const documentValue: DiagnosticExport = {
  version: 1, generatedAt: stamp, installation: {
    installationId, venueId: '22345678-1234-4234-8234-123456789abc', environment: 'test', revision: 1,
    access: {status: 'active', lastContactAt: null, leaseExpiresAt: null},
    services: [
      {service: 'continuous_backup', state: 'ready', health: 'healthy', observedAt: stamp},
      {service: 'remote_access', state: 'unconfigured', health: 'unknown', observedAt: null},
      {service: 'retained_snapshots', state: 'ready', health: 'healthy', observedAt: stamp},
    ],
    backups: {latestSnapshotAt: null, verifiedSnapshotAt: null},
    monitoring: {enabled: false, fresh: false, checkedAt: null, incidents: [], remoteChecks: {public: null, staff: null}},
  },
};
type Reply = {body?: unknown; status?: number; raw?: string; retry?: string} | 'network';

function fixture(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=diagnostic-proof'}],
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
  const saved: Array<{value: DiagnosticExport; name: string}> = [];
  let changes = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.ok(init);
    requests.push({url: String(url), init});
    assert.ok(replies.length, 'each HTTP request needs an explicit outcome');
    const reply = replies.shift()!;
    if (reply === 'network') throw new TypeError('private transport detail');
    return new Response(reply.status === 204 ? null : reply.raw ?? JSON.stringify(reply.body), {
      status: reply.status ?? 200, headers: reply.retry ? {'Retry-After': reply.retry} : {},
    });
  });
  const controller = new DiagnosticController(() => { changes++; }, accountRequest, (value, name) => saved.push({value, name}));
  controller.account('owner');
  return {controller, replies, requests, saved, changes: () => changes};
}

function assertRequest(request: {url: string; init: RequestInit}) {
  assert.equal(request.url, '/api/account/diagnostics/read');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.credentials, 'same-origin');
  assert.equal(request.init.body, JSON.stringify({installationId}));
  assert.deepEqual(request.init.headers, {'Content-Type': 'application/json', 'X-CSRF-Token': 'diagnostic-proof'});
}

const failures = [
  {name: 'lost session', reply: {status: 401, body: {error: 'unauthenticated'}}, error: 'pairSession'},
  {name: 'missing business permission', reply: {status: 403, body: {error: 'permission_denied'}}, error: 'permissionBusiness'},
  {name: 'forbidden request', reply: {status: 403, body: {error: 'forbidden'}}, error: 'forbidden'},
  {name: 'unknown permission refusal', reply: {status: 403, body: {error: 'private_internal_detail'}}, error: 'forbidden'},
  {name: 'rate limit without wait', reply: {status: 429, body: {error: 'rate_limited'}}, error: 'limited'},
  {name: 'service refusal', reply: {status: 503, body: {error: 'temporarily_unavailable'}}, error: 'diagnosticUnavailable'},
  {name: 'server failure with a well-formed diagnostic', reply: {status: 500, body: documentValue}, error: 'diagnosticUnavailable'},
  {name: 'permission refusal with a well-formed diagnostic', reply: {status: 403, body: documentValue}, error: 'forbidden'},
  {name: 'broken JSON', reply: {raw: '{unfinished'}, error: 'diagnosticUnavailable'},
  {name: 'empty body', reply: {raw: ''}, error: 'diagnosticUnavailable'},
  {name: 'empty no-content reply', reply: {status: 204}, error: 'diagnosticUnavailable'},
  {name: 'network failure', reply: 'network', error: 'diagnosticUnavailable'},
] satisfies Array<{name: string; reply: Reply; error: string}>;

for (const entry of failures) {
  test(`diagnostic transport ${entry.name} saves nothing and permits an explicit valid retry`, async t => {
    const f = fixture(t);
    f.replies.push(entry.reply);
    await f.controller.download(installationId);
    assert.deepEqual(f.saved, []);
    assert.equal(f.controller.error, entry.error);
    assert.equal(f.controller.pending, false);
    assert.equal(f.controller.selected, undefined);
    assert.equal(f.controller.waiting, 0);
    assert.equal(f.changes(), 2, 'pending and completed state both notify the screen');
    assert.equal(f.requests.length, 1, 'a failed download must not retry by itself');
    assertRequest(f.requests[0]!);

    f.replies.push({body: documentValue});
    await f.controller.download(installationId);
    assert.deepEqual(f.saved, [{value: documentValue, name: 'waitron-cloud-diagnostic-22345678-20261028T100000Z.json'}]);
    assert.equal(f.controller.error, undefined);
    assert.equal(f.controller.pending, false);
    assert.equal(f.controller.selected, undefined);
    assert.equal(f.changes(), 4);
    assert.equal(f.requests.length, 2);
    assertRequest(f.requests[1]!);
    assert.equal(f.replies.length, 0);
  });
}

for (const entry of [
  {name: 'seconds', status: 429, retry: '2', error: 'limited'},
  {name: 'HTTP date', status: 503, retry: 'Wed, 28 Oct 2026 10:00:02 GMT', error: 'diagnosticUnavailable'},
]) {
  test(`diagnostic transport honours Retry-After ${entry.name} until its exact expiry`, async t => {
    const f = fixture(t);
    let now = Date.parse(stamp);
    t.mock.method(Date, 'now', () => now);
    f.replies.push({status: entry.status, retry: entry.retry, body: {error: 'temporarily_unavailable'}});
    await f.controller.download(installationId);
    assert.deepEqual(f.saved, []);
    assert.equal(f.controller.error, entry.error);
    assert.equal(f.controller.retryAt, Date.parse('2026-10-28T10:00:02.000Z'));
    assert.equal(f.controller.waiting, 2);
    now += 1_999;
    await f.controller.download(installationId);
    assert.equal(f.requests.length, 1, 'the user cannot bypass an active server wait');
    assert.equal(f.controller.waiting, 1);
    assert.equal(f.changes(), 2);
    now++;
    assert.equal(f.controller.waiting, 0);
    f.replies.push({body: documentValue});
    await f.controller.download(installationId);
    assert.deepEqual(f.saved, [{value: documentValue, name: 'waitron-cloud-diagnostic-22345678-20261028T100000Z.json'}]);
    assert.equal(f.controller.error, undefined);
    assert.equal(f.requests.length, 2);
    assert.equal(f.changes(), 4);
    for (const request of f.requests) assertRequest(request);
    assert.equal(f.replies.length, 0);
  });
}
