import assert from 'node:assert/strict';
import {assertArtifactMetadata, decodePlanArchive} from './ci-plan-artifact.mjs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {appendFileSync, readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {assertDocumentation} from './ci-docs.mjs';
import {assertScriptWork} from './ci-scripts.mjs';
import {assertPackageAllocations} from './ci-summary.mjs';
import {assertReceiptSuites} from './ci-run-receipts.mjs';
import {conformanceMatrix} from './cloud-cost/conformance.mjs';
import {assertReuseProof, workflowPaths} from './ci-reuse-proof.mjs';
import {createDecisionEvidence, readbackDecision} from './ci-decision.mjs';
import {readRuntimeReuseContext, runtimeReuseDependencies} from './ci-reuse-runtime.mjs';

export {assertReuseProof};
export const maxEvidenceBytes = 256 * 1024;
const sha = /^(?!0{40}$)[a-f0-9]{40}$/;
const positive = value => Number.isSafeInteger(value) && value > 0;
const ci = workflowPaths[0];
const packagePlaceholder = "package (${{ matrix.package }}${{ ((matrix.shards && format(', shard {0}/{1}', matrix.shard, matrix.shards)) || '') }})";

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), 'Nonfinite JSON value');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    assert.equal(Object.keys(value).length, value.length, 'Sparse or extended JSON array');
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  assert.ok(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'Non-JSON value');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
export const evidenceDigest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');

function assertRange(selection) {
  assert.match(selection.base, sha, 'Invalid selection base');
  assert.match(selection.head, sha, 'Invalid selection head');
  assert.notEqual(selection.base, selection.head, 'Empty selection range');
  assert.ok(Array.isArray(selection.paths) && selection.paths.length > 0 &&
    selection.paths.every(path => typeof path === 'string' && path.length > 0 && !path.startsWith('/') &&
      !path.split('/').some(part => ['.', '..', ''].includes(part)) && !/[\0\r\n]/.test(path)) &&
    new Set(selection.paths).size === selection.paths.length, 'Invalid selection paths');
  assert.equal(typeof selection.required, 'boolean', 'Missing selection requirement');
}

export function expectedJobContract(workflowPath, selection) {
  assert.ok(workflowPaths.includes(workflowPath), 'Unknown workflow contract');
  assert.ok(selection && typeof selection === 'object', 'Missing workflow selection');
  const required = [];
  const skipped = [];
  const add = (needed, names, placeholder = names) => (needed ? required : skipped).push(...(needed ? names : placeholder));
  if (workflowPath === ci) {
    assert.ok(Array.isArray(selection.packages) && Array.isArray(selection.receipts) && typeof selection.typecheck === 'boolean', 'Missing CI plan');
    const modes = [selection.scripts, selection.documentation, selection.reuse].filter(Boolean);
    assert.ok(modes.length <= 1, 'CI work modes cannot mix');
    if (selection.scripts) assertScriptWork(selection);
    else if (selection.documentation || selection.reuse) {
      if (selection.documentation) assertDocumentation(selection.documentation);
      else assertReuseProof(selection.reuse, workflowPath);
      assert.equal(selection.packages.length + selection.receipts.length, 0, 'Special mode cannot select suites');
      assert.equal(selection.typecheck, false, 'Special mode cannot select types');
    } else {
      assert.ok(selection.packages.length > 0, 'Empty scope cannot pass');
      assert.equal(selection.typecheck, true, 'Selected work requires types');
    }
    assertPackageAllocations(selection.packages);
    if (selection.receipts.length) assertReceiptSuites(selection.receipts);
    required.push('changes');
    add(Boolean(selection.scripts), ['scripts']);
    add(Boolean(selection.documentation), ['documentation']);
    add(selection.typecheck, ['typecheck']);
    add(selection.typecheck, ['root (1/4)', 'root (2/4)', 'root (3/4)', 'root (4/4)'], ['root (${{ matrix.shard }}/4)']);
    add(selection.packages.length > 0, selection.packages.map(row => `package (${row.package}${row.shards ? `, shard ${row.shard}/${row.shards}` : ''})`), [packagePlaceholder]);
    add(selection.receipts.length > 0, ['receipts']);
  } else {
    if (selection.reuse) {
      assertReuseProof(selection.reuse, workflowPath);
      assert.equal(selection.required, false, 'Reused sibling cannot run native checks');
      assert.equal(selection.full, undefined, 'Reused sibling cannot be a full invocation');
    } else if (selection.full === true) {
      assert.equal(selection.required, true, 'A full workflow must run native checks');
      assert.match(selection.head, sha, 'Invalid full workflow head');
      assert.equal(selection.base, undefined, 'Full workflow cannot claim a selected range');
      assert.equal(selection.paths, undefined, 'Full workflow cannot claim selected paths');
    } else assertRange(selection);
    required.push(workflowPath.endsWith('/cloud-cost.yml') ? 'discover' : 'changes');
    if (workflowPath.endsWith('/cloud-cost.yml')) {
      if (selection.required) {
        assert.deepEqual(selection.matrix, conformanceMatrix(), 'Cost matrix must contain every native allocation');
        add(true, selection.matrix.map(row => `cost (${row.file}, ${row.group})`));
      } else add(false, [], ['cost (${{ matrix.file }}, ${{ matrix.group }})']);
    } else if (workflowPath.endsWith('/venue-services-proof.yml')) {
      add(selection.required, ['service-receipts (legacy)', 'service-receipts (venue)'], ['service-receipts (${{ matrix.receipt }})']);
    } else if (workflowPath.endsWith('/aws-infrastructure.yml')) {
      assert.ok(selection.required || selection.reuse, 'AWS source must run its checks');
      add(selection.required, ['verify (guards-1)', 'verify (guards-2)', 'verify (guards-3)', 'verify (suites)'], ['verify (${{ matrix.cell }})']);
    } else {
      assert.ok(selection.required || selection.reuse, 'Diagnostic source must run its checks');
      add(selection.required, ['linux-contention']);
    }
  }
  required.push('summary');
  const names = required.concat(skipped);
  assert.equal(new Set(names).size, names.length, 'Duplicate contract identity');
  return {required, skipped};
}

