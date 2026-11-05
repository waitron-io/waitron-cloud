import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout} from 'node:timers/promises';
import {expectedJobContract} from './ci-evidence.mjs';
import {createCurrentJobReader} from './ci-reuse-api.mjs';
import {assertCurrentReuse} from './ci-reuse.mjs';
import {bindRuntimeWorkflow, completeMissingMainDecision, readRuntimeReuseContext, runtimeReuseDependencies} from './ci-reuse-runtime.mjs';
import {hasFinishedSteps} from './ci-summary.mjs';

export async function waitForNativeSummary(path, plan, results, {readJobs, identity, prefix = '', timeoutMs = 60_000,
  now = () => performance.now(), sleep = setTimeout, recheckReuse} = {}) {
  const family = path.endsWith('/cloud-cost.yml') ? 'cost' : path.endsWith('/venue-services-proof.yml') ? 'venue' : 'aws';
  assert.ok(prefix === '' || prefix === `${family} / `, 'Unexpected native job prefix');
  const planner = path.endsWith('/cloud-cost.yml') ? 'discover' : 'changes';
  const work = path.endsWith('/cloud-cost.yml') ? 'conformance' : path.endsWith('/venue-services-proof.yml') ? 'service-receipts'
    : path.endsWith('/aws-infrastructure.yml') ? 'verify' : 'linux-contention';
  assert.deepEqual(Object.keys(results).sort(), [planner, work].sort(), 'Incomplete native needs');
  assert.equal(results[planner]?.result, 'success', 'Native planner did not succeed');
  assert.equal(results[work]?.result, plan.required ? 'success' : 'skipped', 'Native work result differs from its plan');
  const contract = expectedJobContract(path, plan);
  const expected = contract.required.concat(contract.skipped);
  const deadline = now() + timeoutMs;
  let lookupError;
  for (;;) {
    assert.ok(now() < deadline, `Timed out waiting for native job records${lookupError ? `; last lookup: ${lookupError.message}` : ''}`);
    let jobs;
    try {jobs = readJobs(Math.ceil(deadline - now()));}
    catch (error) {
      if (error.code !== 'ETIMEDOUT') throw error;
      lookupError = error;
      await sleep(Math.max(0, Math.min(2000, deadline - now())));
      continue;
    }
    lookupError = undefined;
    assert.ok(now() < deadline, 'Timed out reading native job records');
    assert.ok(jobs.every(job => typeof job?.name === 'string' && job.name.length > 0), 'Invalid native job name');
    if (prefix) jobs = jobs.filter(job => job.name.startsWith(prefix)).map(job => ({...job, name: job.name.slice(prefix.length)}));
    assert.equal(jobs.length, expected.length, 'Incomplete native job inventory');
    assert.equal(new Set(jobs.map(job => job.id)).size, jobs.length, 'Duplicate native job ID');
    assert.equal(new Set(jobs.map(job => job.name)).size, jobs.length, 'Duplicate native job name');
    let waiting = false;
    for (const job of jobs) {
      assert.ok(expected.includes(job.name), 'Unknown native job');
      assert.ok(Number.isSafeInteger(job.id) && job.id > 0, 'Invalid native job identity');
      assert.equal(job.run_id, identity.runId, 'Wrong native run');
      assert.equal(job.run_attempt, identity.runAttempt, 'Wrong native attempt');
      assert.equal(job.head_sha, identity.headSha, 'Wrong native source');
      if (job.name === 'summary') continue;
      const wanted = contract.required.includes(job.name) ? 'success' : 'skipped';
      if (job.status !== 'completed') {
        if (wanted === 'success' && hasFinishedSteps(job, identity)) continue;
        waiting = true; continue;
      }
      assert.equal(job.conclusion, wanted, 'Native job result differs from its plan');
    }
    if (!waiting) {
      if (plan.reuse) {assert.equal(typeof recheckReuse, 'function'); recheckReuse();}
      return;
    }
    await sleep(Math.max(0, Math.min(2000, deadline - now())));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const plan = JSON.parse(process.env.CI_PLAN), path = process.env.CI_WORKFLOW_PATH;
    const readJobs = createCurrentJobReader({repository: process.env.GITHUB_REPOSITORY,
      runId: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT)});
    await waitForNativeSummary(path, plan, JSON.parse(process.env.CI_RESULTS), {readJobs, prefix: process.env.CI_JOB_PREFIX || '',
      identity: {runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), headSha: process.env.CI_HEAD_SHA},
      recheckReuse: () => {
        let context = readRuntimeReuseContext(); context.workflowPath = path;
        const dependencies = runtimeReuseDependencies(context);
        context = bindRuntimeWorkflow(context, dependencies.api);
        assertCurrentReuse(plan.reuse, context, dependencies);
      }});
    if (process.env.CI_RECORD_DECISION === 'true') {
      const context = readRuntimeReuseContext();
      context.workflowPath = process.env.CI_WORKFLOW_PATH ?? context.workflowPath;
      completeMissingMainDecision(plan, process.env.CI_MODE, {context, published: process.env.CI_DECISION_ARTIFACT});
    }
    const result = plan.reuse ? `Reused PR #${plan.reuse.pr}, run ${plan.reuse.runId}, attempt ${plan.reuse.attempt}; zero new product checks`
      : plan.required ? 'Passed every selected native job' : 'No native proof inputs selected; planner and summary passed';
    console.log(result);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result + '\n');
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
