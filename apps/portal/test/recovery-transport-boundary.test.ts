import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {RecoveryController} from '../src/recovery-controller.ts';
import type {RecoveryView} from '../src/recovery-types.ts';

const requestId = '12345678-1234-4234-8234-123456789abc';
const pointId = '22345678-1234-4234-8234-123456789abc';
const venueId = '32345678-1234-4234-8234-123456789abc';
const oldInstallationId = '42345678-1234-4234-8234-123456789abc';
const otherId = '52345678-1234-4234-8234-123456789abc';
const now = Date.parse('2026-10-28T12:00:00.000Z');
const expiresAt = '2026-10-28T13:00:00.000Z';
const source = {kind: 'snapshot', pointId} as const;
const pending: RecoveryView = {requestId, state: 'awaiting_owner', expiresAt, operationId: null, operation: null};
const approved: RecoveryView = {requestId, state: 'approved', expiresAt, operationId: requestId,
  operation: {id: requestId, venueId, pointId, source, mode: 'failure', status: 'restored', expiresAt}};
const ready: RecoveryView = {...approved, replacement: {requestId, pointId, source, venueId,
  oldInstallationId, localVenueId: otherId, nodeId: otherId, environment: 'test',
  publicKey: 'MCowBQYDK2VwAyEA' + 'A'.repeat(43), peerPublicKey: Buffer.alloc(32).toString('base64'),
  state: 'awaiting_owner', expiresAt, organisationName: 'Harbour Kitchen', legalBusinessName: 'Harbour Kitchen SL',
  registration: null}};
const completed: RecoveryView = {...ready, replacement: {...ready.replacement!, state: 'complete',
  registration: {venueId, installationId: otherId, organisationId: otherId, legalBusinessId: otherId}}};
const actions = ['inspect', 'approve', 'close', 'replace'] as const;
type Action = typeof actions[number];
type Reply = {body: unknown; status?: number; retry?: string};

function harness(t: TestContext, action: Action) {
  t.mock.timers.enable({apis: ['setTimeout']});
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=recovery-transport'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const initial = action === 'approve' ? pending : ready;
  const replies: Record<Action, Reply> = {
    inspect: {body: initial}, approve: {body: approved},
    close: {body: {...approved, operation: {...approved.operation!, status: 'closed'}}},
    replace: {body: completed},
  };
  let held: Action | undefined;
  let release: (() => void) | undefined;
  const calls: Array<{url: string; init: RequestInit | undefined}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    calls.push({url: String(url), init});
    const current = String(url).slice('/api/account/recovery/'.length) as Action;
    const reply = replies[current];
    if (held === current) {held = undefined; await new Promise<void>(resolve => {release = resolve;});}
    return Response.json(reply.body, {status: reply.status ?? 200,
      headers: reply.retry ? {'Retry-After': reply.retry} : {}});
  });
  let changes = 0;
  const c = new RecoveryController(() => {changes++;});
  c.account('owner'); c.open(requestId); c.code = ' 01234567 ';
  function select() {
    if (action === 'approve') {c.choose(venueId, pointId); c.stopped = true; c.acceptLoss = true;}
    if (action === 'replace') c.confirmReplacement = true;
  }
  function wire(index: number, expected: Action) {
    const call = calls[index]!;
    assert.equal(call.url, '/api/account/recovery/' + expected);
    assert.equal(call.init?.method, 'POST');
    assert.equal(call.init?.credentials, 'same-origin');
    assert.equal(new Headers(call.init?.headers).get('X-CSRF-Token'), 'recovery-transport');
    assert.equal(new Headers(call.init?.headers).get('Content-Type'), 'application/json');
    const body: Record<string, string> = {requestId, code: '01234567'};
    if (expected === 'approve') Object.assign(body, {source: 'snapshot', pointId,
      oldServerUnavailable: 'true', acceptDataLoss: 'true'});
    if (expected === 'replace') Object.assign(body, {oldInstallationId,
      oldServerUnavailable: 'true', confirmReplacement: 'true'});
    assert.deepEqual(JSON.parse(String(call.init?.body)), body);
  }
  return {c, replies, calls, initial, select, wire, changes: () => changes,
    advance: (ms: number) => {clock += ms; t.mock.timers.tick(ms);},
    hold: () => {held = action;},
    release: () => {assert.ok(release, 'the HTTP request reached its held boundary'); held = undefined; release();}};
}

