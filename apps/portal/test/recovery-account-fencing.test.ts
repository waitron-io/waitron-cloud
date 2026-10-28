import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ApiResult} from '../src/api.ts';
import {RecoveryController} from '../src/recovery-controller.ts';
import {validRecoveryView, type RecoveryView} from '../src/recovery-types.ts';

const requestId = '12345678-1234-4234-8234-123456789abc';
const nextRequestId = '22345678-1234-4234-8234-123456789abc';
const venueId = '32345678-1234-4234-8234-123456789abc';
const pointId = '42345678-1234-4234-8234-123456789abc';
const expiresAt = '2099-01-01T00:00:00.000Z';
const code = '00123456';
const source = {kind: 'snapshot', pointId} as const;
type Action = 'inspect' | 'approve' | 'close' | 'replace';
const actions: Action[] = ['inspect', 'approve', 'close', 'replace'];

function views(id = requestId) {
  const pending: RecoveryView = {requestId: id, state: 'awaiting_owner', expiresAt, operationId: null, operation: null};
  const restored: RecoveryView = {
    requestId: id, state: 'approved', expiresAt, operationId: id,
    operation: {id, venueId, pointId, source, mode: 'failure', status: 'restored', expiresAt},
    replacement: {
      requestId: id, pointId, source, venueId,
      oldInstallationId: '52345678-1234-4234-8234-123456789abc',
      localVenueId: '62345678-1234-4234-8234-123456789abc',
      nodeId: '72345678-1234-4234-8234-123456789abc', environment: 'test',
      publicKey: 'MCowBQYDK2VwAyEA' + 'A'.repeat(43), peerPublicKey: Buffer.alloc(32).toString('base64'),
      state: 'awaiting_owner', expiresAt, organisationName: 'Café Sol', legalBusinessName: 'Sol SL', registration: null,
    },
  };
  assert(validRecoveryView(pending));
  assert(validRecoveryView(restored));
  return {pending, restored};
}

function success(action: Action): ApiResult<RecoveryView> {
  const {restored} = views();
  if (action === 'approve' || action === 'close') {
    return {ok: true, value: {...restored, replacement: null,
      operation: {...restored.operation!, status: action === 'approve' ? 'pending' : 'closed'}}};
  }
  if (action === 'replace') return {ok: true, value: {...restored, replacement: {...restored.replacement!, state: 'complete',
    registration: {venueId, installationId: nextRequestId, organisationId: requestId, legalBusinessId: pointId}}}};
  return {ok: true, value: restored};
}

const outcomes = [
  {name: 'success', result: (action: Action) => success(action)},
  ...[
    {name: 'lost reply', status: 0, code: 'network_error', retryAfterMs: 0},
    {name: 'signed out', status: 401, code: 'unauthenticated', retryAfterMs: 60_000},
    {name: 'forbidden', status: 403, code: 'forbidden', retryAfterMs: 60_000},
    {name: 'rate limit', status: 429, code: 'rate_limited', retryAfterMs: 60_000},
    {name: 'unavailable', status: 503, code: 'temporarily_unavailable', retryAfterMs: 0},
  ].map(({name, ...failure}) => ({name, result: (_action: Action): ApiResult<RecoveryView> => ({ok: false, ...failure})})),
];

function harness() {
  let changes = 0;
  const calls: {path: string; body?: Record<string, unknown>}[] = [];
  const replies: {path: string; body: Record<string, unknown>; promise: Promise<ApiResult<RecoveryView>>}[] = [];
  const controller = new RecoveryController(() => { changes++; }, async <T>(path: string, body?: Record<string, unknown>) => {
    calls.push({path, body});
    const expected = replies.shift();
    assert.ok(expected, 'a late reply must not start an unplanned recovery request');
    assert.equal(path, expected.path);
    assert.deepEqual(body, expected.body);
    return await expected.promise as ApiResult<T>;
  });
  function hold(action: Action, body: Record<string, unknown>) {
    let resolve!: (result: ApiResult<RecoveryView>) => void;
    const promise = new Promise<ApiResult<RecoveryView>>(done => { resolve = done; });
    replies.push({path: '/recovery/' + action, body, promise});
    return resolve;
  }
  function state() {
    return structuredClone({requestId: controller.requestId, code: controller.code, view: controller.view,
      venueId: controller.venueId, pointId: controller.pointId, source: controller.source,
      stopped: controller.stopped, acceptLoss: controller.acceptLoss, confirmReplacement: controller.confirmReplacement,
      uncertain: controller.uncertain, pending: controller.pending, retryAt: controller.retryAt,
      error: controller.error, changes, calls});
  }
  return {controller, hold, state, calls};
}

