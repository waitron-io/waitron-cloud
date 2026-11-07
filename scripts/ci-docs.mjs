import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFileSync, readFileSync} from 'node:fs';
import {readInputInventory, unreadMarkdown} from './ci-input-audit.mjs';
export {unreadMarkdown} from './ci-input-audit.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';
import {pathToFileURL} from 'node:url';
import {proofInputPlan} from './ci-proof-inputs.mjs';

const shaPattern = /^[a-f0-9]{40}$/;

export function assertDocumentation(documentation) {
  assert.ok(documentation && shaPattern.test(documentation.base) && shaPattern.test(documentation.head), 'Missing document revisions');
  assert.ok(Array.isArray(documentation.paths) && documentation.paths.length > 0 &&
    documentation.paths.every(unreadMarkdown) && new Set(documentation.paths).size === documentation.paths.length, 'Invalid document paths');
}

export function readDocumentation(sha, git) {
  const entries = readInputInventory(sha, git);
  return {documents: new Set(entries.filter(row => row.mode === '100644' && row.type === 'blob' && unreadMarkdown(row.path)).map(row => row.path)), entries};
}

export function documentationPlan(paths, base, head, git) {
  if (!paths.length || !paths.every(unreadMarkdown)) return null;
  assertDocumentation({base, head, paths});
  const trees = [base, head].map(sha => readDocumentation(sha, git));
  assert.ok(paths.every(path => trees.some(tree => tree.documents.has(path)) && trees.every(tree => {
    const entry = tree.entries.find(entry => entry.path === path);
    return !entry || entry.mode === '100644' && entry.type === 'blob';
  })), 'Document must be regular prose in every saved tree where it exists');
  return {base, head, paths};
}

export function checkDocumentation(plan, git) {
  assertDocumentation(plan.documentation);
  const {base, head, paths} = plan.documentation;
  const actual = git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0');
  assert.equal(actual.pop(), '');
  assert.deepEqual([...paths].sort(), actual.sort(), 'Document plan omits changed inputs');
  documentationPlan(paths, base, head, git);
  const current = readDocumentation(head, git).documents;
  for (const path of paths) {
    if (!current.has(path)) continue;
    const content = git('show', `${head}:${path}`, {binary: true});
    let text;
    try { text = new TextDecoder('utf-8', {fatal: true}).decode(content); }
    catch { throw Error(`${path}: invalid UTF-8`); }
    assert.ok(!text.includes('\0'), `${path}: NUL in Markdown`);
    assert.ok(text.endsWith('\n'), `${path}: missing final newline`);
  }
  return paths.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const git = (...args) => {
      const binary = typeof args.at(-1) === 'object' && args.pop().binary;
      return execFileSync('git', args, {encoding: binary ? undefined : 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024});
    };
    git.readBlobs = readGitBlobs;
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--plan') {
      if (process.env.CI_FORCE_FULL === 'true') {
        appendFileSync(process.env.GITHUB_OUTPUT, 'required=true\n');
        console.log('Explicit full proof run');
      } else if (process.env.CI_PROOF_KIND) {
        let event = {};
        try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); }
        catch { /* Missing event evidence retains a complete proof run. */ }
        const plan = proofInputPlan(process.env.CI_PROOF_KIND, event, git);
        appendFileSync(process.env.GITHUB_OUTPUT, `required=${plan.required}\n`);
        console.log(plan.reason);
      } else {
        let documentation = null;
        try {
          const {pull_request: pr} = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
          if (process.env.CI_FORCE_FULL !== 'true' && pr) {
            assert.ok([pr.base.sha, pr.head.sha].every(sha => shaPattern.test(sha)), 'Invalid proof revisions');
            const base = git('merge-base', pr.base.sha, pr.head.sha).trim();
            const paths = git('diff', '--name-only', '--no-renames', '-z', base, pr.head.sha).split('\0');
            assert.equal(paths.pop(), '', 'Incomplete proof diff');
            documentation = documentationPlan(paths, base, pr.head.sha, git);
          }
        } catch { /* Unclassified saved inputs retain all proof work. */ }
        appendFileSync(process.env.GITHUB_OUTPUT, `required=${!documentation}\n`);
        console.log(documentation ? 'Regular prose: no proof tests required' : 'Full proof work required');
      }
    } else {
      assert.equal(args.length, 0, 'Usage: ci-docs.mjs [--plan]');
      const count = checkDocumentation(JSON.parse(process.env.CI_PLAN), git);
      console.log(`Checked ${count} changed Markdown paths against immutable saved inputs`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
