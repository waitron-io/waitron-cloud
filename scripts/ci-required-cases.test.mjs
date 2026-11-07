import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

// Removing the reporter's successful-case check must let the missing-case control pass.
async function fixture(t, body, args = [], options = {}) {
  const api = await import('./ci-required-cases.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof api.createRequiredCaseReporter, 'function', 'required cases need an executing reporter');
  const root = mkdtempSync(join(tmpdir(), 'cloud-required-cases-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const directory of options.directories ?? []) mkdirSync(join(root, directory), {recursive: true});
  for (const [file, content] of Object.entries(options.extraFiles ?? {})) writeFileSync(join(root, file), `import test from 'node:test'; ${content}\n`);
  const requirements = options.requirements ?? {'behavior.test.mjs': ['^lease expiry refuses access$']};
  writeFileSync(join(root, 'behavior.test.mjs'), `import test from 'node:test'; ${body}\n`);
  writeFileSync(join(root, 'reporter.mjs'), `import {createRequiredCaseReporter} from ${JSON.stringify(new URL('./ci-required-cases.mjs', import.meta.url).href)};
export default createRequiredCaseReporter(${JSON.stringify(requirements)}, {root:${JSON.stringify(root)}});\n`);
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout',
    '--test-reporter=./reporter.mjs', '--test-reporter-destination=stdout', ...args, ...(options.selectedFiles ?? ['behavior.test.mjs'])],
    {cwd: root, env, encoding: 'utf8', timeout: 10000});
  return {...result, markerExists: existsSync(join(root, 'marker'))};
}

test('required cases accept a real passing test alongside unrelated optional skips', async t => {
  const result = await fixture(t, "test('lease expiry refuses access',()=>{});test.skip('optional platform check',()=>{});");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Required cases: 1 passed/);
});
for (const [label, body, args] of [
  ['missing', "test('another refusal',()=>{});", []],
  ['empty file', '', []],
  ['selection matching no cases', "test('lease expiry refuses access',()=>{});", ['--test-name-pattern=absent']],
  ['shard selecting no files', "test('lease expiry refuses access',()=>{});", ['--test-shard=2/2']],
  ['skipped', "test.skip('lease expiry refuses access',()=>{});", []],
  ['todo', "test.todo('lease expiry refuses access');", []],
  ['runtime skip with an empty reason', "test('lease expiry refuses access',t=>t.skip(''));", []],
  ['runtime todo with an empty reason', "test('lease expiry refuses access',t=>t.todo(''));", []],
  ['expected failure', "test('lease expiry refuses access',{expectFailure:true},()=>{throw Error('expected failure');});", []],
  ['suite name', "const {describe}=await import('node:test');describe('lease expiry refuses access',()=>{test('another case',()=>{});});", []],
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

test('required cases allow unrelated test definitions from memory', async t => {
  const result = await fixture(t, `test('lease expiry refuses access',()=>{});
globalThis.testFromMemory=test;
(await import('node:vm')).runInThisContext("testFromMemory('unrelated memory behavior',()=>{});", {filename:'memory-only-case.mjs'});`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Required cases: 1 passed/);
});

test('required cases accept ordinary false skip todo and expected-failure options', async t => {
  const result = await fixture(t, "test('lease expiry refuses access',{skip:false,todo:false,expectFailure:false},()=>{});");
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('a shard does not demand cases assigned to another shard', async t => {
  const result = await fixture(t, '', ['--test-shard=1/2'], {
    extraFiles: {'a.test.mjs': "test('first case',()=>{});", 'b.test.mjs': "test('second case',()=>{});"},
    requirements: {'a.test.mjs': ['^first case$'], 'b.test.mjs': ['^second case$']},
    selectedFiles: ['a.test.mjs', 'b.test.mjs'],
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Required cases: 1 passed/);
});

for (const [label, patterns] of [['empty', []], ['duplicate', ['^lease expiry refuses access$', '^lease expiry refuses access$']]]) {
  test(`invalid ${label} required cases refuse before executing tests`, async t => {
    const result = await fixture(t, "test('lease expiry refuses access',async()=>{(await import('node:fs')).writeFileSync('marker','ran');});", [],
      {requirements: {'behavior.test.mjs': patterns}});
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Invalid required cases/);
    assert.equal(result.markerExists, false);
  });
}

for (const [label, options] of [
  ['missing file', {requirements: {'absent.test.mjs': ['^lease expiry refuses access$']}}],
  ['directory', {requirements: {'not-a-file': ['^lease expiry refuses access$']}, directories: ['not-a-file']}],
]) test(`required source ${label} refuses before executing tests`, async t => {
  const result = await fixture(t, "test('lease expiry refuses access',async()=>{(await import('node:fs')).writeFileSync('marker','ran');});", [], options);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, label === 'missing file'
    ? /Required test file is missing: absent\.test\.mjs/ : /Required test file is not regular: not-a-file/);
  assert.equal(result.markerExists, false);
});

test('programmatic proof streams reject a reflected expected failure', t => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-required-expected-failure-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const file = join(root, 'behavior.test.mjs');
  writeFileSync(file, "import test from 'node:test';test('controlled',{expectFailure:true},()=>{throw Error('controlled');});\n");
  writeFileSync(join(root, 'driver.mjs'), `import {run} from 'node:test';
import {requiredCaseEvents} from ${JSON.stringify(new URL('./ci-required-cases.mjs', import.meta.url).href)};
try {
  for await (const event of requiredCaseEvents(run({files:[${JSON.stringify(file)}],execArgv:[]}),
    {root:${JSON.stringify(root)},requirements:{'behavior.test.mjs':['^controlled$']}})) void event;
  process.stdout.write('PROOF_ACCEPTED\\n');
} catch (error) {process.stderr.write(error.message);process.exitCode=1;}
`);
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['driver.mjs'], {cwd: root, env, encoding: 'utf8', timeout: 10000});
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Required case did not pass exactly once/);
});
