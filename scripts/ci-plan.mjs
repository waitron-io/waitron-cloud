import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {resolveRange} from './ci-range.mjs';
import {findReuse, permitsRangeSelection} from './ci-reuse.mjs';
import {bindRuntimeWorkflow, evidenceInvocation, publishRuntimePlan, reuseContextFromEnvironment, runtimeReuseDependencies} from './ci-reuse-runtime.mjs';
import {appendFileSync, readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadWorkspace, scopeForPaths, workPlan, receiptSuites} from './ci-scope.mjs';
import {documentationPlan} from './ci-docs.mjs';
import {receiptPlan} from './ci-receipts.mjs';
import {scriptPlan, isKubernetesProofPath} from './ci-scripts.mjs';
import {scopeForRevisions, readGitBlobs} from './ci-package-revisions.mjs';
import {assertRootInputWork, rootInputPlan} from './ci-root-inputs.mjs';
import {describeLockChanges} from './ci-lock.mjs';
import {lockPackageScope} from './ci-lock-selection.mjs';
import {unreadMarkdown} from './ci-input-audit.mjs';

function mixedCodePaths(paths, base, head, git) {
  const prose = paths.filter(unreadMarkdown);
  try {
    if (prose.length) documentationPlan(prose, base, head, git);
    const proof = paths.filter(isKubernetesProofPath);
    if (proof.length) scriptPlan(proof, base, head, git);
    const remaining = paths.filter(path => !prose.includes(path) && !proof.includes(path));
    return remaining.length ? remaining : paths;
  } catch { return paths; }
}

export function packageWorkForPaths(paths, workspace, base, head, git, testFilesByPackage, kind) {
  if (!paths.length) throw Error('Package work requires nonempty paths');
  const ownersOnly = kind === 'pr';
  let scope = scopeForPaths(paths, workspace, {direct: true, ownersOnly});
  let receiptScope = scopeForPaths(paths, workspace), lockSelection;
  let reason, reviewedPackageReaders = false;
  if (paths.includes('pnpm-lock.yaml') && paths.every(path => path === 'pnpm-lock.yaml' || workspace.some(pkg => path === `${pkg.directory}/package.json`))) {
    try {lockSelection = lockPackageScope(base, head, workspace, git, paths); scope = lockSelection.scope;}
    catch { /* Unproved root or package readers retain full lockfile work. */ }
  }
  if (!lockSelection && !scope.full && scope.packages.length < workspace.length) {
    try {
      let candidateReviewedReaders = false;
      const revisions = scopeForRevisions(paths, workspace, base, head, git, {direct: true, receiptScope: true,
        onReviewedReader: () => { candidateReviewedReaders = true; }});
      reviewedPackageReaders = candidateReviewedReaders;
      if (!ownersOnly) scope.packages = [...new Set([...scope.packages, ...revisions.packages])].sort();
      receiptScope.packages = [...new Set([...receiptScope.packages, ...revisions.receiptPackages])].sort();
    } catch (error) {
      // Package evidence cannot invalidate an independent receipt audit.
      if (!ownersOnly) scope.packages = scopeForPaths([], workspace).packages;
      receiptScope.packages = scopeForPaths([], workspace).packages;
      reason = `Unverified package revisions: ${error.message}: ${ownersOnly ? 'full receipt scope' : 'full package suite'} (${paths.join(', ')})`;
    }
  }
  reason ??= scope.full ? `Shared or unknown paths: full suite (${paths.join(', ')})` : `Selected ${scope.packages.join(', ')}`;
  if (paths.includes('pnpm-lock.yaml')) reason += `; ${lockSelection?.reason ?? describeLockChanges(base, head, git)}`;
  const work = workPlan(scope, workspace, undefined, receiptScope, testFilesByPackage);
  if (lockSelection || reviewedPackageReaders) work.receipts = [...receiptSuites];
  else {
    const selection = receiptPlan(work.receipts, receiptScope, base, head, git);
    work.receipts = selection.receipts;
    if (selection.reason) reason += `; ${selection.reason}`;
  }
  if (reviewedPackageReaders) reason += '; retained all receipt suites while qualifying package readers';
  return {...work, reason};
}

function buildRevisionPlan(range, workspace, git, testFilesByPackage) {
  const full = reason => ({...workPlan(scopeForPaths([], workspace), workspace, undefined, undefined, testFilesByPackage), reuse: null, reason});
  try {
    const {base, head} = range;
    const paths = git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0');
    if (paths.pop() !== '' || !paths.length) throw Error('Incomplete or empty NUL path inventory');
    try {
      const documentation = documentationPlan(paths, base, head, git);
      if (documentation) return {packages: [], receipts: [], typecheck: false, reuse: null, documentation, reason: `Regular prose: ${paths.join(', ')}`};
    } catch { /* Unclassified saved prose keeps the full fallback. */ }
    try {
      const scripts = scriptPlan(paths, base, head, git);
      if (scripts) return {packages: [], receipts: [], typecheck: false, reuse: null, scripts, reason: `Owned root script: ${paths.join(', ')}`};
    } catch { /* Missing or nonregular script targets keep the full fallback. */ }
    const root = rootInputPlan(paths, base, head, git);
    if (root?.full) return full(root.reason);
    if (root) {
      const work = root.packagePaths.length ? packageWorkForPaths(root.packagePaths, workspace, base, head, git, testFilesByPackage, range.kind)
        : {packages: [], receipts: [], typecheck: false, reason: 'Known root owners'};
      return {...work, receipts: [...new Set([...work.receipts, ...root.receipts])], reuse: null,
        rootInputs: root.rootInputs, rootTests: root.rootTests || work.typecheck};
    }
    if (paths.includes('pnpm-lock.yaml') && !paths.every(path => path === 'pnpm-lock.yaml' || workspace.some(pkg => path === `${pkg.directory}/package.json`))) {
      return full(`Shared or unknown paths: full suite (${paths.join(', ')}); ${describeLockChanges(base, head, git)}`);
    }
    return {...packageWorkForPaths(mixedCodePaths(paths, base, head, git), workspace, base, head, git, testFilesByPackage, range.kind), reuse: null};
  } catch {
    return full('Cannot determine revision diff: full suite');
  }
}