for (const action of actions) {
  test(`recovery HTTP pending ${action} blocks every duplicate action until its reply`, async t => {
    const h = harness(t, action), {c} = h;
    await c.inspect(); h.select(); h.hold();
    const work = c[action]();
    try {
      assert.equal(c.pending, true);
      const changes = h.changes();
      for (const duplicate of actions) await c[duplicate]();
      assert.equal(h.calls.length, 2);
      assert.equal(h.changes(), changes);
      assert.equal(c.pending, true);
      assert.deepEqual(c.view, h.initial);
      h.wire(1, action);
    } finally {h.release(); await work;}
    assert.equal(c.pending, false);
    assert.equal(c.error, undefined);
    assert.deepEqual(c.view, h.replies[action].body);
    assert.ok(h.changes() > 0);
  });

  for (const format of ['seconds', 'date'] as const) {
    test(`recovery HTTP ${action} honours ${format} Retry-After at the exact expiry`, async t => {
      const h = harness(t, action), {c} = h;
      await c.inspect(); h.select();
      const accepted = h.replies[action];
      h.replies[action] = {body: {error: 'rate_limited'}, status: 429,
        retry: format === 'seconds' ? '2' : new Date(now + 2000).toUTCString()};
      await c[action]();
      assert.equal(c.error, 'limited'); assert.equal(c.uncertain, false);
      assert.equal(c.pending, false); assert.deepEqual(c.view, h.initial);
      assert.equal(c.retryAt, now + 2000); assert.equal(c.waiting, 2);
      h.wire(1, action);
      for (const blocked of actions) await c[blocked]();
      h.advance(1999);
      assert.equal(c.waiting, 1);
      for (const blocked of actions) await c[blocked]();
      assert.equal(h.calls.length, 2);
      h.advance(1); assert.equal(c.waiting, 0);
      h.replies[action] = accepted;
      await c[action]();
      assert.equal(h.calls.length, 3); h.wire(2, action);
      assert.deepEqual(c.view, accepted.body);
      assert.equal(c.pending, false); assert.equal(c.uncertain, false);
      assert.equal(c.error, undefined);
    });
  }
}

for (const action of ['approve', 'close', 'replace'] as const) {
  test(`recovery HTTP ${action} server failure delays inspection and never repeats the write automatically`, async t => {
    const h = harness(t, action), {c} = h;
    await c.inspect(); h.select();
    const accepted = h.replies[action];
    h.replies[action] = {body: {error: 'temporarily_unavailable'}, status: 503, retry: '2'};
    await c[action]();
    assert.equal(c.uncertain, true); assert.equal(c.error, 'recoveryUncertain');
    assert.equal(c.confirmReplacement, false); assert.equal(c.pending, false);
    assert.equal(c.waiting, 2); assert.deepEqual(c.view, h.initial);
    assert.equal(h.calls.length, 2); h.wire(1, action);
    await c.inspect(); assert.equal(h.calls.length, 2);
    h.advance(2000);
    assert.equal(c.waiting, 0);
    assert.equal(h.calls.length, 2, 'expiry alone sends no request');
    h.replies.inspect = {body: accepted.body};
    await c.inspect();
    assert.deepEqual(h.calls.map(call => call.url), ['/api/account/recovery/inspect',
      '/api/account/recovery/' + action, '/api/account/recovery/inspect']);
    h.wire(2, 'inspect');
    assert.deepEqual(c.view, accepted.body);
    assert.equal(c.uncertain, false); assert.equal(c.error, undefined);
    assert.equal(c.confirmReplacement, false);
  });
}

for (const reset of ['account', 'request'] as const) {
  test(`recovery HTTP retry wait survives ${reset} changes while clearing chosen recovery details`, async t => {
    const h = harness(t, 'approve'), {c} = h;
    await c.inspect(); h.select();
    assert.equal(c.venueId, venueId); assert.equal(c.pointId, pointId);
    assert.equal(c.source, 'snapshot'); assert.equal(c.stopped, true); assert.equal(c.acceptLoss, true);
    h.replies.approve = {body: {error: 'rate_limited'}, status: 429, retry: '2'};
    await c.approve();
    if (reset === 'account') c.account('other'); else c.open(otherId);
    assert.equal(c.code, '');
    assert.equal(c.view, undefined); assert.equal(c.confirmReplacement, false);
    assert.equal(c.venueId, undefined); assert.equal(c.pointId, undefined); assert.equal(c.source, undefined);
    assert.equal(c.stopped, false); assert.equal(c.acceptLoss, false);
    assert.equal(c.waiting, 2);
    c.code = '87654321';
    await c.inspect(); h.advance(1999); await c.inspect();
    assert.equal(h.calls.length, 2); assert.equal(c.waiting, 1);
    h.advance(1);
    const expectedRequest = reset === 'request' ? otherId : requestId;
    h.replies.inspect = {body: {...pending, requestId: expectedRequest}};
    await c.inspect();
    assert.equal(h.calls.length, 3);
    assert.deepEqual(JSON.parse(String(h.calls[2]!.init?.body)), {requestId: expectedRequest, code: '87654321'});
    assert.deepEqual(c.view, {...pending, requestId: expectedRequest});
    assert.equal(c.error, undefined); assert.equal(c.waiting, 0);
  });

  test(`recovery HTTP ${reset} round trip cannot restore confirmation for an identical replacement proposal`, async t => {
    const h = harness(t, 'replace'), {c} = h;
    await c.inspect(); h.select(); assert.equal(c.confirmReplacement, true);
    if (reset === 'account') {c.account('other'); c.account('owner');}
    else {c.open(otherId); c.open(requestId);}
    assert.equal(c.code, ''); assert.equal(c.view, undefined);
    c.code = '01234567'; await c.inspect();
    assert.deepEqual(c.view, ready); assert.equal(c.confirmReplacement, false);
    await c.replace();
    assert.equal(h.calls.length, 2, 'the restored identical offer still needs fresh confirmation');
    c.confirmReplacement = true; await c.replace();
    assert.equal(h.calls.length, 3); h.wire(2, 'replace');
    assert.deepEqual(c.view, completed); assert.equal(c.confirmReplacement, false);
  });
}
