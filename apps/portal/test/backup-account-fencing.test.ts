import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BackupController} from '../src/backup-controller.ts';
import type {ApiResult} from '../src/api.ts';
import type {BackupPage} from '../src/backup-types.ts';

const venue = '12345678-1234-4234-8234-123456789abc';
const otherVenue = '22345678-1234-4234-8234-123456789abc';
const oldPoint = '32345678-1234-4234-8234-123456789abc';
const currentPoint = '42345678-1234-4234-8234-123456789abc';
const chosenPoint = '52345678-1234-4234-8234-123456789abc';
const source: BackupPage = {
  venueId: venue,
  points: [{id: oldPoint, capturedAt: '2026-10-01T12:00:00.000Z',
    expiresAt: '2026-11-01T12:00:00.000Z', verification: 'verified', retention: 'daily', protection: 'fallback'}],
  defaultPointId: oldPoint, nextCursor: 'old-next',
  continuousRecovery: {recoverableAt: '2026-10-02T12:00:00.000Z',
    checkedAt: '2026-10-02T12:01:00.000Z', sourceNodeId: otherVenue},
};
const current: BackupPage = {
  venueId: venue,
  points: [
    {id: currentPoint, capturedAt: '2026-10-27T12:00:00.000Z',
      expiresAt: '2026-11-27T12:00:00.000Z', verification: 'verified', retention: 'monthly', protection: 'fallback'},
    {id: chosenPoint, capturedAt: '2026-10-26T12:00:00.000Z',
      expiresAt: '2026-11-26T12:00:00.000Z', verification: 'verified', retention: 'daily', protection: 'recovery'},
  ],
  defaultPointId: currentPoint, nextCursor: 'current-next', continuousRecovery: null,
};
const failures = {
  lost: {ok: false, status: 0, code: 'network_error', retryAfterMs: 7_000},
  unauthorized: {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 11_000},
  forbidden: {ok: false, status: 403, code: 'permission_denied', retryAfterMs: 13_000},
  limited: {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 17_000},
  unavailable: {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 19_000},
} as const;
const outcomes = ['success', 'lost', 'unauthorized', 'forbidden', 'limited', 'unavailable'] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {resolve = finish;});
  return {promise, resolve};
}

function emptyCatalogue(controller: BackupController) {
  assert.equal(controller.page, undefined);
  assert.equal(controller.selected, undefined);
  assert.equal(controller.selectedSource, undefined);
  assert.equal(controller.error, undefined);
  assert.equal(controller.retryAt, 0);
}

