import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBoundedGit, createReuseApi} from './ci-reuse-api.mjs';

export function reuseContextFromEnvironment(event, env = process.env) {
  const inputs = JSON.parse(env.CI_WORKFLOW_INPUTS || '{}');
  assert.ok(inputs && typeof inputs === 'object' && !Array.isArray(inputs), 'Invalid workflow inputs');
  return {event, sha: env.GITHUB_SHA, repository: env.GITHUB_REPOSITORY, branch: env.GITHUB_REF_NAME,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID), runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT),
    workflowId: Number(env.CI_WORKFLOW_ID), eventName: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF,
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