async function prepare(h: ReturnType<typeof harness>, action: Action) {
  const c = h.controller;
  c.account('owner'); c.open(requestId); c.code = code;
  const reply = h.hold('inspect', {requestId, code});
  const loading = c.inspect();
  reply({ok: true, value: action === 'approve' ? views().pending : views().restored});
  await loading;
  c.choose(venueId, pointId); c.stopped = true; c.acceptLoss = true; c.confirmReplacement = true;
}

function body(action: Action) {
  return {requestId, code,
    ...(action === 'approve' ? {source: 'snapshot', pointId, oldServerUnavailable: 'true', acceptDataLoss: 'true'} : {}),
    ...(action === 'replace' ? {oldInstallationId: views().restored.replacement!.oldInstallationId,
      oldServerUnavailable: 'true', confirmReplacement: 'true'} : {})};
}

// Removing the reply guard or failing to advance the generation lets an old reply alter these new choices.
for (const action of actions) for (const outcome of outcomes) {
  for (const destination of ['another account', 'returning account', 'another request'] as const) {
    for (const current of ['pending', 'complete'] as const) {
      test(`old recovery ${action} ${outcome.name} preserves ${destination} with ${current} inspection`, {timeout: 5_000}, async () => {
        const h = harness(), c = h.controller;
        await prepare(h, action);
        const oldReply = h.hold(action, body(action));
        const oldWork = c[action]();
        assert.equal(c.pending, true);
        if (destination === 'another request') c.open(nextRequestId);
        else { c.account('different'); if (destination === 'returning account') c.account('owner'); }
        assert.equal(c.code, ''); assert.equal(c.view, undefined);
        assert.equal(c.venueId, undefined); assert.equal(c.pointId, undefined); assert.equal(c.source, undefined);
        assert.equal(c.stopped, false); assert.equal(c.acceptLoss, false); assert.equal(c.confirmReplacement, false);
        assert.equal(c.uncertain, false); assert.equal(c.pending, false); assert.equal(c.error, undefined);
        const id = destination === 'another request' ? nextRequestId : requestId;
        c.code = '87654321';
        const newReply = h.hold('inspect', {requestId: id, code: '87654321'});
        const newWork = c.inspect();
        if (current === 'complete') {
          newReply({ok: true, value: views(id).restored}); await newWork;
          c.chooseContinuous(venueId); c.stopped = true; c.acceptLoss = true; c.confirmReplacement = true;
        }
        const before = h.state();
        oldReply(outcome.result(action)); await oldWork;
        assert.deepEqual(h.state(), before, 'stale completion must preserve current data, confirmations, wait and notifications');
        if (current === 'pending') { newReply({ok: true, value: views(id).restored}); await newWork; }
        assert.deepEqual(c.view, views(id).restored); assert.equal(c.pending, false); assert.equal(c.error, undefined);
      });
    }
  }

  test(`signed-out recovery ignores late ${action} ${outcome.name}`, {timeout: 5_000}, async () => {
    const h = harness(), c = h.controller;
    await prepare(h, action);
    const reply = h.hold(action, body(action)), work = c[action]();
    c.account(undefined);
    assert.equal(c.code, ''); assert.equal(c.view, undefined); assert.equal(c.pending, false);
    assert.equal(c.confirmReplacement, false); assert.equal(c.stopped, false); assert.equal(c.acceptLoss, false);
    const before = h.state();
    reply(outcome.result(action)); await work;
    assert.deepEqual(h.state(), before);
    await c.inspect(); await c.approve(); await c.close(); await c.replace();
    assert.deepEqual(h.state(), before, 'signed-out actions cannot issue a recovery request');
  });
}

for (const action of actions) test(`same recovery account and request preserve pending ${action}`, async () => {
  const h = harness(), c = h.controller;
  await prepare(h, action);
  const reply = h.hold(action, body(action)), work = c[action](), before = h.state();
  c.account('owner'); c.open(requestId);
  assert.deepEqual(h.state(), before);
  const result = success(action); assert(result.ok); assert(validRecoveryView(result.value));
  reply(result); await work;
  assert.deepEqual(c.view, result.value); assert.equal(c.pending, false); assert.equal(c.error, undefined);
  assert.equal(c.uncertain, false); assert.equal(h.state().changes, before.changes + 1);
});
