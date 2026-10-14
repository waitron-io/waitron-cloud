import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

// This guard reads workflow text; GitHub Actions executes the expressions and jobs.
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const job = (name) => workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'))?.[1] ?? '';

test('main merges keep independent runs while superseded pull request runs cancel', () => {
  assert.match(workflow, /group: ci-\$\{\{ github.event_name == 'pull_request' && github.ref \|\| github.run_id \}\}/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/);
});

test('every workspace package test runs in a separate database-backed matrix job', () => {
  const packages = job('packages');
  assert.match(packages, /fail-fast: false/);
  for (const parent of ['packages', 'apps']) {
    for (const directory of readdirSync(new URL(`../${parent}/`, import.meta.url))) {
      const manifest = JSON.parse(readFileSync(new URL(`../${parent}/${directory}/package.json`, import.meta.url)));
      if (manifest.scripts?.test) assert.ok(packages.includes(`- '${manifest.name}'\n`), `missing ${manifest.name}`);
    }
  }
  assert.match(packages, /node scripts\/test-postgres.mjs --filter \$\{\{ matrix.package \}\} test/);
  assert.match(job('typecheck'), /run: pnpm typecheck/);
});

test('all existing receipt suites and the workflow guard run in CI', () => {
  const receipts = job('receipts');
  assert.match(receipts, /fail-fast: false/);
  for (const suite of ['two-venue-milestone-receipt', 'backup-capacity', 'public-gateway-limits', 'local-stack', 'database-recovery-receipt']) {
    assert.ok(receipts.includes(`- test:${suite}\n`), `missing ${suite}`);
  }
  assert.match(receipts, /run: pnpm \$\{\{ matrix.suite \}\}/);
  assert.match(job('typecheck'), /run: node --test scripts\/ci-workflow.test.mjs/);
});
test('slow packages run every file shard with their original test deadlines', () => {
  const packages = job('packages');
  assert.match(packages, /shard: \[1\]/);
  for (const [name, count, directory] of [
    ['registration', 7, 'packages/registration'],
    ['account-http', 3, 'packages/account-http'],
    ['backups', 2, 'packages/backups'],
    ['portal', 3, 'apps/portal'],
  ]) {
    const rows = [...packages.matchAll(new RegExp(`package: '@waitron-cloud/${name}'\\n\\s+shard: (\\d+)\\n\\s+shards: (\\d+)`, 'g'))];
    assert.deepEqual(rows.map(row => Number(row[1])).sort((a, b) => a - b), Array.from({length: count}, (_, i) => i + 1), `${name} must run each shard once`);
    assert.ok(rows.every(row => Number(row[2]) === count), `${name} shard denominators must agree`);
    const files = readdirSync(new URL(`../${directory}/test/`, import.meta.url)).filter(file => file.endsWith('.test.ts'));
    assert.ok(count <= files.length, `${name} must have no empty shard`);
  }
  assert.match(packages, /if: \$\{\{ !matrix.shards \}\}\n\s+run: node scripts\/test-postgres.mjs --filter/);
  assert.match(packages, /if: matrix.package == '@waitron-cloud\/portal'\n\s+run: pnpm --filter \$\{\{ matrix.package \}\} build/);
  assert.match(packages, /if: matrix.shards\n\s+run: node scripts\/test-postgres.mjs exec pnpm --filter \$\{\{ matrix.package \}\} exec node --test --test-timeout=\$\{\{ matrix.package == '@waitron-cloud\/portal' && '120000' \|\| '30000' \}\} --test-shard=\$\{\{ matrix.shard \}\}\/\$\{\{ matrix.shards \}\} "test\/\*\.test\.ts"/);
});

test('work jobs stop within eight minutes and the summary keeps its two-minute limit', () => {
  for (const name of ['typecheck', 'receipts', 'packages']) assert.match(job(name), /timeout-minutes: 8/);
  assert.match(job('summary'), /timeout-minutes: 2/);
});

test('the actual summary command refuses failed, missing, skipped and cancelled work', () => {
  const command = job('summary').split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const successful = {TYPECHECK: 'success', RECEIPTS: 'success', PACKAGES: 'success'};
  assert.equal(spawnSync('bash', ['-c', command], {env: {...process.env, ...successful}}).status, 0);
  for (const prerequisite of Object.keys(successful)) {
    for (const result of ['failure', 'cancelled', 'skipped', '', 'queued', 'in_progress']) {
      assert.equal(spawnSync('bash', ['-c', command], {env: {...process.env, ...successful, [prerequisite]: result}}).status, 1, `${prerequisite}=${result} must block landing`);
    }
  }
});

test('browser setup is limited to browser packages and bounded across two attempts', () => {
  const packages = job('packages');
  assert.match(packages, /if: matrix.package == '@waitron-cloud\/portal' \|\| matrix.package == '@waitron-cloud\/ui-smoke'/);
  assert.match(packages, /timeout --kill-after=10s 120s pnpm --filter @waitron-cloud\/ui-smoke exec playwright install --with-deps chromium/);
  assert.match(packages, /for attempt in 1 2; do/);
  assert.match(packages, /if \[ "\$attempt" -eq 2 \]; then exit 1; fi/);
});

test('the summary runs even after failure and refuses any unsuccessful prerequisite', () => {
  const summary = job('summary');
  assert.match(summary, /if: \$\{\{ always\(\) \}\}/);
  assert.match(summary, /needs: \[typecheck, receipts, packages\]/);
  for (const prerequisite of ['typecheck', 'receipts', 'packages']) {
    assert.ok(summary.includes(`\${{ needs.${prerequisite}.result }}`));
  }
  assert.match(summary, /\[ "\$result" = success \] \|\| exit 1/);
  for (const name of ['typecheck', 'receipts', 'packages', 'summary']) {
    assert.match(job(name), /timeout-minutes: [1-9]\d*/);
  }
});