export function createPlanEvidence(input) {
  const record = structuredClone(input);
  assert.equal(record?.version, 1, 'Unsupported plan evidence');
  assert.equal(record.repository, 'waitron-io/waitron-cloud', 'Wrong evidence repository');
  for (const key of ['repositoryId', 'pr', 'runId', 'attempt']) assert.ok(positive(record[key]), `Invalid evidence ${key}`);
  const {event, checkout, workflow} = record;
  assert.equal(event?.name, 'pull_request', 'Source must be a PR event');
  assert.equal(event.number, record.pr, 'Wrong original PR');
  for (const side of ['base', 'head']) {
    assert.match(event[side]?.sha, sha, 'Invalid original revision');
    assert.equal(event[side].repositoryId, record.repositoryId, 'Wrong original repository ID');
    assert.equal(event[side].repository, record.repository, 'Wrong original repository');
    assert.ok(typeof event[side].ref === 'string' && /^[A-Za-z0-9_./-]+$/.test(event[side].ref), 'Invalid original branch');
  }
  assert.equal(event.base.ref, 'main', 'Source base must be main');
  assert.match(event.mergeBase, sha, 'Invalid original merge base');
  assert.match(event.sha, sha, 'Invalid event execution commit');
  assert.equal(checkout?.sha, event.head.sha, 'Checkout must be the PR head');
  assert.match(checkout.tree, sha, 'Invalid checked-out tree');
  assert.ok(positive(workflow?.id) && workflowPaths.includes(workflow.path), 'Invalid evidence workflow');
  assert.equal(workflow.ref, `${record.repository}/${workflow.path}@refs/pull/${record.pr}/merge`, 'Wrong workflow reference');
  assert.match(workflow.sha, sha, 'Invalid workflow revision');
  assert.equal(workflow.executionSha, event.sha, 'Wrong workflow execution commit');
  expectedJobContract(workflow.path, record.selection);
  assert.ok(!record.selection.reuse, 'A reused run cannot be a PR source');
  record.planDigest = evidenceDigest(record.selection);
  assert.ok(Buffer.byteLength(canonicalJson(record)) <= maxEvidenceBytes, 'Plan evidence is too large');
  return record;
}

export function parsePlanEvidence(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maxEvidenceBytes, 'Invalid evidence size');
  const record = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  const checked = createPlanEvidence(record);
  assert.equal(record.planDigest, checked.planDigest, 'Plan digest does not match selection');
  return checked;
}

export function assertSourceEvidence(source, selection, jobs, contract) {
  const checked = parsePlanEvidence(Buffer.from(canonicalJson(source)));
  assert.equal(canonicalJson(checked.selection), canonicalJson(selection), 'Reconstructed source selection differs');
  assert.deepEqual(contract, expectedJobContract(checked.workflow.path, selection), 'Wrong source job contract');
  assert.ok(Array.isArray(jobs) && jobs.length > 0, 'Missing source jobs');
  assert.equal(new Set(jobs.map(job => job.id)).size, jobs.length, 'Duplicate source job ID');
  assert.equal(new Set(jobs.map(job => job.name)).size, jobs.length, 'Duplicate source job name');
  assert.equal(jobs.length, contract.required.length + contract.skipped.length, 'Incomplete source job inventory');
  for (const job of jobs) {
    assert.ok(positive(job.id), 'Invalid source job ID');
    assert.equal(job.run_id, checked.runId, 'Wrong source run');
    assert.equal(job.run_attempt, checked.attempt, 'Wrong source attempt');
    assert.equal(job.head_sha, checked.checkout.sha, 'Wrong source head');
    assert.ok(contract.required.includes(job.name) || contract.skipped.includes(job.name), 'Unknown source job');
    assert.equal(job.status, 'completed', 'Source job is unfinished');
    assert.equal(job.conclusion, contract.required.includes(job.name) ? 'success' : 'skipped', 'Source job did not match its plan');
  }
}

