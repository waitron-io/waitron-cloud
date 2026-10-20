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

const objects = [
  '{API}',
  '{API, n: 1}',
  '{n: 1, API}',
  '{n: 1, API, tail: 2}',
  '{nested: {n: 1}, API}',
  '{ /* { */ n: "}", /* first */ API /* last */ , tail: 2}',
];

const forms = [
  {name: 'yield', declaration: object => `export default function* makeReader() { yield ${object} }`, value: 'makeReader().next().value'},
  {name: 'return', declaration: object => `export default function makeReader() { return ${object} }`, value: 'makeReader()'},
  {name: 'default', declaration: object => `export default ${object}`, value: 'makeReader'},
];

function reader(api, form, object) {
  return `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';\n${form.declaration(object.replaceAll('API', api))}`;
}

function consumer(form) {
  return `import makeReader from '../../../tools/reader.mts';
const scan = Object.values(${form.value}).find(value => typeof value === 'function');
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
}

// Dropping a shorthand reference must lose the consumer this program executes.
test('object shorthand retains directory consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) for (const object of objects) {
    await t.test(`${api}: ${object}`, () => fixture(({root, write, commit, plan}) => {
      const form = forms[0];
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('object reader helper loaded');\n");
      write('tools/reader.mts', reader(api, form, object));
      write('packages/portal/src/reader.mts', consumer(form));
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'object reader helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), allPackages);
      assert.match(result.reason, /Unresolved (?:object directory reference|indirect directory call) at tools\/reader\.mts/);
    }));
  }
});

test('object readers retain saved base head and unchanged transitive consumers', async t => {
  for (const form of forms) for (const revision of ['base', 'head', 'unchanged']) {
    await t.test(`${form.name}: ${revision}`, () => fixture(({root, git, write, commit, plan, workspace}) => {
      const active = reader('readdirSync', form, '{n: 1, API}');
      const inert = reader('readdirSync', form, '{scan: () => []}');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('object reader helper loaded');\n");
      write('tools/reader.mts', revision === 'head' ? inert : active);
      write('packages/portal/src/index.mjs', consumer(form));
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'object reader helper loaded\n');
      if (revision !== 'unchanged') write('tools/reader.mts', revision === 'head' ? active : inert);
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'object reader helper loaded\n');
      write('tools/reader.mts', inert);
      write('catalogue-adapter.mjs', 'export const dirty = true;\n');
      assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git), /Unresolved (?:object directory reference|indirect directory call) at tools\/reader\.mts/);
      assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
    }));
  }
});

test('unused object readers keep isolated package selection', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mts', reader('readdirSync', forms[0], '{API}'));
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
}));

test('ordinary object values and resolved calls keep isolated package selection', async t => {
  for (const object of ['{n: 1}', "(() => { const names = readdirSync(new URL('./', import.meta.url)); return {names} })()"]) {
    await t.test(object, () => fixture(({root, write, commit, plan}) => {
      write('tools/reader.mts', reader('readdirSync', forms[2], object));
      write('packages/portal/src/index.mjs', "import value from '../../../tools/reader.mts';\nconsole.log(typeof value);\n");
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'object\n');
      assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
    }));
  }
});

// An import list names a binding without storing it in a runtime object.
test('named imports keep isolated package selection', async t => {
  for (const declaration of [
    "import {readdirSync} from 'node:fs';",
    "import fs, {readdirSync, opendirSync} from 'node:fs';",
    "import ñs, {readFileSync, /* { } */ readdirSync} from 'node:fs';",
    "import /* { } */ { /* } */ readdirSync /* { */ } /* } */ from 'node:fs';",
    "import type {readdirSync} from 'node:fs';",
  ]) await t.test(declaration, () => fixture(({root, write, commit, plan}) => {
    write('tools/reader.mts', declaration + '\nexport default {n: 1};\n');
    write('packages/portal/src/index.mjs', "import value from '../../../tools/reader.mts';\nconsole.log(value.n);\n");
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '1\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
  }));
});
