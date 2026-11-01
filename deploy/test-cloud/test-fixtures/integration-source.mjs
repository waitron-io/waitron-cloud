import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, lstat, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const roots = ['apps', 'packages', 'deploy', 'scripts'];
const files = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', '.npmrc', 'compose.yaml', '.dockerignore'];
const sha = value => createHash('sha256').update(value).digest('hex');
function runtimePath(path) {
  return typeof path === 'string' && /^[A-Za-z0-9_.@/-]+$/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules' || part === 'dist') &&
    !path.endsWith('.md') && !path.split('/').some(part => part === '.env' || part.startsWith('.env.')) &&
    (files.includes(path) || roots.some(root => path.startsWith(root + '/')));
}

export async function measureIntegrationFiles(root, values) {
  root = await realpath(root);
  assert.ok(Array.isArray(values) && values.length > 0 && values.length <= 10000);
  let previous = '';
  for (const value of values) {
    assert.deepEqual(Object.keys(value).sort(), ['path', 'sha256']);
    assert.ok(runtimePath(value.path) && value.path > previous);
    previous = value.path;
    assert.match(value.sha256, /^[a-f0-9]{64}$/);
    const path = join(root, value.path);
    assert.equal(await realpath(path), path);
    assert.equal((await lstat(path)).isFile(), true);
    assert.equal(sha(await readFile(path)), value.sha256, 'integration.image_source_mismatch');
  }
  return {files: values.length, runtimeSha256: sha(JSON.stringify(values))};
}

export async function captureIntegrationSource(root) {
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024}).trim();
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'integration.source_dirty');
  const head = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}');
  const paths = git('ls-files', '-z', '--', ...roots, ...files).split('\0').filter(runtimePath).sort();
  const values = [];
  for (const path of paths) {
    assert.equal((await lstat(join(root, path))).isFile(), true);
    values.push({path, sha256: sha(await readFile(join(root, path)))});
  }
  assert.ok(values.length > 0);
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'integration.source_dirty');
  assert.equal(git('rev-parse', 'HEAD'), head, 'integration.source_changed');
  return {head, tree, dirty: false, files: values};
}

export async function checkIntegrationSource(root, expected) {
  assert.deepEqual(await captureIntegrationSource(root), expected, 'integration.source_changed');
  return true;
}
