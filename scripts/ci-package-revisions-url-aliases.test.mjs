import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {scopeForRevisions, readGitBlobs} from './ci-package-revisions.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-package-revisions-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const write = (path, content) => {
    mkdirSync(join(root, path, '..'), {recursive: true});
    writeFileSync(join(root, path), content);
  };
  const commit = () => {git('add', '.'); git('commit', '-sm', 'Package graph fixture'); return git('rev-parse', 'HEAD').trim();};
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    write('package.json', JSON.stringify({name: 'revision-fixture', private: true}));
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    write('zz-inventory-tail.txt', 'Unrelated inventory tail.\n');
    const workspace = ['catalogue', 'gateway', 'portal', 'unrelated'].map(name => ({
      name, private: true, directory: `packages/${name}`, scripts: {test: 'node --test'},
    }));
    for (const pkg of workspace) {
      write(`${pkg.directory}/package.json`, JSON.stringify({name: pkg.name, private: true, scripts: pkg.scripts}));
      write(`${pkg.directory}/src/index.mjs`, 'export const value = 1;\n');
    }
    git.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    const plan = (base, head, call = git) => createPlan(
      {pull_request: {base: {sha: base}, head: {sha: head}}},
      {sha: head, repository: 'waitron-io/waitron-cloud'}, workspace, call,
      () => {throw Error('No API expected');});
    run({root, git, write, commit, plan, workspace});
  } finally {rmSync(root, {recursive: true, force: true});}
}

// Dropping a URL alias edge must lose an executed helper consumer in these controls.
const apis = ['readdirSync', 'readdir', 'opendirSync', 'opendir'];
const helper = "import './packages/catalogue/src/index.mjs';\nconsole.log('aliased directory helper loaded');\n";
function reader(api, declarations, options = '') {
  return `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
${declarations}
for await (const item of await ${api}(directory${options})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(typeof item === 'string'
    ? new URL('../../../' + name, import.meta.url) : new URL('file://' + item.parentPath + '/' + name));
}`;
}
const execute = root => execFileSync(process.execPath, ['packages/portal/src/scan.mts'], {cwd: root, encoding: 'utf8', timeout: 5000});
const aliases = [
  ['single', "const original = new URL('../../../', import.meta.url); const directory = original;"],
  ['chain', "let original = new URL('../../../', import.meta.url), intermediate = original, directory = intermediate;"],
  ['escaped and typed', String.raw`const \u006friginal = new U\u0052L('../../../', import.meta.url); var diréctory: URL = original; const directory: U\u{52}L = dir\u00e9ctory;`],
  ['cycle and reverse declaration order', "var directory = intermediate, intermediate = original, original = new URL('../../../', import.meta.url); directory = intermediate = original; var original = directory;"],
];

test('URL declaration aliases retain executed immediate helper consumers', async t => {
  for (const [index, [name, declarations]] of aliases.entries()) {
    const api = apis[index];
    await t.test(`${api} ${name}`, () => fixture(({root, git, write, commit, workspace}) => {
      write('catalogue-adapter.mjs', helper);
      write('nested/unrelated-adapter.mjs', "import '../packages/unrelated/src/index.mjs';\n");
      write('packages/portal/src/scan.mts', reader(api, declarations));
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execute(root), 'aliased directory helper loaded\n');
      assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
        {full: false, packages: ['catalogue', 'portal']});
      assert.deepEqual(scopeForRevisions(['packages/unrelated/src/index.mjs'], workspace, base, head, git),
        {full: false, packages: ['unrelated']});
    }));
  }
});

test('aliased URL readers retain old and new saved transitive consumers', async t => {
  for (const [revision, change] of [['base', 'edit'], ['base', 'delete'], ['head', 'add'], ['head', 'edit']]) {
    await t.test(`${revision} ${change}`, () => fixture(({root, git, write, commit, workspace}) => {
      if (change !== 'add') write('catalogue-adapter.mjs', helper);
      const active = reader('readdirSync', aliases[1][1]).replaceAll('../../../', '../');
      write('tools/scan.mts', revision === 'base' ? active : 'export const inert = true;\n');
      write('packages/portal/src/scan.mts', "import '../../../tools/scan.mts';\n");
      write('packages/gateway/src/index.mjs', "import '../../portal/src/scan.mts';\n");
      const base = commit();
      if (revision === 'base') assert.equal(execute(root), 'aliased directory helper loaded\n');
      write('tools/scan.mts', revision === 'head' ? active : 'export const inert = true;\n');
      if (change === 'delete') rmSync(join(root, 'catalogue-adapter.mjs'));
      else write('catalogue-adapter.mjs', helper + '// changed helper\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision === 'head') assert.equal(execute(root), 'aliased directory helper loaded\n');
      write('tools/scan.mts', 'export const dirty = true;\n');
      write('catalogue-adapter.mjs', 'export const dirty = true;\n');
      assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
        {full: false, packages: ['catalogue', 'gateway', 'portal']});
    }));
  }
});

test('aliased root URL readers with options retain all possible consumers', async t => {
  for (const api of apis) await t.test(api, () => fixture(({root, write, commit, plan}) => {
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.mjs';\nconsole.log('nested alias helper loaded');\n");
    write('packages/portal/src/scan.mts', reader(api, aliases[1][1], ', {recursive: true}'));
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execute(root), 'nested alias helper loaded\n');
    const selected = plan(base, head);
    assert.deepEqual(selected.packages.map(pkg => pkg.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    assert.match(selected.reason, /Unverified repository-root directory scan options/);
  }));
});

test('unused aliases, unrelated names and local alias reads keep narrow selection', async t => {
  for (const [name, source] of [
    ['unused', aliases[1][1]],
    ['different scanned name', aliases[0][1] + " const other = new URL('./', import.meta.url); readdirSync(other);"],
    ['local alias', "const original = new URL('./', import.meta.url); const directory = original; readdirSync(directory);"],
    ['prefix of an expression', "const original = new URL('../../../', import.meta.url); const directory = original.href;"],
    ['working directory', "const original = new URL('../../../', import.meta.url); const directory = original; const command = {cwd: directory};"],
  ]) await t.test(name, () => fixture(({root, git, write, commit, workspace}) => {
    write('catalogue-adapter.mjs', helper);
    write('packages/portal/src/scan.mts', "import {readdirSync} from 'node:fs';\n" + source);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execute(root), '');
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
      {full: false, packages: ['catalogue']});
  }));
});
