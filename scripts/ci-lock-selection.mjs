import assert from 'node:assert/strict';
import {auditInputMode} from './ci-input-audit.mjs';
import {parseLock, changedImporters} from './ci-lock.mjs';
import {scopeForRevisions} from './ci-package-revisions.mjs';

export function lockPackageScope(base, head, workspace, git, changedPaths = ['pnpm-lock.yaml']) {
  const manifests = workspace.map(pkg => `${pkg.directory}/package.json`);
  assert.ok(changedPaths.includes('pnpm-lock.yaml') && changedPaths.every(path => path === 'pnpm-lock.yaml' || manifests.includes(path)), 'Unrelated lock inputs require full work');
  const locks = [base, head].map(sha => {
    assert.match(sha, /^[a-f0-9]{40}$/);
    auditInputMode('lock', sha, git, manifests);
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
