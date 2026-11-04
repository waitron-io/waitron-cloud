import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {loadWorkspace} from './ci-scope.mjs';

async function fixture(run) {
  const scratch = mkdtempSync(join(tmpdir(), 'cloud-declared-readers-')), root = join(scratch, 'repo');
  mkdirSync(root);
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args],
    {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const put = (path, value) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), value);};
  const commit = () => {git('add', '-A'); git('commit', '-sm', 'Declared reader fixture'); return git('rev-parse', 'HEAD').trim();};
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.test');
    put('package.json', '{"name":"declared-readers-fixture","private":true}\n');
    put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    for (const name of ['catalogue', 'consumer', 'unrelated']) {
      put(`packages/${name}/package.json`, JSON.stringify({name, private: true, scripts: {test: 'node --test'}}));
      put(`packages/${name}/src/index.mjs`, 'export const value = 1;\n');
    }
    put('packages/consumer/src/index.mjs', "import {value} from '../../../scripts/declared.mjs';\nconsole.log(value);\n");
    put('scripts/link.mjs', "export {value} from '../packages/catalogue/src/index.mjs';\n");
    put('scripts/orphan.mjs', "import {readdirSync} from 'node:fs';\nreaddirSync('/unresolved-source');\n");
    const load = async declarations => {
      // Inject fixture evidence only into a private copy; production has no override switch.
      const code = readFileSync(new URL('./ci-package-revisions.mjs', import.meta.url), 'utf8')
        .replace("'./ci-scope.mjs'", JSON.stringify(new URL('./ci-scope.mjs', import.meta.url).href));
      const scanner = join(scratch, `scanner-${Math.random()}.mjs`);
      writeFileSync(scanner, code);
      writeFileSync(join(scratch, 'ci-package-readers.mjs'), `export const reviewedDirectoryReaders = Object.freeze(${JSON.stringify(declarations)});\n`);
      return (await import(pathToFileURL(scanner).href)).scopeForRevisions;
    };
    await run({root, git, put, commit, load});
  } finally {rmSync(scratch, {recursive: true, force: true});}
}

