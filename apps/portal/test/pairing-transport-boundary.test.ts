import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {PairingController} from '../src/pairing-controller.ts';

const requestId = '12345678-1234-4234-8234-123456789abc';
const organisationId = '22345678-1234-4234-8234-123456789abc';
const legalBusinessId = '32345678-1234-4234-8234-123456789abc';
const localVenueId = '42345678-1234-4234-8234-123456789abc';
const nextRequestId = '52345678-1234-4234-8234-123456789abc';
const business = {organisationId, legalBusinessId, organisationName: 'Harbour Kitchen',
  legalBusinessName: 'Harbour Kitchen SL', countryCode: 'ES'};
const inspection = {requestId, localVenueId, environment: 'test',
  expiresAt: '2026-10-29T12:00:00.000Z', state: 'awaiting_cloud'};
const approval = {...inspection, ...business, state: 'awaiting_local'};
type Operation = 'load' | 'inspect' | 'approve';
const operations: Operation[] = ['load', 'inspect', 'approve'];

function harness(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=pairing-transport-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const calls: Array<{url: unknown; init: RequestInit | undefined}> = [];
  const c = new PairingController(() => {});
  c.account('owner'); c.open(requestId); c.code = '01234567';
  const transport = {reply: async (url: unknown): Promise<Response> => Response.json(
    String(url).endsWith('/businesses') ? {businesses: [business]}
      : String(url).endsWith('/approve') ? {...approval, requestId: c.requestId} : {...inspection, requestId: c.requestId})};
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    calls.push({url, init});
    return transport.reply(url);
  });
  const valid = transport.reply;
  return {c, calls, transport, valid};
}

function assertRequest(call: {url: unknown; init: RequestInit | undefined}, operation: Operation, id = requestId) {
  assert.equal(call.url, `/api/account/pairing/${operation === 'load' ? 'businesses' : operation}`);
  assert.equal(call.init?.method, operation === 'load' ? 'GET' : 'POST');
  assert.equal(call.init?.credentials, 'same-origin');
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get('X-CSRF-Token'), operation === 'load' ? null : 'pairing-transport-proof');
  if (operation === 'load') assert.equal(call.init?.body, undefined);
  else assert.deepEqual(JSON.parse(String(call.init?.body)), operation === 'approve'
    ? {requestId: id, code: '01234567', organisationId, legalBusinessId}
    : {requestId: id, code: '01234567'});
}

const refusals = [
  {name: 'expired session', reply: async () => Response.json({error: 'session_expired'}, {status: 401}), read: 'pairSession', write: 'pairSession'},
  {name: 'permission refusal', reply: async () => Response.json({error: 'forbidden'}, {status: 403}), read: 'pairPermission', write: 'pairPermission'},
  {name: 'binding conflict', reply: async () => Response.json({error: 'binding_conflict'}, {status: 409}), read: 'pairPermission', write: 'pairPermission'},
  {name: 'unavailable pairing', reply: async () => Response.json({error: 'pairing_unavailable'}, {status: 410}), read: 'pairUnavailable', write: 'pairUnavailable'},
  {name: 'service outage', reply: async () => Response.json({error: 'temporarily_unavailable'}, {status: 503}), read: 'unavailable', write: 'pairUncertain'},
  {name: 'unreadable gateway refusal', reply: async () => new Response('<html>upstream unavailable</html>', {status: 502}), read: 'unavailable', write: 'pairUncertain'},
  {name: 'lost connection', reply: async (): Promise<Response> => {throw new TypeError('fixture connection lost');}, read: 'unavailable', write: 'pairUncertain'},
];

for (const operation of operations) for (const refusal of refusals) {
  test(`pairing transport ${operation} ${refusal.name} retains the choice for an explicit retry`, async t => {
    const {c, calls, transport, valid} = harness(t);
    await c.load(); await c.inspect();
    calls.length = 0;
    transport.reply = refusal.reply;
    await c[operation]();
    assert.equal(c.error, operation === 'approve' ? refusal.write : refusal.read);
    assert.equal(c.pending, false);
    assert.equal(c.loaded, true);
    assert.deepEqual(c.businesses, [business]);
    assert.equal(c.selected, legalBusinessId);
    assert.equal(c.code, '01234567');
    assert.equal(c.codeError, false);
    assert.deepEqual(c.view, inspection);
    assert.equal(c.waiting, 0);
    assert.equal(calls.length, 1, 'a refusal cannot automatically replay an approval');
    assertRequest(calls[0]!, operation);
    transport.reply = valid;
    await c[operation]();
    assert.equal(calls.length, 2);
    assertRequest(calls[1]!, operation);
    assert.equal(c.error, undefined);
    assert.equal(c.pending, false);
    assert.deepEqual(c.businesses, [business]);
    assert.equal(c.selected, legalBusinessId);
    assert.deepEqual(c.view, operation === 'approve' ? approval : inspection);
  });
}

