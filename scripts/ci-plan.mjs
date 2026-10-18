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

export function createPlan(event, context, workspace, git, api) {
  let scope = scopeForPaths([],workspace);
  let revisions;
  let lockSelection;
  let reason = 'Main push or unknown diff: full suite';
  if (event.pull_request) {
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
      scope = scopeForPaths(paths,workspace);
      if (paths.includes('pnpm-lock.yaml') && paths.every(path => path === 'pnpm-lock.yaml' || workspace.some(pkg => path === `${pkg.directory}/package.json`))) {
        try { lockSelection = lockPackageScope(mergeBase, head.sha, workspace, git, paths); scope = lockSelection.scope; }
        catch { /* Unproved root or package readers retain full lockfile work. */ }
      }
      if (!lockSelection && !scope.full && scope.packages.length < workspace.length) {
        try {
          const revisions = scopeForRevisions(paths, workspace, mergeBase, head.sha, git);
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
  const context = {sha:process.env.GITHUB_SHA,repository:process.env.GITHUB_REPOSITORY,branch:process.env.GITHUB_REF_NAME};
  const git = (...args) => {
    if (args[0]==='rev-parse' && /^[a-f0-9]{40}\^\{tree\}$/.test(args[1])) {
      const sha=args[1].slice(0,40);
      try { execFileSync('git',['cat-file','-e',sha],{stdio:'ignore',timeout:10_000}); }
      catch { execFileSync('git',['fetch','--no-tags','origin',sha],{stdio:'ignore',timeout:30_000}); }
    }
    return execFileSync('git',args,{encoding:'utf8',timeout:30_000,stdio:['ignore','pipe','pipe']});
  };
  git.readBlobs = readGitBlobs;
  const api = path => JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',timeout:30_000,stdio:['ignore','pipe','ignore']}));
  // Warn on every plan, including paths that never enter the document selector.
  // Audit renewal requires explicit reader review; warnings never bypass admission checks.
  try { auditDocumentation(git('rev-parse', 'HEAD').trim(), git); }
  catch {
    console.log('::warning title=Documentation-only CI unavailable::Review changed executable inputs and renew scripts/ci-input-audit.json with --write-staged using docs/ci-documentation-audit.md. Docs-only changes retain full CI until reviewed.');
  }
  const plan = createPlan(event,context,loadWorkspace(),git,api);
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
