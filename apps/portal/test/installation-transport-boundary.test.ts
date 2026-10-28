import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {InstallationController} from '../src/installation-controller.ts';
import type {AccountInstallation} from '../src/installation-types.ts';

const id = '12345678-1234-4234-8234-123456789abc';
const venueId = '22345678-1234-4234-8234-123456789abc';
const organisationId = '32345678-1234-4234-8234-123456789abc';
const stamp = '2026-10-28T12:00:00.000Z';
const start = Date.parse(stamp);
function row(): AccountInstallation {
  return {installationId: id, venueId, organisationId,
    legalBusinessId: '42345678-1234-4234-8234-123456789abc',
    environment: 'test', revision: 2, revokedAt: null, lastContactAt: stamp,
    leaseExpiresAt: '2026-10-28T12:01:00.000Z', canRevoke: true,
    services: [
      {service: 'continuous_backup', state: 'ready', health: 'healthy', failure: null, observedAt: stamp},
      {service: 'remote_access', state: 'ready', health: 'healthy', failure: null, observedAt: stamp},
      {service: 'retained_snapshots', state: 'ready', health: 'healthy', failure: null, observedAt: stamp},
    ]};
}
type Operation = 'load' | 'revoke';
function path(operation: Operation) {
  return `/api/account/installations${operation === 'revoke' ? '/revoke' : ''}`;
}
function accepted(operation: Operation) {
  return Response.json(operation === 'load' ? {installations: [row()]} : {...row(), revokedAt: stamp});
}
function harness(t: TestContext) {
  for (const [key, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=stop-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const replies: Array<{url: string; reply: () => Response | Promise<Response>}> = [];
  const calls: Array<{url: string; init: RequestInit | undefined}> = [];
  const violations: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    calls.push({url: String(url), init});
    const next = replies.shift();
    if (!next || next.url !== url) {
      violations.push(`Unexpected request: ${String(url)}`);
      throw new Error('Unexpected fixture request');
    }
    return next.reply();
  });
  t.after(() => {
    assert.deepEqual(violations, [], 'fixture refusals must not be swallowed by the HTTP client');
    assert.equal(replies.length, 0, 'every planned request must execute');
    for (const call of calls) {
      const write = call.url.endsWith('/revoke');
      assert.equal(call.init?.credentials, 'same-origin');
      assert.equal(call.init?.method, write ? 'POST' : 'GET');
      assert.equal(new Headers(call.init?.headers).get('X-CSRF-Token'), write ? 'stop-proof' : null);
      assert.deepEqual(call.init?.body ? JSON.parse(String(call.init.body)) : undefined,
        write ? {installationId: id} : undefined);
    }
  });
  const controller = new InstallationController(() => {});
  controller.account('owner');
  const enqueue = (operation: Operation, reply: () => Response | Promise<Response> = () => accepted(operation)) =>
    replies.push({url: path(operation), reply});
  const seed = async () => { enqueue('load'); await controller.load(); controller.choose(id); };
  return {controller, calls, enqueue, seed};
}

