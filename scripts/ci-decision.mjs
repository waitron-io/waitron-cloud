import assert from 'node:assert/strict';
import {canonicalJson, evidenceDigest, expectedJobContract, maxEvidenceBytes} from './ci-evidence.mjs';
import {assertArtifactMetadata, decodePlanArchive} from './ci-plan-artifact.mjs';
import {collectPages} from './ci-reuse-api.mjs';
import {assertCurrentReuse, assertReviewedInputs} from './ci-reuse.mjs';
import {loadWorkspaceAtRevision} from './ci-workspace-snapshot.mjs';
import {resolveRange} from './ci-range.mjs';
import {scopeForPaths, workPlan} from './ci-scope.mjs';
import {workflowPaths} from './ci-reuse-proof.mjs';
import {selectWorkflowPlan, fullWorkflowPlan} from './ci-workflow-plan.mjs';

const ci = '.github/workflows/ci.yml';
const revision = value => assert.match(value, /^(?!0{40}$)[a-f0-9]{40}$/, 'Invalid decision revision');
const positive = value => assert.ok(Number.isSafeInteger(value) && value > 0, 'Invalid decision numeric identity');

export function createDecisionEvidence(context, selection, git, mode) {
  const workflowPath = context.workflowPath ?? ci;
  const event = Object.fromEntries(['before', 'after', 'forced', 'deleted', 'created']
    .filter(key => context.event?.[key] !== undefined).map(key => [key, context.event[key]]));
  const saved = Object.fromEntries(['sha', 'repository', 'repositoryId', 'runId', 'attempt', 'workflowId', 'eventName', 'ref', 'full', 'called',
    'workflowRef', 'workflowSha'].map(key => [key, context[key]]));
  const record = {version: 1, workflowPath, context: {...saved, event}, mode, selection,
    tree: git('rev-parse', 'HEAD^{tree}').trim()};
  assert.equal(git('rev-parse', 'HEAD').trim(), context.sha, 'Decision requires the exact pushed checkout');
  return validateDecisionEvidence(record);
}

export function validateDecisionEvidence(record) {
  assert.deepEqual(Object.keys(record).sort(), ['version', 'workflowPath', 'context', 'mode', 'selection', 'tree'].sort(), 'Invalid decision fields');
  assert.equal(record.version, 1, 'Unsupported decision version');
  assert.ok(workflowPaths.includes(record.workflowPath), 'Unsupported decision workflow');
  assert.ok(['reused', 'selected', 'full', 'unselected'].includes(record.mode), 'Unsupported decision mode');
  if (record.workflowPath === ci) assert.notEqual(record.mode, 'unselected', 'CI cannot have an empty scope');
  const context = record.context;
  assert.equal(context?.repository, 'waitron-io/waitron-cloud', 'Wrong decision repository');
  for (const key of ['repositoryId', 'runId', 'attempt', 'workflowId']) positive(context[key]);
  assert.equal(context.eventName, 'push', 'Decision is not a main push');
  assert.equal(context.ref, 'refs/heads/main', 'Decision is not for main');
  assert.equal(context.workflowRef, `${context.repository}/${record.workflowPath}@refs/heads/main`, 'Decision workflow reference differs');
  revision(context.sha); revision(record.tree);
  assert.equal(context.workflowSha, context.sha, 'Decision execution revision differs');
  if (record.mode !== 'full') assert.equal(context.event?.after, context.sha, 'Decision event head differs');
  assert.equal(typeof context.full, 'boolean', 'Missing full invocation marker');
  assert.equal(typeof context.called, 'boolean', 'Missing called invocation marker');
  assert.equal(Boolean(record.selection?.reuse), record.mode === 'reused', 'Decision reuse mode differs');
  if (record.workflowPath !== ci) {
    assert.equal(record.selection.required, ['full', 'selected'].includes(record.mode), 'Native decision mode differs from its work');
    assert.equal(record.selection.full === true, record.mode === 'full', 'Native full decision marker differs');
    if (!record.selection.reuse) assert.equal(record.selection.head, context.sha, 'Native selection head differs from decision');
  }
  expectedJobContract(record.workflowPath, record.selection);
  assert.ok(Buffer.byteLength(canonicalJson(record)) <= maxEvidenceBytes, 'Decision is too large');
  return record;
}

function assertJobs(jobs, contract, context) {
  assert.equal(jobs.length, contract.required.length + contract.skipped.length, 'Incomplete main job inventory');
  assert.equal(new Set(jobs.map(job => job.name)).size, jobs.length, 'Duplicate main job name');
  for (const job of jobs) {
    positive(job.id);
    assert.equal(job.run_id, context.runId, 'Wrong main job run');
    assert.equal(job.run_attempt, context.attempt, 'Wrong main job attempt');
    assert.equal(job.head_sha, context.sha, 'Wrong main job checkout');
    assert.ok(contract.required.includes(job.name) || contract.skipped.includes(job.name), 'Unknown main job');
    assert.equal(job.status, 'completed', 'Main job is unfinished');
    assert.equal(job.conclusion, contract.required.includes(job.name) ? 'success' : 'skipped', 'Main job differs from its plan');
  }
}

