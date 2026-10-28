import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {TranslationConsentController} from '../src/translation-consent-controller.ts';

const first = '12345678-1234-4234-8234-123456789abc';
const second = 'abcdef12-3456-4789-8abc-123456789abc';
const recordedAt = '2026-10-14T10:00:00.000Z';
const before = {consents: [
  {venueId: first, consented: false, consentedAt: null},
  {venueId: second, consented: true, consentedAt: recordedAt},
]};
const confirmed = {consents: [
  {venueId: first, consented: true, consentedAt: recordedAt},
  {venueId: second, consented: false, consentedAt: null},
]};

function browser(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}],
    ['document', {cookie: '__Host-cloud_csrf=consent-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

const failures = [
  ...[
    {name: 'null list', value: null},
    {name: 'array envelope', value: []},
    {name: 'missing list', value: {}},
    {name: 'object list', value: {consents: {}}},
    {name: 'null choice', value: {consents: [null]}},
    {name: 'array choice', value: {consents: [[]]}},
    {name: 'missing venue', value: {consents: [{consented: true, consentedAt: recordedAt}]}},
    {name: 'invalid venue', value: {consents: [{venueId: 'not-a-venue', consented: false, consentedAt: null}]}},
    {name: 'uppercase venue', value: {consents: [{venueId: first.toUpperCase(), consented: false, consentedAt: null}]}},
    {name: 'duplicate venue', value: {consents: [before.consents[0], confirmed.consents[0]]}},
    {name: 'string consent', value: {consents: [{venueId: first, consented: 'false', consentedAt: null}]}},
    {name: 'missing consent', value: {consents: [{venueId: first, consentedAt: null}]}},
    {name: 'agreement without date', value: {consents: [{venueId: first, consented: true, consentedAt: null}]}},
    {name: 'agreement with invalid date', value: {consents: [{venueId: first, consented: true, consentedAt: 'not-a-date'}]}},
    {name: 'agreement with numeric date', value: {consents: [{venueId: first, consented: true, consentedAt: 0}]}},
    {name: 'withdrawal with date', value: {consents: [{venueId: first, consented: false, consentedAt: recordedAt}]}},
    {name: 'withdrawal without null date', value: {consents: [{venueId: first, consented: false}]}},
  ].map(entry => ({name: entry.name, reply: () => Response.json(entry.value)})),
  ...[201, 202, 206].map(status => ({name: `HTTP ${status}`, reply: () => Response.json(confirmed, {status})})),
  {name: 'empty HTTP 204', reply: () => new Response(null, {status: 204})},
  {name: 'broken JSON', reply: () => new Response('{"consents":[')},
  {name: 'lost connection', reply: (): Response => {throw new TypeError('fixture connection lost');}},
];

type Operation = 'initial read' | 'reload' | 'agree' | 'withdraw';
const operations: Operation[] = ['initial read', 'reload', 'agree', 'withdraw'];
function perform(controller: TranslationConsentController, operation: Operation) {
  return operation === 'agree' ? controller.agree(first)
    : operation === 'withdraw' ? controller.withdraw(second) : controller.load();
}

for (const operation of operations) {
  for (const entry of failures) {
    test(`translation consent ${operation} with ${entry.name} retains choices and permits an explicit retry`, async t => {
      browser(t);
      let reply = () => Response.json(before);
      const calls: RequestInit[] = [];
      t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
        assert.equal(url, '/api/account/translation-consent');
        calls.push(init!);
        return reply();
      });
      const controller = new TranslationConsentController(() => {}, accountRequest);
      controller.account('owner');
      if (operation !== 'initial read') await controller.load();
      calls.length = 0;
      reply = entry.reply;
      await perform(controller, operation);
      assert.deepEqual(controller.consents, operation === 'initial read' ? [] : before.consents);
      assert.equal(controller.loaded, operation !== 'initial read');
      assert.equal(controller.pending, false);
      assert.equal(controller.error, operation === 'agree' || operation === 'withdraw' ? 'translationConsentUncertain' : 'unavailable');
      assert.equal(controller.errorVenueId, operation === 'agree' ? first : operation === 'withdraw' ? second : undefined);
      assert.equal(controller.waiting, 0);
      assert.equal(calls.length, 1, 'an uncertain operation must not repeat itself');
      const request = calls[0]!;
      assert.equal(request.credentials, 'same-origin');
      if (operation === 'agree' || operation === 'withdraw') {
        assert.equal(request.method, 'POST');
        assert.deepEqual(JSON.parse(String(request.body)), operation === 'agree'
          ? {venueId: first, choice: 'agree', consentVersion: 'providers-2026-10-14'}
          : {venueId: second, choice: 'withdraw'});
        assert.equal(new Headers(request.headers).get('X-CSRF-Token'), 'consent-proof');
      } else {
        assert.equal(request.method, 'GET');
        assert.equal(request.body, undefined);
        assert.equal(new Headers(request.headers).has('X-CSRF-Token'), false);
      }
      reply = () => Response.json(confirmed);
      await perform(controller, operation);
      assert.equal(calls.length, 2);
      assert.deepEqual(controller.consents, confirmed.consents);
      assert.equal(controller.consented(first), true);
      assert.equal(controller.consented(second), false);
      assert.equal(controller.loaded, true);
      assert.equal(controller.pending, false);
      assert.equal(controller.error, undefined);
      assert.equal(controller.errorVenueId, undefined);
    });
  }
}

