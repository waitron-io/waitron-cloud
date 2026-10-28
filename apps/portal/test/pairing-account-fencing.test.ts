import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PairingController} from '../src/pairing-controller.ts';
import type {ApiResult} from '../src/api.ts';
import type {PairingBusiness, PairingView} from '../src/pairing-types.ts';

const requestId = '12345678-1234-4234-8234-123456789abc';
const nextRequestId = '22345678-1234-4234-8234-123456789abc';
const source: PairingBusiness = {
  organisationId: '32345678-1234-4234-8234-123456789abc',
  legalBusinessId: '42345678-1234-4234-8234-123456789abc',
  organisationName: 'Café Sol', legalBusinessName: 'Sol SL', countryCode: 'ES',
};
const replacement: PairingBusiness = {
  organisationId: '52345678-1234-4234-8234-123456789abc',
  legalBusinessId: '62345678-1234-4234-8234-123456789abc',
  organisationName: 'Café Luna', legalBusinessName: 'Luna SL', countryCode: 'ES',
};
const sourceView: PairingView = {
  requestId, localVenueId: '72345678-1234-4234-8234-123456789abc',
  environment: 'test', expiresAt: '2099-01-01T00:00:00Z', state: 'awaiting_cloud',
};
const failures = {
  lost: {ok: false, status: 0, code: 'network_error', retryAfterMs: 7_000},
  unauthorized: {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 11_000},
  forbidden: {ok: false, status: 403, code: 'permission_denied', retryAfterMs: 13_000},
  limited: {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 17_000},
  unavailable: {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 19_000},
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {resolve = finish;});
  return {promise, resolve};
}

for (const boundary of ['businesses', 'inspect', 'approve'] as const) {
  for (const change of ['account', 'account-return', 'request', 'request-return'] as const) {
    for (const newer of ['pending', 'loaded'] as const) {
      for (const outcome of ['success', 'lost', 'unauthorized', 'forbidden', 'limited', 'unavailable'] as const) {
        test(`old pairing ${boundary} ${outcome} cannot affect ${change} with ${newer} choices`, {timeout: 5_000}, async t => {
          t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-28T00:00:00Z')});
          const oldReply = deferred<ApiResult<unknown>>();
          const newReply = deferred<ApiResult<unknown>>();
          const calls: Array<{path: string; body: unknown}> = [];
          const replies: Array<ApiResult<unknown> | Promise<ApiResult<unknown>>> = [
            ...(boundary !== 'businesses' ? [{ok: true as const, value: {businesses: [source]}}] : []),
            ...(boundary === 'approve' ? [{ok: true as const, value: sourceView}] : []),
            oldReply.promise, newReply.promise,
          ];
          let changes = 0;
          const request = async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
            calls.push({path, body: structuredClone(body)});
            assert.notEqual(replies.length, 0, 'an old reply must not issue another request');
            return await replies.shift()! as ApiResult<T>;
          };
          const controller = new PairingController(() => {changes++;}, request);
          controller.account('owner');
          controller.open(requestId);
          if (boundary !== 'businesses') await controller.load();
          controller.code = '12345678';
          if (boundary === 'approve') await controller.inspect();
          const oldOperation = boundary === 'businesses' ? controller.load()
            : boundary === 'inspect' ? controller.inspect() : controller.approve();
          assert.equal(controller.pending, true);
          const oldCalls = [
            {path: '/pairing/businesses', body: undefined},
            ...(boundary !== 'businesses' ? [{path: '/pairing/inspect', body: {requestId, code: '12345678'}}] : []),
            ...(boundary === 'approve' ? [{path: '/pairing/approve', body: {
              requestId, code: '12345678', organisationId: source.organisationId, legalBusinessId: source.legalBusinessId,
            }}] : []),
          ];
          assert.deepEqual(calls, oldCalls);

          if (change.startsWith('account')) {
            controller.account('different');
            if (change === 'account-return') controller.account('owner');
          } else {
            controller.open(nextRequestId);
            if (change === 'request-return') controller.open(requestId);
          }
          const currentRequestId = change === 'request' ? nextRequestId : requestId;
          assert.equal(controller.requestId, currentRequestId);
          assert.equal(controller.code, '');
          assert.deepEqual(controller.businesses, []);
          assert.equal(controller.selected, '');
          assert.equal(controller.view, undefined);
          assert.equal(controller.pending, false);
          assert.equal(controller.loaded, false);
          const loading = controller.load();
          controller.code = '87654321';
          const currentReply = {ok: true as const, value: {businesses: [replacement]}};
          const currentView: PairingView = {...sourceView, requestId: currentRequestId,
            localVenueId: '82345678-1234-4234-8234-123456789abc'};
          const staleReply: ApiResult<unknown> = outcome === 'success' ? {ok: true, value:
            boundary === 'businesses' ? {businesses: [source]} : boundary === 'inspect'
              ? sourceView : {...sourceView, ...source, state: 'awaiting_local'}} : failures[outcome];
          try {
            if (newer === 'loaded') {
              newReply.resolve(currentReply);
              await loading;
              replies.push({ok: true, value: currentView});
              await controller.inspect();
              assert.deepEqual(controller.view, currentView);
            }
            const snapshot = () => ({
              requestId: controller.requestId, code: controller.code,
              businesses: structuredClone(controller.businesses), selected: controller.selected,
              view: structuredClone(controller.view), pending: controller.pending, loaded: controller.loaded,
              codeError: controller.codeError, error: controller.error, retryAt: controller.retryAt,
              changes, calls: structuredClone(calls),
            });
            const before = snapshot();
            oldReply.resolve(staleReply);
            await oldOperation;
            assert.deepEqual(snapshot(), before, 'old replies must preserve the current request, private choices, pending read, cooldown and feedback');

            newReply.resolve(currentReply);
            await loading;
            assert.deepEqual(controller.businesses, [replacement]);
            assert.equal(controller.selected, replacement.legalBusinessId);
            assert.equal(controller.code, '87654321');
            assert.equal(controller.loaded, true);
            assert.equal(controller.pending, false);
            assert.equal(controller.error, undefined);
            assert.equal(controller.codeError, false);
            assert.equal(controller.retryAt, 0);
            assert.equal(changes, before.changes + (newer === 'pending' ? 1 : 0));
            if (newer === 'pending') {
              replies.push({ok: true, value: currentView});
              await controller.inspect();
            }
            const approved: PairingView = {...currentView, ...replacement, state: 'awaiting_local'};
            replies.push({ok: true, value: approved});
            await controller.approve();
            assert.deepEqual(controller.view, approved);
            assert.equal(controller.pending, false);
            assert.equal(controller.error, undefined);
            assert.deepEqual(calls, [...oldCalls,
              {path: '/pairing/businesses', body: undefined},
              {path: '/pairing/inspect', body: {requestId: currentRequestId, code: '87654321'}},
              {path: '/pairing/approve', body: {requestId: currentRequestId, code: '87654321',
                organisationId: replacement.organisationId, legalBusinessId: replacement.legalBusinessId}},
            ]);
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
}
