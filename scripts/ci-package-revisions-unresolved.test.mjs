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
  ['URL alias mutation', "const directory = new URL('./', import.meta.url); const alias = directory; alias.pathname = new URL('../../../', import.meta.url).pathname;", 'directory'],
  ['URL object mutation', "const directory = new URL('./', import.meta.url); directory.pathname = new URL('../../../', import.meta.url).pathname;", 'directory'],
  ['uncertain alias chain', "let original = new URL('./', import.meta.url); original = (() => new URL('../../../', import.meta.url))(); const middle = original; const directory = middle;", 'directory'],
  ['query URL variable', "const directory = new URL('../../../?scan=1', import.meta.url);", 'directory'],
  ['query URL direct', '', "new URL('../../../?scan=1', import.meta.url)"],
  ['constructor continuation', "const directory = new URL('./', import.meta.url)\n && new URL('../../../', import.meta.url);", 'directory'],
  ['continued constructor value', "const local = new URL('./', import.meta.url); const directory = local\n && new URL('../../../', import.meta.url);", 'directory'],
  ['continued alias value', "const local = new URL('./', import.meta.url); let middle; middle = local\n && new URL('../../../', import.meta.url); const directory = middle;", 'directory'],
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

// A same-named outer URL must not qualify a function's different input binding.
test('shadowed reader parameters retain the consumer of the actual argument', () => fixture(({root, write, commit, plan}) => {
  write('catalogue-adapter.mjs', helper);
  const source = reader('readdirSync', "const directory = new URL('./', import.meta.url); function scan(directory) { return readdirSync(directory); }", 'directory')
    .replace('await readdirSync(directory)', "await scan(new URL('../../../', import.meta.url))");
  write('packages/portal/src/scan.mts', source);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execute(root), 'unresolved helper loaded\n');
  const result = plan(base, head);
  assert.deepEqual(result.packages.map(row => row.package), all);
  assert.match(result.reason, /Unresolved directory input/);
}));

// An explicit argument can replace a default URL even when that default is known.
test('an escaped URL cannot qualify a default parameter reader', () => fixture(({root, write, commit, plan}) => {
  write('catalogue-adapter.mjs', helper);
  const source = reader('readdirSync', "function scan(directory = new URL('./', import.meta.url)) { return readdirSync(directory); } const root = new URL('../../../', import.meta.url);", 'root')
    .replace('await readdirSync(root)', 'await scan(root)');
  write('packages/portal/src/scan.mts', source);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execute(root), 'unresolved helper loaded\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), all);
}));

// These executed same-name probes must keep the actual reader rather than an outer name's URL.
test('unproved binding contexts keep the consumers from the reviewer probes', async t => {
  const outer = "const directory = new URL('./', import.meta.url);";
  const target = "new URL('../../../', import.meta.url)";
  const loop = reader('readdirSync', '', 'directory').split('for await')[1];
  for (const [name, body] of [
    ['default parameter', `function scan(directory = new URL('./', import.meta.url)) { return readdirSync(directory); } for await${loop.replace('await readdirSync(directory)', `await scan(${target})`)}`],
    ['parameter', `${outer} function scan(directory) { return readdirSync(directory); } for await${loop.replace('await readdirSync(directory)', `await scan(${target})`)}`],
    ['parameter transfer', `${outer} function scan(input) { const directory = input; return readdirSync(directory); } for await${loop.replace('await readdirSync(directory)', `await scan(${target})`)}`],
    ['loop binding', `${outer} for (const directory of [${target}]) { for await${loop} }`],
    ['destructuring', `${outer} { const [directory] = [${target}]; for await${loop} }`],
    ['catch binding', `${outer} try { throw ${target}; } catch (directory) { for await${loop} }`],
  ]) await t.test(name, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', helper);
    write('packages/portal/src/scan.mts', "import {readdirSync} from 'node:fs';\n" + body);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execute(root), 'unresolved helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), all);
  }));
});
