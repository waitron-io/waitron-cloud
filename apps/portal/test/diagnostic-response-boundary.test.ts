import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {DiagnosticController} from '../src/diagnostic-controller.ts';
import type {DiagnosticExport} from '../src/diagnostic-types.ts';

const installationId = '12345678-1234-4234-8234-123456789abc';
const venueId = '22345678-1234-4234-8234-123456789abc';
const stamp = '2026-10-28T10:00:00.000Z';
const incident = {kind: 'disconnected' as const, openedAt: stamp, changedAt: stamp};
const remote = {status: 'healthy' as const, checkedAt: stamp, certificateNotAfter: null};

function diagnostic(): DiagnosticExport {
  return {version: 1, generatedAt: stamp, installation: {
    installationId, venueId, environment: 'production', revision: 7,
    access: {status: 'active', lastContactAt: stamp, leaseExpiresAt: null},
    services: [
      {service: 'continuous_backup', state: 'ready', health: 'healthy', observedAt: stamp},
      {service: 'remote_access', state: 'ready', health: 'healthy', observedAt: stamp},
      {service: 'retained_snapshots', state: 'ready', health: 'healthy', observedAt: stamp},
    ],
    backups: {latestSnapshotAt: stamp, verifiedSnapshotAt: null},
    monitoring: {enabled: true, fresh: true, checkedAt: stamp, incidents: [incident],
      remoteChecks: {public: remote, staff: null}},
  }};
}

function browser(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=browser-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

function replace(path: string, value: unknown): unknown {
  const result = structuredClone(diagnostic());
  const keys = path.split('.');
  let parent = result as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[keys.at(-1)!] = value;
  return result;
}

const invalid = [
  {name: 'top-level credentials', path: 'credentials', value: {token: 'private-fixture'}},
  {name: 'installation configuration', path: 'installation.configuration', value: {key: 'private-fixture'}},
  {name: 'access token', path: 'installation.access.token', value: 'private-fixture'},
  {name: 'service credentials', path: 'installation.services.0.credentials', value: 'private-fixture'},
  {name: 'backup reader key', path: 'installation.backups.readerKey', value: 'private-fixture'},
  {name: 'monitoring internal address', path: 'installation.monitoring.address', value: 'private-fixture'},
  {name: 'incident private detail', path: 'installation.monitoring.incidents.0.detail', value: 'private-fixture'},
  {name: 'remote check extra route', path: 'installation.monitoring.remoteChecks.route', value: 'private-fixture'},
  {name: 'public remote check URL', path: 'installation.monitoring.remoteChecks.public.url', value: 'private-fixture'},
  {name: 'staff remote check token', path: 'installation.monitoring.remoteChecks.staff', value: {...remote, token: 'private-fixture'}},
  {name: 'unsupported version', path: 'version', value: 2},
  {name: 'noncanonical generated time', path: 'generatedAt', value: '2026-10-28T10:00:00Z'},
  {name: 'invalid installation ID', path: 'installation.installationId', value: 'installation'},
  {name: 'negative revision', path: 'installation.revision', value: -1},
  {name: 'unsafe revision', path: 'installation.revision', value: 9007199254740992},
  {name: 'unknown access state', path: 'installation.access.status', value: 'enabled'},
  {name: 'invalid access time', path: 'installation.access.lastContactAt', value: 'yesterday'},
  {name: 'duplicate services', path: 'installation.services', value: [
    diagnostic().installation.services[0], diagnostic().installation.services[0], diagnostic().installation.services[2],
  ]},
  {name: 'unknown service health', path: 'installation.services.1.health', value: 'online'},
  {name: 'invalid backup time', path: 'installation.backups.verifiedSnapshotAt', value: 'yesterday'},
  {name: 'nonboolean freshness', path: 'installation.monitoring.fresh', value: 'yes'},
  {name: 'duplicate incidents', path: 'installation.monitoring.incidents', value: [incident, incident]},
  {name: 'unknown incident kind', path: 'installation.monitoring.incidents.0.kind', value: 'private_failure'},
  {name: 'invalid incident time', path: 'installation.monitoring.incidents.0.changedAt', value: 'yesterday'},
  {name: 'unknown remote status', path: 'installation.monitoring.remoteChecks.public.status', value: 'ready'},
  {name: 'invalid certificate time', path: 'installation.monitoring.remoteChecks.public.certificateNotAfter', value: 'yesterday'},
];

for (const entry of invalid) {
  test(`diagnostic HTTP reply rejects ${entry.name} before saving and permits a valid retry`, async t => {
    browser(t);
    let response = replace(entry.path, entry.value);
    const requests: Array<{url: unknown; init: RequestInit | undefined}> = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      requests.push({url, init});
      return Response.json(response);
    });
    assert.deepEqual(await accountRequest('/diagnostics/read', {installationId}), {
      ok: false, status: 503, code: 'unexpected_response', retryAfterMs: 0,
    });
    const saved: Array<{value: DiagnosticExport; name: string}> = [];
    const controller = new DiagnosticController(() => {}, accountRequest, (value, name) => saved.push({value, name}));
    controller.account('owner');
    await controller.download(installationId);
    assert.deepEqual(saved, [], 'invalid HTTP documents must never reach the save callback');
    assert.equal(controller.error, 'diagnosticUnavailable');
    assert.equal(controller.pending, false);
    assert.equal(controller.selected, undefined);
    assert.equal(controller.waiting, 0);

    response = diagnostic();
    await controller.download(installationId);
    assert.deepEqual(saved, [{value: diagnostic(), name: 'waitron-cloud-diagnostic-22345678-20261028T100000Z.json'}]);
    assert.equal(controller.error, undefined);
    assert.equal(controller.pending, false);
    assert.equal(requests.length, 3, 'each user request makes one HTTP attempt');
    for (const {url, init} of requests) {
      assert.equal(url, '/api/account/diagnostics/read');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.credentials, 'same-origin');
      assert.deepEqual(JSON.parse(String(init?.body)), {installationId});
      assert.equal(new Headers(init?.headers).get('X-CSRF-Token'), 'browser-proof');
    }
  });
}

test('a valid diagnostic for another installation cannot be saved for the selected installation', async t => {
  browser(t);
  let response = replace('installation.installationId', '32345678-1234-4234-8234-123456789abc');
  t.mock.method(globalThis, 'fetch', async () => Response.json(response));
  const parsed = await accountRequest('/diagnostics/read', {installationId});
  assert.equal(parsed.ok, true, 'the document is well formed but names another installation');
  const saved: Array<{value: DiagnosticExport; name: string}> = [];
  const controller = new DiagnosticController(() => {}, accountRequest, (value, name) => saved.push({value, name}));
  controller.account('owner');
  await controller.download(installationId);
  assert.deepEqual(saved, []);
  assert.equal(controller.error, 'diagnosticUnavailable');
  assert.equal(controller.pending, false);
  response = diagnostic();
  await controller.download(installationId);
  assert.deepEqual(saved, [{value: diagnostic(), name: 'waitron-cloud-diagnostic-22345678-20261028T100000Z.json'}]);
  assert.equal(controller.error, undefined);
});
