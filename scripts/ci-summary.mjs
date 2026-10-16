import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {assertDocumentation} from './ci-docs.mjs';
import {packageMembers} from './ci-package-groups.mjs';
import {assertReceiptSuites} from './ci-run-receipts.mjs';
import {assertScriptWork} from './ci-scripts.mjs';

export const packageShards = Object.freeze({
  '@waitron-cloud/registration': 5,
  '@waitron-cloud/account-http': 3,
  '@waitron-cloud/backups': 2,
  '@waitron-cloud/portal': 3,
  '@waitron-cloud/identity': 1,
  '@waitron-cloud/operations': 1,
  '@waitron-cloud/remote-access': 1,
  '@waitron-cloud/fiscal-allocation': 1,
  '@waitron-cloud/translation': 1,
  '@waitron-cloud/ui-smoke': 1,
});

export function assertSummary(plan, results, jobs) {
  assert.equal(results.changes, 'success', 'CI planner must succeed');
  assert.ok(Array.isArray(plan.packages) && Array.isArray(plan.receipts) && typeof plan.typecheck === 'boolean', 'Missing CI plan');
  if (plan.scripts) {
    assertScriptWork(plan);
  } else if (plan.reuse) {
    assert.ok(!plan.documentation, 'Reuse cannot declare document work');
    assert.match(plan.reuse.sha, /^[a-f0-9]{40}$/);
    assert.ok(Number.isSafeInteger(plan.reuse.runId) && plan.reuse.runId > 0);
    assert.equal(plan.packages.length + plan.receipts.length, 0);
    assert.equal(plan.typecheck, false);
  } else if (plan.documentation) {
    assertDocumentation(plan.documentation);
    assert.equal(plan.packages.length + plan.receipts.length, 0);
    assert.equal(plan.typecheck, false);
  } else {
    assert.ok(plan.packages.length > 0, 'Empty scope cannot pass');
    assert.equal(plan.typecheck, true);
  }
  const expected = ['changes'];
  if (plan.scripts) expected.push('scripts');
  if (plan.scripts || results.scripts !== undefined) {
    assert.equal(results.scripts, plan.scripts ? 'success' : 'skipped', 'scripts did not match its plan');
  }
  if (plan.documentation) expected.push('documentation');
  if (plan.documentation || results.documentation !== undefined) {
    assert.equal(results.documentation, plan.documentation ? 'success' : 'skipped', 'documentation did not match its plan');
  }
  if (plan.typecheck) expected.push('typecheck');
  const logicalPackages = plan.packages.flatMap(row => packageMembers(row).map(name => `${name}:${row.shard}`));
  assert.equal(new Set(logicalPackages).size, logicalPackages.length, 'Duplicate package execution');
  const groupedPackages = plan.packages.filter(row => Object.hasOwn(row, 'members')).flatMap(packageMembers);
  for (const name of groupedPackages) {
    assert.equal(plan.packages.filter(row => packageMembers(row).includes(name)).length, 1, 'Duplicate package execution');
  }
  // Successful jobs cannot prove completeness when the plan itself omits a shard.
  // Check the execution contract independently of the plan's declared counts.
  const allocations = new Map();
  for (const row of plan.packages) {
    if (Object.hasOwn(row, 'members')) continue;
    const count = packageShards[row.package];
    assert.ok(count && Number.isSafeInteger(row.shard) && row.shard >= 1 && row.shard <= count, 'Invalid package allocation');
    assert.deepEqual(Object.keys(row).sort(), count > 1 ? ['package', 'shard', 'shards'] : ['package', 'shard'], 'Invalid package allocation fields');
    if (count > 1) assert.equal(row.shards, count, 'Invalid package allocation partition count');
    allocations.set(row.package, (allocations.get(row.package) ?? 0) + 1);
  }
  for (const [name, count] of allocations) assert.equal(count, packageShards[name], `Incomplete package allocation: ${name}`);
  for (const row of plan.packages) expected.push(`package (${row.package}${row.shards ? `, shard ${row.shard}/${row.shards}` : ''})`);
  if (plan.receipts.length) {
    assertReceiptSuites(plan.receipts);
    expected.push('receipts');
  }
  assert.equal(new Set(expected).size, expected.length, 'Duplicate planned jobs');
  for (const [group,required] of [['typecheck',plan.typecheck],['packages',plan.packages.length>0],['receipts',plan.receipts.length>0]]) {
    assert.equal(results[group], required ? 'success' : 'skipped', `${group} did not match its plan`);
  }
  for (const job of jobs) {
    if (job.name === 'summary' || expected.includes(job.name)) continue;
    assert.ok(job.status === 'completed' && job.conclusion === 'skipped', `Unexpected executed job: ${job.name}`);
  }
  for (const name of expected) {
    const matches = jobs.filter(job=>job.name===name);
    assert.equal(matches.length, 1, `Missing or duplicate job: ${name}`);
    assert.equal(matches[0].status, 'completed', `${name} is unfinished`);
    assert.equal(matches[0].conclusion, 'success', `${name} did not pass`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const plan = JSON.parse(process.env.CI_PLAN);
    const results = Object.fromEntries(Object.entries(JSON.parse(process.env.CI_RESULTS)).map(([name,job])=>[name,job.result]));
    const pages = JSON.parse(execFileSync('gh', ['api','--paginate','--slurp',`repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/jobs?filter=latest&per_page=100`], {encoding:'utf8',timeout:30_000}));
    assertSummary(plan,results,pages.flatMap(page=>page.jobs));
    console.log(plan.reuse ? `same tree as PR head ${plan.reuse.sha}, run ${plan.reuse.runId}` : plan.documentation ? `Passed 1 document check (${plan.documentation.paths.length} paths)` : plan.scripts ? 'Passed root script checks' : `Passed ${plan.packages.length} package jobs and ${plan.receipts.length} receipts`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
