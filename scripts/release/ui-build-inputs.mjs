import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {parse} from '@babel/parser';
import {parseDocument} from 'yaml';
import {readdir, symlink} from 'node:fs/promises';
import {posix, relative, sep} from 'node:path';

const MiB = 1024 * 1024;
const oid = /^[a-f0-9]{40}$/;
const utf8 = (bytes) => new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
const hashObject = (type, bytes) =>
  createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const pathKey = (path) =>
  path
    .normalize('NFC')
    .toUpperCase()
    .toLowerCase()
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '');

// macOS can report EPERM for an exited child before Node receives its exit event.
// Only a subsequent ESRCH establishes that this owned process group is gone.
async function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code === 'ESRCH') return;
    if (error.code === 'EPERM')
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        try {
          process.kill(-pid, 0);
        } catch (probe) {
          if (probe.code === 'ESRCH') return;
          if (probe.code !== 'EPERM') throw probe;
        }
      }
    throw error;
  }
}

function directExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({code, signal}));
    child.once('error', (error) => resolve({code: null, error}));
  });
}
async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function stopChild(child, exit) {
  const errors = [];
  try {
    if (child?.pid) await signalGroup(child.pid, 'SIGKILL');
  } catch (error) {
    errors.push(error);
  } finally {
    child?.stdin?.destroy();
    child?.stdout?.destroy();
    child?.stderr?.destroy();
  }
  try {
    if (exit) await within(exit, 2000, 'owned command did not exit after stopping');
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw new AggregateError(errors, 'owned command cleanup failed');
}

async function boundedFile(path, maxBytes) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    assert(
      stat.isFile() && Number.isSafeInteger(stat.size) && stat.size <= maxBytes,
      'nonregular or oversized input file'
    );
    const chunks = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes - total + 1));
      const {bytesRead} = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      assert(total <= maxBytes, 'input file byte limit');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    assert.equal(total, stat.size, 'input file changed while reading');
    return {bytes: Buffer.concat(chunks, total), stat};
  } finally {
    await file.close();
  }
}
async function smallFile(path) {
  return utf8((await boundedFile(path, 4096)).bytes);
}
async function objectDirectory(repo) {
  assert(typeof repo === 'string' && isAbsolute(repo), 'repository must be an absolute path');
  repo = await realpath(repo);
  let dir = join(repo, '.git');
  try {
    const stat = await lstat(dir);
    assert(!stat.isSymbolicLink(), 'Git directory cannot be a symbolic link');
    if (stat.isFile()) {
      const text = await smallFile(dir);
      assert(/^gitdir: [^\r\n]+\n?$/.test(text), 'invalid Git directory pointer');
      dir = resolve(repo, text.slice(8).trimEnd());
    } else assert(stat.isDirectory(), 'invalid Git directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Bare repositories expose their own object directory.
    dir = repo;
    await smallFile(join(dir, 'HEAD'));
  }
  try {
    const common = await smallFile(join(dir, 'commondir'));
    assert(/^[^\r\n]+\n?$/.test(common), 'invalid common Git directory');
    dir = resolve(dir, common.trimEnd());
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const objects = await realpath(join(dir, 'objects'));
  for (const name of ['alternates', 'http-alternates']) {
    try {
      assert.equal(
        (await smallFile(join(objects, 'info', name))).trim(),
        '',
        'external object alternates are unsupported'
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return objects;
}

// Read through an owned Git configuration; the caller supplies only an object store.
async function withObjects(repo, git, use) {
  assert(typeof git === 'string' && isAbsolute(git), 'trusted Git executable must be absolute');
  const objects = await objectDirectory(repo),
    neutral = await mkdtemp(join(tmpdir(), 'ui-git-read-'));
  let child,
    timer,
    exit,
    stderr = Buffer.alloc(0),
    failure,
    operationError;
  try {
    await mkdir(join(neutral, 'refs'));
    await mkdir(join(neutral, 'objects'));
    await writeFile(join(neutral, 'HEAD'), 'ref: refs/heads/unused\n');
    await writeFile(join(neutral, 'config'), '[core]\nrepositoryformatversion = 0\nbare = true\n');
    child = spawn(git, ['--git-dir=' + neutral, 'cat-file', '--batch'], {
      cwd: neutral,
      detached: true,
      env: {
        PATH: '/usr/bin:/bin',
        HOME: neutral,
        LC_ALL: 'C',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_NO_LAZY_FETCH: '1',
        GIT_GRAFT_FILE: '/dev/null',
        GIT_OBJECT_DIRECTORY: objects
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    child.stdin.on('error', (error) => {
      failure ??= error;
    });
    child.on('error', (error) => {
      failure ??= error;
    });
    exit = directExit(child);
    child.stderr.on('data', (bytes) => {
      if (stderr.length < 4096)
        stderr = Buffer.concat([stderr, bytes.subarray(0, 4096 - stderr.length)]);
    });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Git object read timed out')), 30000);
    });
    const stream = child.stdout[Symbol.asyncIterator]();
    let pending = Buffer.alloc(0);
    async function need(n) {
      while (pending.length < n) {
        const next = await stream.next();
        assert(
          !next.done,
          'truncated Git object output: ' + (failure?.message ?? stderr.toString())
        );
        pending = Buffer.concat([pending, next.value]);
      }
    }
    const read = async (id, type, maxBytes) => {
      assert(oid.test(id), 'invalid immutable object identity');
      child.stdin.write(id + '\n');
      while (!pending.includes(10)) {
        assert(pending.length < 128, 'invalid Git object header');
        await need(pending.length + 1);
      }
      const end = pending.indexOf(10),
        header = pending.subarray(0, end).toString('latin1');
      pending = pending.subarray(end + 1);
      const match = /^([a-f0-9]{40}) (commit|tree|blob|tag) (0|[1-9]\d*)$/.exec(header);
      assert(
        match && match[1] === id && match[2] === type,
        'missing object or incorrect object type (expected ' + type + ')'
      );
      const size = Number(match[3]);
      assert(Number.isSafeInteger(size) && size <= maxBytes, 'Git object exceeds byte limit');
      await need(size + 1);
      assert.equal(pending[size], 10, 'invalid Git object terminator');
      const bytes = Buffer.from(pending.subarray(0, size));
      pending = pending.subarray(size + 1);
      assert.equal(hashObject(type, bytes), id, 'immutable Git object hash differs');
      return bytes;
    };
    const result = await Promise.race([use(read), deadline]);
    child.stdin.end();
    const status = await Promise.race([exit, deadline]);
    assert(
      status.code === 0 && !failure,
      'Git object reader failed: ' + (failure?.message ?? stderr.toString())
    );
    return result;
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    clearTimeout(timer);
    const errors = [];
    try {
      await stopChild(child, exit);
    } catch (error) {
      errors.push(error);
    }
    try {
      await rm(neutral, {recursive: true, force: true});
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(
        operationError ? [operationError, ...errors] : errors,
        'Git object operation or cleanup failed'
      );
  }
}

export async function readUiGitTree(args) {
  return readUiGitTreeBudget(args, {remaining: 512 * MiB});
}
async function readUiGitTreeBudget({repo, commit, git}, budget) {
  assert(typeof commit === 'string' && oid.test(commit), 'source identity must name a full commit');
  return withObjects(repo, git, async (read) => {
    const account = (bytes) => {
      assert(bytes.length <= budget.remaining, 'repository byte limit');
      budget.remaining -= bytes.length;
      return bytes;
    };
    const commitBytes = account(await read(commit, 'commit', Math.min(16 * MiB, budget.remaining)));
    const tree = /^tree ([a-f0-9]{40})\n/.exec(commitBytes.toString('latin1'))?.[1];
    assert(tree, 'commit must name a tree');
    const trees = new Map(),
      blobs = new Map(),
      files = new Map(),
      paths = new Set();
    let count = 0;
    const visit = async (id, prefix, depth) => {
      assert(depth <= 128, 'Git tree depth limit');
      const bytes = trees.get(id) ?? (await read(id, 'tree', Math.min(32 * MiB, budget.remaining)));
      trees.set(id, bytes);
      account(bytes);
      let start = 0;
      while (start < bytes.length) {
        assert(++count <= 50000, 'repository entry limit');
        const space = bytes.indexOf(32, start),
          end = bytes.indexOf(0, space + 1);
        assert(space > start && end > space && end + 21 <= bytes.length, 'truncated Git tree');
        const mode = bytes.subarray(start, space).toString('latin1'),
          name = utf8(bytes.subarray(space + 1, end));
        assert(
          ['40000', '100644', '100755'].includes(mode),
          'Git inputs must be regular blobs or trees'
        );
        assert(
          name &&
            name !== '.' &&
            name !== '..' &&
            pathKey(name) !== '.git' &&
            name.normalize('NFC') === name &&
            !/[\x00-\x1f\x7f\\/:]/.test(name),
          'unsafe Git input path'
        );
        const path = prefix + name,
          key = pathKey(path);
        assert(Buffer.byteLength(path) <= 4096, 'Git input path limit');
        assert(!paths.has(key), 'Git input path collision');
        paths.add(key);
        const objectId = bytes.subarray(end + 1, end + 21).toString('hex');
        start = end + 21;
        if (mode === '40000') await visit(objectId, path + '/', depth + 1);
        else {
          const data =
            blobs.get(objectId) ??
            (await read(objectId, 'blob', Math.min(16 * MiB, budget.remaining)));
          account(data);
          blobs.set(objectId, data);
          files.set(path, {mode, objectId, bytes: data});
        }
      }
    };
    await visit(tree, '', 0);
    return {commitBytes, trees, files: new Map([...files].sort(([a], [b]) => compare(a, b)))};
  });
}

const sha512 = (bytes) => createHash('sha512').update(bytes).digest('hex');
const serialise = (value) => {
  const digest = createHash('sha512');
  let length = 0;
  const append = (text) => {
    length += Buffer.byteLength(text);
    assert(length <= 32 * MiB, 'serialised evidence byte limit');
    digest.update(text);
  };
  const visit = (value) => {
    if (Array.isArray(value)) {
      append('[');
      value.forEach((entry, index) => {
        if (index) append(',');
        visit(entry);
      });
      append(']');
    } else {
      assert(
        typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value)),
        'unsupported evidence framing value'
      );
      append(JSON.stringify(value));
    }
  };
  visit(value);
  append('\n');
  return {length, sha512: digest.digest('hex')};
};
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected, label) => {
  assert(record(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `unsupported ${label} fields`);
};
function json(bytes) {
  const source = utf8(bytes),
    value = JSON.parse(source);
  let offset = 0;
  const whitespace = () => {
    while (/\s/.test(source[offset] ?? '') && offset < source.length) offset++;
  };
  const string = () => {
    const match = /^"(?:[^"\\]|\\[\s\S])*"/.exec(source.slice(offset));
    assert(match, 'invalid JSON string');
    offset += match[0].length;
    const text = JSON.parse(match[0]);
    assert(!/[\uD800-\uDFFF]/u.test(text), 'invalid JSON Unicode');
    return text;
  };
  const visit = () => {
    whitespace();
    if (source[offset] === '{') {
      offset++;
      whitespace();
      const names = new Set();
      if (source[offset] !== '}')
        while (true) {
          whitespace();
          const name = string();
          assert(!names.has(name), 'duplicate JSON field');
          names.add(name);
          whitespace();
          offset++;
          visit();
          whitespace();
          if (source[offset] !== ',') break;
          offset++;
        }
      offset++;
    } else if (source[offset] === '[') {
      offset++;
      whitespace();
      if (source[offset] !== ']')
        while (true) {
          visit();
          whitespace();
          if (source[offset] !== ',') break;
          offset++;
        }
      offset++;
    } else if (source[offset] === '"') string();
    else {
      const start = offset;
      while (offset < source.length && !/[\s,}\]]/.test(source[offset])) offset++;
      const primitive = JSON.parse(source.slice(start, offset));
      if (typeof primitive === 'number')
        assert(Number.isSafeInteger(primitive), 'unsafe JSON number');
    }
  };
  visit();
  return value;
}
function yaml(bytes) {
  const doc = parseDocument(utf8(bytes), {uniqueKeys: true, version: '1.2', strict: true});
  assert.equal(
    doc.errors.length,
    0,
    'unsupported or duplicate YAML input: ' + doc.errors.map((e) => e.message).join('; ')
  );
  assert.equal(doc.warnings.length, 0, 'unsupported YAML input');
  return doc.toJS({maxAliasCount: 0});
}
const policyBytes = await readFile(new URL('./ui-build-policy.json', import.meta.url));
const policy = json(policyBytes);
keys(
  policy,
  [
    'schema',
    'policyVersion',
    'programs',
    'configs',
    'workspace',
    'packageBuild',
    'packagePrepack',
    'commands'
  ],
  'build policy'
);
assert.equal(policy.schema, 1, 'unsupported build policy schema');
assert.equal(policy.policyVersion, 1, 'unsupported build policy version');
const required = (files, path) => {
  const file = files.get(path);
  assert(file, 'missing build input: ' + path);
  assert(['100644', '100755'].includes(file.mode), 'nonregular build input');
  return file;
};
const tuple = (role, path, file) => [role, path, file.mode, file.bytes.length, sha512(file.bytes)];
const sorted = (entries) => entries.sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));
function inventory(entries) {
  const seen = new Set();
  for (const entry of entries) {
    assert(
      entry.length === 5 &&
        ['build', 'check-definition', 'context', 'recipe', 'tool'].includes(entry[0]),
      'unsupported inventory tuple'
    );
    assert(!seen.has(entry[1]), 'duplicate inventory path');
    seen.add(entry[1]);
    assert(
      Number.isSafeInteger(entry[3]) && entry[3] >= 0 && /^[a-f0-9]{128}$/.test(entry[4]),
      'invalid inventory framing'
    );
  }
  sorted(entries);
  assert(serialise(entries).length <= 32 * MiB, 'serialised inventory byte limit');
  return entries;
}
function moduleImports(bytes, path, typescript = false) {
  const ast = parse(utf8(bytes), {
    sourceType: 'module',
    plugins: typescript ? ['typescript', 'decorators-legacy'] : [],
    createImportExpressions: true
  });
  const imports = [];
  for (const comment of ast.comments ?? [])
    if (comment.type === 'CommentLine' && /^\/\s*<reference\b/i.test(comment.value)) {
      assert(
        path === 'packages/ui-core/src/vite-env.d.ts' &&
          comment.value.trim() === '/ <reference types="vite/client" />',
        'unclassified declaration reference'
      );
    }
  const literal = (node) => {
    assert(node?.type === 'StringLiteral', 'unclassified computed import in ' + path);
    imports.push(node.value);
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) &&
      node.source
    )
      literal(node.source);
    if (node.type === 'ImportExpression') literal(node.source);
    if (node.type === 'TSImportType') literal(node.source);
    if (node.type === 'TSExternalModuleReference') literal(node.expression);
    if (
      node.type === 'CallExpression' &&
      (node.callee?.type === 'Import' || node.callee?.name === 'require')
    ) {
      assert.equal(node.arguments.length, 1, 'unclassified import');
      literal(node.arguments[0]);
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
      if (Array.isArray(value)) for (const child of value) visit(child);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  return imports;
}
function sourceInputs(files, source) {
  const build = new Set([
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'tsconfig.base.json',
    'LICENSE',
    'LICENSE-GRANTS.md',
    'scripts/release/prepare-ui.mjs',
    'packages/ui-core/package.json',
    'packages/ui-core/README.md',
    'packages/ui-core/scripts/build.mjs',
    'packages/ui-core/tsconfig.json',
    'packages/ui-core/tsconfig.build.json'
  ]);
  for (const path of build) required(files, path);
  for (const [path, digest] of Object.entries(policy.programs))
    assert.equal(
      sha512(required(files, path).bytes),
      digest,
      'unsupported executable recipe: ' + path
    );
  for (const [path, expected] of Object.entries(policy.configs))
    assert.deepEqual(
      json(required(files, path).bytes),
      expected,
      'unsupported config input: ' + path
    );
  const workspace = yaml(required(files, 'pnpm-workspace.yaml').bytes);
  keys(workspace, ['packages'], 'source workspace');
  assert.deepEqual(workspace.packages, policy.workspace, 'unsupported workspace patterns');
  const manifestPaths = [
    'package.json',
    ...[...files.keys()].filter((p) => /^(apps|packages|bench)\/[^/]+\/package\.json$/.test(p))
  ];
  const manifests = new Map(),
    names = new Map();
  for (const path of manifestPaths) {
    const p = json(required(files, path).bytes);
    assert(
      record(p) && typeof p.name === 'string' && !names.has(p.name),
      'unsupported workspace identity'
    );
    manifests.set(path, p);
    names.set(p.name, path);
    build.add(path);
    assert(
      p.packageManager === undefined || p.packageManager === 'pnpm@9.15.0',
      'unsupported source package-manager selection'
    );
    assert(
      !p.pnpm || (record(p.pnpm) && Object.keys(p.pnpm).every((k) => k === 'overrides')),
      'unsupported pnpm configuration'
    );
    assert(
      !p.imports && !p.workspaces && !p.resolutions,
      'unclassified package imports or workspace resolution'
    );
    for (const type of [
      'dependencies',
      'optionalDependencies',
      'devDependencies',
      'peerDependencies'
    ])
      for (const [name, version] of Object.entries(p[type] ?? {})) {
        assert(
          typeof version === 'string' &&
            /^(?:[\d^~*<>=]|npm:|workspace:)/.test(version) &&
            !/[\r\n]/.test(version) &&
            !/(?:https?:|file:|git:|github:|link:)/.test(version),
          'unsupported dependency source: ' + name
        );
      }
  }
  for (const path of files.keys()) {
    const folded = pathKey(path);
    assert(
      !folded.split('/').includes('node_modules'),
      'tracked node_modules are unsupported build inputs'
    );
    assert(
      !/(?:^|\/)(?:\.npmrc|\.pnpmfile\.cjs|pnpmfile\.cjs|\.gitmodules|\.npmignore|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?)$/.test(
        folded
      ),
      'unsupported install config input: ' + path
    );
    assert(
      !/^packages\/ui-core\/(?:src|scripts)\/(?:.*\/)?(?:package\.json|tsconfig[^/]*\.json)$/.test(
        folded
      ),
      'unclassified nested build configuration'
    );
    if (path.startsWith('packages/ui-core/')) build.add(path);
    if (/(?:^|\/)(?:\.gitignore|\.gitattributes)$/.test(path)) build.add(path);
  }
  const ui = manifests.get('packages/ui-core/package.json');
  assert.equal(ui.name, '@waitron/ui-core', 'unsupported source package');
  assert.equal(ui.version, source.version, 'source version differs');
  assert(!ui.browser, 'unclassified browser configuration');
  assert.equal(ui.type, 'module', 'unsupported source module type');
  assert.equal(ui.scripts?.build, policy.packageBuild, 'unsupported build command');
  assert.equal(ui.scripts?.prepack, policy.packagePrepack, 'unsupported prepack command');
  assert(!ui.scripts.prebuild && !ui.scripts.postbuild, 'unsupported build hook');
  for (const name of [
    'dependencies',
    'optionalDependencies',
    'bundledDependencies',
    'bundleDependencies'
  ])
    assert.equal(Object.keys(ui[name] ?? {}).length, 0, 'runtime dependency must remain external');
  assert.deepEqual(ui.peerDependencies, {lit: '^3.2.0'}, 'unsupported Lit peer');
  const lock = yaml(required(files, 'pnpm-lock.yaml').bytes);
  assert.equal(lock.lockfileVersion, '9.0', 'unsupported lock schema');
  assert(
    Object.keys(lock).every((k) =>
      ['lockfileVersion', 'settings', 'overrides', 'importers', 'packages', 'snapshots'].includes(k)
    ),
    'unsupported lock fields'
  );
  assert.deepEqual(
    lock.overrides ?? {},
    manifests.get('package.json').pnpm?.overrides ?? {},
    'unsupported lock overrides'
  );
  assert(
    record(lock.importers) && record(lock.packages) && record(lock.snapshots),
    'missing lock inventories'
  );
  assert.deepEqual(
    Object.keys(lock.importers).sort(),
    [...manifests.keys()]
      .map((path) => (path === 'package.json' ? '.' : path.slice(0, -'/package.json'.length)))
      .sort(),
    'workspace lock importer membership differs'
  );
  for (const [path, p] of manifests) {
    const directory = path === 'package.json' ? '.' : path.slice(0, -'/package.json'.length),
      importer = lock.importers[directory];
    assert(record(importer), 'missing workspace lock importer');
    for (const type of ['dependencies', 'optionalDependencies', 'devDependencies']) {
      assert.deepEqual(
        Object.keys(importer[type] ?? {}).sort(),
        Object.keys(p[type] ?? {}).sort(),
        'workspace lock dependencies differ'
      );
      for (const [name, decl] of Object.entries(importer[type] ?? {})) {
        keys(decl, ['specifier', 'version'], 'locked dependency');
        assert.equal(decl.specifier, p[type][name], 'lock dependency specifier differs');
        assert(
          typeof decl.version === 'string' && !/(?:https?:|file:|git:|github:)/.test(decl.version),
          'unsupported locked dependency source'
        );
        if (decl.version.startsWith('link:')) {
          assert(directory !== 'packages/ui-core', 'unsupported UI workspace build dependency');
          assert(
            decl.specifier.startsWith('workspace:') && names.has(name),
            'unsupported workspace dependency'
          );
          assert.equal(
            posix.normalize(posix.join(directory, decl.version.slice(5))) + '/package.json',
            names.get(name),
            'escaping workspace dependency'
          );
        }
      }
    }
  }
  for (const [name, p] of Object.entries(lock.packages)) {
    assert(!/(?:https?:|file:|git:|github:)/.test(name), 'unsupported locked package');
    keys(p.resolution, ['integrity'], 'package resolution');
    assert.match(
      p.resolution.integrity,
      /^(?:sha512-[A-Za-z0-9+/]{86}==|sha1-[A-Za-z0-9+/]{27}=)$/,
      'unsupported dependency integrity'
    );
  }
  const locked = (name, version) => {
    assert(
      typeof version === 'string' && !/(?:https?:|file:|git:|github:|link:)/.test(version),
      'unsupported snapshot dependency source'
    );
    const identity = version.split('(')[0].includes('@') ? version : name + '@' + version;
    assert(record(lock.snapshots[identity]), 'missing locked dependency snapshot: ' + identity);
    assert(
      record(lock.packages[identity.split('(')[0]]),
      'missing dependency integrity identity: ' + identity
    );
  };
  for (const importer of Object.values(lock.importers))
    for (const type of ['dependencies', 'optionalDependencies', 'devDependencies'])
      for (const [name, decl] of Object.entries(importer[type] ?? {}))
        if (!decl.version.startsWith('link:')) locked(name, decl.version);
  for (const [identity, snapshot] of Object.entries(lock.snapshots)) {
    assert(
      record(snapshot) && record(lock.packages[identity.split('(')[0]]),
      'missing snapshot integrity identity'
    );
    for (const type of ['dependencies', 'optionalDependencies'])
      for (const [name, version] of Object.entries(snapshot[type] ?? {})) locked(name, version);
  }
  const checked = new Set(),
    check = (path) => {
      if (checked.has(path)) return;
      checked.add(path);
      const file = required(files, path);
      build.add(path);
      if (path.endsWith('.css')) return;
      assert(/\.(?:ts|js|mjs)$/.test(path), 'unclassified source loader: ' + path);
      for (const specifier of moduleImports(file.bytes, path, /\.tsx?$/.test(path))) {
        if (specifier === 'lit' || specifier.startsWith('lit/')) {
          assert(
            /^lit(?:\/[A-Za-z0-9_.-]+)*$/.test(specifier) &&
              !specifier.split('/').some((part) => part === '.' || part === '..'),
            'escaping external Lit import'
          );
          continue;
        }
        assert(
          specifier.startsWith('./') || specifier.startsWith('../'),
          'unclassified UI import: ' + specifier
        );
        const rawCss = /\.css\?(?:raw|inline)$/.test(specifier);
        assert(rawCss || !/[?#]/.test(specifier), 'unclassified import suffix');
        const clean = rawCss ? specifier.replace(/\?(?:raw|inline)$/, '') : specifier,
          target = posix.normalize(posix.join(posix.dirname(path), clean));
        assert(rawCss || !target.endsWith('.css'), 'unclassified CSS loader');
        assert(target.startsWith('packages/ui-core/src/'), 'escaping source import');
        const extensions = ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'];
        const candidates = [
          ...new Set([
            target,
            ...extensions.map((ext) => target + ext),
            ...extensions.map((ext) => target + '/index' + ext),
            ...(target.endsWith('.js')
              ? ['.ts', '.tsx'].map((ext) => target.slice(0, -3) + ext)
              : [])
          ])
        ].filter((p) => files.has(p));
        assert(candidates.length === 1, 'missing or ambiguous source import: ' + specifier);
        check(candidates[0]);
      }
    };
  assert(record(ui.exports) && Object.keys(ui.exports).length > 0, 'missing source exports');
  for (const value of Object.values(ui.exports)) {
    assert(typeof value === 'string' && value.startsWith('./src/'), 'unclassified source export');
    const path = posix.normalize('packages/ui-core/' + value);
    assert(path.startsWith('packages/ui-core/src/'), 'escaping source export');
    check(path);
  }
  for (const path of policy.configs['packages/ui-core/tsconfig.build.json'].include)
    check('packages/ui-core/' + path);
  return inventory(
    [...files].map(([path, file]) =>
      tuple(
        build.has(path)
          ? 'build'
          : path.startsWith('.github/workflows/')
            ? 'check-definition'
            : 'context',
        path,
        file
      )
    )
  );
}
function recipeInputs(files, sourceFiles) {
  const requiredPaths = [
    '.github/workflows/ui-release.yml',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'scripts/ci-setup-pnpm.mjs',
    'scripts/ci-pnpm-bootstrap-lock.json',
    'scripts/ci-pnpm-diagnostics.cjs',
    'scripts/release/ui-build-policy.json',
    'scripts/release/ui-source.json'
  ];
  const paths = new Set(requiredPaths);
  for (const path of requiredPaths) required(files, path);
  assert.deepEqual(
    required(files, 'scripts/release/ui-build-policy.json').bytes,
    policyBytes,
    'unsupported recipe policy'
  );
  for (const path of files.keys())
    if (
      path.startsWith('scripts/release/') &&
      !path.includes('/fixtures/') &&
      !path.endsWith('.test.mjs') &&
      !path.endsWith('-fixtures.mjs')
    ) {
      assert(
        path.endsWith('.mjs') ||
          ['scripts/release/ui-build-policy.json', 'scripts/release/ui-source.json'].includes(path),
        'unclassified recipe extension: ' + path
      );
      paths.add(path);
    }
  for (const path of paths)
    if (path.endsWith('.mjs'))
      for (const specifier of moduleImports(required(files, path).bytes, path)) {
        if (specifier.startsWith('node:')) {
          assert(
            [
              'node:assert/strict',
              'node:child_process',
              'node:crypto',
              'node:fs',
              'node:fs/promises',
              'node:os',
              'node:path',
              'node:url',
              'node:zlib'
            ].includes(specifier),
            'unclassified recipe builtin import'
          );
          continue;
        }
        if (['@babel/parser', 'yaml'].includes(specifier)) continue;
        assert(specifier.startsWith('./'), 'escaping recipe import: ' + specifier);
        const target = posix.normalize(posix.join(posix.dirname(path), specifier));
        assert(paths.has(target), 'unclassified recipe import closure: ' + target);
      }
  return inventory(
    [...paths]
      .map((path) =>
        tuple(
          path === 'scripts/release/ui-source.json' ? 'context' : 'recipe',
          path,
          required(files, path)
        )
      )
      .concat(
        ['pnpm-lock.yaml', 'scripts/release/prepare-ui.mjs'].map((path) =>
          tuple('recipe', 'source/' + path, required(sourceFiles, path))
        )
      )
  );
}

async function toolEvidence(tools) {
  keys(tools, ['node', 'pnpm', 'npm', 'git', 'tar', 'sh'], 'tools');
  assert(['linux', 'darwin'].includes(process.platform), 'unsupported tool platform');
  const chain = [],
    audits = [];
  for (const name of Object.keys(tools).sort(compare)) {
    const tool = tools[name];
    keys(tool, ['executable', 'distributionRoot'], 'tool');
    assert(
      isAbsolute(tool.executable) && isAbsolute(tool.distributionRoot),
      'tool paths must be absolute'
    );
    const root = await realpath(tool.distributionRoot),
      executable = await realpath(tool.executable);
    const selectedRelative = relative(resolve(tool.distributionRoot), resolve(tool.executable))
      .split(sep)
      .join('/');
    assert(
      selectedRelative &&
        !selectedRelative.split('/').includes('..') &&
        !isAbsolute(selectedRelative),
      'tool executable must be selected within its distribution'
    );
    const inside = (path) => {
      const rel = relative(root, path);
      return rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
    };
    assert(inside(executable), 'tool executable outside distribution');
    const entries = [],
      seen = new Set();
    let count = 0,
      total = 0;
    const walk = async (path, logical) => {
      assert(++count <= 20000, 'tool distribution entry limit');
      assert(
        logical.normalize('NFC') === logical && !seen.has(pathKey(logical)),
        'tool path collision'
      );
      seen.add(pathKey(logical));
      let stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        const target = await realpath(path);
        assert(inside(target), 'tool link escapes distribution');
        stat = await lstat(target);
        assert(stat.isFile(), 'tool links must resolve to regular internal files');
        entries.push(
          tuple('tool', '@link-target/' + logical, {
            mode: '100644',
            bytes: Buffer.from(relative(root, target).split(sep).join('/'))
          })
        );
      }
      assert((stat.mode & 0o7000) === 0, 'unsupported special tool permissions');
      if (stat.isDirectory()) {
        for (const child of (await readdir(path)).sort(compare)) {
          assert(
            child !== '.' && child !== '..' && !/[\x00-\x1f\\/]/.test(child),
            'unsafe tool path'
          );
          await walk(join(path, child), logical + '/' + child);
        }
      } else {
        assert(
          stat.isFile() && Number.isSafeInteger(stat.size) && stat.size <= 256 * MiB - total,
          'nonregular or oversized tool file'
        );
        const target = await realpath(path);
        assert(inside(target), 'tool path escapes distribution');
        const {bytes, stat: actual} = await boundedFile(target, 256 * MiB - total);
        assert.equal(actual.size, stat.size, 'tool file changed');
        total += bytes.length;
        assert(total <= 256 * MiB, 'tool distribution byte limit');
        entries.push(
          tuple('tool', logical, {mode: stat.mode & 0o111 ? '100755' : '100644', bytes})
        );
      }
    };
    // A fixed logical path binds the executable as well as all supporting distribution files.
    const scan = async () => {
      for (const child of (await readdir(root)).sort(compare)) await walk(join(root, child), child);
      return inventory([...entries]);
    };
    const before = await scan();
    assert(
      entries.some(
        (e) => e[1] === relative(root, executable).split(sep).join('/') && e[2] === '100755'
      ),
      'tool must be executable'
    );
    const selected = entries.find((e) => e[1] === relative(root, executable).split(sep).join('/'));
    const selections = [
      ['tool', '@executable/' + selectedRelative, selected[2], selected[3], selected[4]],
      ['tool', '@resolved-executable/' + selected[1], selected[2], selected[3], selected[4]]
    ];
    entries.push(...selections);
    const neutral = await mkdtemp(join(tmpdir(), 'ui-tool-probe-'));
    let version;
    try {
      version = await probeTool(resolve(tool.executable), name, neutral, tools);
    } finally {
      await rm(neutral, {recursive: true, force: true});
    }
    entries.length = 0;
    seen.clear();
    count = 0;
    total = 0;
    assert.deepEqual(await scan(), before, 'tool distribution changed during version probe');
    entries.push(...selections);
    chain.push([name, version, process.platform, process.arch, inventory([...entries])]);
    audits.push(async () => {
      entries.length = 0;
      seen.clear();
      count = 0;
      total = 0;
      assert.deepEqual(await scan(), before, 'tool distribution changed during version probes');
    });
  }
  for (const audit of audits) await audit();
  return chain;
}
async function probeTool(executable, name, neutral, tools) {
  const bin = join(neutral, 'bin');
  await mkdir(bin);
  const userConfig = join(neutral, 'npm-user.rc'),
    globalConfig = join(neutral, 'npm-global.rc'),
    gitConfig = join(neutral, 'git.rc');
  for (const path of [userConfig, globalConfig, gitConfig]) await writeFile(path, '');
  for (const [logical, tool] of Object.entries(tools))
    await symlink(await realpath(tool.executable), join(bin, logical));
  const args = name === 'sh' ? ['-c', 'printf "%s\\n" "${BASH_VERSION:-POSIX-sh}"'] : ['--version'];
  const child = spawn(executable, args, {
    cwd: neutral,
    detached: true,
    env: {
      PATH: bin,
      HOME: neutral,
      LC_ALL: 'C',
      TZ: 'UTC',
      CI: 'true',
      NPM_CONFIG_USERCONFIG: userConfig,
      NPM_CONFIG_GLOBALCONFIG: globalConfig,
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const exit = directExit(child),
    chunks = [];
  let length = 0,
    error,
    timer,
    operationError;
  let abort;
  const failed = new Promise((_, reject) => {
    abort = reject;
    timer = setTimeout(() => reject(new Error('tool probe failed: tool probe timed out')), 30000);
  });
  const collect = (bytes) => {
    length += bytes.length;
    if (length > 64 * 1024) abort(new Error('tool probe failed: tool version output limit'));
    else chunks.push(bytes);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', (e) => {
    error ??= e;
  });
  const complete = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  try {
    const code = await Promise.race([complete, failed]);
    assert(!error && code === 0, 'tool probe failed: ' + (error?.message ?? code));
    const version = utf8(Buffer.concat(chunks)).trim();
    assert(version && Buffer.byteLength(version) <= 4096, 'tool version text limit');
    assert(name !== 'sh' || version !== 'POSIX-sh', 'POSIX shell version is unavailable');
    return version;
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    clearTimeout(timer);
    try {
      await stopChild(child, exit);
    } catch (error) {
      throw new AggregateError(
        operationError ? [operationError, error] : [error],
        'tool probe operation or cleanup failed'
      );
    }
  }
}

export async function computeUiBuildEvidence(options) {
  keys(
    options,
    ['sourceRepo', 'source', 'recipeRepo', 'recipeCommit', 'tools', 'sourceChecks'],
    'build evidence call'
  );
  let {sourceRepo, source, recipeRepo, recipeCommit, tools, sourceChecks} = options;
  keys(source, ['repository', 'commit', 'version'], 'source');
  source = {...source};
  assert.equal(source.repository, 'clintongormley/waitron', 'unsupported source repository');
  assert(
    typeof source.version === 'string' &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(source.version),
    'unsupported source version'
  );
  assert(
    Buffer.isBuffer(sourceChecks) && sourceChecks.length <= 16 * MiB,
    'source-check bytes must be a Buffer at most 16 MiB'
  );
  keys(tools, ['node', 'pnpm', 'npm', 'git', 'tar', 'sh'], 'tools');
  tools = Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, {...tool}]));
  sourceChecks = Buffer.from(sourceChecks);
  const budget = {remaining: 512 * MiB};
  const sourceTree = await readUiGitTreeBudget(
    {repo: sourceRepo, commit: source.commit, git: tools.git.executable},
    budget
  );
  const recipeTree = await readUiGitTreeBudget(
    {repo: recipeRepo, commit: recipeCommit, git: tools.git.executable},
    budget
  );
  const inputs = sourceInputs(sourceTree.files, source),
    recipeEntries = recipeInputs(recipeTree.files, sourceTree.files),
    toolchain = await toolEvidence(tools);
  const inputBytes = serialise([
    'ui-build-evidence',
    1,
    'inputs',
    source.repository,
    source.commit,
    source.version,
    inputs
  ]);
  const recipeBytes = serialise([
    'ui-build-evidence',
    1,
    'recipe',
    'waitron-io/waitron-cloud',
    recipeCommit,
    source.commit,
    policy.policyVersion,
    policy.commands,
    toolchain,
    recipeEntries
  ]);
  assert(
    inputBytes.length <= 32 * MiB && recipeBytes.length <= 32 * MiB,
    'serialised evidence byte limit'
  );
  return {
    schema: 1,
    source: {...source},
    recipeCommit,
    inputs,
    recipeInputs: recipeEntries,
    toolchain,
    inputsSha512: inputBytes.sha512,
    recipeSha512: recipeBytes.sha512,
    sourceChecksSha512: sha512(sourceChecks)
  };
}
