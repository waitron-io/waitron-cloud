import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadWorkspace, workPlan} from './ci-scope.mjs';
import {assertSummary} from './ci-summary.mjs';

test('summary requires all three backup jobs and refuses the previous two-job allocation', () => {
  const results = {changes: 'success', typecheck: 'success', root: 'success', packages: 'success', receipts: 'skipped'};
  const rows = [1, 2, 3].map(shard => ({package: '@waitron-cloud/backups', shard, shards: 3}));
  const summarize = packages => assertSummary({packages, receipts: [], typecheck: true}, results,
    ['changes', 'typecheck', 'root (1/4)', 'root (2/4)', 'root (3/4)', 'root (4/4)',
      ...packages.map(row => `package (${row.package}, shard ${row.shard}/${row.shards})`)]
      .map(name => ({name, status: 'completed', conclusion: 'success'})));
  assert.doesNotThrow(() => summarize(rows));
  for (const omitted of rows) assert.throws(() => summarize(rows.filter(row => row !== omitted)), /Incomplete package allocation/);
  assert.throws(() => summarize(rows.slice(0, 2).map(row => ({...row, shards: 2}))), /Invalid package allocation/);
});

test('backup partitions execute every current and future file once while dividing the expensive guard files', t => {
  // Losing a shard or reverting the allocation must expose missing or concentrated work.
  const rows = workPlan({full: false, packages: ['@waitron-cloud/backups']}, loadWorkspace()).packages;
  const files = readdirSync(new URL('../packages/backups/test/', import.meta.url))
    .filter(name => name.endsWith('.test.ts')).concat('zz-future-backup.test.ts').sort();
  const expensive = new Set(['venue-service-capture-guards.test.ts',
    'venue-service-catalogue-guards.test.ts', 'venue-service-stream-guards.test.ts']);
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
      assert.ok(selected.length <= Math.ceil(files.length / 3), `Oversized backup partition ${row.shard}`);
      assert.ok(selected.filter(name => expensive.has(name)).length <= 2,
        'The three expensive guard files must not share one job');
      t.diagnostic(JSON.stringify({shard: row.shard, files: selected.length,
        expensive: selected.filter(name => expensive.has(name))}));
      for (const kind of ['fail', 'cancelled', 'skipped']) assert.match(output, new RegExp(`^# ${kind} 0$`, 'm'));
      seen.push(...selected);
    }
    assert.equal(rows.length, 3);
    assert.deepEqual(seen.sort(), files);
  } finally {rmSync(root, {recursive: true, force: true});}
});
