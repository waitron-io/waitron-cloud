import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {InstallationController} from '../src/installation-controller.ts';
import type {AccountInstallation} from '../src/installation-types.ts';

const installationId = '12345678-1234-4234-8234-123456789abc';
const venueId = '22345678-1234-4234-8234-123456789abc';
const organisationId = '32345678-1234-4234-8234-123456789abc';
const legalBusinessId = '42345678-1234-4234-8234-123456789abc';
const otherId = '52345678-1234-4234-8234-123456789abc';
const stamp = '2026-10-28T12:00:00.000Z';

function installation(): AccountInstallation {
  return {installationId, venueId, organisationId, legalBusinessId,
    environment: 'test', revision: 2, revokedAt: null, lastContactAt: stamp,
    leaseExpiresAt: '2026-10-28T12:01:00.000Z', canRevoke: true,
    overview: {organisationName: 'Harbour Kitchen', businessName: 'Harbour Kitchen SL',
      countryCode: 'ES', latestSnapshotAt: stamp, verifiedSnapshotAt: stamp},
    monitoring: {enabled: true, fresh: true, checkedAt: stamp,
      incidents: [{kind: 'public_route_failed', openedAt: stamp, changedAt: stamp}],
      remoteChecks: {public: {status: 'failed', checkedAt: stamp, certificateNotAfter: null},
        staff: {status: 'healthy', checkedAt: stamp, certificateNotAfter: '2026-11-28T12:00:00.000Z'}}},
    services: ['continuous_backup', 'remote_access', 'retained_snapshots'].map(service => ({
      service: service as AccountInstallation['services'][number]['service'],
      state: 'ready', health: 'healthy', failure: null, observedAt: stamp}))};
}

function harness(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=stop-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const replies: Record<string, {body: unknown; status?: number; retry?: string}> = {
    '/api/account/installations': {body: {installations: [installation()]}},
    '/api/account/installations/revoke': {body: {...installation(), revokedAt: stamp}},
  };
  const calls: Array<{url: string; init: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(typeof url, 'string');
    assert.ok(init);
    const reply = replies[String(url)];
    assert.ok(reply, 'unexpected endpoint');
    calls.push({url: String(url), init});
    return Response.json(reply.body, {status: reply.status ?? 200,
      headers: reply.retry ? {'Retry-After': reply.retry} : {}});
  });
  const controller = new InstallationController(() => {});
  controller.account('owner');
  return {controller, replies, calls};
}

const invalidRows = [
  {name: 'null installation', patch: () => null},
  {name: 'invalid installation ID', patch: () => ({installationId: 'server'})},
  {name: 'invalid venue ID', patch: () => ({venueId: 'venue'})},
  {name: 'unknown environment', patch: () => ({environment: 'staging'})},
  {name: 'negative revision', patch: () => ({revision: -1})},
  {name: 'invalid contact time', patch: () => ({lastContactAt: 'yesterday'})},
  {name: 'invalid stop time', patch: () => ({revokedAt: 'yesterday'})},
  {name: 'missing service', patch: () => ({services: installation().services.slice(1)})},
  {name: 'duplicate services', patch: () => ({services: Array(3).fill(installation().services[0])})},
  {name: 'unknown service state', patch: () => ({services: installation().services.map(s => ({...s, state: 'stopped'}))})},
  {name: 'unknown service health', patch: () => ({services: installation().services.map(s => ({...s, health: 'good'}))})},
  {name: 'blank business name', patch: () => ({overview: {...installation().overview, businessName: ''}})},
  {name: 'invalid country code', patch: () => ({overview: {...installation().overview, countryCode: 'es'}})},
  {name: 'invalid snapshot time', patch: () => ({overview: {...installation().overview, verifiedSnapshotAt: 'yesterday'}})},
  {name: 'unknown incident', patch: () => ({monitoring: {...installation().monitoring,
    incidents: [{kind: 'remote_failed', openedAt: stamp, changedAt: stamp}]}})},
  {name: 'duplicate incidents', patch: () => ({monitoring: {...installation().monitoring,
    incidents: Array(2).fill({kind: 'disconnected', openedAt: stamp, changedAt: stamp})}})},
  {name: 'missing staff route', patch: () => ({monitoring: {...installation().monitoring,
    remoteChecks: {public: null}}})},
  {name: 'private route failure detail', patch: () => ({monitoring: {...installation().monitoring,
    remoteChecks: {public: {status: 'failed', checkedAt: stamp, certificateNotAfter: null,
      failure: 'private-network-detail'}, staff: null}}})},
];

function changedRow(entry: typeof invalidRows[number]) {
  const patch = entry.patch();
  return patch === null ? null : {...installation(), ...patch};
}

for (const entry of [
  {name: 'missing list', value: () => ({})},
  {name: 'object list', value: () => ({installations: installation()})},
  {name: 'missing offered permission', value: () => ({installations: [{...installation(), canRevoke: undefined}]})},
  ...invalidRows.map(entry => ({name: entry.name,
    value: () => ({installations: [installation(), changedRow(entry)]})})),
]) {
  test(`installation HTTP ${entry.name} cannot replace usable rows or offer another stop`, async t => {
    const {controller: c, replies, calls} = harness(t);
    await c.load();
    c.choose(installationId);
    replies['/api/account/installations'] = {body: entry.value()};
    await c.load();
    assert.deepEqual(c.installations, [installation()]);
    assert.deepEqual(c.visible, [installation()]);
    assert.equal(c.selectedOrganisation, organisationId);
    assert.equal(c.confirming, installationId);
    assert.equal(c.pending, false);
    assert.equal(c.loaded, true);
    assert.equal(c.error, 'unavailable');
    assert.equal(calls.length, 2);
    replies['/api/account/installations'] = {body: {installations: [installation()]}};
    await c.load();
    assert.equal(c.error, undefined);
    assert.deepEqual(c.installations, [installation()]);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.init.method === 'GET' && call.init.credentials === 'same-origin'));
  });
}

