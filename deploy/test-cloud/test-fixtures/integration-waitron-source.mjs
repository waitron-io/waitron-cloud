import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, lstat, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const sha = value => createHash('sha256').update(value).digest('hex');
const commit = /^[a-f0-9]{40}$/;
const object = (kind, bytes) => createHash('sha1').update(kind + ' ' + bytes.length + '\0').update(bytes).digest();
const exact = (value, keys) => assert.deepEqual(Object.keys(value).sort(), keys.split(',').sort(), 'waitron_source.shape');
function safePath(path) {
  return typeof path === 'string' && /^[A-Za-z0-9_.@/+\-]+$/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git' || part === 'node_modules' || part === '.env' || (part.startsWith('.env.') && part !== '.env.example'));
}
function treeDigest(entries) {
  const root = new Map();
  for (const entry of entries) {
    const parts = entry.path.split('/');
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      if (!parent.has(part)) parent.set(part, new Map());
      parent = parent.get(part);
      assert.ok(parent instanceof Map, 'waitron_source.path_collision');
    }
    const name = parts.at(-1);
    assert.equal(parent.has(name), false, 'waitron_source.path_collision');
    parent.set(name, entry);
  }
  const digest = directory => {
    const rows = [...directory].map(([name, value]) => ({name, directory: value instanceof Map, value}));
    // Git compares a directory name as if it ended in '/', including against sibling files.
    rows.sort((a, b) => Buffer.compare(Buffer.from(a.name + (a.directory ? '/' : '')), Buffer.from(b.name + (b.directory ? '/' : ''))));
    return object('tree', Buffer.concat(rows.map(row => Buffer.concat([
      Buffer.from((row.directory ? '40000' : row.value.mode) + ' ' + row.name + '\0'),
      row.directory ? digest(row.value) : row.value.blob,
    ]))));
  };
  return digest(root).toString('hex');
}

export async function measureWaitronSource(root, source, expectedHead) {
  assert.match(expectedHead, commit, 'waitron_source.pin');
  exact(source, 'head,tree,dirty,files');
  assert.equal(source.head, expectedHead, 'waitron_source.pin');
  assert.match(source.tree, commit, 'waitron_source.tree');
  assert.equal(source.dirty, false, 'waitron_source.dirty');
  assert.ok(Array.isArray(source.files) && source.files.length > 0 && source.files.length <= 20000, 'waitron_source.count');
  root = await realpath(root);
  let previous = '', total = 0;
  const measured = [];
  for (const value of source.files) {
    exact(value, 'path,mode,sha256');
    assert.ok(safePath(value.path) && value.path > previous, 'waitron_source.path');
    assert.ok(value.path.split('/').length <= 64, 'waitron_source.path');
    previous = value.path;
    assert.ok(value.mode === '100644' || value.mode === '100755', 'waitron_source.mode');
    assert.match(value.sha256, /^[a-f0-9]{64}$/, 'waitron_source.hash');
    const path = join(root, value.path), info = await lstat(path);
    assert.equal(await realpath(path), path, 'waitron_source.symlink');
    assert.equal(info.isFile(), true, 'waitron_source.file');
    assert.equal(Boolean(info.mode & 0o111), value.mode === '100755', 'waitron_source.mode');
    total += info.size;
    assert.ok(info.size <= 64 * 1024 * 1024 && total <= 512 * 1024 * 1024, 'waitron_source.size');
    const bytes = await readFile(path);
    assert.equal(bytes.length, info.size, 'waitron_source.changed');
    assert.equal(sha(bytes), value.sha256, 'waitron_source.bytes');
    measured.push({...value, blob: object('blob', bytes)});
  }
  assert.equal(treeDigest(measured), source.tree, 'waitron_source.tree');
  return {head: source.head, tree: source.tree, dirty: false, files: measured.length, sourceSha256: sha(JSON.stringify(source.files))};
}

export async function captureWaitronSource(root, expectedHead) {
  assert.match(expectedHead, commit, 'waitron_source.pin');
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const stable = () => {
    assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'waitron_source.dirty');
    assert.equal(git('rev-parse', 'HEAD'), expectedHead, 'waitron_source.pin');
  };
  stable();
  const files = [];
  for (const row of git('ls-files', '--stage', '-z').split('\0').filter(Boolean)) {
    const [entry, path] = row.split('\t'), [mode, , stage] = entry.split(' ');
    assert.ok(safePath(path) && stage === '0', 'waitron_source.path');
    assert.ok(mode === '100644' || mode === '100755', 'waitron_source.mode');
    const info = await lstat(join(root, path));
    assert.ok(info.isFile() && info.size <= 64 * 1024 * 1024, 'waitron_source.file');
    files.push({path, mode, sha256: sha(await readFile(join(root, path)))});
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const source = {head: expectedHead, tree: git('rev-parse', 'HEAD^{tree}'), dirty: false, files};
  await measureWaitronSource(root, source, expectedHead);
  stable();
  return source;
}

export async function waitronSourceMain(args) {
  try {
    let result;
    if (args.length === 3 && args[0] === 'capture') result = await captureWaitronSource(args[1], args[2]);
    else {
      assert.ok(args.length === 2 && args[0] === 'measure');
      let text = '';
      for await (const part of process.stdin) {text += part; assert.ok(Buffer.byteLength(text) <= 4 * 1024 * 1024);}
      result = await measureWaitronSource(process.cwd(), JSON.parse(text), args[1]);
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {process.stderr.write('Waitron source refused\n'); process.exitCode = 1;}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await waitronSourceMain(process.argv.slice(2));
