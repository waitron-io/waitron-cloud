import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {BackupController} from '../src/backup-controller.ts';
import type {BackupPage} from '../src/backup-types.ts';

const venueId = '12345678-1234-4234-8234-123456789abc';
const pointId = '22345678-1234-4234-8234-123456789abc';
const nextPointId = '32345678-1234-4234-8234-123456789abc';
const sourceNodeId = '42345678-1234-4234-8234-123456789abc';
const stamp = '2026-10-28T10:00:00.000Z';

function catalogue(): BackupPage {
  return {venueId, points: [{id: pointId, capturedAt: stamp, expiresAt: '2026-11-28T10:00:00.000Z',
    verification: 'verified', retention: 'daily', protection: 'fallback'}],
    nextCursor: 'older_page-1', defaultPointId: pointId,
    continuousRecovery: {recoverableAt: stamp, checkedAt: stamp, sourceNodeId}};
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
  const result = structuredClone(catalogue());
  const keys = path.split('.');
  let parent = result as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[keys.at(-1)!] = value;
  return result;
}

function points(count: number) {
  return Array.from({length: count}, (_, i) => ({...catalogue().points[0]!,
    id: `${String(i + 1).padStart(8, '0')}-1234-4234-8234-123456789abc`}));
}

const invalid = [
  {name: 'top-level reader credentials', path: 'readerCredentials', value: {accessKeyId: 'private-fixture'}},
  {name: 'snapshot decryption key', path: 'points.0.key', value: 'private-fixture'},
  {name: 'continuous-source bucket', path: 'continuousRecovery.bucket', value: 'private-fixture'},
  {name: 'malformed venue ID', path: 'venueId', value: 'venue'},
  {name: 'missing point list', path: 'points', value: null},
  {name: 'non-list points', path: 'points', value: {}},
  {name: 'null point', path: 'points.0', value: null},
  {name: 'array point', path: 'points.0', value: []},
  {name: 'malformed point ID', path: 'points.0.id', value: 'snapshot'},
  {name: 'invalid capture time', path: 'points.0.capturedAt', value: 'yesterday'},
  {name: 'noncanonical capture time', path: 'points.0.capturedAt', value: '2026-10-28T10:00:00Z'},
  {name: 'invalid expiry time', path: 'points.0.expiresAt', value: 'tomorrow'},
  {name: 'unknown verification', path: 'points.0.verification', value: 'uploaded'},
  {name: 'unknown retention', path: 'points.0.retention', value: 'forever'},
  {name: 'unknown protection', path: 'points.0.protection', value: 'locked'},
  {name: 'duplicate snapshot IDs', path: 'points', value: [catalogue().points[0], catalogue().points[0]]},
  {name: '51 distinct snapshots', path: 'points', value: points(51)},
  {name: 'empty cursor', path: 'nextCursor', value: ''},
  {name: 'cursor with path characters', path: 'nextCursor', value: '../private'},
  {name: 'overlong cursor', path: 'nextCursor', value: 'a'.repeat(257)},
  {name: 'numeric cursor', path: 'nextCursor', value: 1},
  {name: 'malformed default point ID', path: 'defaultPointId', value: 'default'},
  {name: 'non-object continuous source', path: 'continuousRecovery', value: 'ready'},
  {name: 'array continuous source', path: 'continuousRecovery', value: []},
  {name: 'invalid recovery time', path: 'continuousRecovery.recoverableAt', value: 'today'},
  {name: 'noncanonical checked time', path: 'continuousRecovery.checkedAt', value: '2026-10-28T10:00:00Z'},
  {name: 'malformed source node ID', path: 'continuousRecovery.sourceNodeId', value: 'source'},
];

