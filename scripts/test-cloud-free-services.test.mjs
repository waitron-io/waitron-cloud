import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';

const api = await import('./test-cloud-free-services.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const suiteIds = ['account-mail', 'relay-plans', 'translation-plans', 'relay-guards', 'translation-guards', 'http-guards', 'deployment-gates'];
function receipt() {
  return {version: 1, kind: 'test-cloud-free-services', cloudHead: 'a'.repeat(40), cloudTree: 'b'.repeat(40),
    scope: 'local-fixtures', relay: 'local-proof', translation: 'fake-loopback', deployedTranslation: 'off',
    waitronRelay: 'not-qualified', waitronTranslation: 'not-qualified',
    suites: suiteIds.map(id => ({id, tests: 3, passed: 3, failed: 0, cancelled: 0, skipped: 0, todo: 0}))};
}
test('free-service receipt accepts only complete local fixture evidence', () => {
  assert.equal(typeof api.validateFreeServiceReceipt, 'function', 'free-service receipt validator is missing');
  assert.equal(api.validateFreeServiceReceipt(receipt()), true);
});
test('missing, duplicate, failing, skipped and empty suites cannot certify the matrix', () => {
  assert.equal(typeof api.validateFreeServiceReceipt, 'function');
  const changes = [r => r.suites.pop(), r => r.suites.push(r.suites[0]), r => r.suites[0].id = 'foreign',
    r => r.suites[0].failed = 1, r => r.suites[0].skipped = 1, r => r.suites[0].cancelled = 1,
    r => r.suites[0].todo = 1, r => r.suites[0].tests = 0, r => r.suites[0].passed = 2,
    r => r.suites[0].tests = 3.5, r => r.suites[0].passed = '3'];
  for (const change of changes) {const r = receipt(); change(r); assert.throws(() => api.validateFreeServiceReceipt(r));}
});
test('receipt refuses live-service claims, private fields and unbound revisions', () => {
  assert.equal(typeof api.validateFreeServiceReceipt, 'function');
  for (const change of [r => r.translation = 'live', r => r.relay = 'live', r => r.deployedTranslation = 'on',
    r => r.waitronRelay = 'proved', r => r.waitronTranslation = 'proved', r => r.scope = 'box',
    r => r.cloudHead = '', r => r.cloudTree = 'unknown', r => r.token = 'private', r => r.suites[0].email = 'private']) {
    const r = receipt(); change(r); assert.throws(() => api.validateFreeServiceReceipt(r));
  }
});
test('suite summaries require a final passing runner result and reject hidden stdout', async () => {
  assert.equal(typeof api.summariseTestRun, 'function', 'bounded test-event summary is missing');
  const summary = {type: 'test:summary', data: {success: true, counts: {tests: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0, todo: 0}}};
  async function* events(values) {yield* values;}
  assert.deepEqual(await api.summariseTestRun(events([summary])), {tests: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0, todo: 0});
  assert.deepEqual(await api.summariseTestRun(events([{...summary, data: {...summary.data, file: '/a.test.mjs'}}, summary]), ['/a.test.mjs']), {tests: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0, todo: 0});
  for (const values of [[], [{...summary, data: {...summary.data, success: false}}], [summary, summary],
    [{type: 'test:stderr', data: {message: 'private'}}, summary], [{type: 'test:stdout', data: {message: 'private'}}, summary]]) {
    await assert.rejects(api.summariseTestRun(events(values)));
  }
});
test('a file wrapper cannot replace missing or empty test execution', async () => {
  const summary = {type: 'test:summary', data: {success: true, counts: {tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0}}};
  async function* events(values) {yield* values;}
  await assert.rejects(api.summariseTestRun(events([summary]), ['/missing.test.mjs']));
  await assert.rejects(api.summariseTestRun(events([{...summary, data: {...summary.data, file: '/other.test.mjs'}}, summary]), ['/expected.test.mjs']));
  await assert.rejects(api.summariseTestRun(events([{...summary, data: {...summary.data, file: '/empty.test.mjs', counts: {...summary.data.counts, tests: 0, passed: 0}}}, summary]), ['/empty.test.mjs']));
});
test('CLI rejects unknown arguments without echoing private input', () => {
  const result = spawnSync(process.execPath, ['scripts/test-cloud-free-services.mjs', '--token=private-value'], {encoding: 'utf8'});
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Free-service proof failed\n');
});
test('inherited Node test filters cannot certify a partial suite', () => {
  const env = {...process.env, NODE_OPTIONS: '--test-skip-pattern=remote'};
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['scripts/test-cloud-free-services.mjs', '--suite', 'deployment-gates'], {encoding: 'utf8', env});
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Free-service proof failed\n');
});
