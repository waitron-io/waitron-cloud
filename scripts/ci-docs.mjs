import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
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
    const count = checkDocumentation(JSON.parse(process.env.CI_PLAN), git);
    console.log(`Checked ${count} changed Markdown paths against audited immutable inputs`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