for (const boundary of ['refresh', 'older'] as const) {
  for (const change of ['account', 'account-return', 'venue', 'reopen'] as const) {
    for (const newer of ['pending', 'loaded'] as const) {
      for (const outcome of outcomes) {
        test(`old backup ${boundary} ${outcome} cannot affect ${change} with ${newer} catalogue`, {timeout: 5_000}, async t => {
          t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-28T00:00:00Z')});
          const oldReply = deferred<ApiResult<unknown>>();
          const newReply = deferred<ApiResult<unknown>>();
          const calls: Array<{path: string; body: unknown}> = [];
          const replies: Array<ApiResult<unknown> | Promise<ApiResult<unknown>>> = [
            {ok: true, value: source}, oldReply.promise, newReply.promise,
          ];
          let changes = 0;
          const request = async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
            calls.push({path, body: structuredClone(body)});
            assert.notEqual(replies.length, 0, 'stale replies must not issue another request');
            return await replies.shift()! as ApiResult<T>;
          };
          const controller = new BackupController(() => {changes++;}, request);
          controller.account('owner');
          await controller.open(venue);
          assert.deepEqual(controller.page, source);
          assert.equal(controller.selectedSource, 'continuous');
          controller.select(oldPoint);
          const oldOperation = controller.load(boundary === 'older');
          assert.equal(controller.pending, true);
          const oldCalls = [
            {path: '/backups/list', body: {venueId: venue}},
            {path: '/backups/list', body: {venueId: venue, ...(boundary === 'older' ? {cursor: 'old-next'} : {})}},
          ];
          assert.deepEqual(calls, oldCalls);

          if (change.startsWith('account')) {
            controller.account('different');
            if (change === 'account-return') controller.account('owner');
            assert.equal(controller.venueId, undefined);
            assert.equal(controller.pending, false);
            emptyCatalogue(controller);
          } else if (change === 'reopen') {
            controller.close();
            assert.equal(controller.venueId, undefined);
            assert.equal(controller.pending, false);
            emptyCatalogue(controller);
          }
          const currentVenue = change === 'venue' ? otherVenue : venue;
          const currentPage: BackupPage = {...current, venueId: currentVenue};
          const loading = controller.open(currentVenue);
          assert.equal(controller.venueId, currentVenue);
          assert.equal(controller.pending, true);
          emptyCatalogue(controller);
          const currentReply = {ok: true as const, value: currentPage};
          const staleReply: ApiResult<unknown> = outcome === 'success' ? {ok: true, value: source} : failures[outcome];
          const snapshot = () => ({
            venueId: controller.venueId, page: structuredClone(controller.page),
            selected: controller.selected, selectedSource: controller.selectedSource,
            error: controller.error, pending: controller.pending, retryAt: controller.retryAt,
            changes, calls: structuredClone(calls),
          });
          try {
            if (newer === 'loaded') {
              newReply.resolve(currentReply);
              await loading;
              assert.equal(controller.selected, currentPoint);
              assert.equal(controller.selectedSource, 'snapshot');
              controller.select(chosenPoint);
              assert.equal(controller.selected, chosenPoint);
            }
            const before = snapshot();
            oldReply.resolve(staleReply);
            await oldOperation;
            assert.deepEqual(snapshot(), before, 'old catalogue replies must preserve current rows, recovery choices, pending read, feedback and cooldown');

            newReply.resolve(currentReply);
            await loading;
            assert.deepEqual(controller.page, currentPage);
            assert.equal(controller.selected, newer === 'loaded' ? chosenPoint : currentPoint);
            assert.equal(controller.selectedSource, 'snapshot');
            assert.equal(controller.pending, false);
            assert.equal(controller.error, undefined);
            assert.equal(controller.retryAt, 0);
            assert.equal(changes, before.changes + (newer === 'pending' ? 2 : 0));
            assert.deepEqual(calls, [...oldCalls, {path: '/backups/list', body: {venueId: currentVenue}}]);

            const olderPage: BackupPage = {...currentPage, nextCursor: null, defaultPointId: chosenPoint,
              points: [currentPage.points[1]!]};
            replies.push({ok: true, value: olderPage});
            await controller.load(true);
            assert.deepEqual(controller.page, olderPage);
            assert.equal(controller.selected, chosenPoint);
            assert.equal(controller.selectedSource, 'snapshot');
            assert.equal(controller.pending, false);
            assert.equal(controller.error, undefined);
            assert.deepEqual(calls.at(-1), {path: '/backups/list', body: {venueId: currentVenue, cursor: 'current-next'}});
            assert.equal(calls.length, 4);
            assert.equal(replies.length, 0);
          } finally {
            oldReply.resolve(staleReply);
            newReply.resolve(currentReply);
            await Promise.all([oldOperation, loading]);
          }
        });
      }
    }
  }

  for (const outcome of outcomes) {
    test(`old backup ${boundary} ${outcome} cannot restore private choices after sign-out`, {timeout: 5_000}, async t => {
      t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-28T00:00:00Z')});
      const oldReply = deferred<ApiResult<unknown>>();
      const calls: Array<{path: string; body: unknown}> = [];
      let changes = 0;
      const controller = new BackupController(() => {changes++;}, async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
        calls.push({path, body: structuredClone(body)});
        assert(calls.length <= 2, 'signed-out actions must not send requests');
        return (calls.length === 1 ? {ok: true, value: source} : await oldReply.promise) as ApiResult<T>;
      });
      controller.account('owner');
      await controller.open(venue);
      controller.select(oldPoint);
      const oldOperation = controller.load(boundary === 'older');
      controller.account(undefined);
      assert.equal(controller.venueId, undefined);
      assert.equal(controller.pending, false);
      emptyCatalogue(controller);
      const before = changes;
      oldReply.resolve(outcome === 'success' ? {ok: true, value: source} : failures[outcome]);
      await oldOperation;
      assert.equal(controller.venueId, undefined);
      assert.equal(controller.pending, false);
      emptyCatalogue(controller);
      assert.equal(changes, before);
      await controller.open(otherVenue);
      await controller.load(true);
      assert.deepEqual(calls, [
        {path: '/backups/list', body: {venueId: venue}},
        {path: '/backups/list', body: {venueId: venue, ...(boundary === 'older' ? {cursor: 'old-next'} : {})}},
      ]);
    });
  }

  test(`selecting the same backup account preserves a pending ${boundary}`, {timeout: 5_000}, async () => {
    const reply = deferred<ApiResult<unknown>>();
    let calls = 0;
    let changes = 0;
    const controller = new BackupController(() => {changes++;}, async <T>(): Promise<ApiResult<T>> => {
      calls++;
      assert(calls <= 2);
      return (calls === 1 ? {ok: true, value: source} : await reply.promise) as ApiResult<T>;
    });
    controller.account('owner');
    await controller.open(venue);
    controller.select(oldPoint);
    const loading = controller.load(boundary === 'older');
    const before = changes;
    controller.account('owner');
    assert.equal(controller.venueId, venue);
    assert.equal(controller.pending, true);
    assert.deepEqual(controller.page, source);
    assert.equal(controller.selected, oldPoint);
    assert.equal(controller.selectedSource, 'snapshot');
    assert.equal(changes, before);
    reply.resolve({ok: true, value: current});
    await loading;
    assert.deepEqual(controller.page, current);
    assert.equal(controller.selected, currentPoint);
    assert.equal(controller.selectedSource, 'snapshot');
    assert.equal(controller.pending, false);
    assert.equal(calls, 2);
    assert.equal(changes, before + 1);
  });
}
