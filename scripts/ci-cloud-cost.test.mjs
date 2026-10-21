import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadWorkspace, scopeForPaths, workPlan } from './ci-scope.mjs';
import { createPlan } from './ci-plan.mjs';

test('costModelCodeAndPublicDataKeepTheirSyntheticSuiteInTheFullFallback', () => {
  const workspace = loadWorkspace();
  for (const path of ['scripts/cloud-cost/calculator.mjs', 'docs/cost-model/prices.json', 'docs/cloud-cost-calculator.html']) {
    const plan = workPlan(scopeForPaths([path], workspace), workspace);
    assert.ok(plan.receipts.includes('test:cloud-cost'), path);
    for (const previous of ['test:two-venue-milestone-receipt', 'test:backup-capacity', 'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt'])
      assert.ok(plan.receipts.includes(previous), previous);
  }
  const main = createPlan({ forced: true }, { sha: 'a'.repeat(40) }, workspace, () => { throw Error('unused'); }, () => { throw Error('unused'); });
  assert.ok(main.receipts.includes('test:cloud-cost'));
});

test('receiptRunnerExecutesTheCostSuiteAndPropagatesItsFailure', t => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-cost-ci-')); t.after(() => rmSync(root, { recursive: true }));
  const log = join(root, 'calls');
  writeFileSync(join(root, 'pnpm'), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$COST_CI_CALLS"\nexit 23\n', { mode: 0o700 });
  const result = spawnSync(process.execPath, ['scripts/ci-run-receipts.mjs'], { encoding: 'utf8',
    env: { ...process.env, PATH: `${root}:${process.env.PATH}`, COST_CI_CALLS: log, CI_PLAN: JSON.stringify({ receipts: ['test:cloud-cost'] }) } });
  assert.equal(result.status, 1); assert.match(result.stderr, /test:cloud-cost failed: 23/);
  assert.equal(readFileSync(log, 'utf8'), 'test:cloud-cost\n');
});

test('pullRequestPlanningRetainsCostVerificationForEveryPublicArtifactAndCodePath', () => {
  const workspace = loadWorkspace(), base = 'b'.repeat(40), head = 'a'.repeat(40);
  for (const path of ['docs/cloud-cost-model.md', 'docs/cloud-cost-calculator.html', 'docs/cost-model/prices.json', 'scripts/cloud-cost/calculator.mjs']) {
    const git = (...args) => {
      if (args[0] === 'merge-base') return base;
      if (args[0] === 'diff') return path + '\0';
      throw Error('No audited input evidence');
    };
    const selected = createPlan({ pull_request: { base: { sha: base }, head: { sha: head } } }, { sha: head }, workspace, git, () => { throw Error('No API'); });
    assert.ok(selected.receipts.includes('test:cloud-cost'), path);
    assert.equal(selected.documentation, undefined);
  }
});
