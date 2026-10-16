import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {sourceDependencies, scopeForPaths, quotedReferences} from './ci-scope.mjs';

function workspaceAt(sha, workspace, git) {
  assert.match(sha, /^[a-f0-9]{40}$/);
  const entries = git('ls-tree', '-rz', '--full-tree', sha).split('\0');
  assert.equal(entries.pop(), '', 'Incomplete package tree inventory');
  const files = new Map();
  for (const entry of entries) {
    const match = entry.match(/^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/);
    assert.ok(match, 'Malformed package tree inventory');
    const [, mode, type, id, path] = match;
    assert.ok(!files.has(path), 'Duplicate package input');
    assert.ok(!/(?:^|\/)\.gitattributes$/.test(path), 'Checkout attributes require full package work');
    files.set(path, {mode, type, id});
  }
  const inputs = [...files].filter(([path]) => path === 'pnpm-workspace.yaml' ||
    /\.[cm]?[jt]sx?$/.test(path) || workspace.some(pkg => path === `${pkg.directory}/package.json`));
  const blobs = git.readBlobs?.([...new Set(inputs.map(([, file]) => file.id))]);
  const read = path => {
    const file = files.get(path);
    assert.ok(file?.type === 'blob' && ['100644', '100755'].includes(file.mode), `Nonregular or missing package input: ${path}`);
    if (!git.readBlobs) return git('show', `${sha}:${path}`);
    assert.ok(blobs instanceof Map && typeof blobs.get(file.id) === 'string', `Missing batched package input: ${path}`);
    return blobs.get(file.id);
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
  const modules = new Map([...files.keys()].filter(path => /\.[cm]?[jt]sx?$/.test(path)).map(path => [path, read(path)]));
  // Index named subdirectories. Repository-root references also supply command
  // working directories and need separate reader evidence before expansion.
  const directories = new Map();
  for (const path of modules.keys()) {
    for (let directory = posix.dirname(path); directory !== '.'; directory = posix.dirname(directory)) {
      if (!directories.has(directory)) directories.set(directory, []);
      directories.get(directory).push(path);
    }
  }
  for (const pkg of packages) {
    const sources = [];
    for (const [path, file] of files) {
      if (!path.startsWith(`${pkg.directory}/`)) continue;
      assert.ok(file.type === 'blob' && ['100644', '100755'].includes(file.mode), `Nonregular workspace input: ${path}`);
      assert.ok(!path.split('/').some(part => ['node_modules', '.git'].includes(part)), 'Tracked dependency override');
      if (/\.[cm]?[jt]sx?$/.test(path)) sources.push({path, source: modules.get(path)});
    }
    const visited = new Set(sources.map(source => source.path));
    // A shared helper can read a sibling without the package naming that sibling.
    // Visit saved helper sources too; a cycle must not expand the queue forever.
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index];
      for (const value of quotedReferences(source.source)) {
        const target = value.startsWith('.') ? posix.normalize(posix.join(posix.dirname(source.path), value)) : value;
        if (packages.some(other => target.startsWith(`${other.directory}/`))) continue;
        // Keep descendant helpers without matching a similarly named sibling.
        for (const path of [...(directories.get(target.replace(/\/$/, '')) ?? []), target, target.replace(/\.js$/, '.ts'), target.replace(/\.mjs$/, '.mts'), target.replace(/\.cjs$/, '.cts'), target.replace(/\.jsx?$/, '.tsx'),
          ...['.mjs', '.cjs', '.js', '.ts', '.mts', '.cts', '.tsx', '.jsx'].flatMap(ext => [target + ext, posix.join(target, 'index' + ext)])]) {
          if (!modules.has(path) || visited.has(path)) continue;
          visited.add(path);
          sources.push({path, source: modules.get(path)});
        }
      }
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

export function readGitBlobs(ids, execute = input => execFileSync('git', ['cat-file', '--batch'], {
  input, timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
})) {
  const unique = [...new Set(ids)];
  for (const id of unique) assert.match(id, /^[a-f0-9]{40}$/, 'Invalid batch object ID');
  const blobs = new Map();
  if (!unique.length) return blobs;
  const output = execute(unique.join('\n') + '\n');
  assert.ok(Buffer.isBuffer(output), 'Git batch output must be bytes');
  let offset = 0;
  for (const id of unique) {
    const newline = output.indexOf(10, offset);
    assert.ok(newline >= offset, 'Incomplete Git batch header');
    const header = output.subarray(offset, newline).toString('utf8').match(/^([a-f0-9]{40}) blob (0|[1-9][0-9]*)$/);
    assert.ok(header && header[1] === id, 'Unexpected Git batch object');
    const size = Number(header[2]);
    assert.ok(Number.isSafeInteger(size) && size <= output.length - newline - 2, 'Incomplete Git batch body');
    assert.ok(size <= 1024 * 1024, 'Git batch object exceeds the legacy per-file limit');
    const body = output.subarray(newline + 1, newline + 1 + size);
    offset = newline + 1 + size;
    assert.equal(output[offset++], 10, 'Missing Git batch separator');
    // The size is in bytes; embedded newlines and non-ASCII source cannot frame records.
    const hash = createHash('sha1').update(`blob ${size}\0`).update(body).digest('hex');
    assert.equal(hash, id, 'Corrupt Git batch blob');
    blobs.set(id, body.toString('utf8'));
  }
  assert.equal(offset, output.length, 'Unexpected trailing Git batch data');
  return blobs;
}
