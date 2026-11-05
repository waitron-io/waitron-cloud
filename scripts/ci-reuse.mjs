import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {collectPages} from './ci-reuse-api.mjs';
import {assertSourceEvidence, canonicalJson, evidenceDigest, expectedJobContract, readPlanArtifact} from './ci-evidence.mjs';
import {workflowPaths, assertReuseProof} from './ci-reuse-proof.mjs';
import {selectWorkflowPlan} from './ci-workflow-plan.mjs';

const positive = value => Number.isSafeInteger(value) && value > 0;
const validSha = value => typeof value === 'string' && /^(?!0{40}$)[a-f0-9]{40}$/.test(value);
const repository = 'waitron-io/waitron-cloud';
const rangeReasons = new Set(['Multiple pushed commits: use range selection', 'No associated PR: use range selection',
  'Merge tree differs from PR head: use range selection']);

export const permitsRangeSelection = result => result.reuse === null && rangeReasons.has(result.reason);

export function assertCurrentReuse(proof, context, dependencies) {
  assertReuseProof(proof, proof.workflowPath);
  const result = findReuse(context, dependencies, proof.workflowPath);
  assert.ok(result.reuse, `Reuse source no longer qualifies: ${result.reason}`);
  assert.equal(canonicalJson(result.reuse), canonicalJson(proof), 'Reuse proof differs from current evidence');
}

function assertRepository(value, id) {
  assert.equal(value?.id, id, 'Repository identity differs');
  assert.equal(value.full_name, repository, 'Repository name differs');
}

function runIdentity(run) {
  return Object.fromEntries(['id', 'workflow_id', 'path', 'event', 'repository', 'head_repository', 'head_sha', 'head_branch',
    'run_attempt', 'status', 'conclusion', 'pull_requests', 'referenced_workflows'].map(key => [key, run[key]]));
}

function assertSourceRun(run, {pr, workflowId, workflowPath, repositoryId}) {
  assert.ok(positive(run?.id) && positive(run.run_attempt), 'Invalid source run identity');
  assert.equal(run.workflow_id, workflowId, 'Source workflow ID differs');
  assert.equal(run.path, workflowPath, 'Source workflow path differs');
  assert.equal(run.event, 'pull_request', 'Source is not a PR run');
  assertRepository(run.repository, repositoryId);
  assertRepository(run.head_repository, repositoryId);
  assert.equal(run.head_sha, pr.head.sha, 'Source head differs');
  assert.equal(run.head_branch, pr.head.ref, 'Source branch differs');
  assert.equal(run.status, 'completed', 'Latest source run is unfinished');
  assert.equal(run.conclusion, 'success', 'Latest source run is not green');
  assert.ok(Array.isArray(run.pull_requests), 'Missing optional association inventory');
  for (const association of run.pull_requests) {
    assert.equal(association.number, pr.number, 'Source PR association differs');
    assert.equal(association.head?.sha, pr.head.sha, 'Associated source head differs');
    assert.equal(association.base?.ref, 'main', 'Associated source base differs');
  }
  assert.ok(Array.isArray(run.referenced_workflows), 'Missing referenced workflow inventory');
}

function treeInventory(revision, git) {
  const records = git('ls-tree', '-rz', '--full-tree', revision).split('\0');
  assert.equal(records.pop(), '', 'Incomplete provenance tree inventory');
  const entries = new Map();
  for (const record of records) {
    const match = record.match(/^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/);
    assert.ok(match && !entries.has(match[4]), 'Malformed or duplicated provenance path');
    entries.set(match[4], {mode: match[1], type: match[2], id: match[3]});
  }
  return entries;
}