function selectRevisionPlan(range, workspace, git, testFilesByPackage) {
  const plan = buildRevisionPlan(range, workspace, git, testFilesByPackage);
  if (plan.reason.length > 4096) plan.reason = plan.reason.slice(0, 4096) + '... (explanation truncated)';
  if (Buffer.byteLength(JSON.stringify(plan)) > 240 * 1024) {
    return {...workPlan(scopeForPaths([], workspace), workspace, undefined, undefined, testFilesByPackage), reuse: null,
      reason: 'Plan evidence exceeds its bound: full suite'};
  }
  return plan;
}

export function selectPlan(range, snapshot, git) {
  assert.equal(snapshot.revision,range.head,'Workspace snapshot revision mismatch');
  assert.ok(Array.isArray(snapshot.packages) && snapshot.packages.length,'Missing workspace packages');
  assert.ok(snapshot.testFilesByPackage && typeof snapshot.testFilesByPackage==='object','Missing saved test inventory');
  const plan = selectRevisionPlan(range,snapshot.packages,git,snapshot.testFilesByPackage);
  assertRootInputWork(plan, {base: range.base, head: range.head, git});
  return plan;
}

export function createPlan(event, context, workspace, git, api, reuseGit = git) {
  const range = resolveRange(event,context,git);
  const full = reason => ({...workPlan(scopeForPaths([],workspace),workspace),reuse:null,reason});
  if (range.kind === 'full') return full(range.reason);
  if (range.kind === 'push') {
    try {
      const parents = git('show', '-s', '--format=%P', range.head).trim().split(' ').filter(Boolean);
      assert.ok(parents.length && parents.every(sha => /^(?!0{40}$)[a-f0-9]{40}$/.test(sha)), 'Invalid push topology');
      if (parents.length !== 1 || parents[0] !== range.base) return selectRevisionPlan(range,workspace,git);
    } catch {return full('Cannot verify push topology: full suite');}
    const result = findReuse({...context, event}, {api, git: reuseGit}, '.github/workflows/ci.yml');
    if (result.reuse) return {packages: [], receipts: [], typecheck: false, reuse: result.reuse, reason: result.reason};
    if (!permitsRangeSelection(result)) return full(`Unverified PR evidence: ${result.reason}: full suite`);
  }
  return selectRevisionPlan(range,workspace,git);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  let context = reuseContextFromEnvironment(event);
  context.full ||= process.env.CI_FORCE_FULL === 'true';
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', args, {encoding: binary ? undefined : 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  };
  git.readBlobs = readGitBlobs;
  let record = process.env.CI_RECORD_EVIDENCE === 'true' && evidenceInvocation(context);
  const dependencies = (record || context.eventName === 'push') && context.repository === 'waitron-io/waitron-cloud'
    ? runtimeReuseDependencies(context) : {};
  if (record) {
      try {context = bindRuntimeWorkflow(context, dependencies.api);}
      catch {context.full = true; record = false; console.log('Workflow identity unavailable: full work without reusable source evidence');}
    }
  const workspace = loadWorkspace();
  const plan = createPlan(event,context,workspace,git,dependencies.api,dependencies.git);
  // Diagnostics share GitHub's job output budget with the executable work plan.
  if (plan.reason.length > 4096) plan.reason = plan.reason.slice(0, 4096) + '... (explanation truncated)';
  const range = resolveRange(event, context, git);
  const complete = workPlan(scopeForPaths([], workspace), workspace);
  const mode = plan.reuse ? 'reused' : plan.typecheck && JSON.stringify(plan.packages) === JSON.stringify(complete.packages) && JSON.stringify(plan.receipts) === JSON.stringify(complete.receipts) ? 'full' : 'selected';
  if (record) publishRuntimePlan(context, plan, git, mode);
  const outputs = {
    mode,
    plan:JSON.stringify(plan), typecheck:String(plan.typecheck), root_tests:String(plan.rootInputs ? plan.rootTests : plan.typecheck),
    documentation:String(Boolean(plan.documentation)),
    scripts:String(Boolean(plan.scripts)),
    packages:String(plan.packages.length>0), receipts:String(plan.receipts.length>0),
    package_matrix:JSON.stringify({include:plan.packages.length ? plan.packages : [{package:'unused',shard:1}]}),
  };
  appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(outputs).map(([key,value])=>`${key}=${value}\n`).join(''));
  console.log(plan.reason);
}
