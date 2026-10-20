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

// Removing the uncertainty guard would let an executed helper consumer disappear.
const apis = ['readdirSync', 'readdir', 'opendirSync', 'opendir'];
const original = "const original = new URL('../../../', import.meta.url);";
const unresolved = [
  ['as URL', original + ' const directory = original as URL;', 'directory'],
  ['non-null assertion', original + ' const directory = original!;', 'directory'],
  ['reader argument parentheses', original, '(original)'],
  ['destructured URL', original + ' const {directory} = {directory: original};', 'directory'],
  ['logical assignment', original + ' let directory; directory ||= original;', 'directory'],
  ['computed transfer', original + ' const choose = () => original; const directory = choose();', 'directory'],
  ['direct computed argument', original + ' const choose = () => original;', 'choose()'],
  ['overwritten known URL', original + " let directory = new URL('./', import.meta.url); directory = (() => original)();", 'directory'],
  ['URL property expression', original + ' const directory = original.pathname;', 'directory'],
  ['uncertain alias chain', "let original = new URL('./', import.meta.url); original = (() => new URL('../../../', import.meta.url))(); const middle = original; const directory = middle;", 'directory'],
  ['query URL variable', "const directory = new URL('../../../?scan=1', import.meta.url);", 'directory'],
  ['query URL direct', '', "new URL('../../../?scan=1', import.meta.url)"],
  ['line continuation transfer', original + " const local = new URL('./', import.meta.url); const directory = local\n && original;", 'directory'],
  ['constructor assertion', "const directory = new URL('../../../', import.meta.url) as URL;", 'directory'],
];
function reader(api, declaration, argument) {
  return `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
${declaration}
for await (const item of await ${api}(${argument})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(new URL('../../../' + name, import.meta.url));
}`;
}
const helper = "import './packages/catalogue/src/index.mjs';\nconsole.log('unresolved helper loaded');\n";
const execute = root => execFileSync(process.execPath, ['packages/portal/src/scan.mts'], {cwd: root, encoding: 'utf8', timeout: 5000});
const all = ['catalogue', 'gateway', 'portal', 'unrelated'];

test('unresolved directory inputs retain all package tests after actual helper loads', async t => {
  for (const api of apis) for (const [name, declarations, argument] of unresolved) {
    await t.test(`${api} ${name}`, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', helper);
      write('packages/portal/src/scan.mts', reader(api, declarations, argument));
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execute(root), 'unresolved helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), all);
      assert.match(result.reason, /Unresolved directory input at packages\/portal\/src\/scan\.mts/);
    }));
  }
});

test('unresolved saved helper inputs retain all packages from either revision despite dirty local files', async t => {
  for (const revision of ['base', 'head']) await t.test(revision, () => fixture(({root, git, write, commit, plan, workspace}) => {
    write('catalogue-adapter.mjs', helper);
    const active = reader('readdirSync', unresolved[0][1], unresolved[0][2]).replaceAll('../../../', '../');
    write('tools/scan.mts', revision === 'base' ? active : 'export const inert = true;\n');
    write('packages/portal/src/scan.mts', "import '../../../tools/scan.mts';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/scan.mts';\n");
    const base = commit();
    if (revision === 'base') assert.equal(execute(root), 'unresolved helper loaded\n');
    write('tools/scan.mts', revision === 'head' ? active : 'export const inert = true;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision === 'head') assert.equal(execute(root), 'unresolved helper loaded\n');
    write('tools/scan.mts', 'export const dirty = true;\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    const result = plan(base, head);
    assert.deepEqual(result.packages.map(row => row.package), all);
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
      /Unresolved directory input at tools\/scan\.mts/);
  }));
});

// A blanket directory-name fallback would break these ordinary resolved controls.
test('ordinary resolved URL reads keep package selection narrow', async t => {
  for (const argument of ["new URL('../../../', import.meta.url)", 'directory']) {
    await t.test(argument, () => fixture(({root, git, write, commit, plan, workspace}) => {
      write('catalogue-adapter.mjs', helper);
      write('packages/portal/src/scan.mts', reader('readdirSync', "const directory = new URL('../../../', import.meta.url);", argument));
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execute(root), 'unresolved helper loaded\n');
      assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'portal']);
      assert.deepEqual(scopeForRevisions(['packages/unrelated/src/index.mjs'], workspace, base, head, git),
        {full: false, packages: ['unrelated']});
    }));
  }
});
