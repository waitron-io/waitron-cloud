import {execFileSync} from 'node:child_process';
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

export function createPlan(event, context, workspace, git, api) {
  let scope = scopeForPaths([],workspace);
  let revisions;
  let lockSelection;
  let reason = 'Main push or unknown diff: full suite';
  if (context.full !== true && event.pull_request) {
    try {
      const {head,base} = event.pull_request;
      if (![head.sha,base.sha].every(sha=>/^[a-f0-9]{40}$/.test(sha))) throw Error('Invalid event SHA');
      const mergeBase = git('merge-base',base.sha,head.sha).trim();
      const paths = git('diff','--name-only','--no-renames','-z',mergeBase,head.sha).split('\0');
      if (paths.at(-1)==='') paths.pop();
      try {
        const documentation = documentationPlan(paths, mergeBase, head.sha, git);
        if (documentation) return {packages:[], receipts:[], typecheck:false, reuse:null, documentation, reason:`Audited unread Markdown: ${paths.join(', ')}`};
      } catch { /* Missing or stale audit evidence keeps the existing full fallback. */ }
      try {
        const scripts = scriptPlan(paths, mergeBase, head.sha, git);
        if (scripts) return {packages: [], receipts: [], typecheck: false, reuse: null, scripts, reason: `Audited root script: ${paths.join(', ')}`};
      } catch { /* Missing or stale reader evidence keeps the existing full fallback. */ }
      const codePaths = mixedCodePaths(paths, mergeBase, head.sha, git);
      scope = scopeForPaths(codePaths,workspace);
      if (paths.includes('pnpm-lock.yaml') && paths.every(path => path === 'pnpm-lock.yaml' || workspace.some(pkg => path === `${pkg.directory}/package.json`))) {
        try { lockSelection = lockPackageScope(mergeBase, head.sha, workspace, git, paths); scope = lockSelection.scope; }
        catch { /* Unproved root or package readers retain full lockfile work. */ }
      }
      if (!lockSelection && !scope.full && scope.packages.length < workspace.length) {
        try {
          const revisions = scopeForRevisions(codePaths, workspace, mergeBase, head.sha, git);
          scope.packages = [...new Set([...scope.packages, ...revisions.packages])].sort();
        }
        catch (error) {
          // Package evidence cannot invalidate an independent receipt audit.
          scope.packages = scopeForPaths([], workspace).packages;
          reason = `Unverified package revisions: ${error.message}: full package suite (${paths.join(', ')})`;
        }
      }
      revisions = {base:mergeBase, head:head.sha};
      if (!reason.startsWith('Unverified package revisions:')) reason = scope.full ? `Shared, unaudited or unknown paths: full suite (${paths.join(', ')})` : `Selected ${scope.packages.join(', ')}`;
      if (paths.includes('pnpm-lock.yaml')) reason += `; ${lockSelection?.reason ?? describeLockChanges(mergeBase, head.sha, git)}`;
    } catch {
      reason = 'Cannot determine PR diff: full suite';
    }
  }
  const work = workPlan(scope,workspace);
  if (lockSelection) work.receipts = [...receiptSuites];
  if (revisions && !lockSelection) {
    const selection = receiptPlan(work.receipts, scope, revisions.base, revisions.head, git);
    work.receipts = selection.receipts;
    if (selection.reason) reason += `; ${selection.reason}`;
  }
  return {...work,reuse:null,reason};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  const context = {sha:process.env.GITHUB_SHA,repository:process.env.GITHUB_REPOSITORY,branch:process.env.GITHUB_REF_NAME,full:process.env.CI_FORCE_FULL === 'true'};
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
  const plan = createPlan(event,context,loadWorkspace(),git);
  // Diagnostics share GitHub's job output budget with the executable work plan.
  if (plan.reason.length > 4096) plan.reason = plan.reason.slice(0, 4096) + '... (explanation truncated)';
  const outputs = {
    plan:JSON.stringify(plan), typecheck:String(plan.typecheck),
    documentation:String(Boolean(plan.documentation)),
    scripts:String(Boolean(plan.scripts)),
    packages:String(plan.packages.length>0), receipts:String(plan.receipts.length>0),
    package_matrix:JSON.stringify({include:plan.packages.length ? plan.packages : [{package:'unused',shard:1}]}),
  };
  appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(outputs).map(([key,value])=>`${key}=${value}\n`).join(''));
  console.log(plan.reason);
}
