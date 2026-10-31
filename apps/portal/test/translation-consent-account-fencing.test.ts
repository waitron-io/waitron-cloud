import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TranslationConsentController, type TranslationConsent} from '../src/translation-consent-controller.ts';
import type {accountRequest, ApiResult} from '../src/api.ts';

const oldVenue = '12345678-1234-4234-8234-123456789abc';
const currentVenue = '87654321-4321-4321-8321-cba987654321';
const oldChoices: TranslationConsent[] = [
  {venueId: oldVenue, consented: true, consentedAt: '2026-10-14T10:00:00.000Z'},
];
const currentChoices: TranslationConsent[] = [
  {venueId: currentVenue, consented: true, consentedAt: '2026-10-15T12:00:00.000Z'},
];
type Reply = ApiResult<{consents: TranslationConsent[]}>;
const outcomes: {name: string; reply: Reply}[] = [
  {name: 'success', reply: {ok: true, value: {consents: oldChoices}}},
  {name: 'lost reply', reply: {ok: false, status: 0, code: 'network_error', retryAfterMs: 0}},
  {name: 'expired session', reply: {ok: false, status: 401, code: 'unauthenticated', retryAfterMs: 0}},
  {name: 'denied permission', reply: {ok: false, status: 403, code: 'permission_denied', retryAfterMs: 0}},
  {name: 'rate limit', reply: {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 60_000}},
  {name: 'unavailable', reply: {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 0}},
];

for (const action of ['load', 'agree', 'withdraw'] as const) {
  for (const {name, reply} of outcomes) {
    for (const destination of ['another account', 'same account after signing back in'] as const) {
      for (const current of ['pending read', 'loaded choices'] as const) {
        test(`late consent ${action} ${name} preserves ${current} for ${destination}`, async () => {
          const requests: {
            path: string;
            body: Record<string, unknown> | undefined;
            finish: (reply: Reply) => void;
          }[] = [];
          const request: typeof accountRequest = <T>(path: string, body?: Record<string, unknown>) =>
            new Promise<ApiResult<T>>(resolve => {
              requests.push({path, body, finish: result => resolve(result as ApiResult<T>)});
            });
          let changes = 0;
          const controller = new TranslationConsentController(() => { changes++; }, request);
          controller.account('first');
          const initialRead = controller.load();
          assert.equal(requests.length, 1);
          requests[0]!.finish({ok: true, value: {consents: oldChoices}});
          await initialRead;
          assert.equal(controller.consented(oldVenue), true);
          const oldRequest = action === 'load' ? controller.load() : controller[action](oldVenue);
          assert.equal(requests.length, 2);

          controller.account('second');
          if (destination === 'same account after signing back in') controller.account('first');
          assert.deepEqual(controller.consents, [], 'changing accounts clears private choices');
          assert.equal(controller.loaded, false);
          const currentRead = controller.load();
          assert.equal(requests.length, 3, 'the current account can start its own read');
          if (current === 'loaded choices') {
            requests[2]!.finish({ok: true, value: {consents: currentChoices}});
            await currentRead;
            assert.equal(controller.consented(currentVenue), true);
          } else {
            assert.equal(controller.pending, true);
          }

          const state = () => structuredClone({
            consents: controller.consents, loaded: controller.loaded, loadAttempted: controller.loadAttempted,
            pending: controller.pending, error: controller.error, errorVenueId: controller.errorVenueId,
            retryAt: controller.retryAt,
          });
          const before = state(), changesBefore = changes;
          requests[1]!.finish(reply);
          await oldRequest;
          assert.deepEqual(state(), before, 'an old reply cannot change current consent state');
          assert.equal(changes, changesBefore, 'an old reply cannot publish a state change');
          assert.equal(controller.waiting, 0, 'a stale rate limit cannot block current choices');

          if (current === 'pending read') {
            await controller.load();
            await controller.agree(currentVenue);
            await controller.withdraw(currentVenue);
            assert.equal(requests.length, 3, 'an old reply cannot release the current read guard');
            requests[2]!.finish({ok: true, value: {consents: currentChoices}});
            await currentRead;
          }
          assert.deepEqual(controller.consents, currentChoices);
          assert.equal(controller.consented(oldVenue), false);
          assert.equal(controller.consented(currentVenue), true);
          assert.equal(controller.pending, false);
          assert.equal(controller.loaded, true);
          const currentWrite = controller.withdraw(currentVenue);
          assert.equal(requests.length, 4, 'the current account can still change its choice');
          requests[3]!.finish({ok: true, value: {consents: [
            {venueId: currentVenue, consented: false, consentedAt: null},
          ]}});
          await currentWrite;
          assert.equal(controller.consented(currentVenue), false);
          assert.equal(controller.error, undefined);
          assert.equal(controller.pending, false);
          assert.deepEqual(requests.map(({path, body}) => ({path, body})), [
            {path: '/translation-consent', body: undefined},
            {path: '/translation-consent', body: action === 'load' ? undefined : action === 'agree'
              ? {venueId: oldVenue, choice: 'agree', consentVersion: 'providers-2026-10-14'}
              : {venueId: oldVenue, choice: 'withdraw'}},
            {path: '/translation-consent', body: undefined},
            {path: '/translation-consent', body: {venueId: currentVenue, choice: 'withdraw'}},
          ]);
        });
      }
    }
  }
}
