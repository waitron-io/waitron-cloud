import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {assertDocumentation} from './ci-docs.mjs';
import {assertReceiptSuites} from './ci-run-receipts.mjs';

export function assertSummary(plan, results, jobs) {
  assert.equal(results.changes, 'success', 'CI planner must succeed');
  assert.ok(Array.isArray(plan.packages) && Array.isArray(plan.receipts) && typeof plan.typecheck === 'boolean', 'Missing CI plan');
  if (plan.reuse) {
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
  if (plan.documentation) expected.push('documentation');
  if (plan.documentation || results.documentation !== undefined) {
    assert.equal(results.documentation, plan.documentation ? 'success' : 'skipped', 'documentation did not match its plan');
  }
  if (plan.typecheck) expected.push('typecheck');
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
    console.log(plan.reuse ? `same tree as PR head ${plan.reuse.sha}, run ${plan.reuse.runId}` : plan.documentation ? `Passed 1 document check (${plan.documentation.paths.length} paths)` : `Passed ${plan.packages.length} package jobs and ${plan.receipts.length} receipts`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
