import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace, scopeForPaths} from './ci-scope.mjs';
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

test('quoted computed directory members retain consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const quote of ["'", '"', '`']) {
      await t.test(`${api} ${quote}`, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('computed helper loaded');\n");
        write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await fs[${quote}${api}${quote}](directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'computed helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('computed directory members survive wrappers comments and stored references', async t => {
  for (const expression of [
    "(fs)[ /* open */ 'readdirSync' /* close */ ]",
    'fs!?.[ // open\n "readdirSync" // close\n ]!',
    "[fs['readdirSync'], null][0]",
    "[[], 0, fs['readdirSync'], null][2]",
    "[0, ns.nested.fs['readdirSync'], null][1]",
  ]) await t.test(expression, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('wrapped computed helper loaded');\n");
    write('packages/portal/src/reader.mts', `import * as fs from 'node:fs';
const ns = {nested: {fs}};
const directory = new URL('../../../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'wrapped computed helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('saved computed directory helpers retain either revision and transitive consumers', () => {
  for (const revision of ['base', 'head', 'unchanged']) fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved computed helper loaded');\n");
    const reader = `import * as fs from 'node:fs';
const directory = new URL('../', import.meta.url);
for (const name of fs['readdirSync'](directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('tools/scan.mjs', revision === 'head' ? 'export const value = 1;\n' : reader);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved computed helper loaded\n');
    if (revision !== 'unchanged') write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved computed helper loaded\n');
    write('tools/scan.mjs', 'export const changedLocally = true;\n');
    write('catalogue-adapter.mjs', 'export const changedLocally = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      /Unresolved indirect directory call at tools\/scan\.mjs/, revision);
    assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  });
});

test('unused computed directory helpers keep narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', `import * as fs from 'node:fs';
fs['readdirSync'](new URL('../', import.meta.url));
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));
