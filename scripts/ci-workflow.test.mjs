import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {loadWorkspace, scopeForPaths, workPlan, receiptSuites} from './ci-scope.mjs';

// This guard reads workflow text; the scratch PR receipts prove Actions executes its wiring.
const workflow=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
const job=name=>workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`,'m'))?.[1]??'';
test('main merges keep independent runs while superseded pull request runs cancel',()=>{
  assert.match(workflow,/group: ci-\$\{\{ github.event_name == 'pull_request' && github.ref \|\| github.run_id \}\}/);
  assert.match(workflow,/cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/);
});
test('every discovered workspace test package runs through the planned database matrix',()=>{
  const members=loadWorkspace();
  const full=workPlan(scopeForPaths(['pnpm-lock.yaml'],members),members);
  assert.deepEqual([...new Set(full.packages.map(row=>row.package))].sort(),members.map(pkg=>pkg.name).sort());
  assert.match(job('packages'),/fail-fast: false/);
  assert.match(job('packages'),/matrix: \$\{\{ fromJSON\(needs.changes.outputs.package_matrix\) \}\}/);
  assert.match(job('packages'),/node scripts\/test-postgres.mjs --filter \$\{\{ matrix.package \}\} test/);
  assert.match(job('typecheck'),/run: pnpm typecheck/);
});
test('all existing receipt suites and workflow guards remain available in CI',()=>{
  assert.deepEqual(receiptSuites,['test:two-venue-milestone-receipt','test:backup-capacity','test:public-gateway-limits','test:local-stack','test:database-recovery-receipt']);
  assert.match(job('receipts'),/fail-fast: false/);
  assert.match(job('receipts'),/matrix: \$\{\{ fromJSON\(needs.changes.outputs.receipt_matrix\) \}\}/);
  assert.match(job('receipts'),/run: pnpm \$\{\{ matrix.suite \}\}/);
  assert.match(job('typecheck'),/run: node --test scripts\/ci-\*\.test.mjs scripts\/identity-upstream.test.mjs scripts\/verify-gateway-reconnection-receipt.test.mjs/);
});
test('slow packages run every file shard with their original test deadlines',()=>{
  const members=loadWorkspace();
  const full=workPlan(scopeForPaths([],members),members);
  for (const [name,count] of [['registration',7],['account-http',3],['backups',2],['portal',3]]) {
    const rows=full.packages.filter(row=>row.package===`@waitron-cloud/${name}`);
    assert.deepEqual(rows.map(row=>row.shard),Array.from({length:count},(_,i)=>i+1));
    assert.ok(rows.every(row=>row.shards===count));
  }
  const packages=job('packages');
  assert.match(packages,/if: \$\{\{ !matrix.shards \}\}\n\s+run: node scripts\/test-postgres.mjs --filter/);
  assert.match(packages,/if: matrix.package == '@waitron-cloud\/portal'\n\s+run: pnpm --filter \$\{\{ matrix.package \}\} build/);
  assert.match(packages,/if: matrix.shards\n\s+run: node scripts\/test-postgres.mjs exec pnpm --filter \$\{\{ matrix.package \}\} exec node --test --test-timeout=\$\{\{ matrix.package == '@waitron-cloud\/portal' && '120000' \|\| '30000' \}\} --test-shard=\$\{\{ matrix.shard \}\}\/\$\{\{ matrix.shards \}\} "test\/\*\.test\.ts"/);
});
test('work jobs stop within eight minutes and planner/summary within two',()=>{
  for (const name of ['typecheck','receipts','packages']) assert.match(job(name),/timeout-minutes: 8/);
  for (const name of ['changes','summary']) assert.match(job(name),/timeout-minutes: 2/);
});
test('browser setup is limited to browser packages and bounded across two attempts',()=>{
  const packages=job('packages');
  assert.match(packages,/if: matrix.package == '@waitron-cloud\/portal' \|\| matrix.package == '@waitron-cloud\/ui-smoke'/);
  assert.match(packages,/timeout --kill-after=10s 120s pnpm --filter @waitron-cloud\/ui-smoke exec playwright install --with-deps chromium/);
  assert.match(packages,/for attempt in 1 2; do/);
  assert.match(packages,/if \[ "\$attempt" -eq 2 \]; then exit 1; fi/);
});
test('strict summary always runs and receives the plan and every dependency result',()=>{
  assert.match(job('summary'),/if: \$\{\{ always\(\) \}\}/);
  assert.match(job('summary'),/needs: \[changes, typecheck, receipts, packages\]/);
  assert.match(job('summary'),/CI_PLAN: \$\{\{ needs.changes.outputs.plan \}\}/);
  assert.match(job('summary'),/CI_RESULTS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(job('summary'),/run: node scripts\/ci-summary.mjs/);
});
test('all work gates follow the planner and every checkout tests the exact PR head',()=>{
  for (const name of ['typecheck','receipts','packages']) {
    assert.match(job(name),new RegExp(`if: needs.changes.outputs.${name} == 'true'`));
    assert.match(job(name),/needs: changes/);
  }
  for (const name of ['changes','typecheck','receipts','packages','summary']) {
    assert.match(job(name),/ref: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  }
  assert.match(job('changes'),/fetch-depth: 0/);
  assert.match(job('changes'),/run: node scripts\/ci-plan.mjs/);
});
