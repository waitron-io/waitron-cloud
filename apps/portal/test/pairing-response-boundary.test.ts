import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {PairingController} from '../src/pairing-controller.ts';

const requestId = '12345678-1234-4234-8234-123456789abc';
const organisationId = '22345678-1234-4234-8234-123456789abc';
const legalBusinessId = '32345678-1234-4234-8234-123456789abc';
const localVenueId = '42345678-1234-4234-8234-123456789abc';
const otherId = '52345678-1234-4234-8234-123456789abc';
const business = {organisationId, legalBusinessId, organisationName: 'Harbour Kitchen',
  legalBusinessName: 'Harbour Kitchen SL', countryCode: 'ES'};
const inspection = {requestId, localVenueId, environment: 'test',
  expiresAt: '2026-10-28T16:00:00.000Z', state: 'awaiting_cloud'};
const approval = {...inspection, ...business, state: 'awaiting_local'};

function harness(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=pairing-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const replies: Record<string, unknown> = {
    '/api/account/pairing/businesses': {businesses: [business]},
    '/api/account/pairing/inspect': inspection,
    '/api/account/pairing/approve': approval,
  };
  const calls: Array<{url: string; init: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(typeof url, 'string');
    assert.ok(init);
    assert.ok(Object.hasOwn(replies, String(url)), 'unexpected endpoint');
    calls.push({url: String(url), init});
    return Response.json(replies[String(url)]);
  });
  const controller = new PairingController(() => {});
  controller.account('owner');
  controller.open(requestId);
  return {controller, calls, replies};
}

const invalidBusinesses = [
  {name: 'missing list', value: {}},
  {name: 'object list', value: {businesses: business}},
  {name: 'null business', value: {businesses: [null]}},
  {name: 'invalid organisation', value: {businesses: [{...business, organisationId: 'organisation'}]}},
  {name: 'invalid business', value: {businesses: [{...business, legalBusinessId: 'business'}]}},
  {name: 'blank organisation name', value: {businesses: [{...business, organisationName: '  '}]}},
  {name: 'oversize business name', value: {businesses: [{...business, legalBusinessName: 'x'.repeat(201)}]}},
  {name: 'invalid country', value: {businesses: [{...business, countryCode: 'es'}]}},
];

for (const entry of invalidBusinesses) {
  test(`pairing HTTP ${entry.name} cannot supply an approval choice`, async t => {
    const {controller: c, calls, replies} = harness(t);
    replies['/api/account/pairing/businesses'] = entry.value;
    await c.load();
    assert.deepEqual(c.businesses, []);
    assert.equal(c.selected, '');
    assert.equal(c.loaded, false);
    assert.equal(c.pending, false);
    assert.equal(c.error, 'unavailable');
    c.code = '12345678';
    await c.inspect();
    assert.deepEqual(c.view, inspection);
    await c.approve();
    assert.equal(c.error, 'pairChoice');
    assert.deepEqual(calls.map(call => call.url), ['/api/account/pairing/businesses', '/api/account/pairing/inspect']);
    replies['/api/account/pairing/businesses'] = {businesses: [business]};
    await c.load();
    assert.deepEqual(c.businesses, [business]);
    assert.equal(c.selected, legalBusinessId);
    assert.equal(c.loaded, true);
    assert.equal(c.error, undefined);
    await c.approve();
    assert.deepEqual(c.view, approval);
    assert.equal(c.pending, false);
    assert.equal(c.error, undefined);
  });
}

const invalidViews = [
  {name: 'null view', change: () => null},
  {name: 'missing request', change: (v: typeof approval) => ({...v, requestId: undefined})},
  {name: 'invalid venue', change: (v: typeof approval) => ({...v, localVenueId: 'venue'})},
  {name: 'unknown environment', change: (v: typeof approval) => ({...v, environment: 'staging'})},
  {name: 'invalid expiry', change: (v: typeof approval) => ({...v, expiresAt: 'tomorrow'})},
  {name: 'unknown state', change: (v: typeof approval) => ({...v, state: 'approved'})},
  {name: 'incomplete accepted binding', change: (v: typeof approval) => ({...v, state: 'awaiting_local', organisationId: undefined})},
  {name: 'blank accepted business name', change: (v: typeof approval) => ({...v, state: 'complete', legalBusinessName: ' '})},
];

for (const operation of ['inspect', 'approve'] as const) for (const entry of invalidViews) {
  test(`pairing HTTP ${operation} rejects ${entry.name} and permits a valid retry`, async t => {
    const {controller: c, calls, replies} = harness(t);
    await c.load();
    c.code = '12345678';
    if (operation === 'approve') await c.inspect();
    replies[`/api/account/pairing/${operation}`] = entry.change(approval);
    await c[operation]();
    assert.deepEqual(c.view, operation === 'approve' ? inspection : undefined);
    assert.equal(c.error, operation === 'approve' ? 'pairUncertain' : 'unavailable');
    assert.equal(c.pending, false);
    assert.equal(c.code, '12345678');
    assert.equal(c.selected, legalBusinessId);
    const attempts = calls.length;
    assert.equal(attempts, operation === 'approve' ? 3 : 2, 'a malformed reply must not automatically repeat a write');
    replies[`/api/account/pairing/${operation}`] = operation === 'approve' ? approval : inspection;
    await c[operation]();
    assert.equal(calls.length, attempts + 1);
    assert.deepEqual(c.view, operation === 'approve' ? approval : inspection);
    assert.equal(c.error, undefined);
    assert.equal(c.pending, false);
    const last = calls.at(-1)!;
    assert.equal(last.url, `/api/account/pairing/${operation}`);
    assert.equal(last.init.method, 'POST');
    assert.equal(last.init.credentials, 'same-origin');
    assert.equal(new Headers(last.init.headers).get('X-CSRF-Token'), 'pairing-proof');
    assert.deepEqual(JSON.parse(String(last.init.body)), operation === 'approve'
      ? {requestId, code: '12345678', organisationId, legalBusinessId}
      : {requestId, code: '12345678'});
  });
}

for (const operation of ['inspect', 'approve'] as const) {
  const mismatches = operation === 'inspect'
    ? [{name: 'another request', patch: {requestId: otherId}}, {name: 'another venue', patch: {localVenueId: otherId}}]
    : [{name: 'another request', patch: {requestId: otherId}}, {name: 'another venue', patch: {localVenueId: otherId}},
      {name: 'another organisation', patch: {organisationId: otherId}}, {name: 'another business', patch: {legalBusinessId: otherId}},
      {name: 'unaccepted approval', patch: {state: 'awaiting_cloud'}}];
  for (const entry of mismatches) {
    test(`well-shaped pairing ${operation} for ${entry.name} cannot replace the inspected venue`, async t => {
      const {controller: c, calls, replies} = harness(t);
      await c.load();
      c.code = '12345678';
      await c.inspect();
      replies[`/api/account/pairing/${operation}`] = {...(operation === 'approve' ? approval : inspection), ...entry.patch};
      await c[operation]();
      assert.deepEqual(c.view, inspection);
      assert.equal(c.error, 'unavailable');
      assert.equal(c.pending, false);
      assert.equal(c.selected, legalBusinessId);
      assert.equal(calls.length, 3);
      replies[`/api/account/pairing/${operation}`] = operation === 'approve' ? approval : inspection;
      await c[operation]();
      assert.deepEqual(c.view, operation === 'approve' ? approval : inspection);
      assert.equal(c.error, undefined);
      assert.equal(calls.length, 4);
    });
  }
}
