import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadWorkspace, workPlan} from './ci-scope.mjs';

test('six portal partitions discover current and future files exactly once without overlapping fixtures', () => {
  const workspace = loadWorkspace();
  const rows = workPlan({full: false, packages: ['@waitron-cloud/portal']}, workspace).packages;
  assert.equal(rows.length, 6);
  const files = readdirSync(new URL('../apps/portal/test/', import.meta.url))
    .filter(name => name.endsWith('.test.ts')).concat('zz-future-portal.test.ts').sort();
  assert.equal(new Set(files).size, files.length);
  const root = mkdtempSync(join(tmpdir(), 'cloud-portal-shards-'));
  try {
    for (const name of files) writeFileSync(join(root, name), `import test from 'node:test';
import {mkdirSync, rmdirSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
test(${JSON.stringify(name)}, async () => {
  mkdirSync('active-discovery');
  try {await delay(5);} finally {rmdirSync('active-discovery');}
});
`);
    const seen = [];
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    for (const row of rows) {
      const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1',
        '--test-timeout=120000', `--test-shard=${row.shard}/${row.shards}`, '*.test.ts'],
        {cwd: root, env, encoding: 'utf8', timeout: 30_000});
      const selected = [...output.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]);
      assert.ok(selected.length > 0, `Empty portal shard ${row.shard}`);
      assert.ok(selected.length <= Math.ceil(files.length / 6), `Oversized portal shard ${row.shard}`);
      for (const kind of ['fail', 'cancelled', 'skipped']) assert.match(output, new RegExp(`^# ${kind} 0$`, 'm'));
      seen.push(...selected);
    }
    assert.deepEqual(seen.sort(), files);
  } finally {rmSync(root, {recursive: true, force: true});}
});