for (const operation of operations) for (const status of [403, 503]) {
  test(`pairing transport ${operation} cannot accept a success-shaped HTTP ${status} refusal`, async t => {
    const {c, calls, transport, valid} = harness(t);
    await c.load(); await c.inspect(); calls.length = 0;
    transport.reply = async url => {
      const value = await (await valid(url)).json();
      return Response.json({...value, error: 'temporarily_unavailable'}, {status});
    };
    await c[operation]();
    assert.equal(c.error, status === 403 ? 'pairPermission' : operation === 'approve' ? 'pairUncertain' : 'unavailable');
    assert.equal(c.pending, false);
    assert.deepEqual(c.view, inspection);
    assert.equal(calls.length, 1);
    assertRequest(calls[0]!, operation);
    transport.reply = valid;
    await c[operation]();
    assert.equal(calls.length, 2);
    assert.equal(c.error, undefined);
    assert.deepEqual(c.view, operation === 'approve' ? approval : inspection);
  });
}

for (const operation of operations) for (const format of ['seconds', 'date'] as const) {
  test(`pairing transport ${operation} keeps a ${format} retry wait across account and request changes`, async t => {
    t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-10-28T10:00:00.000Z')});
    const {c, calls, transport, valid} = harness(t);
    await c.load(); await c.inspect(); calls.length = 0;
    transport.reply = async () => Response.json({error: 'rate_limited'}, {
      status: 429, headers: {'Retry-After': format === 'seconds' ? '7' : 'Wed, 28 Oct 2026 10:00:07 GMT'},
    });
    await c[operation]();
    assert.equal(c.error, 'limited');
    assert.equal(c.waiting, 7);
    assert.equal(c.pending, false);
    assert.deepEqual(c.view, inspection);
    assert.equal(c.selected, legalBusinessId);
    assertRequest(calls[0]!, operation);
    transport.reply = valid;
    await c.load(); await c.inspect(); await c.approve();
    assert.equal(calls.length, 1);
    c.account('next-owner'); c.open(nextRequestId); c.code = '01234567';
    assert.deepEqual(c.businesses, []);
    assert.equal(c.view, undefined);
    assert.equal(c.waiting, 7);
    await c.load(); await c.inspect(); await c.approve();
    assert.equal(calls.length, 1, 'changing account or request cannot bypass the server wait');
    t.mock.timers.tick(6999);
    assert.equal(c.waiting, 1);
    await c.load(); await c.inspect(); await c.approve();
    assert.equal(calls.length, 1);
    t.mock.timers.tick(1);
    assert.equal(c.waiting, 0);
    await c.load();
    assert.equal(calls.length, 2);
    assertRequest(calls[1]!, 'load', nextRequestId);
    await c.inspect();
    assert.equal(calls.length, 3);
    assertRequest(calls[2]!, 'inspect', nextRequestId);
    await c.approve();
    assert.equal(calls.length, 4);
    assertRequest(calls[3]!, 'approve', nextRequestId);
    assert.deepEqual(c.view, {...approval, requestId: nextRequestId});
    assert.equal(c.error, undefined);
    assert.equal(c.pending, false);
  });
}

for (const operation of operations) {
  test(`pairing transport pending ${operation} prevents duplicate dispatch and releases after refusal`, async t => {
    const {c, calls, transport, valid} = harness(t);
    await c.load(); await c.inspect(); calls.length = 0;
    let release!: (response: Response) => void;
    transport.reply = () => new Promise(resolve => {release = resolve;});
    const pending = c[operation]();
    assert.equal(c.pending, true);
    assert.equal(calls.length, 1);
    assertRequest(calls[0]!, operation);
    const suppressed = [c.load(), c.inspect(), c.approve()];
    assert.equal(calls.length, 1);
    assert.deepEqual(c.view, inspection);
    release(Response.json({error: 'temporarily_unavailable'}, {status: 503}));
    await pending; await Promise.all(suppressed);
    assert.equal(c.pending, false);
    assert.equal(c.error, operation === 'approve' ? 'pairUncertain' : 'unavailable');
    assert.deepEqual(c.view, inspection);
    transport.reply = valid;
    await c[operation]();
    assert.equal(calls.length, 2);
    assert.equal(c.pending, false);
    assert.equal(c.error, undefined);
    assert.deepEqual(c.view, operation === 'approve' ? approval : inspection);
  });
}
