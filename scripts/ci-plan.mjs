import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {resolveRange} from './ci-range.mjs';
import {findReuse, permitsRangeSelection} from './ci-reuse.mjs';
import {bindRuntimeWorkflow, evidenceInvocation, publishRuntimePlan, reuseContextFromEnvironment, runtimeReuseDependencies} from './ci-reuse-runtime.mjs';
import {appendFileSync, readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadWorkspace, scopeForPaths, workPlan, receiptSuites} from './ci-scope.mjs';
import {auditDocumentation, documentationPlan} from './ci-docs.mjs';
import {receiptPlan} from './ci-receipts.mjs';
import {scriptPlan} from './ci-scripts.mjs';
import {scopeForRevisions, readGitBlobs} from './ci-package-revisions.mjs';
import {describeLockChanges} from './ci-lock.mjs';
import {lockPackageScope} from './ci-lock-selection.mjs';
import {auditInputMode, auditAllInputModes, readInputAudit, unreadMarkdown} from './ci-input-audit.mjs';

function mixedCodePaths(paths, base, head, git) {
  const prose = paths.filter(unreadMarkdown);
  if (!prose.length || prose.length === paths.length) return paths;
  const policyPath = 'scripts/ci-input-audit.json';
  const evidenceChanged = paths.some(path => path === policyPath || path === 'scripts/ci-input-audit-v2.json' || path.startsWith('scripts/ci-input-audit.d/'));
  try {
    documentationPlan(prose, base, head, git);
    for (const revision of [base, head]) {
      const {entries, policy} = readInputAudit(revision, git);
      // A prose path must be regular in every tree where it exists.
      for (const path of prose) {
        const entry = entries.find(entry => entry.path === path);
        if (entry && (entry.mode !== '100644' || entry.type !== 'blob')) throw Error('Non-regular Markdown');
      }
      // Prose-only base commits keep the document audit current while changing
      // peer inventories. The renewed head must prove every policy mode.
      if (evidenceChanged && revision === head) {
        if (policy.version === 2) auditAllInputModes(revision, git);
        else for (const mode of ['docs', 'identity', 'gateway', 'lock']) {
          auditInputMode(mode, revision, git, Object.keys(policy.manifests));
        }
      }
    }
    return paths.filter(path => !prose.includes(path) && path !== policyPath && path !== 'scripts/ci-input-audit-v2.json' && !path.startsWith('scripts/ci-input-audit.d/'));
  } catch {
    return paths;
  }
}

function buildRevisionPlan(range, workspace, git, testFilesByPackage) {
  let scope = scopeForPaths([],workspace);
  let revisions;
  let receiptScope;
  let lockSelection;
  let reason = 'Main push or unknown diff: full suite';
  {
    try {
      const head = {sha:range.head};
      const mergeBase = range.base;
      const paths = git('diff','--name-only','--no-renames','-z',mergeBase,head.sha).split('\0');
      if (paths.pop() !== '') throw Error('Incomplete NUL path inventory');
      if (!paths.length) throw Error('Empty revision range');
      try {
        const documentation = documentationPlan(paths, mergeBase, head.sha, git);
        if (documentation) return {packages:[], receipts:[], typecheck:false, reuse:null, documentation, reason:`Audited unread Markdown: ${paths.join(', ')}`};
      } catch { /* Missing or stale audit evidence keeps the existing full fallback. */ }
      try {
        const scripts = scriptPlan(paths, mergeBase, head.sha, git);
        if (scripts) return {packages: [], receipts: [], typecheck: false, reuse: null, scripts, reason: `Audited root script: ${paths.join(', ')}`};
      } catch { /* Missing or stale reader evidence keeps the existing full fallback. */ }
      const codePaths = mixedCodePaths(paths, mergeBase, head.sha, git);
      scope = scopeForPaths(codePaths,workspace,{direct:true});
      receiptScope = scopeForPaths(codePaths,workspace);
      if (paths.includes('pnpm-lock.yaml') && paths.every(path => path === 'pnpm-lock.yaml' || workspace.some(pkg => path === `${pkg.directory}/package.json`))) {
        try { lockSelection = lockPackageScope(mergeBase, head.sha, workspace, git, paths); scope = lockSelection.scope; }
        catch { /* Unproved root or package readers retain full lockfile work. */ }
      }
      if (!lockSelection && !scope.full && scope.packages.length < workspace.length) {
        try {
          const revisions = scopeForRevisions(codePaths, workspace, mergeBase, head.sha, git, {direct:true, receiptScope:true});
          scope.packages = [...new Set([...scope.packages, ...revisions.packages])].sort();
          receiptScope.packages = [...new Set([...receiptScope.packages, ...revisions.receiptPackages])].sort();
        }
        catch (error) {
          // Package evidence cannot invalidate an independent receipt audit.
          scope.packages = scopeForPaths([], workspace).packages;
          receiptScope.packages = [...scope.packages];
          reason = `Unverified package revisions: ${error.message}: full package suite (${paths.join(', ')})`;
        }
      }
      revisions = {base:mergeBase, head:head.sha};
      if (!reason.startsWith('Unverified package revisions:')) reason = scope.full ? `Shared, unaudited or unknown paths: full suite (${paths.join(', ')})` : `Selected ${scope.packages.join(', ')}`;
      if (paths.includes('pnpm-lock.yaml')) reason += `; ${lockSelection?.reason ?? describeLockChanges(mergeBase, head.sha, git)}`;
    } catch {
      scope = scopeForPaths([],workspace);
      revisions = undefined;
      lockSelection = undefined;
      reason = 'Cannot determine revision diff: full suite';
    }
  }
  const work = workPlan(scope,workspace,undefined,receiptScope ?? scope,testFilesByPackage);
  if (lockSelection) work.receipts = [...receiptSuites];
  if (revisions && !lockSelection) {
    const selection = receiptPlan(work.receipts, receiptScope ?? scope, revisions.base, revisions.head, git);
    work.receipts = selection.receipts;
    if (selection.reason) reason += `; ${selection.reason}`;
  }
  return {...work,reuse:null,reason};
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
  return selectRevisionPlan(range,snapshot.packages,git,snapshot.testFilesByPackage);
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
  // Warn on every plan, including paths that never enter the document selector.
  // Audit renewal requires explicit reader review; warnings never bypass admission checks.
  try { auditDocumentation(git('rev-parse', 'HEAD').trim(), git); }
  catch {
    console.log('::warning title=Documentation-only CI unavailable::Review changed executable inputs, then renew documentation evidence (scripts/ci-input-audit.json in v1; docs records in v2) with --write-staged using docs/ci-documentation-audit.md. V2 peer records may remain stale and retain full work. Docs-only changes retain full CI, and the required root/script freshness check fails until reviewed and renewed.');
  }
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
    plan:JSON.stringify(plan), typecheck:String(plan.typecheck),
    documentation:String(Boolean(plan.documentation)),
    scripts:String(Boolean(plan.scripts)),
    packages:String(plan.packages.length>0), receipts:String(plan.receipts.length>0),
    package_matrix:JSON.stringify({include:plan.packages.length ? plan.packages : [{package:'unused',shard:1}]}),
  };
  appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(outputs).map(([key,value])=>`${key}=${value}\n`).join(''));
  console.log(plan.reason);
}