for (const entry of invalidRows) {
  test(`installation HTTP stop with ${entry.name} stays uncertain until an explicit valid retry`, async t => {
    const {controller: c, replies, calls} = harness(t);
    await c.load();
    c.choose(installationId);
    const row = changedRow(entry);
    replies['/api/account/installations/revoke'] = {body: row === null ? null : {...row,
      ...(entry.name === 'invalid stop time' ? {} : {revokedAt: stamp})}};
    await c.revoke();
    assert.deepEqual(c.installations, [installation()]);
    assert.equal(c.confirming, installationId);
    assert.equal(c.error, 'stopUncertain');
    assert.equal(c.pending, false);
    assert.equal(calls.length, 2, 'a malformed reply must not automatically repeat a stop');
    replies['/api/account/installations/revoke'] = {body: {...installation(), revokedAt: stamp,
      canRevoke: false, overview: undefined}};
    await c.revoke();
    assert.deepEqual(c.installations, [{...installation(), revokedAt: stamp}]);
    assert.equal(c.confirming, undefined);
    assert.equal(c.error, undefined);
    assert.equal(c.pending, false);
    assert.equal(calls.length, 3);
    const write = calls.at(-1)!;
    assert.equal(write.url, '/api/account/installations/revoke');
    assert.equal(write.init.method, 'POST');
    assert.equal(write.init.credentials, 'same-origin');
    assert.equal(new Headers(write.init.headers).get('X-CSRF-Token'), 'stop-proof');
    assert.deepEqual(JSON.parse(String(write.init.body)), {installationId});
  });
}

for (const field of ['installationId', 'venueId', 'organisationId', 'legalBusinessId', 'revokedAt'] as const) {
  test(`well-shaped stop reply with mismatched ${field} cannot confirm the selected stop`, async t => {
    const {controller: c, replies, calls} = harness(t);
    await c.load();
    c.choose(installationId);
    replies['/api/account/installations/revoke'] = {body: {...installation(), revokedAt: stamp,
      [field]: field === 'revokedAt' ? null : otherId}};
    await c.revoke();
    assert.deepEqual(c.installations, [installation()]);
    assert.equal(c.confirming, installationId);
    assert.equal(c.selectedOrganisation, organisationId);
    assert.equal(c.error, 'unavailable');
    assert.equal(c.pending, false);
    assert.equal(calls.length, 2);
    replies['/api/account/installations/revoke'] = {body: {...installation(), revokedAt: stamp}};
    await c.revoke();
    assert.deepEqual(c.installations, [{...installation(), revokedAt: stamp}]);
    assert.equal(c.confirming, undefined);
    assert.equal(c.error, undefined);
    assert.equal(calls.length, 3);
  });
}

for (const operation of ['load', 'revoke'] as const) {
  for (const refusal of [
    {status: 401, code: 'session_expired', error: 'pairSession'},
    {status: 403, code: 'permission_denied', error: 'permissionBusiness'},
    {status: 403, code: 'forbidden', error: 'forbidden'},
  ]) {
    test(`installation HTTP ${operation} handles ${refusal.code} without reporting a stop`, async t => {
      const {controller: c, replies, calls} = harness(t);
      await c.load();
      c.choose(installationId);
      replies[`/api/account/installations${operation === 'revoke' ? '/revoke' : ''}`] = {
        status: refusal.status, body: {error: refusal.code}};
      await c[operation]();
      assert.deepEqual(c.installations, operation === 'load' ? [] : [installation()]);
      assert.equal(c.confirming, operation === 'load' ? undefined : installationId);
      assert.equal(c.selectedOrganisation, operation === 'load' ? undefined : organisationId);
      assert.equal(c.error, refusal.error);
      assert.equal(c.pending, false);
      assert.equal(calls.length, 2);
    });
  }

  test(`installation HTTP ${operation} honours Retry-After before a valid explicit retry`, async t => {
    const {controller: c, replies, calls} = harness(t);
    let now = 1_800_000_000_000;
    t.mock.method(Date, 'now', () => now);
    await c.load();
    c.choose(installationId);
    const path = `/api/account/installations${operation === 'revoke' ? '/revoke' : ''}`;
    const valid = replies[path]!;
    replies[path] = {status: 429, body: {error: 'rate_limited'}, retry: '30'};
    await c[operation]();
    assert.deepEqual(c.installations, [installation()]);
    assert.equal(c.confirming, installationId);
    assert.equal(c.error, 'limited');
    assert.equal(c.pending, false);
    assert.equal(c.retryAt, now + 30_000);
    await c[operation]();
    assert.equal(calls.length, 2);
    now += 30_000;
    replies[path] = valid;
    await c[operation]();
    assert.equal(calls.length, 3);
    assert.equal(c.error, undefined);
    assert.equal(c.confirming, operation === 'revoke' ? undefined : installationId);
    assert.deepEqual(c.installations, [{...installation(), revokedAt: operation === 'revoke' ? stamp : null}]);
  });
}
