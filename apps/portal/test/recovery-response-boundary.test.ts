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
const actions = ['approve', 'close', 'replace'] as const;
type Action = typeof actions[number];
type Reply = {body?: unknown; status?: number; retry?: string; brokenJson?: boolean; network?: boolean};

function harness(t: TestContext) {
  t.mock.method(Date, 'now', () => now);
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=recovery-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const replies: Record<string, Reply> = {
    inspect: {body: ready}, approve: {body: approved},
    close: {body: {...approved, operation: {...approved.operation!, status: 'closed'}}},
    replace: {body: completed},
  };
  const calls: Array<{action: string; init: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(typeof url, 'string');
    assert.ok(String(url).startsWith('/api/account/recovery/'));
    assert.ok(init);
    const action = String(url).slice('/api/account/recovery/'.length);
    const reply = replies[action];
    assert.ok(reply, 'unexpected recovery action');
    calls.push({action, init});
    if (reply.network) throw new TypeError('connection lost');
    const options: ResponseInit = {status: reply.status ?? 200, headers: reply.retry ? {'Retry-After': reply.retry} : {}};
    return reply.brokenJson ? new Response('{', options) : Response.json(reply.body, options);
  });
  const c = new RecoveryController(() => {});
  c.account('owner'); c.open(requestId); c.code = '12345678';
  return {c, replies, calls};
}

function select(c: RecoveryController, action: Action) {
  if (action === 'approve') {c.choose(venueId, pointId); c.stopped = true; c.acceptLoss = true;}
  if (action === 'replace') c.confirmReplacement = true;
}

const malformed = [
  {name: 'unexpected private fields', body: {...ready, secret: 'must-not-be-published'}},
  {name: 'noncanonical expiry', body: {...ready, expiresAt: '2026-10-28'}},
  {name: 'mismatched operation', body: {...ready, operation: {...approved.operation!, id: otherId}}},
  {name: 'mismatched snapshot source', body: {...ready, operation: {...approved.operation!, pointId: otherId}}},
  {name: 'production replacement', body: {...ready, replacement: {...ready.replacement!, environment: 'production'}}},
  {name: 'mismatched replacement venue', body: {...ready, replacement: {...ready.replacement!, venueId: otherId}}},
  {name: 'invalid replacement key', body: {...ready, replacement: {...ready.replacement!, publicKey: 'not-a-key'}}},
  {name: 'registration for another venue', body: {...completed, replacement: {...completed.replacement!,
    registration: {...completed.replacement!.registration!, venueId: otherId}}}},
];

for (const invalid of malformed) {
  test(`recovery HTTP ${invalid.name} cannot replace an inspected proposal`, async t => {
    const {c, replies, calls} = harness(t);
    await c.inspect(); c.confirmReplacement = true;
    replies.inspect = {body: invalid.body};
    await c.inspect();
    assert.deepEqual(c.view, ready);
    assert.equal(c.confirmReplacement, true);
    assert.equal(c.error, 'unavailable');
    assert.equal(c.pending, false);
    replies.inspect = {body: completed};
    await c.inspect();
    assert.deepEqual(c.view, completed);
    assert.equal(c.confirmReplacement, false);
    assert.equal(c.error, undefined);
    assert.equal(calls.length, 3);
  });
}

for (const action of actions) {
  for (const invalid of [
    {name: 'malformed view', reply: {body: {...ready, extra: true}}},
    {name: 'broken JSON', reply: {brokenJson: true}},
    {name: 'lost response', reply: {network: true}},
  ]) {
    test(`recovery HTTP ${action} with ${invalid.name} requires inspection before confirming its outcome`, async t => {
      const {c, replies, calls} = harness(t);
      const initial = action === 'approve' ? pending : ready;
      replies.inspect = {body: initial}; await c.inspect(); select(c, action);
      const valid = replies[action]!;
      replies[action] = invalid.reply;
      replies.inspect = {body: {error: 'temporarily_unavailable'}, status: 503};
      await c[action]();
      assert.deepEqual(c.view, initial);
      assert.equal(c.uncertain, true);
      assert.equal(c.pending, false);
      assert.equal(c.confirmReplacement, false);
      assert.deepEqual(calls.map(call => call.action), ['inspect', action, 'inspect']);
      if (action !== 'close') {
        select(c, action); await c[action]();
        assert.equal(calls.length, 3, 'uncertain approval/replacement must not repeat the write');
      }
      replies.inspect = {body: initial}; await c.inspect();
      assert.equal(c.uncertain, false);
      select(c, action); replies[action] = valid;
      await c[action]();
      assert.deepEqual(c.view, valid.body);
      assert.equal(c.uncertain, false);
      assert.equal(c.error, undefined);
      assert.equal(c.pending, false);
      assert.deepEqual(calls.map(call => call.action), ['inspect', action, 'inspect', 'inspect', action]);
      const write = calls.at(-1)!;
      assert.equal(write.init.method, 'POST');
      assert.equal(write.init.credentials, 'same-origin');
      assert.equal(new Headers(write.init.headers).get('X-CSRF-Token'), 'recovery-proof');
      assert.deepEqual(JSON.parse(String(write.init.body)), {requestId, code: '12345678',
        ...(action === 'approve' ? {source: 'snapshot', pointId, oldServerUnavailable: 'true', acceptDataLoss: 'true'} : {}),
        ...(action === 'replace' ? {oldInstallationId, oldServerUnavailable: 'true', confirmReplacement: 'true'} : {})});
    });
  }
}

