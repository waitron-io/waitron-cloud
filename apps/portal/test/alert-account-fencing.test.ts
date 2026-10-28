import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AlertController, type AlertPreferences} from '../src/alert-controller.ts';
import type {accountRequest, ApiResult} from '../src/api.ts';

const outcomes: {name: string; result: ApiResult<AlertPreferences>}[] = [
  {name: 'success', result: {ok: true, value: {enabled: true, locale: 'es'}}},
  {name: 'lost reply', result: {ok: false, status: 0, code: 'network_error', retryAfterMs: 0}},
  {name: 'expired session', result: {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 0}},
  {name: 'denied permission', result: {ok: false, status: 403, code: 'forbidden', retryAfterMs: 0}},
  {name: 'rate limit', result: {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 60_000}},
  {name: 'unavailable', result: {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 0}},
];

for (const {name, result} of outcomes) {
  for (const destination of ['another account', 'same account after signing back in'] as const) {
    for (const current of ['pending read', 'edited draft'] as const) {
      test(`late alert save ${name} preserves ${current} for ${destination}`, async () => {
        const requests: {
          path: string;
          body: Record<string, unknown> | undefined;
          finish: (result: ApiResult<AlertPreferences>) => void;
        }[] = [];
        const request: typeof accountRequest = <T>(path: string, body?: Record<string, unknown>) =>
          new Promise<ApiResult<T>>(resolve => {
            requests.push({path, body, finish: reply => resolve(reply as ApiResult<T>)});
          });
        let changes = 0;
        const controller = new AlertController(() => { changes++; }, request);

        controller.account('first');
        const initialRead = controller.load();
        assert.equal(requests.length, 1);
        requests[0]!.finish({ok: true, value: {enabled: false, locale: 'en'}});
        await initialRead;
        controller.choose(true, 'es');
        const oldSave = controller.save();
        assert.equal(requests.length, 2);
        assert.deepEqual(requests[1]!.body, {enabled: 'on', locale: 'es'});

        controller.account('second');
        if (destination === 'same account after signing back in') controller.account('first');
        assert.equal(controller.loaded, false, 'switching accounts clears the previous choices');
        assert.equal(controller.saved, false);
        const currentRead = controller.load();
        assert.equal(requests.length, 3, 'the new account can start its own read');
        if (current === 'edited draft') {
          requests[2]!.finish({ok: true, value: {enabled: false, locale: 'en'}});
          await currentRead;
          controller.choose(true, 'en');
          assert.equal(controller.dirty, true);
        } else {
          assert.equal(controller.pending, true);
        }

        const state = () => ({
          enabled: controller.enabled, locale: controller.locale, loaded: controller.loaded,
          loadAttempted: controller.loadAttempted, pending: controller.pending, saved: controller.saved,
          error: controller.error, retryAt: controller.retryAt, dirty: controller.dirty,
        });
        const before = state(), changesBefore = changes;
        requests[1]!.finish(result);
        await oldSave;
        assert.deepEqual(state(), before, 'an old save cannot change the current account state');
        assert.equal(changes, changesBefore, 'an old reply cannot publish another state change');
        assert.equal(controller.waiting, 0, 'a stale rate limit cannot block the current account');

        if (current === 'pending read') {
          await controller.load();
          assert.equal(requests.length, 3, 'the old save cannot release the current read guard');
          requests[2]!.finish({ok: true, value: {enabled: false, locale: 'en'}});
          await currentRead;
          assert.equal(controller.pending, false);
          assert.equal(controller.loaded, true);
          assert.equal(controller.dirty, false);
          controller.choose(true, 'en');
        }
        const currentSave = controller.save();
        assert.equal(requests.length, 4, 'the current changed choices remain saveable');
        requests[3]!.finish({ok: true, value: {enabled: true, locale: 'en'}});
        await currentSave;
        assert.equal(controller.saved, true, 'a current reply still confirms the save');
        assert.equal(controller.dirty, false);
        assert.equal(controller.error, undefined);
        assert.deepEqual(requests.map(({path, body}) => ({path, body})), [
          {path: '/alerts', body: undefined},
          {path: '/alerts', body: {enabled: 'on', locale: 'es'}},
          {path: '/alerts', body: undefined},
          {path: '/alerts', body: {enabled: 'on', locale: 'en'}},
        ]);
      });
    }
  }
}
