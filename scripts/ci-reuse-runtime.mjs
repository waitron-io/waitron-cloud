import assert from 'node:assert/strict';
import {appendFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonicalJson, capturePlanEvidence} from './ci-evidence.mjs';
import {createDecisionEvidence} from './ci-decision.mjs';
import {createBoundedGit, createReuseApi} from './ci-reuse-api.mjs';

export function reuseContextFromEnvironment(event, env = process.env) {
  const inputs = JSON.parse(env.CI_WORKFLOW_INPUTS || '{}') ?? {};
  assert.ok(inputs && typeof inputs === 'object' && !Array.isArray(inputs), 'Invalid workflow inputs');
  return {event, sha: env.GITHUB_SHA, repository: env.GITHUB_REPOSITORY, branch: env.GITHUB_REF_NAME,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID), runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT),
    workflowId: Number(env.CI_WORKFLOW_ID), eventName: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF,
    workflowPath: env.GITHUB_WORKFLOW_REF?.match(/^waitron-io\/waitron-cloud\/(\.github\/workflows\/[a-z-]+\.yml)@/)?.[1],
    workflowRef: env.GITHUB_WORKFLOW_REF, workflowSha: env.GITHUB_WORKFLOW_SHA,
    full: env.CI_FULL === 'true', called: env.CI_CALLED === 'true' || Object.hasOwn(inputs, 'full')};
}

export function runtimeReuseDependencies(context) {
  const api = createReuseApi({repository: context.repository});
  return {api, git: createBoundedGit({remaining: api.remaining})};
}

export function readRuntimeReuseContext(env = process.env) {
  const bytes = readFileSync(env.GITHUB_EVENT_PATH);
  assert.ok(bytes.length > 0 && bytes.length <= 1024 * 1024, 'Invalid original event size');
  return reuseContextFromEnvironment(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), env);
}

export function bindRuntimeWorkflow(context, api) {
  const run = api.readRun(context.runId, api.remaining());
  assert.equal(run.id, context.runId, 'Wrong runtime run');
  assert.equal(run.run_attempt, context.attempt, 'Wrong runtime attempt');
  assert.equal(run.path, context.workflowPath, 'Wrong runtime workflow');
  assert.equal(run.event, context.eventName, 'Wrong runtime event');
  assert.equal(run.head_sha, context.eventName === 'pull_request' ? context.event.pull_request.head.sha : context.sha, 'Wrong runtime head');
  for (const repo of [run.repository, run.head_repository]) {
    assert.equal(repo?.id, context.repositoryId, 'Wrong runtime repository');
    assert.equal(repo.full_name, context.repository, 'Wrong runtime repository name');
  }
  assert.ok(Number.isSafeInteger(run.workflow_id) && run.workflow_id > 0, 'Missing runtime workflow ID');
  return {...context, workflowId: run.workflow_id};
}

export function publishRuntimePlan(context, selection, git, mode, {root = '.ci-evidence', output = process.env.GITHUB_OUTPUT,
  summary = process.env.GITHUB_STEP_SUMMARY} = {}) {
  if (context.called || context.full || !['pull_request', 'push'].includes(context.eventName)) return;
  if (context.eventName === 'push' && context.ref !== 'refs/heads/main') return;
  const source = context.eventName === 'pull_request';
  const record = source ? capturePlanEvidence(context.event, context, selection, git) : createDecisionEvidence(context, selection, git, mode);
  const directory = join(root, source ? 'source' : 'decision');
  mkdirSync(directory, {recursive: true});
  writeFileSync(join(directory, 'plan.json'), canonicalJson(record) + '\n', {flag: 'wx'});
  const key = context.workflowPath.slice('.github/workflows/'.length, -4);
  const kind = source ? 'plan' : 'decision';
  appendFileSync(output, `${source ? 'source' : 'decision'}_artifact=ci-${kind}-v1-${key}-${context.runId}-${context.attempt}\n`);
  if (summary) {
    const proof = selection.reuse;
    const link = proof ? `; [source PR #${proof.pr}](https://github.com/${proof.repository}/pull/${proof.pr}), [run ${proof.runId}, attempt ${proof.attempt}](https://github.com/${proof.repository}/actions/runs/${proof.runId}/attempts/${proof.attempt})` : '';
    appendFileSync(summary, `## ${key}: ${source ? 'PR source plan' : mode}\n\nExact checkout ${source ? record.checkout.sha : context.sha}${link}.\n`);
  }
}

export function evidenceInvocation(context) {
  if (context.repository !== 'waitron-io/waitron-cloud' || context.full || context.called) return false;
  if (context.eventName === 'push') return context.ref === 'refs/heads/main';
  if (context.eventName !== 'pull_request') return false;
  return [context.event?.pull_request?.base?.repo, context.event?.pull_request?.head?.repo]
    .every(repo => repo?.id === context.repositoryId && repo.full_name === context.repository);
}

export function completeMissingMainDecision(selection, mode, {context, published, api, git, ...location} = {}) {
  if (published || context.eventName !== 'push' || !evidenceInvocation(context)) return;
  assert.equal(mode, 'full', 'Missing main evidence requires complete full work');
  const dependencies = api && git ? {api, git} : runtimeReuseDependencies(context);
  const bound = bindRuntimeWorkflow(context, dependencies.api);
  publishRuntimePlan(bound, selection, dependencies.git, mode, location);
}