export function assertReviewedInputs(head, git) {
  const files = treeInventory(head, git), native = new Map();
  const executable = path => /\.(?:[cm]?[jt]s|py|sh)$/.test(path) && !/\.test\.[cm]?[jt]s$/.test(path);
  const walk = path => {
    for (const entry of readdirSync(new URL(`../${path}/`, import.meta.url), {withFileTypes: true})) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'ci-input-audit.d'].includes(entry.name)) walk(child);
      } else if (executable(child)) {
        assert.ok(entry.isFile(), `Nonregular reviewed executable: ${child}`);
        const bytes = readFileSync(new URL(`../${child}`, import.meta.url));
        native.set(child, createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'));
      }
    }
  };
  walk('scripts');
  const historical = [...files.keys()].filter(path => path.startsWith('scripts/') && executable(path)).sort();
  assert.deepEqual(historical, [...native.keys()].sort(), 'Historical executable inventory differs');
  for (const path of historical) {
    const entry = files.get(path);
    assert.ok(entry.type === 'blob' && ['100644', '100755'].includes(entry.mode), `Nonregular historical executable: ${path}`);
    assert.equal(entry.id, native.get(path), `Historical reviewed input differs: ${path}`);
  }
  // Comparing the complete script inventory is conservative: generated programs
  // and directory readers cannot conceal an import outside a textual scan.
  for (const path of ['package.json', 'pnpm-lock.yaml']) {
    const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
    const entry = files.get(path);
    assert.ok(entry?.type === 'blob' && entry.mode === '100644', `Missing frozen install input: ${path}`);
    assert.equal(entry.id, createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), 'Frozen install inputs differ');
  }
  const prefix = 'scripts/cloud-cost/fixtures/';
  const fixtureNames = readdirSync(new URL('./cloud-cost/fixtures/', import.meta.url)).filter(name => name.endsWith('-conformance.test.mjs')).sort();
  const trackedNames = [...files.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/') && path.endsWith('-conformance.test.mjs')).sort();
  assert.deepEqual(trackedNames, fixtureNames.map(name => prefix + name), 'Historical native cost fixture inventory differs');
  for (const path of trackedNames) assert.ok(files.get(path).type === 'blob' && ['100644', '100755'].includes(files.get(path).mode), 'Nonregular historical cost fixture');
}

