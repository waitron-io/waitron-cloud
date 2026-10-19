import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {sourceDependencies, scopeForPaths, quotedReferences} from './ci-scope.mjs';

function directoryPattern(expression) {
  // Comments separate tokens like whitespace and stop at their first terminator;
  // crossing a terminator could hide options inside the closing-call lookahead.
  const space = String.raw`(?:\s|/\*(?:[^*]|\*(?!/))*\*/|//[^\r\n\u2028\u2029]*(?:[\r\n\u2028\u2029]|$))`;
  return new RegExp(expression.source.replaceAll(String.raw`\s*`, space + '*')
    .replaceAll(String.raw`\s+`, space + '+'), expression.flags);
}

function arrayDirectorySource(source) {
  // Mask punctuation inside complete literal-like tokens before scanning array
  // predecessors. Matching the original text too preserves earlier conservative
  // matches; the separator prevents a match spanning the two source copies.
  const tokens = /'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|\x60(?:\\[\s\S]|[^\x60\\])*\x60|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\r\n\u2028\u2029]*(?:[\r\n\u2028\u2029]|$)|\/(?![*/])(?:\\[^\r\n]|\[(?:\\[^\r\n]|[^\]\\\r\n])*\]|[^/\\[\r\n])+\//g;
  return source + '\n;\n' + source.replace(tokens, token => token.replace(/[\[\]{};]/g, ' '));
}

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
  // Named directories retain possible descendants; root scans without options
  // enumerate immediate entries rather than command working directories.
  const directories = new Map();
  for (const path of modules.keys()) {
    for (let directory = posix.dirname(path); directory !== '.'; directory = posix.dirname(directory)) {
      if (!directories.has(directory)) directories.set(directory, []);
      directories.get(directory).push(path);
    }
  }
  const rootModules = [...modules.keys()].filter(path => posix.dirname(path) === '.');
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
      // Glob patterns, options and the default working directory can reach inputs
      // outside the quoted paths; unresolved scans must keep every package.
      assert.doesNotMatch(source.source, /\b(?:globSync|glob)\b/, `Unresolved glob scan at ${source.path}`);
      // Backticks and closing parentheses/brackets can precede directory readers
      // through member chains. This scan preserves tagged calls and nested keys
      // without evaluation; opening backticks and inert text can also match.
      assert.doesNotMatch(source.source, directoryPattern(/[)`\]]\s*(?:!\s*)*(?:(?:(?:\?\.|\.)\s*#?(?:[$_\p{ID_Start}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))(?:[$\u200c\u200d\p{ID_Continue}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))*|(?:\?\.\s*)?\[[^\[\]]*\])\s*(?:!\s*)*)*(?:\?\.|\.)\s*(?:readdirSync|readdir|opendirSync|opendir)\b/u),
        `Unresolved parenthesized directory member at ${source.path}`);
      // A Unicode escape can hide a directory API in a dot-member name.
      // Without resolving member identities, keep every possible consumer.
      assert.doesNotMatch(source.source, directoryPattern(/\.\s*[$_\p{ID_Continue}]*\\u/u),
        `Unresolved escaped member at ${source.path}`);
      // Optional calls and function members can enumerate a directory without
      // matching a direct call; unresolved arguments retain every consumer.
      // TypeScript non-null assertions leave the runtime function unchanged,
      // including when the assertion is followed by a direct invocation.
      // Closing parentheses can wrap the reader before invocation or member
      // access. Type arguments and satisfies checks are erased before execution;
      // unresolved references must retain their possible consumers.
      // Array elements can preserve the reader until a later indexed call;
      // simple comma-separated and closing-bracket references stay unresolved.
      // A semicolon can end an assignment that stores the reader for a later call.
      // Escapes can spell a directory API without a literal name. Keep every
      // consumer rather than interpreting unresolved string or template keys.
      // Require a receiver so escaped array values after `of` or `return`
      // do not force unrelated package suites.
      assert.doesNotMatch(source.source, directoryPattern(/(?:\b(?!(?:of|in|return|throw|yield|await|void|typeof|delete|new|instanceof)\b)[A-Za-z_$][\w$]*|[)\]])\s*(?:!\s*)*(?:\?\.\s*)?\[\s*(?:\(\s*)*(?:'[^'\\]*\\|"[^"\\]*\\|`[^`\\]*\\)/),
        `Unresolved escaped directory key at ${source.path}`);
      // Literal keys can preserve directory readers through erased assertions
      // and parentheses. Without resolving the remaining expression, keep consumers.
      assert.doesNotMatch(source.source, directoryPattern(/\[\s*(?:\(\s*)*(['"`])(?:readdirSync|readdir|opendirSync|opendir)\1/),
        `Unresolved indirect directory call at ${source.path}`);
      // The first array element can preserve a reader through a namespace chain;
      // comments, optional access and non-null assertions leave that value intact.
      assert.doesNotMatch(source.source, directoryPattern(/\[\s*(?:#?(?:[$_\p{ID_Start}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))(?:[$\u200c\u200d\p{ID_Continue}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))*\s*(?:!\s*)*(?:\?\.|\.)\s*)*(?:readdirSync|readdir|opendirSync|opendir)\b/u),
        `Unresolved indirect directory call at ${source.path}`);
      assert.doesNotMatch(source.source, directoryPattern(/\b(?:readdirSync|readdir|opendirSync|opendir)\s*(?:(?:!\s*)*(?:\?\.|\.|\[|(?:,\s*)?\]|\)|;|<|satisfies\b)|(?:!\s*)+\()/),
        `Unresolved indirect directory call at ${source.path}`);
      // Assignments and default exports preserve readers across line endings or EOF.
      // Require a value expression so ordinary named imports keep their scope.
      assert.doesNotMatch(source.source, directoryPattern(/(?:=|\bexport\s+default)\s*(?:#?(?:[$_\p{ID_Start}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))(?:[$\u200c\u200d\p{ID_Continue}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))*\s*(?:!\s*)*(?:\?\.|\.)\s*)*(?:readdirSync|readdir|opendirSync|opendir)\b\s*(?:!\s*)*(?:,|[\r\n\u2028\u2029]|\/\/|$)/u),
        `Unresolved indirect directory call at ${source.path}`);
      // A comma can store the reader between other elements. Require an array
      // opener so ordinary named imports do not force full package work. A simple
      // namespace chain, including Unicode and private names, preserves the stored
      // function through non-null assertions too.
      const arraySource = arrayDirectorySource(source.source);
      assert.doesNotMatch(arraySource, directoryPattern(/\[[^\[\]{};]*,\s*(?:#?(?:[$_\p{ID_Start}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))(?:[$\u200c\u200d\p{ID_Continue}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))*\s*(?:!\s*)*(?:\?\.|\.)\s*)*(?:readdirSync|readdir|opendirSync|opendir)\s*(?:!\s*)*,/u),
        `Unresolved indirect directory call at ${source.path}`);
      // A nested value can precede ordinary elements and a stored reader.
      // Resume at its closing delimiter without interpreting the earlier value;
      // brackets, braces and semicolons outside matched tokens bound this scan.
      assert.doesNotMatch(arraySource, directoryPattern(/[\]}][^\[\]{};]*,\s*(?:#?(?:[$_\p{ID_Start}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))(?:[$\u200c\u200d\p{ID_Continue}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))*\s*(?:!\s*)*(?:\?\.|\.)\s*)*(?:readdirSync|readdir|opendirSync|opendir)\s*(?:!\s*)*,/u),
        `Unresolved indirect directory call at ${source.path}`);
      // Logical assignments and awaited logical or conditional operands can keep
      // the reader for a later call. Namespace chains, optional access and erased
      // non-null assertions also preserve that function without resolving it.
      assert.doesNotMatch(source.source, directoryPattern(/\b(?:readdirSync|readdir|opendirSync|opendir)\s*(?:!\s*)*(?:&&|\|\||\?\?|\?(?!\.)|:)|(?:(?:&&|\|\||\?\?)=?|\?|:)\s*(?:await\s+)*(?:#?(?:[$_\p{ID_Start}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))(?:[$\u200c\u200d\p{ID_Continue}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))*\s*(?:!\s*)*(?:\?\.|\.)\s*)*(?:readdirSync|readdir|opendirSync|opendir)\b/u),
        `Unresolved indirect directory call at ${source.path}`);
      // An imported alias can enumerate helpers without naming a directory API
      // at its call site. Quoted names and escaped alias tokens stay unresolved;
      // those bindings must retain every possible consumer without decoding code.
      assert.doesNotMatch(source.source, directoryPattern(/\b(?:readdirSync|readdir|opendirSync|opendir)['"]?\s+as\b/),
        `Unresolved directory import alias at ${source.path}`);
      // Consume each escaped token before testing its suffix, so a long ordinary
      // string cannot restart the same suffix scan at every backslash.
      const aliasSuffix = directoryPattern(/\s+as\b/y);
      for (const token of source.source.matchAll(/(?<![\w$\\{}'"])[\w${}'"]*(?:\\[\s\S][\w${}'"]*)+/g)) {
        aliasSuffix.lastIndex = token.index + token[0].length;
        assert.ok(!aliasSuffix.test(source.source), `Unresolved directory import alias at ${source.path}`);
      }
      // Bare names can hide directory readers behind Unicode escapes. Decode
      // the whole name so unrelated escaped identifiers keep their own scope.
      for (const token of source.source.matchAll(/(?<![$\p{ID_Continue}\\.'"`])[$_\p{ID_Continue}]*\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\})(?:[$\p{ID_Continue}]|\\u(?:[\da-fA-F]{4}|\{0*[\da-fA-F]{1,6}\}))*/gu)) {
        const name = token[0].replace(/\\u(?:([\da-fA-F]{4})|\{(0*[\da-fA-F]{1,6})\})/g,
          (_, fixed, braced) => String.fromCodePoint(parseInt(fixed ?? braced, 16)));
        assert.doesNotMatch(name, /^(?:readdirSync|readdir|opendirSync|opendir)$/,
          `Unresolved escaped identifier at ${source.path}`);
      }
      const rootReads = new Set([...source.source.matchAll(directoryPattern(/\b(?:readdirSync|readdir|opendirSync|opendir)\s*\(\s*new\s+URL\s*\(\s*(['"`])([^'"`\n$\\]*)\1\s*,\s*import\.meta\.url\s*,?\s*\)\s*,?\s*\)/g))].map(match => match[2]));
      // Options may enable recursion or supply a computed policy; an unresolved
      // root scan cannot justify omitting any package consumer.
      const optionReads = new Set([...source.source.matchAll(directoryPattern(/\b(?:readdirSync|readdir|opendirSync|opendir)\s*\(\s*new\s+URL\s*\(\s*(['"`])([^'"`\n$\\]*)\1\s*,\s*import\.meta\.url\s*,?\s*\)\s*,(?!\s*\))/g))].map(match => match[2]));
      const optionVariables = new Set([...source.source.matchAll(directoryPattern(/\b(?:readdirSync|readdir|opendirSync|opendir)\s*\(\s*([A-Za-z_$][\w$]*)\s*,(?!\s*\))/g))].map(match => match[1]));
      // A root URL variable retains helpers when its identifier is scanned.
      const scannedVariables = new Set([...source.source.matchAll(directoryPattern(/\b(?:readdirSync|readdir|opendirSync|opendir)\s*\(\s*([A-Za-z_$][\w$]*)\s*,?\s*\)/g))].map(match => match[1]));
      for (const match of source.source.matchAll(directoryPattern(/(?:\b(?:const|let|var)\s+|,\s*)([A-Za-z_$][\w$]*)\s*(?::\s*URL\s*)?=\s*new\s+URL\s*\(\s*(['"`])([^'"`\n$\\]*)\2\s*,\s*import\.meta\.url\s*,?\s*\)/g))) {
        if (scannedVariables.has(match[1])) rootReads.add(match[3]);
        if (optionVariables.has(match[1])) optionReads.add(match[3]);
      }
      for (const value of optionReads) {
        assert.doesNotMatch(value, /[?#%]/, `Unverified repository-root directory scan options at ${source.path}`);
        const target = posix.normalize(posix.join(posix.dirname(source.path), value)).replace(/\/$/, '');
        assert.notEqual(target, '.', `Unverified repository-root directory scan options at ${source.path}`);
        assert.ok(target !== '..' && !target.startsWith('../'), `Unverified repository-root directory scan options at ${source.path}`);
      }
      for (const value of quotedReferences(source.source)) {
        const target = value.startsWith('.') ? posix.normalize(posix.join(posix.dirname(source.path), value)) : posix.normalize(value);
        if (packages.some(other => target.startsWith(`${other.directory}/`))) continue;
        // Keep descendant helpers without matching a similarly named sibling.
        for (const path of [...(target.replace(/\/$/, '') === '.' && rootReads.has(value) ? rootModules : []), ...(directories.get(posix.normalize(target).replace(/\/$/, '')) ?? []), target, target.replace(/\.js$/, '.ts'), target.replace(/\.mjs$/, '.mts'), target.replace(/\.cjs$/, '.cts'), target.replace(/\.jsx?$/, '.tsx'),
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