for (const entry of [
  {name: 'another request', action: 'close', body: {...approved, requestId: otherId, operationId: otherId,
    operation: {...approved.operation!, id: otherId}}},
  {name: 'another snapshot', action: 'approve', body: {...approved,
    operation: {...approved.operation!, pointId: otherId, source: {kind: 'snapshot', pointId: otherId}}}},
  {name: 'another venue', action: 'approve', body: {...approved, operation: {...approved.operation!, venueId: otherId}}},
  {name: 'another source kind', action: 'approve', body: {...approved, operation: {...approved.operation!, pointId: null,
    source: {kind: 'continuous', recoverableAt: '2026-10-28T11:59:00.000Z', sourceNodeId: otherId}}}},
  {name: 'another old installation', action: 'replace', body: {...completed,
    replacement: {...completed.replacement!, oldInstallationId: otherId}}},
  {name: 'another local venue', action: 'replace', body: {...completed,
    replacement: {...completed.replacement!, localVenueId: venueId}}},
  {name: 'another signing key', action: 'replace', body: {...completed, replacement: {...completed.replacement!,
    publicKey: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.alloc(32, 1)]).toString('base64url')}}},
  {name: 'another peer key', action: 'replace', body: {...completed, replacement: {...completed.replacement!,
    peerPublicKey: Buffer.alloc(32, 1).toString('base64')}}},
  {name: 'another node', action: 'replace', body: {...completed, replacement: {...completed.replacement!, nodeId: venueId}}},
] as const) {
  test(`recovery HTTP ${entry.action} cannot confirm a well-shaped reply for ${entry.name}`, async t => {
    const {c, replies, calls} = harness(t);
    const initial = entry.action === 'approve' ? pending : ready;
    replies.inspect = {body: initial}; await c.inspect(); select(c, entry.action);
    replies[entry.action] = {body: entry.body};
    replies.inspect = {body: {error: 'temporarily_unavailable'}, status: 503};
    await c[entry.action]();
    assert.deepEqual(c.view, initial);
    assert.equal(c.uncertain, true);
    assert.equal(c.confirmReplacement, false);
    assert.equal(c.pending, false);
    assert.deepEqual(calls.map(call => call.action), ['inspect', entry.action, 'inspect']);
  });
}

for (const action of ['inspect', ...actions] as const) {
  for (const status of [401, 403]) {
    test(`recovery HTTP ${action} permission refusal ${status} clears offered recovery and confirmation`, async t => {
      const {c, replies, calls} = harness(t);
      replies.inspect = {body: action === 'approve' ? pending : ready}; await c.inspect();
      if (action !== 'inspect') select(c, action);
      else {c.choose(venueId, pointId); c.confirmReplacement = true;}
      replies[action] = {body: {error: status === 401 ? 'session_expired' : 'forbidden'}, status};
      await c[action]();
      assert.equal(c.view, undefined);
      assert.equal(c.venueId, undefined); assert.equal(c.pointId, undefined); assert.equal(c.source, undefined);
      assert.equal(c.confirmReplacement, false);
      assert.equal(c.uncertain, false); assert.equal(c.pending, false);
      assert.equal(c.error, status === 401 ? 'pairSession' : 'forbidden');
      assert.equal(calls.length, 2, 'permission refusals must not start a follow-up write or inspection');
    });
  }
}

test('recovery HTTP Retry-After blocks inspection and approval until the stated wait ends', async t => {
  const {c, replies, calls} = harness(t);
  let clock = now; t.mock.method(Date, 'now', () => clock);
  replies.inspect = {body: pending}; await c.inspect(); select(c, 'approve');
  replies.approve = {body: {error: 'rate_limited'}, status: 429, retry: '30'};
  await c.approve();
  assert.deepEqual(c.view, pending); assert.equal(c.error, 'limited'); assert.equal(c.uncertain, false);
  assert.equal(c.retryAt, now + 30_000);
  await c.inspect(); await c.approve(); assert.equal(calls.length, 2);
  clock += 30_000; replies.approve = {body: approved}; await c.approve();
  assert.deepEqual(c.view, approved); assert.equal(c.error, undefined); assert.equal(calls.length, 3);
});

test('recovery HTTP accepts the selected continuous source and reconciles a completed replacement', async t => {
  const {c, replies, calls} = harness(t);
  replies.inspect = {body: pending}; await c.inspect();
  c.chooseContinuous(venueId); c.stopped = true; c.acceptLoss = true;
  const continuousSource = {kind: 'continuous', recoverableAt: '2026-10-28T11:59:00.000Z', sourceNodeId: otherId};
  const continuous = {...approved, operation: {...approved.operation!, pointId: null, source: continuousSource}};
  replies.approve = {body: continuous}; await c.approve();
  assert.deepEqual(c.view, continuous); assert.equal(c.uncertain, false);
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), {requestId, code: '12345678',
    source: 'continuous', venueId, oldServerUnavailable: 'true', acceptDataLoss: 'true'});
  const proposal = {...continuous, replacement: {...ready.replacement!, pointId: null, source: continuousSource}};
  replies.inspect = {body: proposal}; await c.inspect(); c.confirmReplacement = true;
  const accepted = {...proposal, replacement: {...completed.replacement!, pointId: null, source: continuousSource}};
  replies.replace = {body: accepted}; await c.replace();
  assert.deepEqual(c.view, accepted); assert.equal(c.uncertain, false);
  assert.equal(c.confirmReplacement, false); assert.equal(c.error, undefined);
  assert.deepEqual(calls.map(call => call.action), ['inspect', 'approve', 'inspect', 'replace']);
});
