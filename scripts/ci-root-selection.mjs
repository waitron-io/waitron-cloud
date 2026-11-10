import assert from 'node:assert/strict';
import {lstatSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readInputInventory, unreadMarkdown} from './ci-input-audit.mjs';
import {rootVerificationContext} from './ci-root-inputs.mjs';

const omitted = new Set(['indirect', 'directories', 'arrays', 'expression-unicode', 'computed',
  'unicode', 'middle-unicode', 'first-unicode', 'bracket-receivers']
  .map(name => `scripts/ci-package-revisions-${name}.test.mjs`));
const explicit = ['scripts/identity-upstream.test.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs',
  'scripts/billing-display-guard-probes.test.mjs', 'scripts/venue-service-guard-probes.test.mjs'];
const rootTest = path => /^scripts\/ci-[^/]+\.test\.mjs$/.test(path) || explicit.includes(path);
const regular = row => row?.mode === '100644' && row.type === 'blob';

export function selectRootFiles(shard, {base, head, git, root = process.cwd(), mode, eventName, forceFull}) {
  assert.ok(eventName === 'pull_request' && mode === 'selected' && ['', 'false'].includes(forceFull), 'Keep full root work');
  assert.ok(Number.isInteger(shard) && shard >= 1 && shard <= 8, 'Unknown root partition');
  const trees = [base, head].map(revision => readInputInventory(revision, git));
  const paths = git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0');
  assert.equal(paths.pop(), '', 'Incomplete changed paths');
  assert.ok(paths.length, 'Empty changed paths');
  for (const path of paths) {
    assert.ok(!path.split('/').includes('.gitattributes'), 'Changed checkout attributes');
    assert.ok(trees.every(tree => {
      const entry = tree.find(row => row.path === path);
      return !entry || regular(entry);
    }), 'Nonregular changed input');
    const directory = /^(packages\/[^/]+|apps\/[^/]+)\/(?:src|test)\/.+/.exec(path)?.[1];
    if (directory) {
      assert.ok(trees.every(tree => regular(tree.find(row => row.path === `${directory}/package.json`))), 'New or unknown package');
    } else assert.ok(unreadMarkdown(path), 'Shared or unknown changed input');
  }
  const files = trees[1].filter(row => rootTest(row.path));
  assert.ok(files.every(regular), 'Nonregular root inventory');
  const actual = readdirSync(join(root, 'scripts')).map(name => `scripts/${name}`).filter(rootTest).sort();
  assert.deepEqual(actual, files.map(row => row.path).sort(), 'Root filesystem differs from Git');
  assert.ok(actual.every(path => lstatSync(join(root, path)).isFile()), 'Nonregular root filesystem');
  // Preserve Node's original assignments so independent full-command fallbacks cannot lose a file.
  return actual.filter((_, index) => index % 8 === shard - 1).filter(path => !omitted.has(path));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const shard = Number(process.argv[2]);
    const context = rootVerificationContext({}, process.env);
    const files = selectRootFiles(shard, {...context, mode: process.env.CI_MODE,
      eventName: process.env.GITHUB_EVENT_NAME, forceFull: process.env.CI_FORCE_FULL});
    const inventory = readdirSync('scripts').map(name => `scripts/${name}`).filter(rootTest).sort();
    console.error('Root advice omits: ' + inventory.filter((path, index) => index % 8 === shard - 1 && omitted.has(path)).join(', '));
    if (files.length) console.log(files.join('\n'));
  } catch (error) {
    console.error('Root advice unavailable: ' + error.message.split('\n')[0]);
    process.exitCode = 1;
  }
}
