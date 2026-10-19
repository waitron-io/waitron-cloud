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

function readerSource(api, expression, directory) {
  return `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(${directory}, import.meta.url);
const scan = ${expression};
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
}

test('semicolon-terminated reader references retain consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const expression of [api, `ñs.${api}`, `${api}! /* stored */`, `ñs! /* receiver */ ?. ${api}! // stored\n`]) {
      await t.test(expression, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('stored reader helper loaded');\n");
        write('packages/portal/src/reader.mts', readerSource(api, expression, "['..', '..', '..', ''].join('/')"));
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'stored reader helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), allPackages);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('saved semicolon readers retain base head and unchanged transitive consumers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) await t.test(revision, () => fixture(({root, git, write, commit, plan, workspace}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('stored reader helper loaded');\n");
    const reader = readerSource('readdirSync', 'ñs.readdirSync', "['..', ''].join('/')");
    write('tools/scan.mts', revision === 'head' ? 'export const value = 1;\n' : reader);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mts';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'stored reader helper loaded\n');
    if (revision !== 'unchanged') write('tools/scan.mts', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'stored reader helper loaded\n');
    write('tools/scan.mts', 'export const dirty = true;\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git), /Unresolved indirect directory call at tools\/scan\.mts/);
    assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
  }));
});

test('unused stored readers keep package work narrow', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mts', readerSource('readdirSync', 'ñs.readdirSync', "['..', ''].join('/')"));
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
}));

test('named imports and ordinary stored values keep package isolation', async t => {
  for (const source of [
    "import {readdirSync, statSync} from 'node:fs';\nconsole.log(typeof statSync);\n",
    "const readdirSyncCount = 1; const scan = readdirSyncCount; console.log(scan);\n",
    "const values = {read: 1}; const scan = values.read; console.log(scan);\n",
  ]) await t.test(source, () => fixture(({write, commit, plan}) => {
    write('packages/portal/src/index.mjs', source);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
  }));
});


test('inert API text followed by a semicolon retains conservative extra work', () => fixture(({root, write, commit, plan}) => {
  write('packages/portal/src/index.mjs', "console.log('readdirSync;');\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'readdirSync;\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
}));


test('newline and comma declarations retain readers Node actually loads', async t => {
  for (const ending of ['\n', '\r\n', ', unused = 1;']) {
    for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
      for (const expression of [api, `ñs.${api}`, `ñs! /* receiver */ ?. ${api}! /* stored */`]) {
        await t.test(`${JSON.stringify(ending)} ${expression}`, () => fixture(({root, write, commit, plan}) => {
          write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('declaration reader helper loaded');\n");
          write('packages/portal/src/reader.mts', readerSource(api, expression, "['..', '..', '..', ''].join('/')").replace(`${expression};\n`, `${expression}${ending}${ending.endsWith(';') ? '\n' : ''}`));
          const base = commit();
          write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
          const head = commit();
          assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'declaration reader helper loaded\n');
          assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
        }));
      }
    }
  }
});

test('saved declaration readers retain either revision and transitive consumers', async t => {
  for (const ending of ['\n', ', unused = 1;']) for (const revision of ['base', 'head', 'unchanged']) {
    await t.test(`${JSON.stringify(ending)} ${revision}`, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('declaration reader helper loaded');\n");
      const reader = readerSource('readdirSync', 'ñs.readdirSync', "['..', ''].join('/')").replace('ñs.readdirSync;\n', `ñs.readdirSync${ending}${ending.endsWith(';') ? '\n' : ''}`);
      write('tools/scan.mts', revision === 'head' ? 'export const value = 1;\n' : reader);
      write('packages/portal/src/index.mjs', "import '../../../tools/scan.mts';\n");
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'declaration reader helper loaded\n');
      if (revision !== 'unchanged') write('tools/scan.mts', revision === 'head' ? reader : 'export const value = 2;\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'declaration reader helper loaded\n');
      write('tools/scan.mts', 'export const dirty = true;\n');
      assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
    }));
  }
});


test('reader declarations retain consumers across line comments and Unicode line endings', async t => {
  for (const ending of [' // stored\n', '\u2028', '\u2029']) await t.test(JSON.stringify(ending), () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('line ending helper loaded');\n");
    write('packages/portal/src/reader.mts', readerSource('readdirSync', 'ñs.readdirSync', "['..', '..', '..', ''].join('/')").replace('ñs.readdirSync;\n', `ñs.readdirSync${ending}${ending.endsWith(';') ? '\n' : ''}`));
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'line ending helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
  }));
});


test('a lone carriage return retains a stored reader consumer', () => fixture(({root, write, commit, plan}) => {
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('carriage return helper loaded');\n");
  write('packages/portal/src/reader.mts', readerSource('readdirSync', 'ñs.readdirSync', "['..', '..', '..', ''].join('/')").replace('ñs.readdirSync;\n', 'ñs.readdirSync\r'));
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'carriage return helper loaded\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
}));
