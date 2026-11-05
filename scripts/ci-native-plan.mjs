import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {bindRuntimeWorkflow, evidenceInvocation, publishRuntimePlan, readRuntimeReuseContext, runtimeReuseDependencies} from './ci-reuse-runtime.mjs';
import {resolveRange} from './ci-range.mjs';
import {findReuse, permitsRangeSelection} from './ci-reuse.mjs';
import {fullWorkflowPlan, selectWorkflowPlan} from './ci-workflow-plan.mjs';

export function createNativePlan(event, context, git, api) {
  const path = context.workflowPath;
  const head = /^(?!0{40}$)[a-f0-9]{40}$/.test(event.pull_request?.head?.sha ?? '') ? event.pull_request.head.sha : context.sha;
  const full = reason => ({plan: fullWorkflowPlan(path, head), mode: 'full', reason});
  const range = resolveRange(event, context, git);
  if (range.kind === 'full') return full(range.reason);
  if (range.kind === 'push') {
    let single;
    try {
      const parents = git('show', '-s', '--format=%P', range.head).trim().split(' ');
      assert.ok(parents.length && parents.every(sha => /^(?!0{40}$)[a-f0-9]{40}$/.test(sha)), 'Invalid push topology');
      single = parents.length === 1 && parents[0] === range.base;
    } catch {return full('Cannot verify push topology');}
    if (single) {
      const result = findReuse(context, {api, git}, path);
      if (result.reuse) return {plan: {required: false, reuse: result.reuse}, mode: 'reused', reason: result.reason};
      if (!permitsRangeSelection(result)) return full(`Unverified PR evidence: ${result.reason}`);
    }
  }
  const plan = selectWorkflowPlan(path, range, git);
  return {plan, mode: plan.full ? 'full' : plan.required ? 'selected' : 'unselected', reason: 'Selected literal revision range'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let context = readRuntimeReuseContext();
    context.workflowPath = process.env.CI_WORKFLOW_PATH;
    context.full ||= process.env.CI_FORCE_FULL === 'true';
    const git = (...args) => execFileSync('git', args, {encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
    let record = process.env.CI_RECORD_EVIDENCE === 'true' && evidenceInvocation(context);
    const dependencies = (record || context.eventName === 'push') && context.repository === 'waitron-io/waitron-cloud' ? runtimeReuseDependencies(context) : {};
    if (record) {
      try {context = bindRuntimeWorkflow(context, dependencies.api);}
      catch {context.full = true; record = false; console.log('Workflow identity unavailable: full work without reusable source evidence');}
    }
    const {plan, mode, reason} = createNativePlan(context.event, context, dependencies.git ?? git, dependencies.api);
    const outputs = {plan: JSON.stringify(plan), mode, required: String(plan.required), files: JSON.stringify(plan.matrix ?? [{file: 'unused', group: 'unused'}])};
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
    if (record) publishRuntimePlan(context, plan, git, mode);
    console.log(reason);
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