// Accepting a refused status or replaying a failed write would change the visible stop result.
for (const operation of ['load', 'revoke'] as const) {
  for (const refusal of ['lost reply', 'broken JSON', 'unreadable body', 'success-shaped refusal', 'private refusal'] as const) {
    test(`installation ${operation} ${refusal} retains the selected row for an explicit retry`, async t => {
      const {controller: c, calls, enqueue, seed} = harness(t);
      await seed();
      enqueue(operation, () => {
        if (refusal === 'lost reply') throw new Error('private transport detail');
        if (refusal === 'broken JSON') return new Response('{', {status: 200});
        if (refusal === 'unreadable body') return new Response(new ReadableStream({
          start(stream) { stream.error(new Error('private body detail')); },
        }), {status: 200});
        if (refusal === 'success-shaped refusal') return Response.json(
          operation === 'load' ? {installations: []} : {...row(), revokedAt: stamp}, {status: 503});
        return Response.json({error: 'private database detail'}, {status: 409});
      });
      await c[operation]();
      assert.deepEqual(c.installations, [row()]);
      assert.deepEqual(c.visible, [row()]);
      assert.equal(c.confirming, id);
      assert.equal(c.selectedOrganisation, organisationId);
      assert.equal(c.pending, false);
      assert.equal(c.error, operation === 'load' ? 'unavailable' : 'stopUncertain');
      assert.equal(calls.length, 2, 'a failed request cannot dispatch its own retry or read-back');
      enqueue(operation);
      await c[operation]();
      assert.equal(calls.length, 3);
      assert.equal(c.pending, false);
      assert.equal(c.error, undefined);
      assert.equal(c.confirming, operation === 'load' ? id : undefined);
      assert.deepEqual(c.installations, [{...row(), revokedAt: operation === 'load' ? null : stamp}]);
    });
  }

  test(`installation pending ${operation} blocks another request and selection changes`, async t => {
    const {controller: c, calls, enqueue, seed} = harness(t);
    await seed();
    let release!: (response: Response) => void;
    const held = new Promise<Response>(resolve => { release = resolve; });
    enqueue(operation, () => held);
    const running = c[operation]();
    assert.equal(c.pending, true);
    try {
      await c.load(); await c.revoke();
      c.choose(); c.selectOrganisation(organisationId);
      assert.equal(calls.length, 2);
      assert.equal(c.confirming, id);
      assert.equal(c.selectedOrganisation, organisationId);
      assert.equal(c.pending, true);
    } finally { release(accepted(operation)); await running; }
    assert.equal(c.pending, false);
    assert.equal(c.error, undefined);
    assert.equal(c.confirming, operation === 'load' ? id : undefined);
    assert.deepEqual(c.installations, [{...row(), revokedAt: operation === 'load' ? null : stamp}]);
  });

  // Dropping a wait on navigation, misreading its units or ignoring its date admits another request early.
  for (const retry of ['30', 'Wed, 28 Oct 2026 12:00:30 GMT']) {
    test(`installation ${operation} Retry-After ${retry} survives account changes and clock rollback`, async t => {
      const {controller: c, calls, enqueue, seed} = harness(t);
      let now = start;
      t.mock.method(Date, 'now', () => now);
      await seed();
      enqueue(operation, () => Response.json({error: 'rate_limited'}, {
        status: 429, headers: {'Retry-After': retry},
      }));
      await c[operation]();
      assert.equal(c.error, 'limited');
      assert.equal(c.retryAt, start + 30_000);
      assert.equal(c.waiting, 30);
      assert.deepEqual(c.installations, [row()]);
      assert.equal(c.confirming, id);
      await c.load(); await c.revoke();
      assert.equal(calls.length, 2);
      for (const account of ['other', undefined, 'owner']) {
        c.account(account);
        await c.load(); await c.revoke();
        assert.equal(c.retryAt, start + 30_000);
        assert.equal(calls.length, 2);
      }
      now = start - 5_000;
      await c.load(); await c.revoke();
      assert.equal(c.waiting, 35);
      assert.equal(calls.length, 2);
      now = start + 29_999;
      await c.load(); await c.revoke();
      assert.equal(c.waiting, 1);
      assert.equal(calls.length, 2);
      now = start + 30_000;
      enqueue('load');
      await c.load();
      assert.equal(c.waiting, 0);
      assert.equal(c.error, undefined);
      assert.deepEqual(c.installations, [row()]);
      c.choose(id);
      enqueue('revoke');
      await c.revoke();
      assert.equal(calls.length, 4);
      assert.deepEqual(c.installations, [{...row(), revokedAt: stamp}]);
      assert.equal(c.confirming, undefined);
      assert.equal(c.error, undefined);
    });
  }
}

test('installation initial unreadable list cannot supply a stop target and permits an explicit read retry', async t => {
  const {controller: c, calls, enqueue} = harness(t);
  enqueue('load', () => new Response('{', {status: 200}));
  await c.load();
  assert.equal(c.error, 'unavailable');
  c.choose(id);
  await c.revoke();
  assert.equal(calls.length, 1);
  assert.deepEqual(c.installations, []);
  assert.equal(c.confirming, undefined);
  assert.equal(c.selectedOrganisation, undefined);
  assert.equal(c.error, undefined);
  assert.equal(c.loaded, true);
  assert.equal(c.pending, false);
  enqueue('load');
  await c.load();
  assert.deepEqual(c.installations, [row()]);
  assert.equal(c.selectedOrganisation, organisationId);
  assert.equal(calls.length, 2);
});
