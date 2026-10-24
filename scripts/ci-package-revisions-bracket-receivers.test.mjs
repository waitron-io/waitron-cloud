import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';
import {scopeForRevisions} from './ci-package-revisions.mjs';
import * as packageInputs from './ci-package-revisions.mjs';

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
    for (const name of ['catalogue', 'gateway', 'portal', 'unrelated']) {
      write(`packages/${name}/package.json`, JSON.stringify({name, private: true, scripts: {test: 'node --test'}}));
      write(`packages/${name}/src/index.mjs`, 'export const value = 1;\n');
    }
    const plan = (base, head, call = git, members = loadWorkspace(root)) => createPlan(
      {pull_request: {base: {sha: base}, head: {sha: head}}},
      {sha: head, repository: 'waitron-io/waitron-cloud'}, members, call,
      () => {throw Error('No API expected');});
    run({root, git, write, commit, plan});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('closing bracket receivers retain directory consumers Node actually loads', async t => {
  for (const receiver of ["(ns)[keys[0]].fs", "(ns)['nest[ed]'].fs", "ns[['nested'][0]].fs"]) {
    for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
      await t.test(`${receiver} ${api}`, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('bracket helper loaded');\n");
        write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const ns = {nested: {fs}, 'nest[ed]': {fs}};
const keys = ['nested'];
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const scan = ${receiver}.${api};
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'bracket helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved parenthesized directory member at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('closing bracket readers retain comments optional access and erased wrappers', async t => {
  for (const expression of [
    "(ns)[keys[0]]!?.fs!?.readdirSync",
    "(ns as typeof ns)['nest[ed]'] /* key */ . /* next */ fs . readdirSync",
    "(ns satisfies typeof ns)[keys[0]] // next\n ?. // member\n fs . readdirSync",
    "[fs][0].readdirSync",
    "(ns)[keys[0]][['fs'][0]].readdirSync",
  ]) await t.test(expression, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('wrapped bracket helper loaded');\n");
    write('packages/portal/src/reader.mts', `import * as fs from 'node:fs';
const ns = {nested: {fs}, 'nest[ed]': {fs}};
const keys = ['nested'];
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const scan = ${expression};
for (const name of scan(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'wrapped bracket helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('saved closing bracket readers retain base head and unchanged transitive consumers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) await t.test(revision, () => fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved bracket helper loaded');\n");
    const reader = `import * as fs from 'node:fs';
const ns = {nested: {fs}};
const keys = ['nested'];
const directory = new URL(['..', ''].join('/'), import.meta.url);
for (const name of (ns)[keys[0]].fs.readdirSync(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('tools/scan.mjs', revision === 'head' ? 'export const value = 1;\n' : reader);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved bracket helper loaded\n');
    if (revision !== 'unchanged') write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved bracket helper loaded\n');
    write('tools/scan.mjs', 'export const dirty = true;\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      /Unresolved parenthesized directory member at tools\/scan\.mjs/);
    assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('unused closing bracket helpers preserve narrow package selection', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', `import * as fs from 'node:fs';
const ns = {nested: {fs}};
const keys = ['nested'];
(ns)[keys[0]].fs.readdirSync(new URL(['..', ''].join('/'), import.meta.url));
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('ordinary indexed access preserves narrow package selection', () => fixture(({root, write, commit, plan}) => {
  write('packages/portal/src/index.mjs', `const rows = [{value: 'ordinary indexed value'}];
console.log(rows[0].value);
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'ordinary indexed value\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));



test('a completed array statement cannot join later inert text into a directory reader', () => fixture(({root, write, commit, plan}) => {
  write('packages/portal/src/index.mjs', "const rows = [];\nconsole.log('a, readdirSync, b');\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'a, readdirSync, b\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));
