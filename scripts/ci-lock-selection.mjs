import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseLock, changedImporters} from './ci-lock.mjs';
import {scopeForRevisions} from './ci-package-revisions.mjs';

const policy = 'scripts/ci-lock-selection-audit.json';

export function lockPackageScope(base, head, workspace, git) {
  const locks = [base, head].map(sha => {
    assert.match(sha, /^[a-f0-9]{40}$/);
    const entries = git('ls-tree', '-rz', '--full-tree', sha).split('\0');
    assert.equal(entries.pop(), '', 'Incomplete lock reader inventory');
    const paths = new Map(), inputs = [];
    for (const entry of entries) {
      const match = entry.match(/^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/);
      assert.ok(match, 'Malformed lock reader inventory');
      const [, mode, type, , path] = match;
      assert.ok(!paths.has(path), 'Duplicate lock reader input');
      paths.set(path, {mode, type});
      if (!['pnpm-lock.yaml', policy].includes(path)) inputs.push(entry + '\0');
    }
    for (const path of ['pnpm-lock.yaml', policy]) {
      assert.deepEqual(paths.get(path), {mode: '100644', type: 'blob'}, `Missing regular lock input: ${path}`);
    }
    const audit = JSON.parse(git('show', `${sha}:${policy}`));
    assert.equal(audit.version, 1, 'Unsupported lock reader audit');
    assert.match(audit.inputSha256, /^[a-f0-9]{64}$/);
    // Every other input pins package, root and install readers. New readers must
    // be reviewed before their dependency changes can omit package work.
    assert.equal(createHash('sha256').update(inputs.join('')).digest('hex'), audit.inputSha256, 'Inputs changed since the lock reader audit');
    const lock = parseLock(git('show', `${sha}:pnpm-lock.yaml`));
    assert.deepEqual(Object.keys(lock.importers).sort(), ['.', ...workspace.map(pkg => pkg.directory)].sort(), 'Lock workspace membership changed');
    return lock;
  });
  const {importers} = changedImporters(...locks);
  assert.ok(importers.length && !importers.includes('.'), 'Root or unchanged lock inputs require full work');
  const scope = scopeForRevisions(importers.map(id => `${id}/package.json`), workspace, base, head, git);
  assert.equal(scope.full, false, 'Unknown lock package consumer');
  return {scope, reason: `pnpm-lock.yaml: audited package selection for resolved dependency inputs changed for ${importers.join(', ')}; all compiler and receipt checks retained`};
}
