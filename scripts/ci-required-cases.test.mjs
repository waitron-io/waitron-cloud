import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

// Removing the reporter's successful-case check must let the missing-case control pass.
async function fixture(t, body, args = []) {
  const api = await import('./ci-required-cases.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof api.createRequiredCaseReporter, 'function', 'required cases need an executing reporter');
  const root = mkdtempSync(join(tmpdir(), 'cloud-required-cases-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, 'behavior.test.mjs'), `import test from 'node:test'; ${body}\n`);
  writeFileSync(join(root, 'reporter.mjs'), `import {createRequiredCaseReporter} from ${JSON.stringify(new URL('./ci-required-cases.mjs', import.meta.url).href)};
export default createRequiredCaseReporter({'behavior.test.mjs': ['^lease expiry refuses access$']}, {root:${JSON.stringify(root)}});\n`);
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout',
    '--test-reporter=./reporter.mjs', '--test-reporter-destination=stdout', ...args, 'behavior.test.mjs'],
    {cwd: root, env, encoding: 'utf8', timeout: 10000});
}

test('required cases accept the actual passing assertion alongside unrelated optional skips', async t => {
  const result = await fixture(t, "test('lease expiry refuses access',()=>{});test.skip('optional platform check',()=>{});");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Required cases: 1 passed/);
});
for (const [label, body, args] of [
  ['missing', "test('another refusal',()=>{});", []],
  ['empty file', '', []],
  ['selection matching no cases', "test('lease expiry refuses access',()=>{});", ['--test-name-pattern=absent']],
  ['skipped', "test.skip('lease expiry refuses access',()=>{});", []],
  ['todo', "test.todo('lease expiry refuses access');", []],
  ['failed', "test('lease expiry refuses access',()=>{throw Error('real refusal failed');});", []],
  ['duplicate', "test('lease expiry refuses access',()=>{});test('lease expiry refuses access',()=>{});", []],
]) test(`required cases refuse ${label} behavior`, async t => {
  const result = await fixture(t, body, args);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /Required case did not pass exactly once/);
});

test('programmatic proof streams refuse a required case that was not executed', async t => {
  const api = await import('./ci-required-cases.mjs');
  assert.equal(typeof api.requiredCaseEvents, 'function', 'proof streams need the same execution check');
  const root = mkdtempSync(join(tmpdir(), 'cloud-required-stream-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const file = join(root, 'behavior.test.mjs'); writeFileSync(file, '');
  async function* events() {yield {type: 'test:summary', data: {file, counts: {tests: 0}}};}
  await assert.rejects(async () => {
    for await (const event of api.requiredCaseEvents(events(), {requirements: {'behavior.test.mjs': ['^lease expiry refuses access$']}, root})) void event;
  }, /Required case did not pass exactly once/);
});
