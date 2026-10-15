import assert from 'node:assert/strict';
import {sourceDependencies, scopeForPaths} from './ci-scope.mjs';

function workspaceAt(sha, workspace, git) {
  assert.match(sha, /^[a-f0-9]{40}$/);
  const entries = git('ls-tree', '-rz', '--full-tree', sha).split('\0');
  assert.equal(entries.pop(), '', 'Incomplete package tree inventory');
  const files = new Map();
  for (const entry of entries) {
    const match = entry.match(/^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/);
    assert.ok(match, 'Malformed package tree inventory');
    const [, mode, type, , path] = match;
    assert.ok(!files.has(path), 'Duplicate package input');
    assert.ok(!/(?:^|\/)\.gitattributes$/.test(path), 'Checkout attributes require full package work');
    files.set(path, {mode, type});
  }
  const read = path => {
    const file = files.get(path);
    assert.ok(file?.type === 'blob' && ['100644', '100755'].includes(file.mode), `Nonregular or missing package input: ${path}`);
    return git('show', `${sha}:${path}`);
  };
  const policy = read('pnpm-workspace.yaml');
  assert.match(policy, /^packages:\s*\n  - 'packages\/\*'\s*\n  - 'apps\/\*'\s*$/,
    'Unsupported workspace discovery policy');
  const manifests = [...files.keys()].filter(path => /^(?:packages|apps)\/[^/]+\/package\.json$/.test(path));
  assert.deepEqual(manifests.sort(), workspace.map(pkg => `${pkg.directory}/package.json`).sort(), 'Workspace membership changed');
  const packages = workspace.map(pkg => {
    const manifest = JSON.parse(read(`${pkg.directory}/package.json`));
    assert.equal(manifest.name, pkg.name, 'Workspace package identity changed');
    assert.equal(manifest.scripts?.test, pkg.scripts?.test, 'Workspace test command changed');
    return {...manifest, directory: pkg.directory};
  });
  for (const pkg of packages) {
    const sources = [];
    for (const [path, file] of files) {
      if (!path.startsWith(`${pkg.directory}/`)) continue;
      assert.ok(file.type === 'blob' && ['100644', '100755'].includes(file.mode), `Nonregular workspace input: ${path}`);
      assert.ok(!path.split('/').some(part => ['node_modules', '.git'].includes(part)), 'Tracked dependency override');
      if (/\.[cm]?[jt]sx?$/.test(path)) sources.push({path, source: read(path)});
    }
    pkg.pathDependencies = sourceDependencies(pkg, packages, sources);
  }
  return packages;
}

export function scopeForRevisions(paths, workspace, base, head, git) {
  const before = workspaceAt(base, workspace, git);
  const after = workspaceAt(head, workspace, git);
  const combined = after.map(pkg => {
    const previous = before.find(other => other.name === pkg.name);
    const dependencies = Object.assign({}, ...[previous, pkg].flatMap(member =>
      ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'pathDependencies'].map(field => member[field])));
    return {...pkg, dependencies};
  });
  return scopeForPaths(paths, combined);
}