export function readbackDecision(record, {api, git, now} = {}) {
  validateDecisionEvidence(record);
  const {context, selection, mode, workflowPath} = record;
  const call = (method, ...args) => api[method](...args, api.remaining());
  const pages = (method, ...args) => collectPages(number => call(method, ...args, number));
  const repository = call('readRepository');
  assert.equal(repository.id, context.repositoryId); assert.equal(repository.full_name, context.repository);
  assert.equal(repository.default_branch, 'main');
  const workflow = call('readWorkflow', workflowPath);
  assert.equal(workflow.id, context.workflowId); assert.equal(workflow.path, workflowPath); assert.equal(workflow.state, 'active');
  const assertRun = run => {
    assert.equal(run.id, context.runId); assert.equal(run.run_attempt, context.attempt);
    assert.equal(run.workflow_id, context.workflowId); assert.equal(run.path, workflowPath);
    assert.equal(run.event, 'push'); assert.equal(run.head_branch, 'main'); assert.equal(run.head_sha, context.sha);
    assert.equal(run.status, 'completed', 'Main run is unfinished'); assert.equal(run.conclusion, 'success', 'Main run did not pass');
    for (const repo of [run.repository, run.head_repository]) {
      assert.equal(repo?.id, context.repositoryId); assert.equal(repo.full_name, context.repository);
    }
  };
  assertRun(call('readRun', context.runId));
  const commit = call('readCommit', context.sha);
  assert.equal(commit.sha, context.sha); assert.equal(commit.tree?.sha, record.tree);
  assert.equal(git('rev-parse', 'HEAD^{tree}').trim(), record.tree, 'Operator checkout tree differs from decision');
  assert.equal(git('rev-parse', `${context.sha}^{tree}`).trim(), record.tree);
  assertReviewedInputs(context.sha, git);
  const artifactName = `ci-decision-v1-${workflowPath.slice('.github/workflows/'.length, -4)}-${context.runId}-${context.attempt}`;
  const artifacts = pages('listArtifacts', context.runId).filter(artifact => artifact.name === artifactName);
  assert.equal(artifacts.length, 1, 'Missing or duplicate main decision artifact');
  const archive = call('readPlanArtifact', artifacts[0].id);
  assertArtifactMetadata(artifacts[0], archive, {workflowPath, runId: context.runId, attempt: context.attempt,
    head: context.sha, repositoryId: context.repositoryId}, maxEvidenceBytes, 'decision');
  const hosted = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(decodePlanArchive(archive, maxEvidenceBytes)));
  assert.equal(canonicalJson(hosted), canonicalJson(record), 'Local decision differs from hosted attempt artifact');
  if (mode !== 'reused') {
    if (mode === 'selected' || mode === 'unselected') {
      const range = resolveRange(context.event, context, git);
      assert.equal(range.kind, 'push', 'Selected decision lacks a trusted range');
      assert.equal(canonicalJson(selection), canonicalJson(selectWorkflowPlan(workflowPath, range, git)), 'Recomputed main selection differs');
    } else if (workflowPath !== ci) {
      assert.equal(canonicalJson(selection), canonicalJson(fullWorkflowPlan(workflowPath, context.sha)), 'Full native decision omits required work');
    } else {
      const snapshot = loadWorkspaceAtRevision(context.sha, git);
      const full = {...workPlan(scopeForPaths([], snapshot.packages), snapshot.packages, undefined, undefined, snapshot.testFilesByPackage), reuse: null};
      const {reason, ...plannedWork} = selection;
      assert.equal(canonicalJson(plannedWork), canonicalJson(full), 'Full decision omits required work');
    }
  }
  const jobs = pages('listAttemptJobs', context.runId, context.attempt);
  assertJobs(jobs, expectedJobContract(workflowPath, selection), context);
  let inherited = null;
  if (mode === 'reused') {
    const proof = selection.reuse, sourceJobs = pages('listAttemptJobs', proof.runId, proof.attempt);
    const digest = evidenceDigest(sourceJobs.map(job => Object.fromEntries(['id', 'run_id', 'run_attempt', 'head_sha', 'name', 'status', 'conclusion']
      .map(key => [key, job[key]]))).sort((a, b) => a.id - b.id));
    assert.equal(digest, proof.jobsDigest, 'Inherited job evidence differs');
    assertCurrentReuse(proof, context, {api, git, now});
    inherited = {proof, succeeded: sourceJobs.filter(job => job.conclusion === 'success').map(job => job.name),
      skipped: sourceJobs.filter(job => job.conclusion === 'skipped').map(job => job.name)};
  }
  assertRun(call('readRun', context.runId));
  return {mode, mergeSha: context.sha, tree: record.tree, runId: context.runId, attempt: context.attempt,
    succeeded: jobs.filter(job => job.conclusion === 'success').map(job => job.name),
    skipped: jobs.filter(job => job.conclusion === 'skipped').map(job => job.name), inherited,
    newlyExecutedProductChecks: mode === 'reused' ? 0 : null};
}
