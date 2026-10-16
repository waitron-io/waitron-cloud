import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as summary from './ci-summary.mjs';
import {loadWorkspace, workPlan} from './ci-scope.mjs';

const {assertSummary} = summary;
const results = {changes: 'success', typecheck: 'success', packages: 'success', receipts: 'skipped'};
const partitions = [['registration', 6], ['account-http', 3], ['backups', 2], ['portal', 3]];
const rowsFor = (name, count) => Array.from({length: count}, (_, i) => ({package: `@waitron-cloud/${name}`, shard: i + 1, shards: count}));

test('summary policy contains exactly the real workspace packages, including no obsolete names', () => {
  assert.deepEqual(Object.keys(summary.packageShards ?? {}).sort(), loadWorkspace().map(pkg => pkg.name).sort());
});

function summarize(packages) {
  const jobs = ['changes', 'typecheck', ...packages.map(row => `package (${row.package}${row.shards ? `, shard ${row.shard}/${row.shards}` : ''})`)]
    .map(name => ({name, status: 'completed', conclusion: 'success'}));
  return assertSummary({packages, receipts: [], typecheck: true}, results, jobs);
}

test('summary accepts every real planner package allocation and the complete grouped plan', () => {
  const workspace = loadWorkspace();
  for (const pkg of workspace) {
    assert.doesNotThrow(() => summarize(workPlan({full: false, packages: [pkg.name]}, workspace).packages));
  }
  assert.doesNotThrow(() => summarize(workPlan({full: true, packages: workspace.map(pkg => pkg.name)}, workspace).packages));
});

test('summary refuses every omitted shard even when all remaining planned jobs pass', () => {
  for (const [name, count] of partitions) {
    const rows = rowsFor(name, count);
    assert.doesNotThrow(() => summarize(rows));
    assert.doesNotThrow(() => summarize([...rows].reverse()));
    for (let omitted = 0; omitted < count; omitted++) {
      assert.throws(() => summarize(rows.filter((_, i) => i !== omitted)), /Incomplete package allocation/, `${name}: omitted shard ${omitted + 1}`);
    }
  }
});

test('summary refuses self-consistent plans that change the registered partition count', () => {
  for (const [name, count] of partitions) {
    for (const declared of new Set([1, count - 1, count + 1, ...(name === 'registration' ? [4, 5, 7, 8] : [])])) {
      assert.throws(() => summarize(rowsFor(name, declared)), /Invalid package allocation/, `${name}: declared ${declared}`);
    }
    assert.throws(() => summarize([{package: `@waitron-cloud/${name}`, shard: 1}]), /Invalid package allocation/);
  }
  assert.throws(() => summarize(rowsFor('identity', 2)), /Invalid package allocation/);
});

test('summary refuses malformed rows before matching their successful job names', () => {
  const regular = {package: '@waitron-cloud/identity', shard: 1};
  assert.doesNotThrow(() => summarize([regular]));
  assert.doesNotThrow(() => summarize([{package: '@waitron-cloud/ui-smoke', shard: 1}]));
  for (const invalid of [
    {...regular, package: '@waitron-cloud/unknown'},
    {package: regular.package},
    {...regular, shard: 0}, {...regular, shard: 2}, {...regular, shard: '1'},
    {...regular, shards: 0}, {...regular, shards: null}, {...regular, shards: false},
    {...regular, command: 'proof:local-stack'},
    ...[0, 4, 1.5, '1', null, true].map(shard => ({package: '@waitron-cloud/portal', shard, shards: 3})),
  ]) assert.throws(() => summarize([invalid]), /Invalid package allocation/);
});

test('summary refuses inconsistent shard denominators and mixed valid package allocations', () => {
  const rows = rowsFor('portal', 3);
  assert.throws(() => summarize([rows[0], {...rows[1], shards: 2}, rows[2]]), /Invalid package allocation/);
  assert.throws(() => summarize([{package: '@waitron-cloud/identity', shard: 1}, ...rows.slice(1)]), /Incomplete package allocation/);
});

test('registration shards discover every current file and a future file exactly once through Node', () => {
  const workspace = loadWorkspace();
  const rows = workPlan({full: false, packages: ['@waitron-cloud/registration']}, workspace).packages;
  assert.equal(rows.length, 6);
  const files = readdirSync(new URL('../packages/registration/test/', import.meta.url))
    .filter(name => name.endsWith('.test.ts')).concat('zz-future-registration.test.ts').sort();
  assert.equal(new Set(files).size, files.length);
  const root = mkdtempSync(join(tmpdir(), 'cloud-registration-shards-'));
  try {
    for (const name of files) writeFileSync(join(root, name),
      `import test from 'node:test';
import {mkdirSync, rmdirSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
test(${JSON.stringify(name)}, async () => {
  mkdirSync('active-discovery');
  try {await delay(50);} finally {rmdirSync('active-discovery');}
});
`);
    const seen = [];
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    for (const row of rows) {
      const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', '--test-timeout=30000',
        `--test-shard=${row.shard}/${row.shards}`, '*.test.ts'], {cwd: root, env, encoding: 'utf8', timeout: 30_000});
      const selected = [...output.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]);
      assert.ok(selected.length > 0, `Empty registration shard ${row.shard}`);
      assert.match(output, /^# fail 0$/m);
      assert.match(output, /^# cancelled 0$/m);
      assert.match(output, /^# skipped 0$/m);
      seen.push(...selected);
    }
    assert.deepEqual(seen.sort(), files);
  } finally {rmSync(root, {recursive: true, force: true});}
});
