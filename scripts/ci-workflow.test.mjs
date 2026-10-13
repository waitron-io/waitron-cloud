import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

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
test('registration runs all three file shards without relaxing test or job deadlines', () => {
  const packages = job('packages');
  assert.match(packages, /shard: \[1\]/);
  for (const shard of [2, 3]) assert.match(packages, new RegExp(`package: '@waitron-cloud/registration'\\n\\s+shard: ${shard}`));
  assert.match(packages, /if: matrix.package != '@waitron-cloud\/registration'\n\s+run: node scripts\/test-postgres.mjs --filter/);
  assert.match(packages, /if: matrix.package == '@waitron-cloud\/registration'\n\s+run: node scripts\/test-postgres.mjs exec pnpm --dir packages\/registration exec node --test --test-timeout=30000 --test-shard=\$\{\{ matrix.shard \}\}\/3 "test\/\*\.test\.ts"/);
  assert.match(packages, /timeout-minutes: 10/);
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
