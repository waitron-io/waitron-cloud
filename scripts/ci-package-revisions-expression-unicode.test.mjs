import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';
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
    for (const name of ['catalogue', 'gateway', 'portal', 'unrelated']) {
      write(`packages/${name}/package.json`, JSON.stringify({name, private: true, scripts: {test: 'node --test'}}));
      write(`packages/${name}/src/index.mjs`, 'export const value = 1;\n');
    }
    const plan = (base, head, call = git) => createPlan(
      {pull_request: {base: {sha: base}, head: {sha: head}}},
      {sha: head, repository: 'waitron-io/waitron-cloud'}, loadWorkspace(root), call,
      () => {throw Error('No API expected');});
    run({root, git, write, commit, plan});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('logical and conditional Unicode namespace readers retain consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const expression of [
      `null || ñs.${api}`, `true && 𐐀.${api}`, `null ?? a\u200cb.${api}`,
      String.raw`false ? null : \u0066s.${api}`, `null || ns.𐐀.fs.${api}`,
      `false ? null : this.#fs.${api}`,
    ]) await t.test(expression, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('unicode expression helper loaded');\n");
      write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const ñs = fs, 𐐀 = fs, a\u200cb = fs, ns = {𐐀: {fs}};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const scan = ${expression.includes('this.#') ? `new class { #fs = fs; get() { return ${expression}; } }().get()` : expression};
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'unicode expression helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
      assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
    }));
  }
});

test('Unicode operand readers retain comments optional access and erased assertions', async t => {
  for (const expression of [
    'null || ñs! /* receiver */ ?. /* reader */ readdirSync!',
    'false ? null : ns.𐐀!.fs!?.readdirSync',
    'null ?? a\u200cb // receiver\n ?. readdirSync',
    String.raw`true && \u{0000066}s.readdirSync`,
  ]) await t.test(expression, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('wrapped unicode operand loaded');\n");
    write('packages/portal/src/reader.mts', `import * as fs from 'node:fs';
const ñs = fs, a\u200cb = fs, ns = {𐐀: {fs}};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const scan = ${expression};
for (const name of scan(directory)) if (name.endsWith('.mjs')) await import(new URL(name, directory));
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'wrapped unicode operand loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('saved Unicode operand readers retain both revisions and transitive consumers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) await t.test(revision, () => fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved unicode operand loaded');\n");
    const reader = `import * as ñs from 'node:fs';
const directory = new URL(['..', ''].join('/'), import.meta.url);
const scan = null || ñs.readdirSync;
for (const name of scan(directory)) if (name.endsWith('.mjs')) await import(new URL(name, directory));
`;
    write('tools/scan.mjs', revision === 'head' ? 'export const value = 1;\n' : reader);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved unicode operand loaded\n');
    if (revision !== 'unchanged') write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved unicode operand loaded\n');
    write('tools/scan.mjs', 'export const dirty = true;\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read), /Unresolved indirect directory call at tools\/scan\.mjs/);
    assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('unused Unicode operand helpers preserve narrow package selection', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', "import * as ñs from 'node:fs';\nconst scan = null || ñs.readdirSync;\nscan(new URL(['..', ''].join('/'), import.meta.url));\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
}));

test('ordinary Unicode operands and directory imports preserve narrow selection', () => fixture(({root, write, commit, plan}) => {
  write('packages/portal/src/index.mjs', `import {readdirSync, opendirSync} from 'node:fs';
const ñs = {𐐀: {value: 'ordinary Unicode operand'}};
console.log(null || ñs.𐐀.value);
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'ordinary Unicode operand\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('logical assignments retain directory readers Node actually calls', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const operator of ['||=', '??=', '&&=']) {
      for (const receiver of ['', 'ñs.', 'this.#fs.']) await t.test(`${operator} ${receiver}${api}`, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('assigned reader helper loaded');\n");
        write('packages/portal/src/reader.mts', `import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const {${api}} = ñs;
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
let scan = ${operator === '&&=' ? 'true' : 'null'};
${receiver === 'this.#fs.' ? `new class { #fs = ñs; set() { scan ${operator} this.#fs.${api}; } }().set();` : `scan ${operator} ${receiver}${api};`}
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'assigned reader helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('awaited operands retain directory readers through comments and erased assertions', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const expression of [
      `null || await ñs.${api}`,
      `false ? null : await /* reader */ ñs!?.${api}!`,
      `scan ??= /* value */ await ñs.${api}`,
      String.raw`null ?? await await \u{0000066}s.${api}`,
    ]) await t.test(expression, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('awaited reader helper loaded');\n");
      write('packages/portal/src/reader.mts', `import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const fs = ñs;
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
let scan = null;
const reader = ${expression};
for await (const item of await reader(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'awaited reader helper loaded\n');
      assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    }));
  }
});

test('saved assigned and awaited readers retain either revision and transitive consumers', async t => {
  for (const operation of ['scan ||= ñs.readdirSync;', 'scan = null || await ñs.readdirSync;']) {
    for (const revision of ['base', 'head', 'unchanged']) await t.test(`${operation} ${revision}`, () => fixture(({root, git, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved operator helper loaded');\n");
      const reader = `import * as ñs from 'node:fs';
const directory = new URL(['..', ''].join('/'), import.meta.url);
let scan = null;
${operation}
for (const name of scan(directory)) if (name.endsWith('.mjs')) await import(new URL(name, directory));
`;
      write('tools/scan.mjs', revision === 'head' ? 'export const value = 1;\n' : reader);
      write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved operator helper loaded\n');
      if (revision !== 'unchanged') write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved operator helper loaded\n');
      write('tools/scan.mjs', 'export const dirty = true;\n');
      write('catalogue-adapter.mjs', 'export const dirty = true;\n');
      const read = (...args) => git(...args);
      read.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
      assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read), /Unresolved indirect directory call at tools\/scan\.mjs/);
      assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    }));
  }
});

test('unused operator readers and ordinary operator values preserve narrow selection', async t => {
  for (const reader of [false, true]) await t.test(`unused reader ${reader}`, () => fixture(({root, write, commit, plan}) => {
    write('tools/unused.mjs', "import * as ñs from 'node:fs';\nlet scan = null; scan ||= ñs.readdirSync; scan = null || await ñs.readdirSync;\n");
    write('packages/portal/src/index.mjs', reader ? 'export const value = 1;\n' : `import {readdirSync, opendirSync} from 'node:fs';
const ñs = {value: 'ordinary operator value'};
let value = null;
value ||= await ñs.value;
console.log(value);
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (!reader) assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'ordinary operator value\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
  }));
});
