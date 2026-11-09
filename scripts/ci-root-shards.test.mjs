import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {assertSummary} from './ci-summary.mjs';
import {reuseProof} from './fixtures/ci-evidence.mjs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const rootJob = workflow.match(/^  root:\n([\s\S]*?)(?=^  [\w-]+:)/m)?.[1] ?? '';
const plan = {packages: [{package: '@waitron-cloud/operations', shard: 1}], receipts: [], typecheck: true};
const results = {changes: 'success', root: 'success', typecheck: 'success', packages: 'success', receipts: 'skipped'};
const jobs = ['changes', 'typecheck', 'package (@waitron-cloud/operations)',
  'root (1/8)', 'root (2/8)', 'root (3/8)', 'root (4/8)', 'root (5/8)', 'root (6/8)', 'root (7/8)', 'root (8/8)']
  .map(name => ({name, status: 'completed', conclusion: 'success'}));

test('workflow root partitions execute every discovered check once and propagate failures', () => {
  // Dropping a selector or a partition loses a file; swallowing a child failure hides a broken check.
  const command = rootJob.match(/- name: Run root checks[\s\S]*?        run: \|\n((?:          .*\n)+)/)?.[1].replace(/^          /gm, '');
  assert.ok(command, 'A separate root job must execute the original test inventory');
  const shards = JSON.parse(rootJob.match(/shard: (\[[^\]]+\])/)?.[1] ?? '[]');
  const root = mkdtempSync(join(tmpdir(), 'cloud-root-partitions-'));
  try {
    mkdirSync(join(root, 'scripts'));
    const files = ['ci-a.test.mjs', 'ci-b.test.mjs', 'ci-new-reader.test.mjs', 'ci-z.test.mjs',
      'ci-c.test.mjs', 'ci-d.test.mjs', 'ci-e.test.mjs', 'ci-f.test.mjs',
      'identity-upstream.test.mjs', 'verify-gateway-reconnection-receipt.test.mjs',
      'billing-display-guard-probes.test.mjs', 'venue-service-guard-probes.test.mjs'];
    for (const file of files) writeFileSync(join(root, 'scripts', file),
      `import test from 'node:test'; test(${JSON.stringify(file)}, () => {});\n`);
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const execute = shard => spawnSync('bash', ['-e', '-c', command.replaceAll('${{ matrix.shard }}', String(shard))],
      {cwd: root, encoding: 'utf8', env, timeout: 10_000});
    const seen = [];
    for (const shard of shards) {
      const result = execute(shard);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      seen.push(...[...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]));
    }
    assert.deepEqual(seen.sort(), [...files].sort());
    for (const file of files) writeFileSync(join(root, 'scripts', file),
      `import test from 'node:test'; test(${JSON.stringify(file)}, () => {throw Error('broken root check');});\n`);
    for (const shard of shards) assert.notEqual(execute(shard).status, 0);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('summary requires all eight root partitions even when the compiler and package jobs pass', () => {
  const title = rootJob.match(/^    name: (.+)$/m)?.[1];
  assert.ok(title, 'Every root partition needs an explicit job name');
  const namedJobs = jobs.map(job => job.name.startsWith('root (')
    ? {...job, name: title.replaceAll('${{ matrix.shard }}', job.name.match(/\d/)[0])}
    : job);
  assert.doesNotThrow(() => assertSummary(plan, results, namedJobs));
  assert.doesNotThrow(() => assertSummary(plan, results, jobs));
  for (const name of ['root (1/8)', 'root (2/8)', 'root (3/8)', 'root (4/8)', 'root (5/8)', 'root (6/8)', 'root (7/8)', 'root (8/8)']) {
    const other = jobs.filter(job => job.name !== name);
    assert.throws(() => assertSummary(plan, results, other));
    const original = jobs.find(job => job.name === name);
    assert.throws(() => assertSummary(plan, results, [...jobs, original]));
    for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
      assert.throws(() => assertSummary(plan, results, [...other, {...original, conclusion}]));
    }
    for (const status of ['queued', 'in_progress']) {
      assert.throws(() => assertSummary(plan, results, [...other, {...original, status}]));
    }
  }
  const legacy = jobs.filter(job => !job.name.startsWith('root (') || /^root \([1-4]\//.test(job.name))
    .map(job => ({...job, name: job.name.replace('/8)', '/4)')}));
  assert.throws(() => assertSummary(plan, results, legacy));
  for (const name of ['root (1/4)', 'root (${{ matrix.shard }}/4)']) {
    for (const conclusion of ['success', 'skipped']) {
      assert.throws(() => assertSummary(plan, results, [...jobs, {name, status: 'completed', conclusion}]));
    }
  }
  for (const root of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => assertSummary(plan, {...results, root}, jobs));
  }
});

test('summary skips root partitions only when the plan skips the compiler', () => {
  const reused = {packages: [], receipts: [], typecheck: false, reuse: reuseProof()};
  const skipped = {changes: 'success', root: 'skipped', typecheck: 'skipped', packages: 'skipped', receipts: 'skipped'};
  assert.doesNotThrow(() => assertSummary(reused, skipped, [jobs[0]]));
  assert.throws(() => assertSummary(reused, {...skipped, root: 'success'}, [jobs[0]]));
  assert.throws(() => assertSummary(reused, skipped, [jobs[0], jobs.at(-1)]));
});
