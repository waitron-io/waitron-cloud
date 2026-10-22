import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {setTimeout} from 'node:timers/promises';
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

function expectedSummaryJobs(plan, results) {
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
  if (plan.typecheck) expected.push('typecheck', 'root (1/4)', 'root (2/4)', 'root (3/4)', 'root (4/4)');
  if (plan.typecheck || results.root !== undefined) {
    assert.equal(results.root, plan.typecheck ? 'success' : 'skipped', 'root did not match its plan');
  }
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
  return expected;
}

function assertSummaryJobs(expected, jobs, waiting = null) {
  for (const job of jobs) {
    assert.ok(job && typeof job.name === 'string' && job.name.trim().length > 0, 'Invalid job record: missing job name');
    if (job.name === 'summary' || expected.includes(job.name)) continue;
    if (waiting && job.status !== 'completed') {
      waiting.push(job.name);
    } else {
      assert.ok(job.status === 'completed' && job.conclusion === 'skipped', `Unexpected executed job: ${job.name}`);
    }
  }
  for (const name of expected) {
    const matches = jobs.filter(job=>job.name===name);
    assert.equal(matches.length, 1, `Missing or duplicate job: ${name}`);
    if (waiting && matches[0].status !== 'completed') {
      waiting.push(name);
      continue;
    }
    assert.equal(matches[0].status, 'completed', `${name} is unfinished`);
    assert.equal(matches[0].conclusion, 'success', `${name} did not pass`);
  }
}

export function assertSummary(plan, results, jobs) {
  assertSummaryJobs(expectedSummaryJobs(plan, results), jobs);
}

function readCurrentJobs(timeoutMs) {
  const pages = JSON.parse(execFileSync('gh', ['api','--paginate','--slurp',`repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/jobs?filter=latest&per_page=100`], {encoding:'utf8',timeout:Math.min(10_000, timeoutMs)}));
  return pages.flatMap(page => page.jobs);
}

function hasFinishedSteps(job, identity) {
  if (!identity || !Number.isSafeInteger(identity.runId) || identity.runId <= 0 ||
      !Number.isSafeInteger(identity.runAttempt) || identity.runAttempt <= 0 ||
      !/^[a-f0-9]{40}$/.test(identity.headSha)) return false;
  if (job.status !== 'in_progress' || job.conclusion !== null ||
      job.run_id !== identity.runId || job.run_attempt !== identity.runAttempt ||
      job.head_sha !== identity.headSha) return false;
  const steps = job.steps;
  if (!Array.isArray(steps) || steps.length < 2 ||
      steps[0]?.name !== 'Set up job' || steps[0].conclusion !== 'success' ||
      steps.at(-1)?.name !== 'Complete job' || steps.at(-1).conclusion !== 'success' ||
      steps.filter(step => step?.name === 'Complete job').length !== 1) return false;
  return steps.every((step, index) => step && typeof step.name === 'string' && step.name.trim().length > 0 && step.status === 'completed' &&
    ['success', 'skipped'].includes(step.conclusion) &&
    Number.isSafeInteger(step.number) && step.number > 0 &&
    (index === 0 || step.number > steps[index - 1].number));
}

export async function waitForSummary(plan, results, {
  readJobs = readCurrentJobs,
  now = () => performance.now(),
  sleep = setTimeout,
  timeoutMs = 60_000,
  pollMs = 2_000,
  identity = {runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), headSha: process.env.CI_HEAD_SHA},
  report = message => console.log(message),
} = {}) {
  const expected = expectedSummaryJobs(plan, results);
  const deadline = now() + timeoutMs;
  let waiting = [];
  let lookupError;
  for (;;) {
    const remaining = deadline - now();
    const names = waiting.join(', ') || expected.join(', ');
    assert.ok(remaining > 0, `Timed out waiting for job records: ${names}${lookupError ? `; last lookup: ${lookupError.message}` : ''}`);
    let jobs;
    try {
      jobs = await readJobs(Math.ceil(remaining));
    } catch (error) {
      if (error.code !== 'ETIMEDOUT') {
        throw new Error(`Could not read job records for ${names}: ${error.message}`, {cause: error});
      }
      lookupError = error;
      await sleep(Math.max(0, Math.min(pollMs, deadline - now())));
      continue;
    }
    assert.ok(now() < deadline, `Timed out reading job records: ${names}`);
    lookupError = undefined;
    waiting = [];
    // The runner finishes its final step before uploads and job-result publication.
    // Final needs success is also required; steps alone cannot prove job success.
    const resolved = jobs.map(job => expected.includes(job?.name) && hasFinishedSteps(job, identity)
      ? {...job, status: 'completed', conclusion: 'success'} : job);
    assertSummaryJobs(expected, resolved, waiting);
    for (let index = 0; index < jobs.length; index++) {
      if (resolved[index] !== jobs[index]) report(`Final needs and completed steps: ${jobs[index].name} (run ${identity.runId}, attempt ${identity.runAttempt}, ${identity.headSha})`);
    }
    if (waiting.length === 0) return;
    await sleep(Math.min(pollMs, deadline - now()));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const plan = JSON.parse(process.env.CI_PLAN);
    const results = Object.fromEntries(Object.entries(JSON.parse(process.env.CI_RESULTS)).map(([name,job])=>[name,job.result]));
    await waitForSummary(plan, results);
    console.log(plan.reuse ? `same tree as PR head ${plan.reuse.sha}, run ${plan.reuse.runId}` : plan.documentation ? `Passed 1 document check (${plan.documentation.paths.length} paths)` : plan.scripts ? 'Passed root script checks' : `Passed ${plan.packages.length} package jobs and ${plan.receipts.length} receipts`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