// Restoring whole-directory expansion, or skipping helper traversal, must each break this case.
for (const directory of ['./', '.', '..']) test(`a reviewed ${directory} value excludes directory guesses and retains a real helper`, () => fixture(async ({root, git, put, commit, load}) => {
  const source = `import {readdirSync} from 'node:fs';\nexport const runtime = () => readdirSync('/owned-runtime-json');\nconst directory = '${directory}';\nexport {value} from './link.mjs';\n`;
  const reader = directory === '..' ? 'scripts/nested/declared.mjs' : 'scripts/declared.mjs';
  put(reader, source);
  if (directory === '..') {
    put('scripts/nested/link.mjs', "export {value} from '../../packages/catalogue/src/index.mjs';\n");
    put('packages/consumer/src/index.mjs', "import {value} from '../../../scripts/nested/declared.mjs';\nconsole.log(value);\n");
  }
  const base = commit(), id = git('hash-object', reader).trim();
  const scope = await load({[reader]: {mode: '100644', type: 'blob', id, nonSourceDirectoryReads: true, directoryReferences: [directory]}});
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(scope(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue', 'consumer']});
  assert.equal(execFileSync(process.execPath, ['packages/consumer/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '2\n');
}));

for (const revision of ['base', 'head']) test(`a changed declaration reader in ${revision} cannot hide behind current evidence`, () => fixture(async ({root, git, put, commit, load}) => {
  const source = "import {readdirSync} from 'node:fs';\nexport const runtime = () => readdirSync('/owned-runtime-json');\nexport {value} from './link.mjs';\n";
  put('scripts/declared.mjs', source);
  const original = commit(), id = git('hash-object', 'scripts/declared.mjs').trim();
  const scope = await load({'scripts/declared.mjs': {mode: '100644', type: 'blob', id, nonSourceDirectoryReads: true, directoryReferences: []}});
  put('scripts/declared.mjs', source + "\nconst unreviewed = 'changed';\n");
  const changed = commit();
  put('scripts/declared.mjs', source);
  const restored = commit();
  assert.throws(() => scope(['packages/catalogue/src/index.mjs'], loadWorkspace(root),
    revision === 'base' ? changed : original, revision === 'head' ? changed : restored, git), /Unreviewed package reader/);
}));

test('a directory-value declaration alone cannot admit a source-discovery scan', () => fixture(async ({root, git, put, commit, load}) => {
  put('scripts/declared.mjs', "import {readdirSync} from 'node:fs';\nreaddirSync('/unresolved-source');\n");
  const sha = commit(), id = git('hash-object', 'scripts/declared.mjs').trim();
  const scope = await load({'scripts/declared.mjs': {mode: '100644', type: 'blob', id, nonSourceDirectoryReads: false, directoryReferences: ['.']}});
  assert.throws(() => scope(['packages/catalogue/src/index.mjs'], loadWorkspace(root), sha, sha, git), /Unresolved directory input/);
}));

test('an undeclared reader keeps its original conservative refusal', () => fixture(async ({root, git, put, commit, load}) => {
  put('scripts/declared.mjs', "import {readdirSync} from 'node:fs';\nreaddirSync('/unresolved-source');\n");
  const sha = commit(), scope = await load({});
  assert.throws(() => scope(['packages/catalogue/src/index.mjs'], loadWorkspace(root), sha, sha, git), /Unresolved directory input/);
}));

test('a declared helper cycle and a base-only consumer survive dirty live readers', () => fixture(async ({root, git, put, commit, load}) => {
  const source = "import {readdirSync} from 'node:fs';\nexport const runtime = () => readdirSync('/owned-runtime-json');\nexport {value} from './link.mjs';\n";
  put('scripts/declared.mjs', source);
  put('scripts/link.mjs', "import './cycle.mjs';\nexport {value} from '../packages/catalogue/src/index.mjs';\n");
  put('scripts/cycle.mjs', "import './declared.mjs';\n");
  const base = commit(), id = git('hash-object', 'scripts/declared.mjs').trim();
  const scope = await load({'scripts/declared.mjs': {mode: '100644', type: 'blob', id, nonSourceDirectoryReads: true, directoryReferences: []}});
  assert.equal(execFileSync(process.execPath, ['packages/consumer/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '1\n');
  put('packages/consumer/src/index.mjs', 'export const value = 3;\n');
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  put('scripts/declared.mjs', 'export {};\n');
  put('scripts/link.mjs', 'export {};\n');
  assert.deepEqual(scope(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue', 'consumer']});
}));

for (const reference of ['scripts/link.mjs', 'packages/catalogue/src/index.mjs']) test(`an excluded directory keeps its explicitly declared ${reference} input`, () => fixture(async ({root, git, put, commit, load}) => {
  const helper = reference.startsWith('scripts/');
  const computed = helper ? "'./' + 'link.mjs'" : "'../packages/' + 'catalog' + 'ue/src/index.mjs'";
  const source = `import {readdirSync} from 'node:fs';\nexport const runtime = () => readdirSync('/owned-runtime-json');\nconst {value} = await import(${computed});\nexport {value};\n`;
  put('scripts/declared.mjs', source);
  const base = commit(), id = git('hash-object', 'scripts/declared.mjs').trim();
  const scope = await load({'scripts/declared.mjs': {mode: '100644', type: 'blob', id,
    nonSourceDirectoryReads: true, directoryReferences: [helper ? './' : '../packages/'], sourceReferences: [reference]}});
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(scope(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue', 'consumer']});
  assert.equal(execFileSync(process.execPath, ['packages/consumer/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '2\n');
}));

for (const options of ['', ', {withFileTypes: true}']) test(`a directory-only exclusion cannot hide its actual URL scan${options}`, () => fixture(async ({root, git, put, commit, load}) => {
  const source = `import {readdirSync} from 'node:fs';\nexport let value = 0;\nfor (const entry of readdirSync(new URL('.', import.meta.url)${options})) {\n const name = typeof entry === 'string' ? entry : entry.name;\n if (name === 'link.mjs') value = (await import(new URL(name, import.meta.url))).value;\n}\n`;
  put('scripts/declared.mjs', source);
  const sha = commit(), id = git('hash-object', 'scripts/declared.mjs').trim();
  const scope = await load({'scripts/declared.mjs': {mode: '100644', type: 'blob', id, nonSourceDirectoryReads: false, directoryReferences: ['.']}});
  assert.equal(execFileSync(process.execPath, ['packages/consumer/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '1\n');
  assert.throws(() => scope(['packages/catalogue/src/index.mjs'], loadWorkspace(root), sha, sha, git), /Directory exclusion hides a scanned input/);
}));

test('a declared data reader retains its own quoted sibling input', () => fixture(async ({root, git, put, commit, load}) => {
  put('scripts/declared.mjs', "import {readdirSync} from 'node:fs';\nexport const runtime = () => readdirSync('/owned-runtime-json');\nexport {value} from '../packages/catalogue/src/index.mjs';\n");
  const base = commit(), id = git('hash-object', 'scripts/declared.mjs').trim();
  const scope = await load({'scripts/declared.mjs': {mode: '100644', type: 'blob', id, nonSourceDirectoryReads: true, directoryReferences: []}});
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  assert.deepEqual(scope(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, commit(), git), {full: false, packages: ['catalogue', 'consumer']});
  assert.equal(execFileSync(process.execPath, ['packages/consumer/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '2\n');
}));

test('a declaration cannot excuse an unresolved glob reader', () => fixture(async ({root, git, put, commit, load}) => {
  put('scripts/declared.mjs', "import {globSync} from 'node:fs';\nexport const runtime = () => globSync('packages/**/src/*.mjs');\n");
  const sha = commit(), id = git('hash-object', 'scripts/declared.mjs').trim();
  const scope = await load({'scripts/declared.mjs': {mode: '100644', type: 'blob', id, nonSourceDirectoryReads: true, directoryReferences: []}});
  assert.throws(() => scope(['packages/catalogue/src/index.mjs'], loadWorkspace(root), sha, sha, git), /Unresolved glob scan/);
}));