for (const operation of ['reload', 'agree', 'withdraw'] as const) {
  for (const refusal of [
    {status: 401, code: 'unauthenticated', error: 'pairSession'},
    {status: 403, code: 'permission_denied', error: 'permissionBusiness'},
    {status: 403, code: 'forbidden', error: 'forbidden'},
  ]) {
    test(`translation consent ${operation} clears choices after ${refusal.status} ${refusal.code}`, async t => {
      browser(t);
      let denied = false;
      let requests = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        return denied ? Response.json({error: refusal.code}, {status: refusal.status}) : Response.json(before);
      });
      const controller = new TranslationConsentController(() => {}, accountRequest);
      controller.account('owner');
      await controller.load();
      denied = true;
      await perform(controller, operation);
      assert.deepEqual(controller.consents, []);
      assert.equal(controller.consented(second), false);
      assert.equal(controller.loaded, false);
      assert.equal(controller.pending, false);
      assert.equal(controller.error, refusal.error);
      assert.equal(requests, 2);
      denied = false;
      await controller.load();
      assert.equal(requests, 3);
      assert.deepEqual(controller.consents, before.consents);
      assert.equal(controller.loaded, true);
      assert.equal(controller.error, undefined);
      assert.equal(controller.errorVenueId, undefined);
    });
  }

  test(`translation consent ${operation} retains a server retry wait before retrying`, async t => {
    browser(t);
    t.mock.timers.enable({apis: ['Date'], now: 100000});
    let limited = false;
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      requests++;
      return limited ? Response.json({error: 'rate_limited'}, {status: 429, headers: {'Retry-After': '7'}}) : Response.json(before);
    });
    const controller = new TranslationConsentController(() => {}, accountRequest);
    controller.account('owner');
    await controller.load();
    limited = true;
    await perform(controller, operation);
    assert.deepEqual(controller.consents, before.consents);
    assert.equal(controller.loaded, true);
    assert.equal(controller.pending, false);
    assert.equal(controller.error, 'limited');
    assert.equal(controller.waiting, 7);
    limited = false;
    await controller.load();
    await controller.agree(first);
    await controller.withdraw(second);
    assert.equal(requests, 2);
    t.mock.timers.tick(6999);
    await perform(controller, operation);
    assert.equal(requests, 2);
    t.mock.timers.tick(1);
    await perform(controller, operation);
    assert.equal(requests, 3);
    assert.equal(controller.waiting, 0);
    assert.equal(controller.error, undefined);
    assert.equal(controller.errorVenueId, undefined);
  });
}

test('a valid empty translation consent list removes previously accepted choices', async t => {
  browser(t);
  let empty = false;
  t.mock.method(globalThis, 'fetch', async () => Response.json(empty ? {consents: []} : before));
  const controller = new TranslationConsentController(() => {}, accountRequest);
  controller.account('owner');
  await controller.load();
  assert.equal(controller.consented(second), true);
  empty = true;
  await controller.load();
  assert.deepEqual(controller.consents, []);
  assert.equal(controller.consented(second), false);
  assert.equal(controller.loaded, true);
  assert.equal(controller.pending, false);
  assert.equal(controller.error, undefined);
});