function assertWorkflowProvenance(source, run, git) {
  const head = source.checkout.sha, execution = source.event.sha;
  assert.equal(source.workflow.sha, execution, 'Workflow revision differs from original PR execution');
  const headFiles = treeInventory(head, git), executedFiles = treeInventory(execution, git);
  const checked = new Set(), references = [];
  const compare = path => {
    const file = headFiles.get(path);
    assert.ok(file?.type === 'blob' && ['100644', '100755'].includes(file.mode), `Missing regular workflow input: ${path}`);
    assert.deepEqual(executedFiles.get(path), file, `Execution workflow input differs: ${path}`);
    const reviewed = readFileSync(new URL(`../${path}`, import.meta.url));
    assert.equal(file.id, createHash('sha1').update(`blob ${reviewed.length}\0`).update(reviewed).digest('hex'),
      `Current reviewed workflow input differs: ${path}`);
  };
  const visit = path => {
    if (checked.has(path)) return;
    checked.add(path); compare(path);
    const definition = git('show', `${head}:${path}`);
    for (const match of definition.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*(?:#.*)?$/gm)) {
      const value = match[1];
      if (!value.startsWith('./')) continue;
      const target = value.slice(2);
      assert.ok(!target.split('/').some(part => !part || part === '.' || part === '..') && !target.includes('@'), 'Unsupported local workflow reference');
      if (/^\.github\/workflows\/[a-z-]+\.ya?ml$/.test(target)) {
        references.push({path: `${repository}/${target}@refs/pull/${source.pr}/merge`, sha: execution});
        visit(target);
      } else {
        const action = ['action.yml', 'action.yaml'].map(name => `${target}/${name}`).filter(name => headFiles.has(name));
        assert.equal(action.length, 1, 'Missing or ambiguous local action');
        const paths = [...new Set([...headFiles.keys(), ...executedFiles.keys()])].filter(name => name.startsWith(`${target}/`));
        for (const name of paths) compare(name);
        visit(action[0]);
      }
    }
  };
  visit(source.workflow.path);
  const actual = run.referenced_workflows.map(ref => ({path: ref.path, sha: ref.sha}));
  assert.equal(canonicalJson(actual.sort((a, b) => a.path.localeCompare(b.path))),
    canonicalJson(references.sort((a, b) => a.path.localeCompare(b.path))), 'Resolved workflow references differ');
}

export function findReuse(context, {api, git, now = () => performance.now()} = {}, workflowPath) {
  const refuse = reason => ({reuse: null, reason: String(reason).slice(0, 1024)});
  const deadline = now() + 30_000;
  let requests = 0;
  const remaining = () => {
    const value = Math.floor(deadline - now());
    assert.ok(Number.isFinite(value) && value > 0, 'Evidence deadline exhausted');
    return value;
  };
  const call = (method, ...args) => {
    assert.ok(requests++ < 30, 'Evidence request budget exhausted');
    const value = api[method](...args, remaining()); remaining(); return value;
  };
  const readGit = (...args) => {remaining(); const value = git(...args); remaining(); return value;};
  if (git?.readBlobs) readGit.readBlobs = ids => {remaining(); const value = git.readBlobs(ids); remaining(); return value;};
  try {
    assert.equal(context.repository, repository, 'Wrong current repository');
    assert.ok(positive(context.repositoryId) && positive(context.runId) && positive(context.attempt), 'Missing current run identity');
    assert.ok(workflowPaths.includes(workflowPath) && positive(context.workflowId), 'Missing current workflow identity');
    assert.ok(!context.full && !context.called && context.eventName === 'push' && context.ref === 'refs/heads/main', 'Only main pushes may reuse checks');
    const event = context.event;
    assert.ok(event && !event.forced && !event.deleted && !event.created && validSha(event.before) && validSha(event.after) && event.after === context.sha,
      'Invalid original push range');
    const repo = call('readRepository');
    assertRepository(repo, context.repositoryId); assert.equal(repo.default_branch, 'main', 'Default branch differs');
    const workflow = call('readWorkflow', workflowPath);
    assert.equal(workflow?.id, context.workflowId, 'Current workflow ID differs');
    assert.equal(workflow.path, workflowPath, 'Current workflow path differs'); assert.equal(workflow.state, 'active', 'Workflow is inactive');
    const current = call('readRun', context.runId);
    assert.equal(current?.id, context.runId, 'Current run ID differs'); assert.equal(current.run_attempt, context.attempt, 'Current run attempt differs');
    assert.equal(current.workflow_id, workflow.id, 'Current run workflow differs'); assert.equal(current.path, workflowPath, 'Current run workflow path differs');
    assert.equal(current.event, 'push', 'Current run is not a push'); assert.equal(current.head_sha, context.sha, 'Current run head differs');
    assert.equal(current.head_branch, 'main', 'Current run branch differs');
    assertRepository(current.repository, repo.id); assertRepository(current.head_repository, repo.id);
    const commits = new Map();
    const commit = sha => {
      assert.ok(validSha(sha), 'Invalid immutable revision');
      if (!commits.has(sha)) {
        const value = call('readCommit', sha);
        assert.equal(value?.sha, sha, 'Commit response identity differs'); assert.ok(validSha(value.tree?.sha), 'Invalid commit tree');
        assert.equal(readGit('rev-parse', '--verify', `${sha}^{commit}`).trim(), sha, 'Local commit identity differs');
        assert.equal(readGit('rev-parse', `${sha}^{tree}`).trim(), value.tree.sha, 'Local commit tree differs');
        assert.ok(Array.isArray(value.parents) && value.parents.every(parent => validSha(parent.sha)), 'Invalid commit parents');
        assert.deepEqual(value.parents.map(parent => parent.sha), readGit('show', '-s', '--format=%P', sha).trim().split(' ').filter(Boolean), 'Commit topology differs from Git');
        commits.set(sha, value);
      }
      return commits.get(sha);
    };
    const merged = commit(context.sha);
    if (merged.parents.length !== 1 || merged.parents[0].sha !== event.before) return refuse('Multiple pushed commits: use range selection');
    commit(event.before);
    const prs = collectPages(number => call('listAssociatedPRs', context.sha, number));
    if (!prs.length) return refuse('No associated PR: use range selection');
    assert.equal(prs.length, 1, 'No unique associated PR');
    const pr = prs[0];
    assert.ok(positive(pr.number) && pr.state === 'closed' && typeof pr.merged_at === 'string' && Number.isFinite(Date.parse(pr.merged_at)), 'Associated PR is not merged');
    assert.equal(pr.merge_commit_sha, context.sha, 'Associated PR merge differs'); assert.equal(pr.base?.ref, 'main', 'Associated PR base differs');
    assertRepository(pr.base.repo, repo.id); assertRepository(pr.head?.repo, repo.id);
    assert.ok(typeof pr.head.ref === 'string' && pr.head.ref.length > 0, 'Missing PR head branch');
    const head = commit(pr.head.sha);
    if (merged.tree.sha !== head.tree.sha) return refuse('Merge tree differs from PR head: use range selection');
    // Equal complete trees bind the running selector, emitter and all their
    // imports and directory inventories to the historical checked-out head.
    assert.equal(readGit('rev-parse', 'HEAD^{tree}').trim(), head.tree.sha, 'Reviewed checkout tree differs from source head');
    assertReviewedInputs(head.sha, readGit);
    const newest = () => {
      const runs = collectPages(number => call('listRuns', workflowPath, pr.head.sha, number));
      assert.ok(runs.length, 'No exact-head source run');
      return runs.reduce((latest, run) => run.id > latest.id ? run : latest);
    };
    const candidate = newest(), binding = {pr, workflowId: workflow.id, workflowPath, repositoryId: repo.id};
    assertSourceRun(candidate, binding); assert.notEqual(candidate.id, context.runId, 'Current run cannot be its own source');
    const run = call('readRun', candidate.id);
    assertSourceRun(run, binding);
    assert.equal(canonicalJson(runIdentity(run)), canonicalJson(runIdentity(candidate)), 'Source changed after listing');
    const originalIdentity = canonicalJson(runIdentity(run));
    const artifacts = collectPages(number => call('listArtifacts', run.id, number));
    const name = `ci-plan-v1-${workflowPath.slice('.github/workflows/'.length, -4)}-${run.id}-${run.run_attempt}`;
    const matching = artifacts.filter(value => value.name === name);
    assert.equal(matching.length, 1, 'Missing or duplicate attempt-bound plan artifact');
    const source = readPlanArtifact(matching[0], call('readPlanArtifact', matching[0].id), {
      workflowPath, runId: run.id, attempt: run.run_attempt, head: pr.head.sha, repositoryId: repo.id,
    });
    assert.equal(source.pr, pr.number, 'Original PR number differs'); assert.equal(source.event.head.ref, pr.head.ref, 'Original head branch differs');
    assert.equal(source.workflow.id, workflow.id, 'Original workflow ID differs'); assert.equal(source.checkout.tree, head.tree.sha, 'Original checked-out tree differs');
    const originalBase = commit(source.event.base.sha), execution = commit(source.event.sha);
    commit(source.event.mergeBase); commit(source.workflow.sha);
    assert.deepEqual(execution.parents.map(parent => parent.sha), [originalBase.sha, head.sha], 'Original PR execution topology differs');
    readGit('merge-base', '--is-ancestor', source.event.mergeBase, originalBase.sha);
    readGit('merge-base', '--is-ancestor', source.event.mergeBase, head.sha);
    assert.equal(readGit('merge-base', originalBase.sha, head.sha).trim(), source.event.mergeBase, 'Original merge base differs');
    assertWorkflowProvenance(source, run, readGit);
    const selection = selectWorkflowPlan(workflowPath, {base: source.event.mergeBase, head: head.sha}, readGit);
    const jobs = collectPages(number => call('listAttemptJobs', run.id, run.run_attempt, number));
    assertSourceEvidence(source, selection, jobs, expectedJobContract(workflowPath, selection));
    const reread = call('readRun', run.id), latest = newest();
    assertSourceRun(reread, binding); assertSourceRun(latest, binding);
    assert.equal(canonicalJson(runIdentity(reread)), originalIdentity, 'Source changed during qualification');
    assert.equal(canonicalJson(runIdentity(latest)), originalIdentity, 'Latest source changed during qualification');
    remaining();
    const reuse = {version: 1, repository, repositoryId: repo.id, pr: pr.number, mergeSha: context.sha, sha: head.sha, tree: head.tree.sha,
      workflowId: workflow.id, workflowPath, runId: run.id, attempt: run.run_attempt, planDigest: source.planDigest,
      jobsDigest: evidenceDigest(jobs.map(job => Object.fromEntries(['id', 'run_id', 'run_attempt', 'head_sha', 'name', 'status', 'conclusion'].map(key => [key, job[key]]))).sort((a, b) => a.id - b.id))};
    assertReuseProof(reuse, workflowPath);
    return {reuse, reason: `Verified identical tree from PR #${pr.number}, run ${run.id}, attempt ${run.run_attempt}`};
  } catch (error) {return refuse(error.message);}
}
