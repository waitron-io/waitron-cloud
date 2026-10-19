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

// Without the predecessor guard, a helper loaded through this reader loses its consumer.
const predecessors = [
  "'a;b'", '"a;b"', '`a;b`', "'escaped\\\';value'",
  "0 /* ; */", "0 // ;\n", "'open[brace{'", '/[;{]/',
];

test('quoted and commented array predecessors retain consumers Node actually loads', async t => {
  for (const prefix of predecessors) for (const nested of [false, true]) {
    for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
      await t.test(`${nested ? 'nested ' : ''}${prefix}: ${api}`, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('quoted predecessor helper loaded');\n");
        write('packages/portal/src/reader.mts', `import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const scan = [${nested ? '[], ' : ''}${prefix}, ñs /* receiver */ ! ?. ${api}!, null].at(-2);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'quoted predecessor helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('saved quoted predecessors retain base head and unchanged transitive consumers', async t => {
  for (const nested of [false, true]) for (const revision of ['base', 'head', 'unchanged']) {
    await t.test(`${nested ? 'nested ' : ''}${revision}`, () => fixture(({root, git, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved quoted predecessor loaded');\n");
      const reader = `import * as ñs from 'node:fs';
const directory = new URL(['..', ''].join('/'), import.meta.url);
const scan = [${nested ? '{}, ' : ''}'a;b', ñs.readdirSync, null].at(-2);
for (const name of scan(directory)) if (name.endsWith('.mjs')) await import(new URL(name, directory));
`;
      write('tools/scan.mjs', revision === 'head' ? 'export const value = 1;\n' : reader);
      write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved quoted predecessor loaded\n');
      if (revision !== 'unchanged') write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved quoted predecessor loaded\n');
      write('tools/scan.mjs', 'export const dirty = true;\n');
      write('catalogue-adapter.mjs', 'export const dirty = true;\n');
      const read = (...args) => git(...args);
      read.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
      assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read), /Unresolved indirect directory call at tools\/scan\.mjs/);
      assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    }));
  }
});

test('unused quoted predecessor helpers preserve narrow work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', "import * as ñs from 'node:fs';\nconst scan = [';', ñs.readdirSync, null][1];\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
}));

test('ordinary quoted predecessors preserve package isolation', () => fixture(({root, write, commit, plan}) => {
  write('packages/portal/src/index.mjs', "const ñs = {value: 'ordinary value'};\nconsole.log([[], 'a;b', ñs.value, null][2]);\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'ordinary value\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('ordinary repeated regular expressions cannot stall saved package selection', () => fixture(({root, write, commit}) => {
  write('packages/portal/src/index.mjs', `console.log([${Array(40).fill('/a/g').join(', ')}].length);\n`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '40\n');
  const program = `import {scopeForRevisions} from ${JSON.stringify(new URL('./ci-package-revisions.mjs', import.meta.url).href)};
import {loadWorkspace} from ${JSON.stringify(new URL('./ci-scope.mjs', import.meta.url).href)};
import {execFileSync} from 'node:child_process';
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});
console.log(JSON.stringify(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(), '${base}', '${head}', git).packages));
`;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', program], {cwd: root, encoding: 'utf8', timeout: 10000}), '["catalogue"]\n');
}));

test('long quoted arrays cannot multiply saved package scan time', () => fixture(({root, write, commit}) => {
  write('packages/portal/src/index.mjs', `console.log([${Array(60000).fill(String.raw`'[\''`).join(', ')}].length);\n`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '60000\n');
  const program = `import {scopeForRevisions} from ${JSON.stringify(new URL('./ci-package-revisions.mjs', import.meta.url).href)};
import {loadWorkspace} from ${JSON.stringify(new URL('./ci-scope.mjs', import.meta.url).href)};
import {execFileSync} from 'node:child_process';
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});
console.log(JSON.stringify(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(), '${base}', '${head}', git).packages));
`;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', program], {cwd: root, encoding: 'utf8', timeout: 10000}), '["catalogue"]\n');
}));

test('copied source text cannot join separate inert fragments into a reader', () => fixture(({root, write, commit, plan}) => {
  write('packages/portal/src/index.mjs', "console.log('a, readdirSync, b');\n// [\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'a, readdirSync, b\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));
