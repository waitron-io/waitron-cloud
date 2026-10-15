import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseLock, changedImporters} from './ci-lock.mjs';
import {scopeForRevisions} from './ci-package-revisions.mjs';

const policy = 'scripts/ci-lock-selection-audit.json';

export function lockPackageScope(base, head, workspace, git, changedPaths = ['pnpm-lock.yaml']) {
  const manifests = workspace.map(pkg => `${pkg.directory}/package.json`);
  assert.ok(changedPaths.includes('pnpm-lock.yaml') && changedPaths.every(path => path === 'pnpm-lock.yaml' || manifests.includes(path)), 'Unrelated lock inputs require full work');
  const locks = [base, head].map(sha => {
    assert.match(sha, /^[a-f0-9]{40}$/);
    const entries = git('ls-tree', '-rz', '--full-tree', sha).split('\0');
    assert.equal(entries.pop(), '', 'Incomplete lock reader inventory');
    const audit = JSON.parse(git('show', `${sha}:${policy}`));
    assert.ok([1, 2].includes(audit.version), 'Unsupported lock reader audit');
    if (audit.version === 2) assert.deepEqual(Object.keys(audit.manifests).sort(), [...manifests].sort(), 'Incomplete manifest reader audit');
    const paths = new Map(), inputs = [];
    for (const entry of entries) {
      const match = entry.match(/^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/);
      assert.ok(match, 'Malformed lock reader inventory');
      const [, mode, type, , path] = match;
      assert.ok(!paths.has(path), 'Duplicate lock reader input');
      paths.set(path, {mode, type});
      if (audit.version === 2 && manifests.includes(path)) {
        assert.deepEqual({mode, type}, {mode: '100644', type: 'blob'}, `Nonregular manifest input: ${path}`);
        const manifest = JSON.parse(git('show', `${sha}:${path}`));
        for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
          if (!Object.hasOwn(manifest, field)) continue;
          assert.ok(manifest[field] && typeof manifest[field] === 'object' && !Array.isArray(manifest[field]) &&
            Object.values(manifest[field]).every(value => typeof value === 'string'), `Invalid manifest dependencies: ${path}`);
          delete manifest[field];
        }
        const projected = JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b, 'en'))));
        assert.equal(createHash('sha256').update(projected).digest('hex'), audit.manifests[path], `Manifest readers changed since audit: ${path}`);
      } else if (!['pnpm-lock.yaml', policy].includes(path)) inputs.push(entry + '\0');
    }
    for (const path of ['pnpm-lock.yaml', policy]) {
      assert.deepEqual(paths.get(path), {mode: '100644', type: 'blob'}, `Missing regular lock input: ${path}`);
    }
    assert.match(audit.inputSha256, /^[a-f0-9]{64}$/);
    // Dependency fields may change; scripts, package identity and all other
    // readers stay pinned so new consumers require review before omitting work.
    assert.equal(createHash('sha256').update(inputs.join('')).digest('hex'), audit.inputSha256, 'Inputs changed since the lock reader audit');
    const lock = parseLock(git('show', `${sha}:pnpm-lock.yaml`));
    assert.deepEqual(Object.keys(lock.importers).sort(), ['.', ...workspace.map(pkg => pkg.directory)].sort(), 'Lock workspace membership changed');
    return lock;
  });
  const {importers} = changedImporters(...locks);
  assert.ok(importers.length && !importers.includes('.'), 'Root or unchanged lock inputs require full work');
  const scope = scopeForRevisions([...new Set([...importers.map(id => `${id}/package.json`), ...changedPaths.filter(path => manifests.includes(path))])], workspace, base, head, git);
  assert.equal(scope.full, false, 'Unknown lock package consumer');
  return {scope, reason: `pnpm-lock.yaml: audited package selection for resolved dependency inputs changed for ${importers.join(', ')}; all compiler and receipt checks retained`};
}
