import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DiagnosticController} from '../src/diagnostic-controller.ts';
import type {DiagnosticExport} from '../src/diagnostic-types.ts';
import type {ApiResult} from '../src/api.ts';

const first = '12345678-1234-4234-8234-123456789abc';
const second = '22345678-1234-4234-8234-123456789abc';
const venue = '32345678-1234-4234-8234-123456789abc';
function document(installationId = first): DiagnosticExport {
  return {
    version: 1, generatedAt: '2026-10-28T00:00:00.000Z',
    installation: {
      installationId, venueId: venue, environment: 'test', revision: 4,
      access: {status: 'active', lastContactAt: null, leaseExpiresAt: null},
      services: [
        {service: 'continuous_backup', state: 'ready', health: 'unknown', observedAt: null},
        {service: 'remote_access', state: 'ready', health: 'unknown', observedAt: null},
        {service: 'retained_snapshots', state: 'ready', health: 'unknown', observedAt: null},
      ],
      backups: {latestSnapshotAt: null, verifiedSnapshotAt: null},
      monitoring: {enabled: true, fresh: false, checkedAt: null, incidents: [], remoteChecks: {public: null, staff: null}},
    },
  };
}
const outcomes = {
  success: {ok: true, value: document()},
  malformed: {ok: true, value: {version: 1}},
  mismatched: {ok: true, value: document(second)},
  lost: {ok: false, status: 0, code: 'network_error', retryAfterMs: 7_000},
  unauthorized: {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 11_000},
  forbidden: {ok: false, status: 403, code: 'permission_denied', retryAfterMs: 13_000},
  limited: {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 17_000},
  unavailable: {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 19_000},
} satisfies Record<string, ApiResult<unknown>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {resolve = finish;});
  return {promise, resolve};
}
function fixture() {
  const replies = [deferred<ApiResult<unknown>>(), deferred<ApiResult<unknown>>()] as const;
  const calls: Array<{path: string; body: unknown}> = [];
  const saved: Array<{value: DiagnosticExport; name: string}> = [];
  let changes = 0;
  const controller = new DiagnosticController(() => {changes++;}, async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
    calls.push({path, body: structuredClone(body)});
    const reply = replies[calls.length - 1];
    assert.ok(reply, 'unexpected additional diagnostic request');
    return await reply.promise as ApiResult<T>;
  }, (value, name) => {saved.push({value: structuredClone(value), name});});
  const snapshot = () => ({
    pending: controller.pending, selected: controller.selected, error: controller.error,
    retryAt: controller.retryAt, waiting: controller.waiting,
    calls: structuredClone(calls), saved: structuredClone(saved), changes,
  });
  return {controller, replies, calls, saved, snapshot};
}
const expectedSave = {value: document(second), name: 'waitron-cloud-diagnostic-32345678-20261028T000000Z.json'};