for (const entry of invalid) {
  test(`backup HTTP reply rejects ${entry.name} and preserves accepted recovery choices on older-page failure`, async t => {
    browser(t);
    const malformed = replace(entry.path, entry.value);
    let response: unknown = malformed;
    const requests: Array<{url: unknown; init: RequestInit | undefined}> = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      requests.push({url, init});
      return Response.json(response);
    });
    const controller = new BackupController(() => {}, accountRequest);
    controller.account('owner');
    await controller.open(venueId);
    assert.equal(controller.page, undefined, 'invalid HTTP metadata must never become catalogue state');
    assert.equal(controller.selected, undefined);
    assert.equal(controller.selectedSource, undefined);
    assert.equal(controller.error, 'unavailable');
    assert.equal(controller.pending, false);
    assert.equal(controller.waiting, 0);

    response = catalogue();
    await controller.load();
    assert.deepEqual(controller.page, catalogue());
    assert.equal(controller.selectedSource, 'continuous');
    controller.select(pointId);
    assert.equal(controller.selectedSource, 'snapshot');

    response = malformed;
    await controller.load(true);
    assert.deepEqual(controller.page, catalogue(), 'a refused older page must keep the accepted catalogue');
    assert.equal(controller.selected, pointId);
    assert.equal(controller.selectedSource, 'snapshot');
    assert.equal(controller.error, 'unavailable');
    assert.equal(controller.pending, false);
    assert.equal(controller.waiting, 0);

    const older = {...catalogue(), points: [{...catalogue().points[0]!, id: nextPointId}],
      nextCursor: null, defaultPointId: nextPointId};
    response = older;
    await controller.load(true);
    assert.deepEqual(controller.page, older);
    assert.equal(controller.selected, nextPointId);
    assert.equal(controller.selectedSource, 'snapshot');
    assert.equal(controller.error, undefined);
    assert.equal(controller.pending, false);
    assert.equal(requests.length, 4, 'each user action makes one HTTP attempt');
    for (const [index, {url, init}] of requests.entries()) {
      assert.equal(url, '/api/account/backups/list');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.credentials, 'same-origin');
      assert.deepEqual(JSON.parse(String(init?.body)), index < 2 ? {venueId} : {venueId, cursor: 'older_page-1'});
      assert.equal(new Headers(init?.headers).get('X-CSRF-Token'), 'browser-proof');
    }
  });
}

test('a well-formed HTTP catalogue for another venue cannot replace accepted recovery choices', async t => {
  browser(t);
  let response = catalogue();
  const requests: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json(response);
  });
  const controller = new BackupController(() => {}, accountRequest);
  controller.account('owner');
  await controller.open(venueId);
  controller.select(pointId);
  response = {...catalogue(), venueId: sourceNodeId};
  assert.equal((await accountRequest('/backups/list', {venueId})).ok, true,
    'the response is structurally valid; venue binding belongs to the controller');
  await controller.load();
  assert.deepEqual(controller.page, catalogue());
  assert.equal(controller.selected, pointId);
  assert.equal(controller.selectedSource, 'snapshot');
  assert.equal(controller.error, 'unavailable');
  assert.equal(controller.pending, false);
  response = {...catalogue(), nextCursor: null};
  await controller.load();
  assert.deepEqual(controller.page, response);
  assert.equal(controller.error, undefined);
  assert.deepEqual(requests, [{venueId}, {venueId}, {venueId}, {venueId}]);
});

test('50 distinct snapshots and a 256-character cursor remain usable through HTTP pagination', async t => {
  browser(t);
  const offered = points(50);
  let response: BackupPage = {...catalogue(), points: offered,
    nextCursor: 'a'.repeat(256), defaultPointId: offered[49]!.id};
  const requests: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json(response);
  });
  const controller = new BackupController(() => {}, accountRequest);
  controller.account('owner');
  await controller.open(venueId);
  assert.deepEqual(controller.page, response);
  assert.equal(controller.selected, '00000050-1234-4234-8234-123456789abc');
  assert.equal(controller.selectedSource, 'continuous');
  response = {venueId, points: [], nextCursor: null, defaultPointId: null, continuousRecovery: null};
  await controller.load(true);
  assert.deepEqual(controller.page, response);
  assert.equal(controller.selected, undefined);
  assert.equal(controller.selectedSource, undefined);
  assert.equal(controller.error, undefined);
  assert.deepEqual(requests, [{venueId}, {venueId, cursor: 'a'.repeat(256)}]);
});

for (const [verification, protection] of [['pending', null], ['failed', 'recovery']] as const) {
  test(`HTTP catalogue retains public ${verification} monthly metadata with ${protection ?? 'no'} protection`, async t => {
    browser(t);
    const response: BackupPage = {...catalogue(), continuousRecovery: null, nextCursor: null,
      points: [{...catalogue().points[0]!, verification, retention: 'monthly', protection}]};
    t.mock.method(globalThis, 'fetch', async () => Response.json(response));
    const controller = new BackupController(() => {}, accountRequest);
    controller.account('owner');
    await controller.open(venueId);
    assert.deepEqual(controller.page, response);
    assert.equal(controller.selected, pointId);
    assert.equal(controller.selectedSource, 'snapshot');
    assert.equal(controller.error, undefined);
    assert.equal(controller.pending, false);
  });
}
