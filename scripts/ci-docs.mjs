import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFileSync, readFileSync} from 'node:fs';
import {auditInputMode, unreadMarkdown} from './ci-input-audit.mjs';
export {unreadMarkdown} from './ci-input-audit.mjs';
import {pathToFileURL} from 'node:url';

const shaPattern = /^[a-f0-9]{40}$/;

export function assertDocumentation(documentation) {
  assert.ok(documentation && shaPattern.test(documentation.base) && shaPattern.test(documentation.head), 'Missing document revisions');
  assert.ok(Array.isArray(documentation.paths) && documentation.paths.length > 0 &&
    documentation.paths.every(unreadMarkdown) && new Set(documentation.paths).size === documentation.paths.length, 'Invalid document paths');
}

export function auditDocumentation(sha, git) {
  assert.match(sha, shaPattern, 'Invalid document audit revision');
  const {documents, inputSha256} = auditInputMode('docs', sha, git);
  return {documents, digest: inputSha256};
}

export function documentationPlan(paths, base, head, git) {
  if (!paths.length || !paths.every(unreadMarkdown)) return null;
  assertDocumentation({base, head, paths});
  const trees = [base, head].map(sha => auditDocumentation(sha, git));
  assert.ok(paths.every(path => trees.some(tree => tree.documents.has(path))), 'Document is not audited regular prose');
  return {base, head, paths};
}

export function checkDocumentation(plan, git) {
  assertDocumentation(plan.documentation);
  const {base, head, paths} = plan.documentation;
  const actual = git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0');
  assert.equal(actual.pop(), '');
  assert.deepEqual([...paths].sort(), actual.sort(), 'Document plan omits changed inputs');
  documentationPlan(paths, base, head, git);
  const current = auditDocumentation(head, git).documents;
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
      return execFileSync('git', args, {encoding: binary ? undefined : 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024});
    };
    const args = process.argv.slice(2);
    if (args.length === 2 && args[0] === '--audit') {
      try { auditDocumentation(args[1], git); }
      catch (error) {
        throw new Error(`${error.message}\nReview changed readers, then renew with node scripts/ci-input-audit.mjs --write-staged as described in docs/ci-documentation-audit.md.`);
      }
      console.log('Documentation reader audit is current');
    } else if (args.length === 1 && args[0] === '--plan') {
      let documentation = null;
      try {
        const {pull_request: pr} = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
        if (pr) {
          assert.ok([pr.base.sha, pr.head.sha].every(sha => shaPattern.test(sha)), 'Invalid proof revisions');
          const base = git('merge-base', pr.base.sha, pr.head.sha).trim();
          const paths = git('diff', '--name-only', '--no-renames', '-z', base, pr.head.sha).split('\0');
          assert.equal(paths.pop(), '', 'Incomplete proof diff');
          documentation = documentationPlan(paths, base, pr.head.sha, git);
        }
      } catch { /* Missing or stale evidence retains all proof work. */ }
      appendFileSync(process.env.GITHUB_OUTPUT, `required=${!documentation}\n`);
      console.log(documentation ? 'Audited unread Markdown: no proof tests required' : 'Full proof work required');
    } else {
      assert.equal(args.length, 0, 'Usage: ci-docs.mjs [--audit <commit> | --plan]');
      const count = checkDocumentation(JSON.parse(process.env.CI_PLAN), git);
      console.log(`Checked ${count} changed Markdown paths against audited immutable inputs`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
