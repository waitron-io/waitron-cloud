import assert from 'node:assert/strict';
import {readInputInventory} from './ci-input-audit.mjs';
import {parseLock, changedImporters} from './ci-lock.mjs';
import {scopeForRevisions} from './ci-package-revisions.mjs';

export function lockPackageScope(base, head, workspace, git, changedPaths = ['pnpm-lock.yaml']) {
  const manifests = workspace.map(pkg => `${pkg.directory}/package.json`);
  assert.ok(changedPaths.includes('pnpm-lock.yaml') && changedPaths.every(path => path === 'pnpm-lock.yaml' || manifests.includes(path)), 'Unrelated lock inputs require full work');
  const projected = [];
  const locks = [base, head].map(sha => {
    assert.match(sha, /^[a-f0-9]{40}$/);
    const entries = readInputInventory(sha, git);
    const regular = path => {
      const entry = entries.find(entry => entry.path === path);
      assert.ok(entry?.mode === '100644' && entry.type === 'blob', `Missing regular lock input: ${path}`);
    };
    regular('pnpm-lock.yaml');
    projected.push(manifests.map(path => {
      regular(path);
      const manifest = JSON.parse(git('show', `${sha}:${path}`));
      assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest), `Invalid manifest: ${path}`);
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        if (!Object.hasOwn(manifest, field)) continue;
        const values = manifest[field];
        assert.ok(values && typeof values === 'object' && !Array.isArray(values) && Object.values(values).every(value => typeof value === 'string'),
          `Invalid manifest dependencies: ${path}`);
        delete manifest[field];
      }
      return Object.fromEntries(Object.keys(manifest).sort().map(key => [key, manifest[key]]));
    }));
    const lock = parseLock(git('show', `${sha}:pnpm-lock.yaml`));
    assert.deepEqual(Object.keys(lock.importers).sort(), ['.', ...workspace.map(pkg => pkg.directory)].sort(), 'Lock workspace membership changed');
    return lock;
  });
  assert.equal(JSON.stringify(projected[0]), JSON.stringify(projected[1]), 'Lock manifest metadata changed; full work required');
  const {importers} = changedImporters(...locks);
  assert.ok(importers.length && !importers.includes('.'), 'Root or unchanged lock inputs require full work');
  const scope = scopeForRevisions([...new Set([...importers.map(id => `${id}/package.json`), ...changedPaths.filter(path => manifests.includes(path))])], workspace, base, head, git);
  assert.equal(scope.full, false, 'Unknown lock package consumer');
  const changedManifests = changedPaths.filter(path => manifests.includes(path)).sort();
  return {scope, reason: `pnpm-lock.yaml: saved package selection for resolved dependency inputs changed for ${importers.join(', ')}${changedManifests.length ? `; changed manifests: ${changedManifests.join(', ')}` : ''}; all compiler and receipt checks retained`};
}
