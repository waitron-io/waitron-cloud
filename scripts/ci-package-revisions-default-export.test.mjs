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

const allPackages = ['catalogue', 'gateway', 'portal', 'unrelated'];

function defaultReader(api, expression, ending = '') {
  const module = api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises';
  return `import {${api}} from '${module}';
import * as ñs from '${module}';
export /* export token */ default /* default token */ ${expression}${ending}`;
}

const consumer = `import scan from '../../../tools/reader.mts';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;

// Omitting the default-export boundary must lose consumers this program loads.
test('default-exported readers retain consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const expression of [api, `ñs.${api}`, `ñs! /* receiver */ ?. ${api}!`, `ñs.${api} /* stored */`, `await ${api}`, `await ñs.${api}`, `await /* value */ await ñs! ?. ${api}!`]) {
      for (const ending of ['', '\nconst marker = 1;']) {
        await t.test(`${expression} ${JSON.stringify(ending)}`, () => fixture(({root, write, commit, plan}) => {
          write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('default reader helper loaded');\n");
          write('tools/reader.mts', defaultReader(api, expression, ending));
          write('packages/portal/src/reader.mts', consumer);
          const base = commit();
          write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
          const head = commit();
          assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'default reader helper loaded\n');
          const result = plan(base, head);
          assert.deepEqual(result.packages.map(row => row.package), allPackages);
          assert.match(result.reason, /Unresolved indirect directory call at tools\/reader\.mts/);
        }));
      }
    }
  }
});

test('default-exported readers retain saved base head and unchanged transitive consumers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) await t.test(revision, () => fixture(({root, git, write, commit, plan, workspace}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('default reader helper loaded');\n");
    const reader = defaultReader('readdirSync', 'ñs.readdirSync');
    const inert = 'export default () => []';
    write('tools/reader.mts', revision === 'head' ? inert : reader);
    write('packages/portal/src/index.mjs', consumer);
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'default reader helper loaded\n');
    if (revision !== 'unchanged') write('tools/reader.mts', revision === 'head' ? reader : inert);
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'default reader helper loaded\n');
    write('tools/reader.mts', inert);
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git), /Unresolved indirect directory call at tools\/reader\.mts/);
    assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
  }));
});

test('awaited default-exported readers retain saved base head and unchanged transitive consumers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) await t.test(revision, () => fixture(({root, git, write, commit, plan, workspace}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('default reader helper loaded');\n");
    const reader = defaultReader('readdirSync', 'await ñs.readdirSync');
    const inert = 'export default () => []';
    write('tools/reader.mts', revision === 'head' ? inert : reader);
    write('packages/portal/src/index.mjs', consumer);
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'default reader helper loaded\n');
    if (revision !== 'unchanged') write('tools/reader.mts', revision === 'head' ? reader : inert);
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'default reader helper loaded\n');
    write('tools/reader.mts', inert);
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git), /Unresolved indirect directory call at tools\/reader\.mts/);
    assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
  }));
});

test('unused default-exported readers keep isolated package selection', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mts', defaultReader('readdirSync', 'ñs.readdirSync'));
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
}));

test('ordinary default exports and named imports keep isolated package selection', async t => {
  for (const source of [
    "import {readdirSync} from 'node:fs';\nexport default 1",
    "const readdirSyncCount = 1;\nexport default readdirSyncCount",
    "const values = {read: 1};\nexport default values.read",
    "const readdirSyncCount = 1;\nexport default await readdirSyncCount",
    "const values = {read: 1};\nexport default await values.read",
  ]) await t.test(source, () => fixture(({root, write, commit, plan}) => {
    write('packages/portal/src/index.mjs', source);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
  }));
});

test('a resolved directory call in a default export keeps isolated package selection', () => fixture(({root, write, commit, plan}) => {
  write('packages/portal/src/index.mjs', "import {readdirSync} from 'node:fs';\nexport default readdirSync(new URL('./', import.meta.url))");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', "import entries from './packages/portal/src/index.mjs'; console.log(entries.includes('index.mjs'));"], {cwd: root, encoding: 'utf8'}), 'true\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));


test('awaited assignments retain directory readers exported later', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('awaited assignment helper loaded');\n");
    write('tools/reader.mts', `import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const scan = await ñs.${api}
export default scan`);
    write('packages/portal/src/reader.mts', consumer);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'awaited assignment helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
    assert.match(plan(base, head).reason, /Unresolved indirect directory call at tools\/reader\.mts/);
  }));
});