export function capturePlanEvidence(event, context, selection, git) {
  assert.equal(context.eventName, 'pull_request', 'Only PR events publish source evidence');
  const pr = event?.pull_request;
  assert.equal(event.number, pr?.number, 'Conflicting original PR number');
  const side = value => ({sha: value?.sha, ref: value?.ref, repositoryId: value?.repo?.id, repository: value?.repo?.full_name});
  const checkoutSha = git('rev-parse', 'HEAD').trim();
  return createPlanEvidence({version: 1, repository: context.repository, repositoryId: context.repositoryId, pr: event.number,
    event: {name: context.eventName, number: event.number, base: side(pr.base), head: side(pr.head),
      mergeBase: git('merge-base', pr.base.sha, pr.head.sha).trim(), sha: context.sha},
    checkout: {sha: checkoutSha, tree: git('rev-parse', `${checkoutSha}^{tree}`).trim()},
    workflow: {id: context.workflowId, path: context.workflowPath, ref: context.workflowRef,
      sha: context.workflowSha, executionSha: context.sha}, runId: context.runId, attempt: context.attempt, selection});
}

export function readPlanArtifact(artifact, bytes, identity) {
  assertArtifactMetadata(artifact, bytes, identity, maxEvidenceBytes);
  const record = parsePlanEvidence(decodePlanArchive(bytes, maxEvidenceBytes));
  assert.equal(record.runId, identity.runId, 'Artifact content run differs');
  assert.equal(record.attempt, identity.attempt, 'Artifact content attempt differs');
  assert.equal(record.checkout.sha, identity.head, 'Artifact content head differs');
  assert.equal(record.repositoryId, identity.repositoryId, 'Artifact content repository differs');
  assert.equal(record.workflow.path, identity.workflowPath, 'Artifact content workflow differs');
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.ok(process.argv.length === 4 && ['--write', '--decision', '--readback'].includes(process.argv[2]), 'Use --write, --decision or --readback <plan.json>');
    if (process.argv[2] !== '--write') {
      if (process.argv[2] === '--readback') {
        const bytes = readFileSync(process.argv[3]);
        assert.ok(bytes.length > 0 && bytes.length <= maxEvidenceBytes, 'Invalid decision size');
        const record = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
        console.log(canonicalJson(readbackDecision(record, runtimeReuseDependencies(record.context))));
      } else {
        const context = readRuntimeReuseContext();
        const {git} = runtimeReuseDependencies(context);
        const record = createDecisionEvidence(context, JSON.parse(process.env.CI_PLAN), git, process.env.CI_MODE);
        writeFileSync(process.argv[3], canonicalJson(record) + '\n', {flag: 'wx'});
        const key = record.workflowPath.slice('.github/workflows/'.length, -4);
        if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `artifact_name=ci-decision-v1-${key}-${context.runId}-${context.attempt}\n`);
      }
    } else {
      const env = process.env;
      const workflowPath = env.GITHUB_WORKFLOW_REF?.match(/^waitron-io\/waitron-cloud\/(\.github\/workflows\/[a-z-]+\.yml)@/)?.[1];
      const context = {repository: env.GITHUB_REPOSITORY, repositoryId: Number(env.GITHUB_REPOSITORY_ID),
        eventName: env.GITHUB_EVENT_NAME, sha: env.GITHUB_SHA, runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT),
        workflowId: Number(env.CI_WORKFLOW_ID), workflowPath, workflowRef: env.GITHUB_WORKFLOW_REF, workflowSha: env.GITHUB_WORKFLOW_SHA};
      const git = (...args) => execFileSync('git', args, {encoding: 'utf8', timeout: 5000, maxBuffer: maxEvidenceBytes, killSignal: 'SIGKILL'});
      const eventBytes = readFileSync(env.GITHUB_EVENT_PATH);
      assert.ok(eventBytes.length <= 1024 * 1024, 'Original event is too large');
      const record = capturePlanEvidence(JSON.parse(eventBytes), context, JSON.parse(env.CI_PLAN), git);
      writeFileSync(process.argv[3], canonicalJson(record) + '\n', {flag: 'wx'});
      const key = workflowPath.slice('.github/workflows/'.length, -'.yml'.length);
      const artifactName = `ci-plan-v1-${key}-${record.runId}-${record.attempt}`;
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `artifact_name=${artifactName}\n`);
      console.log(`Recorded source plan for run ${record.runId}, attempt ${record.attempt}: ${artifactName}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