for (const account of ['different', 'return'] as const) {
  for (const current of ['pending', 'saved', 'refused'] as const) {
    for (const [outcome, oldReply] of Object.entries(outcomes)) {
      test(`old diagnostic ${outcome} cannot affect ${account} account with ${current} download`, {timeout: 5_000}, async t => {
        t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-28T00:00:00Z')});
        const {controller, replies, calls, saved, snapshot} = fixture();
        controller.account('first');
        const oldDownload = controller.download(first);
        assert.equal(controller.pending, true);
        assert.equal(controller.selected, first);
        controller.account('second');
        if (account === 'return') controller.account('first');
        assert.equal(controller.pending, false);
        assert.equal(controller.selected, undefined);
        assert.equal(controller.error, undefined);
        const download = controller.download(second);
        const currentReply: ApiResult<unknown> = current === 'refused'
          ? {ok: false, status: 403, code: 'permission_denied', retryAfterMs: 3_000}
          : {ok: true, value: document(second)};
        try {
          assert.deepEqual(calls, [
            {path: '/diagnostics/read', body: {installationId: first}},
            {path: '/diagnostics/read', body: {installationId: second}},
          ]);
          assert.equal(controller.pending, true);
          assert.equal(controller.selected, second);
          if (current !== 'pending') {
            replies[1].resolve(currentReply);
            await download;
            assert.equal(controller.pending, false);
            assert.equal(controller.selected, undefined);
            assert.equal(controller.error, current === 'refused' ? 'permissionBusiness' : undefined);
            assert.equal(controller.waiting, current === 'refused' ? 3 : 0);
            assert.deepEqual(saved, current === 'saved' ? [expectedSave] : []);
          }
          const before = snapshot();
          replies[0].resolve(oldReply);
          await oldDownload;
          assert.deepEqual(snapshot(), before, 'old reply changed the current download or saved a private document');
          if (current === 'pending') {
            await controller.download(first);
            assert.deepEqual(snapshot(), before, 'pending download admitted a repeated action');
            replies[1].resolve(currentReply);
            await download;
            assert.equal(controller.pending, false);
            assert.equal(controller.selected, undefined);
            assert.equal(controller.error, undefined);
            assert.equal(controller.waiting, 0);
            assert.deepEqual(saved, [expectedSave]);
          }
        } finally {
          replies[0].resolve(oldReply);
          replies[1].resolve(currentReply);
          await Promise.allSettled([oldDownload, download]);
        }
      });
    }
  }
}

for (const [outcome, reply] of Object.entries(outcomes)) {
  test(`signing out discards a delayed diagnostic ${outcome}`, {timeout: 5_000}, async t => {
    t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-28T00:00:00Z')});
    const {controller, replies, calls, saved, snapshot} = fixture();
    controller.account('first');
    const download = controller.download(first);
    controller.account(undefined);
    try {
      assert.equal(controller.pending, false);
      assert.equal(controller.selected, undefined);
      assert.equal(controller.error, undefined);
      const before = snapshot();
      replies[0].resolve(reply);
      await download;
      assert.deepEqual(snapshot(), before, 'signed-out state accepted an old reply');
      await controller.download(second);
      assert.equal(calls.length, 1);
      assert.deepEqual(saved, []);
      controller.account('second');
      const next = controller.download(second);
      replies[1].resolve({ok: true, value: document(second)});
      await next;
      assert.equal(calls.length, 2);
      assert.deepEqual(saved, [expectedSave]);
    } finally {
      replies[0].resolve(reply);
      replies[1].resolve({ok: true, value: document(second)});
      await Promise.allSettled([download]);
    }
  });
}

test('selecting the same account keeps its pending diagnostic download', async () => {
  const {controller, replies, calls, saved, snapshot} = fixture();
  controller.account('first');
  const download = controller.download(first);
  try {
    const before = snapshot();
    controller.account('first');
    await controller.download(second);
    assert.deepEqual(snapshot(), before);
    replies[0].resolve({ok: true, value: document()});
    await download;
    assert.equal(controller.pending, false);
    assert.equal(controller.selected, undefined);
    assert.equal(calls.length, 1);
    assert.deepEqual(saved, [{value: document(), name: 'waitron-cloud-diagnostic-32345678-20261028T000000Z.json'}]);
  } finally {
    replies[0].resolve({ok: true, value: document()});
    await download;
  }
});

test('changing accounts clears diagnostic feedback while preserving an existing server wait', async t => {
  t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-28T00:00:00Z')});
  const {controller, replies, calls} = fixture();
  controller.account('first');
  const download = controller.download(first);
  replies[0].resolve(outcomes.limited);
  await download;
  assert.equal(controller.error, 'limited');
  assert.equal(controller.waiting, 17);
  const retryAt = controller.retryAt;
  controller.account('second');
  assert.equal(controller.error, undefined);
  assert.equal(controller.selected, undefined);
  assert.equal(controller.pending, false);
  assert.equal(controller.retryAt, retryAt);
  await controller.download(second);
  assert.equal(calls.length, 1);
  t.mock.timers.tick(17_000);
  const next = controller.download(second);
  replies[1].resolve({ok: true, value: document(second)});
  await next;
  assert.equal(calls.length, 2);
  assert.equal(controller.error, undefined);
});
