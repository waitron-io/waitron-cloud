import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {TranslationConsentController} from '../src/translation-consent-controller.ts';

const venueId = '12345678-1234-4234-8234-123456789abc';
const choices = {consents: [{venueId, consented: true, consentedAt: '2026-10-14T10:00:00.000Z'}]};
type Action = 'read' | 'agree' | 'withdraw';
const actions: Action[] = ['read', 'agree', 'withdraw'];
const waits = [
  {name: 'seconds', header: '7'},
  {name: 'HTTP date', header: 'Thu, 01 Jan 1970 00:01:47 GMT'},
];

function browser(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}],
    ['document', {cookie: '__Host-cloud_csrf=consent-retry-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

function perform(controller: TranslationConsentController, action: Action) {
  return action === 'read' ? controller.load() : controller[action](venueId);
}

for (const action of actions) for (const wait of waits) for (const status of [429, 503]) {
  test(`translation consent ${action} keeps ${status} ${wait.name} waits across account changes until exact expiry`, async t => {
    browser(t);
    let now = 100000;
    t.mock.method(Date, 'now', () => now);
    let refused = false;
    const calls: RequestInit[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      assert.equal(url, '/api/account/translation-consent');
      calls.push(init!);
      return refused ? Response.json({error: status === 429 ? 'rate_limited' : 'temporarily_unavailable'},
        {status, headers: {'Retry-After': wait.header}}) : Response.json(choices);
    });
    const controller = new TranslationConsentController(() => {});
    controller.account('first-owner');
    await controller.load();
    refused = true;
    await perform(controller, action);
    assert.equal(calls.length, 2, 'a refused operation is sent once');
    assert.equal(controller.pending, false);
    assert.equal(controller.loaded, true);
    assert.deepEqual(controller.consents, choices.consents);
    assert.equal(controller.error, status === 429 ? 'limited' : action === 'read' ? 'unavailable' : 'translationConsentUncertain');
    assert.equal(controller.errorVenueId, action === 'read' ? undefined : venueId);
    assert.equal(controller.waiting, 7);
    assert.equal(controller.retryAt, 107000);

    controller.account('second-owner');
    assert.equal(controller.loaded, false);
    assert.deepEqual(controller.consents, []);
    assert.equal(controller.error, undefined);
    assert.equal(controller.errorVenueId, undefined);
    assert.equal(controller.waiting, 7);
    refused = false;
    for (const candidate of actions) await perform(controller, candidate);
    assert.equal(calls.length, 2, 'switching accounts cannot bypass the server wait');
    now = 106999;
    assert.equal(controller.waiting, 1);
    for (const candidate of actions) await perform(controller, candidate);
    assert.equal(calls.length, 2, 'no request is sent one millisecond before expiry');
    now = 107000;
    assert.equal(controller.waiting, 0);
    assert.equal(calls.length, 2, 'expiry does not automatically repeat a request');
    await perform(controller, action);
    assert.equal(calls.length, 3);
    assert.equal(controller.loaded, true);
    assert.deepEqual(controller.consents, choices.consents);
    assert.equal(controller.pending, false);
    assert.equal(controller.error, undefined);
    assert.equal(controller.errorVenueId, undefined);
    const request = calls[2]!;
    assert.equal(request.credentials, 'same-origin');
    assert.equal(request.method, action === 'read' ? 'GET' : 'POST');
    if (action === 'read') {
      assert.equal(request.body, undefined);
      assert.equal(new Headers(request.headers).has('X-CSRF-Token'), false);
    } else {
      assert.deepEqual(JSON.parse(String(request.body)), action === 'agree'
        ? {venueId, choice: 'agree', consentVersion: 'providers-2026-10-14'}
        : {venueId, choice: 'withdraw'});
      assert.equal(new Headers(request.headers).get('X-CSRF-Token'), 'consent-retry-proof');
    }
  });
}

for (const action of actions) for (const wait of waits) {
  test(`translation consent ${action} retains an earlier ${wait.name} deadline when the clock moves backward during HTTP`, async t => {
    browser(t);
    let now = 100000;
    t.mock.method(Date, 'now', () => now);
    let mode: 'limited' | 'pending' | 'ready' = 'limited';
    let finish!: (response: Response) => void;
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      if (mode === 'limited') return Response.json({error: 'rate_limited'}, {status: 429, headers: {'Retry-After': wait.header}});
      if (mode === 'pending' && calls === 2) return new Promise<Response>(resolve => {finish = resolve;});
      return Response.json(choices);
    });
    const controller = new TranslationConsentController(() => {});
    controller.account('owner');
    await perform(controller, action);
    assert.equal(controller.retryAt, 107000);
    assert.equal(controller.waiting, 7);
    now = 107001;
    mode = 'pending';
    const pending = perform(controller, action);
    assert.equal(controller.pending, true);
    assert.equal(calls, 2);
    for (const candidate of actions) await perform(controller, candidate);
    assert.equal(calls, 2, 'pending HTTP work blocks duplicate reads and writes');
    now = 104000;
    finish(Response.json({error: 'temporarily_unavailable'}, {status: 503}));
    await pending;
    assert.equal(controller.pending, false);
    assert.equal(controller.error, action === 'read' ? 'unavailable' : 'translationConsentUncertain');
    assert.equal(controller.retryAt, 107000, 'a shorter later wait cannot erase the preceding deadline');
    assert.equal(controller.waiting, 3);
    mode = 'ready';
    now = 106999;
    for (const candidate of actions) await perform(controller, candidate);
    assert.equal(calls, 2);
    now = 107000;
    await perform(controller, action);
    assert.equal(calls, 3);
    assert.equal(controller.loaded, true);
    assert.deepEqual(controller.consents, choices.consents);
    assert.equal(controller.pending, false);
    assert.equal(controller.error, undefined);
    assert.equal(controller.waiting, 0);
  });
}
