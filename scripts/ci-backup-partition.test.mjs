import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadWorkspace, workPlan} from './ci-scope.mjs';
import {assertSummary} from './ci-summary.mjs';

test('summary requires all seven backup jobs and refuses previous allocations', () => {
  const results = {changes: 'success', typecheck: 'success', root: 'success', packages: 'success', receipts: 'skipped'};
  const rows = [1, 2, 3, 4, 5, 6, 7].map(shard => ({package: '@waitron-cloud/backups', shard, shards: 7}));
  const summarize = packages => assertSummary({packages, receipts: [], typecheck: true}, results,
    ['changes', 'typecheck', 'root (1/8)', 'root (2/8)', 'root (3/8)', 'root (4/8)', 'root (5/8)', 'root (6/8)', 'root (7/8)', 'root (8/8)',
      ...packages.map(row => `package (${row.package}, shard ${row.shard}/${row.shards})`)]
      .map(name => ({name, status: 'completed', conclusion: 'success'})));
  assert.doesNotThrow(() => summarize(rows));
  for (const omitted of rows) assert.throws(() => summarize(rows.filter(row => row !== omitted)), /Incomplete package allocation/);
  for (const shards of [2, 3]) {
    assert.throws(() => summarize(rows.slice(0, shards).map(row => ({...row, shards}))), /Invalid package allocation/);
  }
});

test('backup partitions execute every current and future file once while dividing the expensive guard files', t => {
  // Losing a shard or reverting the allocation must expose missing or concentrated work.
  const rows = workPlan({full: false, packages: ['@waitron-cloud/backups']}, loadWorkspace()).packages;
  const files = readdirSync(new URL('../packages/backups/test/', import.meta.url))
    .filter(name => name.endsWith('.test.ts')).concat('zz-future-backup.test.ts').sort();
  const expensive = new Set(['venue-service-capture-guards.test.ts',
    'venue-service-catalogue-guards.test.ts', 'venue-service-stream-guards.test.ts',
    'venue-service-storage-guards.test.ts', 'venue-service-replacement-guards.test.ts']);
  const root = mkdtempSync(join(tmpdir(), 'cloud-backup-shards-'));
  try {
    for (const name of files) writeFileSync(join(root, name),
      `import test from 'node:test'; test(${JSON.stringify(name)}, () => {});\n`);
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const seen = [];
    for (const row of rows) {
      const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap',
        '--test-timeout=30000', `--test-shard=${row.shard}/${row.shards}`, '*.test.ts'],
      {cwd: root, env, encoding: 'utf8', timeout: 30_000});
      const selected = [...output.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]);
      assert.ok(selected.length > 0, `Empty backup partition ${row.shard}`);
      assert.ok(selected.length <= Math.ceil(files.length / 7), `Oversized backup partition ${row.shard}`);
      assert.ok(selected.filter(name => expensive.has(name)).length <= 1,
        'Each expensive guard file must have its own job');
      if (selected.includes('venue-service-capture-guards.test.ts')) {
        assert.deepEqual(selected.filter(name => expensive.has(name)), ['venue-service-capture-guards.test.ts'],
          'Capture guards must stay separate from catalogue and stream guards');
      }
      t.diagnostic(JSON.stringify({shard: row.shard, files: selected.length,
        expensive: selected.filter(name => expensive.has(name))}));
      for (const kind of ['fail', 'cancelled', 'skipped']) assert.match(output, new RegExp(`^# ${kind} 0$`, 'm'));
      seen.push(...selected);
    }
    assert.equal(rows.length, 7);
    assert.deepEqual(seen.sort(), files);
  } finally {rmSync(root, {recursive: true, force: true});}
});
