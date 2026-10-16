import assert from 'node:assert/strict';
import test from 'node:test';
import * as summary from './ci-summary.mjs';
import {loadWorkspace, workPlan} from './ci-scope.mjs';

const {assertSummary} = summary;
const results = {changes: 'success', typecheck: 'success', packages: 'success', receipts: 'skipped'};
const partitions = [['registration', 7], ['account-http', 3], ['backups', 2], ['portal', 3]];
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
    for (const declared of [1, count - 1, count + 1]) {
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
