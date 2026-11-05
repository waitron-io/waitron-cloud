import assert from 'node:assert/strict';
import {checkRootReview, rootReviewProjection, rootRecordRoot, rootRegistryPath} from './ci-root-review.mjs';
import {auditDescriptor, auditRecordRoot} from './ci-input-audit-records.mjs';
import {readInputAudit, unreadMarkdown} from './ci-input-audit.mjs';

const candidates = new Set(['scripts/ci-root-shards.test.mjs', 'scripts/verify-backup-capacity-receipt.test.mjs',
  'deploy/local-stack/operations-health.test.mjs']);
const sha = /^[a-f0-9]{40}$/;
const manifestPattern = /^(?:apps|packages)\/[^/\\]+\/package\.json$/;

function packageInventory(revision, entries, git) {
  const manifests = entries.filter(e => manifestPattern.test(e.path));
  const policy = entries.find(e => e.path === 'pnpm-workspace.yaml');
  assert.ok(policy?.mode === '100644' && policy.type === 'blob', 'Missing regular root workspace policy');
  assert.match(git('show', `${revision}:pnpm-workspace.yaml`), /^packages:\s*\n  - 'packages\/\*'\s*\n  - 'apps\/\*'\s*$/, 'Unsupported root workspace policy');
  const directories = new Set(entries.filter(e => /^(?:apps|packages)\//.test(e.path)).map(e => e.path.split('/').slice(0, 2).join('/')));
  assert.deepEqual(manifests.map(e => e.path.slice(0, -'/package.json'.length)).sort(), [...directories].sort(),
    'Shared or unknown root input: incomplete root workspace membership');
  const packages = new Map(), names = new Set();
  for (const entry of manifests) {
    assert.ok(entry.mode === '100644' && entry.type === 'blob', `Nonregular root workspace manifest: ${entry.path}`);
    const manifest = JSON.parse(git('show', `${revision}:${entry.path}`));
    assert.ok(typeof manifest.name === 'string' && manifest.name.trim() && !names.has(manifest.name), 'Invalid root workspace identity');
    assert.ok(typeof manifest.scripts?.test === 'string' && manifest.scripts.test.trim(), 'Missing root workspace test command');
    names.add(manifest.name); packages.set(entry.path.slice(0, -'/package.json'.length), {name: manifest.name, test: manifest.scripts.test});
  }
  return packages;
}

export function rootInputPlan(paths, base, head, git) {
  if (!paths.some(path => candidates.has(path) || path === rootRegistryPath || path.startsWith(rootRecordRoot))) return null;
  try {
    assert.ok(paths.length > 0 && new Set(paths).size === paths.length && paths.every(path => typeof path === 'string' && !path.includes('\0')), 'Invalid root changed paths');
    assert.ok(sha.test(base) && sha.test(head), 'Invalid root revisions');
    // Inspect both trees even if one refuses: a fresh head cannot bless a stale
    // base, and a missing base must not hide a separate head refusal.
    const trees = [base, head].map((revision, index) => {
      try {
        const registry = checkRootReview(revision, git), projection = rootReviewProjection(revision, git);
        const {entries} = readInputAudit(revision, git);
        return {registry, projection, entries};
      } catch (error) {return {error: `${index ? 'head' : 'base'}: ${error.message}`};}
    });
    const errors = trees.filter(tree => tree.error).map(tree => tree.error);
    assert.equal(errors.length, 0, errors.join('; '));
    git('merge-base', '--is-ancestor', base, head);
    const actual = git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0');
    assert.equal(actual.pop(), '', 'Incomplete root changed paths');
    assert.deepEqual([...paths].sort(), actual.sort(), 'Root paths differ from immutable revisions');
    assert.equal(trees[0].projection.registryObjectId, trees[1].projection.registryObjectId, 'Root registry changed; full work required');
    for (const path of [rootRegistryPath, 'scripts/ci-root-review.mjs', 'scripts/ci-root-inputs.mjs', 'scripts/ci-input-audit.json', auditDescriptor]) {
      assert.equal(trees[0].entries.find(e => e.path === path)?.objectId,
        trees[1].entries.find(e => e.path === path)?.objectId, `Shared root policy changed: ${path}`);
    }
    const inventories = [base, head].map((revision, i) => packageInventory(revision, trees[i].entries, git));
    assert.deepEqual([...inventories[0]], [...inventories[1]], 'Root workspace identity or test commands changed');
    const inputs = new Map();
    for (const tree of trees) for (const entry of tree.registry.entries) {
      for (const path of entry.paths) inputs.set(path, entry);
    }
    const selected = new Map(), packagePaths = [];
    for (const path of paths) {
      const entry = inputs.get(path);
      if (entry) {selected.set(entry.id, entry); continue;}
      if (path.startsWith(rootRecordRoot) || path.startsWith(auditRecordRoot + 'docs/')) continue;
      if (unreadMarkdown(path) && trees.every(tree => {
        const row = tree.entries.find(e => e.path === path);
        return !row || row.mode === '100644' && row.type === 'blob';
      })) continue;
      if (inventories.every(packages => [...packages.keys()].some(directory => path.startsWith(directory + '/')))) packagePaths.push(path);
      else assert.fail(`Shared or unknown root input: ${path}`);
    }
    assert.ok(selected.size > 0 || packagePaths.length > 0, 'Evidence or prose alone cannot create root work');
    const entries = [...selected.values()];
    return {rootInputs: {version: 1, base, head, paths, entryIds: [...selected.keys()].sort()},
      rootTests: entries.some(entry => entry.owners.rootTests),
      receipts: [...new Set(entries.flatMap(entry => entry.owners.receipts))].sort(), packagePaths};
  } catch (error) {
    return {full: true, reason: `Root ownership refused: ${error.message.split('\n')[0]}`.slice(0, 512)};
  }
}
