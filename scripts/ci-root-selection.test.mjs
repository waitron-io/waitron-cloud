import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, globSync, readFileSync, readdirSync, rmSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {rootSelectionFixture} from './fixtures/ci-selection.mjs';

for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
const api = await import('./ci-root-selection.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const omitted = ['indirect', 'directories', 'arrays', 'expression-unicode', 'computed',
  'unicode', 'middle-unicode', 'first-unicode', 'bracket-receivers']
  .map(name => `scripts/ci-package-revisions-${name}.test.mjs`);
const retained = ['ci-package-revisions.test.mjs', 'ci-package-revisions-new.test.mjs',
  'ci-a.test.mjs', 'ci-a-new.test.mjs', 'ci-root-shards.test.mjs',
  'identity-upstream.test.mjs', 'verify-gateway-reconnection-receipt.test.mjs',
  'billing-display-guard-probes.test.mjs', 'venue-service-guard-probes.test.mjs']
  .map(name => `scripts/${name}`);
const workflowPatterns = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  .match(/node --test[^\n]*--test-shard=\$\{\{ matrix.shard \}\}\/8 ([^\n]+)/)?.[1].trim().split(/\s+/);

function fixture(run) {
  assert.equal(typeof api.selectRootFiles, 'function', 'Root advice must select files without changing the plan');
  rootSelectionFixture(context => {
    const {write, commit} = context;
    for (const path of [...omitted, ...retained]) write(path,
      `import test from 'node:test'; test(${JSON.stringify(path)}, () => {});\n`);
    write('packages/control/package.json', {name: 'control', scripts: {test: 'node --test test/*.test.mjs'}});
    write('packages/control/src/index.mjs', 'export const value = 1;\n');
    const base = commit();
    write('packages/control/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    run({...context, base, head, mode: 'selected', eventName: 'pull_request', forceFull: 'false'});
  });
}

test('eligible advice omits only the nine synthetic suites and keeps live and future readers', () => fixture(context => {
  const files = Array.from({length: 8}, (_, index) => api.selectRootFiles(index + 1, context)).flat();
  assert.deepEqual(files.sort(), [...retained].sort());
  context.write('docs/explanation.md', '# Updated explanation\n');
  context.head = context.commit();
  assert.deepEqual(Array.from({length: 8}, (_, i) => api.selectRootFiles(i + 1, context)).flat().sort(), [...retained].sort());
}));

test('advice preserves real Node partitions before omissions, including hyphen/dot order and four explicit files', () => fixture(context => {
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  for (let shard = 1; shard <= 8; shard++) {
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-shard=${shard}/8`,
      ...workflowPatterns], {cwd: context.root, env, encoding: 'utf8', timeout: 10_000});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const original = [...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]);
    assert.deepEqual(api.selectRootFiles(shard, context), original.filter(path => !omitted.includes(path)));
  }
}));

test('advice retains every actual workflow input beyond the nine audited files', () => fixture(context => {
  const expected = [...globSync(workflowPatterns, {cwd: new URL('../', import.meta.url)})].sort();
  for (const path of [...retained, ...omitted]) if (!expected.includes(path)) context.git('rm', path);
  for (const path of expected) context.write(path, 'export {};\n');
  context.base = context.commit();
  context.write('packages/control/src/index.mjs', 'export const value = 3;\n');
  context.head = context.commit();
  const actual = Array.from({length: 8}, (_, i) => api.selectRootFiles(i + 1, context)).flat();
  assert.deepEqual(actual.sort(), expected.filter(path => !omitted.includes(path)));
}));

test('full, main, missing and unknown planner contexts retain the original command', () => fixture(context => {
  for (const override of [{mode: 'full'}, {mode: 'reused'}, {mode: undefined}, {eventName: 'push'},
    {eventName: 'workflow_call'}, {forceFull: 'true'}, {forceFull: undefined}, {base: context.head},
    {git: () => {throw Error('history unavailable');}}]) {
    assert.throws(() => api.selectRootFiles(1, {...context, ...override}));
  }
  for (const shard of [0, 9, NaN]) assert.throws(() => api.selectRootFiles(shard, context));
}));

test('shared inputs, new packages, consumed prose and nonregular changes retain full work', () => fixture(context => {
  for (const path of ['packages/control/package.json', 'packages/control/README.md',
    'packages/new/src/index.mjs', 'packages/control/migrations/001.sql', 'scripts/helper.mjs',
    'docs/waitron-integration-contract.md', 'packages/control/src/.gitattributes']) {
    context.git('reset', '--hard', context.head);
    context.write(path, 'changed\n');
    assert.throws(() => api.selectRootFiles(1, {...context, head: context.commit()}), path);
  }
  context.git('reset', '--hard', context.head);
  rmSync(join(context.root, 'packages/control/src/index.mjs'));
  symlinkSync('../../../docs/explanation.md', join(context.root, 'packages/control/src/index.mjs'));
  assert.throws(() => api.selectRootFiles(1, {...context, head: context.commit()}));
}));

test('uncertain filesystem inventories never return partial advice', () => fixture(context => {
  context.write('scripts/ci-untracked.test.mjs', 'export {};\n');
  assert.throws(() => api.selectRootFiles(1, context));
  rmSync(join(context.root, 'scripts/ci-untracked.test.mjs'));
  rmSync(join(context.root, retained.at(-1)));
  assert.throws(() => api.selectRootFiles(1, context));
}));

test('the workflow passes the full and planner decisions to root advice', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const root = workflow.match(/^  root:\n([\s\S]*?)(?=^  [\w-]+:)/m)?.[1] ?? '';
  assert.match(root, /CI_FORCE_FULL: \$\{\{ inputs.full \}\}/);
  assert.match(root, /CI_MODE: \$\{\{ needs.changes.outputs.mode \}\}/);
});

function commandFixture(context) {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const rootJob = workflow.match(/^  root:\n([\s\S]*?)(?=^  [\w-]+:)/m)?.[1] ?? '';
  const command = rootJob.match(/- name: Run root checks[\s\S]*?        run: \|\n((?:          .*\n)+)/)?.[1].replace(/^          /gm, '');
  assert.ok(command, 'Execute the real workflow command');
  for (const name of readdirSync(new URL('./', import.meta.url))) {
    if (name.endsWith('.mjs') && !name.endsWith('.test.mjs') && !existsSync(join(context.root, 'scripts', name)))
      cpSync(new URL(name, import.meta.url), join(context.root, 'scripts', name));
  }
  context.write('event.json', {pull_request: {base: {sha: context.base}, head: {sha: context.head}}});
  const env = {...process.env, CI_FORCE_FULL: 'false', CI_MODE: 'selected', GITHUB_EVENT_NAME: 'pull_request',
    CI_HEAD_SHA: context.head, GITHUB_EVENT_PATH: join(context.root, 'event.json')};
  delete env.NODE_TEST_CONTEXT;
  return (shard, override = {}) => spawnSync('bash', ['-e', '-c', command.replaceAll('${{ matrix.shard }}', String(shard))],
    {cwd: context.root, env: {...env, ...override}, encoding: 'utf8', timeout: 15_000});
}
const executed = result => [...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]);

test('mixed advisory and fallback jobs execute all retained checks exactly once', () => fixture(context => {
  const run = commandFixture(context), seen = [];
  for (let shard = 1; shard <= 8; shard++) {
    const result = run(shard, shard === 1 ? {CI_MODE: 'full'} : {});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    if (shard !== 1) assert.match(result.stderr, /Root advice omits:/);
    seen.push(...executed(result));
  }
  const original = [...omitted, ...retained].sort();
  assert.deepEqual(seen.sort(), [...retained, ...original.filter((path, i) => i % 8 === 0 && omitted.includes(path))].sort());
  for (const override of [{CI_FORCE_FULL: 'true'}, {CI_MODE: ''}, {GITHUB_EVENT_PATH: join(context.root, 'missing-event.json')}]) {
    const result = run(2, override);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(executed(result), original.filter((_, i) => i % 8 === 1));
  }
  rmSync(join(context.root, 'scripts/ci-input-audit.mjs'));
  const failedLoad = run(2);
  assert.equal(failedLoad.status, 0, failedLoad.stdout + failedLoad.stderr);
  assert.deepEqual(executed(failedLoad), original.filter((_, i) => i % 8 === 1));
}));

test('a retained test failure propagates without retrying the original full command', () => fixture(context => {
  const path = 'scripts/ci-package-revisions.test.mjs';
  context.write(path, `import test from 'node:test'; test(${JSON.stringify(path)}, () => {throw Error('retained check failed');});\n`);
  context.base = context.commit();
  context.write('packages/control/src/index.mjs', 'export const value = 3;\n');
  context.head = context.commit();
  const run = commandFixture(context);
  const shard = [...omitted, ...retained].sort().indexOf(path) % 8 + 1;
  const result = run(shard);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /retained check failed/);
  assert.equal([...result.stdout.matchAll(/^not ok \d+ - scripts\/ci-package-revisions\.test\.mjs$/gm)].length, 1);
  assert.ok(executed(result).every(file => !omitted.includes(file)));
}));

test('an empty advised partition succeeds without discovering unrelated tests', () => fixture(context => {
  for (const path of retained.filter(path => path.startsWith('scripts/ci-'))) context.git('rm', path);
  context.base = context.commit();
  context.write('packages/control/src/index.mjs', 'export const value = 3;\n');
  context.head = context.commit();
  const run = commandFixture(context);
  const original = [...omitted, ...retained.slice(-4)].sort();
  const shard = Array.from({length: 8}, (_, i) => i + 1).find(i => original.filter((_, j) => j % 8 === i - 1).every(path => omitted.includes(path)));
  assert.ok(shard);
  context.write('unrelated.test.mjs', "throw Error('default discovery must not run');\n");
  const result = run(shard);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Root partition has no retained files/);
  assert.deepEqual(executed(result), []);
}));
