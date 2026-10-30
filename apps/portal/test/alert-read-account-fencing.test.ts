import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AlertController, type AlertPreferences} from '../src/alert-controller.ts';
import type {ApiResult} from '../src/api.ts';

const previous: AlertPreferences = {enabled: true, locale: 'es'};
const current: AlertPreferences = {enabled: false, locale: 'en'};
const replies: {name: string; result: ApiResult<AlertPreferences>}[] = [
  {name: 'success', result: {ok: true, value: previous}},
  {name: 'network failure', result: {ok: false, status: 0, code: 'network_error', retryAfterMs: 7_000}},
  {name: 'expired session', result: {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 11_000}},
  {name: 'denied permission', result: {ok: false, status: 403, code: 'forbidden', retryAfterMs: 13_000}},
  {name: 'rate limit', result: {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 17_000}},
  {name: 'unavailable', result: {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 19_000}},
];

function fixture() {
  const requests: {
    path: string; body: Record<string, unknown> | undefined;
    finish: (result: ApiResult<AlertPreferences>) => void;
  }[] = [];
  let changes = 0;
  const controller = new AlertController(() => {changes++;}, <T>(path: string, body?: Record<string, unknown>) =>
    new Promise<ApiResult<T>>(resolve => {
      requests.push({path, body, finish: result => resolve(result as ApiResult<T>)});
    }));
  const state = () => ({
    enabled: controller.enabled, locale: controller.locale, loaded: controller.loaded,
    loadAttempted: controller.loadAttempted, pending: controller.pending, saved: controller.saved,
    error: controller.error, retryAt: controller.retryAt, waiting: controller.waiting,
    dirty: controller.dirty, changes,
  });
  const calls = () => requests.map(({path, body}) => ({path, body}));
  return {controller, requests, state, calls};
}

for (const destination of ['another account', 'returning account'] as const) {
  for (const stage of ['pending read', 'edited draft', 'saved preferences'] as const) {
    for (const {name, result} of replies) {
      test(`old alert read ${name} preserves ${stage} for ${destination}`, {timeout: 5_000}, async t => {
        t.mock.timers.enable({apis: ['Date'], now: 1_000_000});
 t.mock.method(performance,'now',()=>Date.now()-1_000_000);
        const {controller, requests, state, calls} = fixture();
        controller.account('first');
        const oldRead = controller.load();
        assert.deepEqual(calls(), [{path: '/alerts', body: undefined}]);
        assert.equal(controller.pending, true);

        controller.account('second');
        if (destination === 'returning account') controller.account('first');
        assert.equal(controller.loaded, false);
        assert.equal(controller.pending, false);
        assert.equal(controller.loadAttempted, false);
        const currentRead = controller.load();
        assert.equal(controller.pending, true);
        assert.equal(requests.length, 2);
        if (stage !== 'pending read') {
          requests[1]!.finish({ok: true, value: current});
          await currentRead;
          assert.equal(controller.loaded, true);
          controller.choose(true, 'en');
          assert.equal(controller.dirty, true);
          if (stage === 'saved preferences') {
            const save = controller.save();
            requests[2]!.finish({ok: true, value: {enabled: true, locale: 'en'}});
            await save;
            assert.equal(controller.saved, true);
            assert.equal(controller.dirty, false);
          }
        }

        const before = state();
        requests[0]!.finish(result);
        await oldRead;
        assert.deepEqual(state(), before, 'a previous account read cannot publish any state or cooldown');
        assert.equal(controller.waiting, 0);
        if (stage === 'pending read') {
          await controller.load();
          assert.equal(requests.length, 2, 'a stale reply cannot release the current read guard');
          requests[1]!.finish({ok: true, value: current});
          await currentRead;
          assert.equal(controller.pending, false);
          assert.equal(controller.loaded, true);
          assert.equal(controller.enabled, false);
          assert.equal(controller.locale, 'en');
          controller.choose(true, 'en');
        }
        if (stage !== 'saved preferences') {
          const save = controller.save();
          assert.equal(requests.length, 3);
          requests[2]!.finish({ok: true, value: {enabled: true, locale: 'en'}});
          await save;
          assert.equal(controller.saved, true);
          assert.equal(controller.dirty, false);
          assert.equal(controller.error, undefined);
        }
        await controller.save();
        assert.deepEqual(calls(), [
          {path: '/alerts', body: undefined},
          {path: '/alerts', body: undefined},
          {path: '/alerts', body: {enabled: 'on', locale: 'en'}},
        ], 'only the current changed choice is written, once');
      });
    }
  }
}

for (const {name, result} of replies) {
  test(`old alert read ${name} leaves signed-out preferences empty`, {timeout: 5_000}, async t => {
    t.mock.timers.enable({apis: ['Date'], now: 1_000_000});
 t.mock.method(performance,'now',()=>Date.now()-1_000_000);
    const {controller, requests, state, calls} = fixture();
    controller.account('first');
    const oldRead = controller.load();
    controller.account(undefined);
    assert.equal(controller.enabled, false);
    assert.equal(controller.locale, 'en');
    assert.equal(controller.loaded, false);
    assert.equal(controller.pending, false);
    assert.equal(controller.loadAttempted, false);
    const before = state();
    requests[0]!.finish(result);
    await oldRead;
    assert.deepEqual(state(), before);
    const signedOutRead = controller.load();
    assert.equal(requests.length, 1, 'signed-out reads cannot start another request');
    await signedOutRead;
    controller.choose(true, 'es');
    await controller.save();
    assert.deepEqual(state(), before);
    assert.deepEqual(calls(), [{path: '/alerts', body: undefined}]);
  });
}

test('selecting the same alert account preserves its pending read and accepts its reply', async () => {
  const {controller, requests, state, calls} = fixture();
  controller.account('first');
  const read = controller.load();
  const before = state();
  controller.account('first');
  assert.deepEqual(state(), before);
  requests[0]!.finish({ok: true, value: previous});
  await read;
  assert.equal(controller.enabled, true);
  assert.equal(controller.locale, 'es');
  assert.equal(controller.loaded, true);
  assert.equal(controller.pending, false);
  assert.equal(controller.dirty, false);
  assert.deepEqual(calls(), [{path: '/alerts', body: undefined}]);
});

test('a current alert read rate limit retains its cooldown through an account change', async t => {
  t.mock.timers.enable({apis: ['Date'], now: 1_000_000});
 t.mock.method(performance,'now',()=>Date.now()-1_000_000);
  const {controller, requests, calls} = fixture();
  controller.account('first');
  const read = controller.load();
  requests[0]!.finish({ok: false, status: 429, code: 'rate_limited', retryAfterMs: 17_000});
  await read;
  assert.equal(controller.error, 'limited');
  assert.equal(controller.waiting, 17);
  controller.account('second');
  assert.equal(controller.waiting, 17);
  const blockedRead = controller.load();
  assert.equal(requests.length, 1);
  await blockedRead;
  t.mock.timers.tick(17_000);
  const next = controller.load();
  assert.equal(requests.length, 2);
  requests[1]!.finish({ok: true, value: current});
  await next;
  assert.equal(controller.loaded, true);
  assert.equal(controller.error, undefined);
  assert.equal(controller.waiting, 0);
  assert.deepEqual(calls(), [{path: '/alerts', body: undefined}, {path: '/alerts', body: undefined}]);
});
