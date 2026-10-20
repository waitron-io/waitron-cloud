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

// Dropping a later URL assignment edge must lose an executed helper consumer in these controls.
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
const assignments = [
  ['later assignment', "const original = new URL('../../../', import.meta.url); let directory; directory = original;"],
  ['separate chain', "const original = new URL('../../../', import.meta.url); let middle, directory; middle = original; directory = middle;"],
  ['combined chain', "const original = new URL('../../../', import.meta.url); let middle, directory; directory = middle = original;"],
  ['mixed declaration and assignment', "const original = new URL('../../../', import.meta.url); let middle; middle = original; const directory = middle;"],
  ['cycle', "const original = new URL('../../../', import.meta.url); let middle, directory; directory = middle = original; middle = directory;"],
  ['escaped names', String.raw`const \u006friginal = new URL('../../../', import.meta.url); let \u0064irectory; directory = orig\u0069nal;`],
  ['comments and no semicolon', "const original = new URL('../../../', import.meta.url); let directory; directory /* transfer */ = /* URL */ original // keep this directory"],
  ['parenthesized assignment', "const original = new URL('../../../', import.meta.url); let directory; (directory = original);"],
];

test('later URL assignments retain helpers actually loaded by each directory API', async t => {
  for (const api of apis) for (const [name, declarations] of assignments) {
    await t.test(`${api} ${name}`, () => fixture(({root, git, write, commit, plan, workspace}) => {
      write('catalogue-adapter.mjs', helper);
      write('nested/unrelated-adapter.mjs', "import '../packages/unrelated/src/index.mjs';\n");
      write('packages/portal/src/scan.mts', reader(api, declarations));
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execute(root), 'aliased directory helper loaded\n');
      assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
        {full: false, packages: ['catalogue', 'portal']});
      assert.deepEqual(plan(base, head).packages.map(pkg => pkg.package), ['catalogue', 'portal']);
      assert.deepEqual(scopeForRevisions(['packages/unrelated/src/index.mjs'], workspace, base, head, git),
        {full: false, packages: ['unrelated']});
    }));
  }
});

test('assigned URL readers retain saved old and new transitive consumers', async t => {
  for (const [revision, change] of [['base', 'edit'], ['base', 'delete'], ['head', 'add'], ['head', 'edit']]) {
    await t.test(`${revision} ${change}`, () => fixture(({root, git, write, commit, workspace}) => {
      if (change !== 'add') write('catalogue-adapter.mjs', helper);
      const active = reader('readdirSync', assignments[2][1]).replaceAll('../../../', '../');
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

test('assigned root URL readers with options retain every possible consumer', async t => {
  for (const api of apis) await t.test(api, () => fixture(({root, write, commit, plan}) => {
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.mjs';\nconsole.log('nested assignment helper loaded');\n");
    write('packages/portal/src/scan.mts', reader(api, assignments[2][1], ', {recursive: true}'));
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execute(root), 'nested assignment helper loaded\n');
    const selected = plan(base, head);
    assert.deepEqual(selected.packages.map(pkg => pkg.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    assert.match(selected.reason, /Unverified repository-root directory scan options/);
  }));
});

test('unused assignments, different names and local assigned reads keep narrow selection', async t => {
  for (const [name, source] of [
    ['unused', assignments[2][1]],
    ['different scanned name', assignments[0][1] + " const other = new URL('./', import.meta.url); readdirSync(other);"],
    ['local assignment', "const original = new URL('./', import.meta.url); let directory; directory = original; readdirSync(directory);"],
    ['expression prefix', "const original = new URL('../../../', import.meta.url); let directory; directory = original.pathname + 'packages/portal/src/'; readdirSync(directory);"],
    ['working directory', assignments[0][1] + ' const command = {cwd: directory};'],
    ['numeric prefix in inert text', "const original = new URL('../../../', import.meta.url); const directory = new URL('./', import.meta.url); // 1directory = original;\nreaddirSync(directory);"],
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

// Equality and arrow expressions must not turn an unused URL into a directory input.
test('URL comparisons and arrow functions do not become directory aliases', async t => {
  for (const [name, expression] of [
    ['comparison', 'original === original'],
    ['arrow function', 'original => original'],
  ]) await t.test(name, () => fixture(({root, git, write, commit, workspace}) => {
    write('catalogue-adapter.mjs', helper);
    write('packages/portal/src/scan.mts', reader('readdirSync', `const original = new URL('../../../', import.meta.url);
let directory; directory = ${expression};
if (directory instanceof URL)`));
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execute(root), '');
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
      {full: false, packages: ['catalogue']});
  }));
});
