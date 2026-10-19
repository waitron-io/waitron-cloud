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

test('stored directory readers after nested and ordinary predecessors retain loaded consumers', async t => {
  for (const prefix of ['[], 0', '{value: 1}, null', '[], 0, false']) {
    for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
      await t.test(`${prefix}, ${api}`, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('nested predecessor helper loaded');\n");
        write('packages/portal/src/reader.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const scan = [${prefix}, ${api}, null].at(-2);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'nested predecessor helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('saved nested predecessor readers retain base head and unchanged transitive consumers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) await t.test(revision, () => fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved nested predecessor helper loaded');\n");
    const reader = `import * as fs from 'node:fs';
const directory = new URL(['..', ''].join('/'), import.meta.url);
const scan = [{}, /* earlier */ 0, // ordinary value
 fs /* namespace */ . readdirSync!, null][2];
for (const name of scan(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('tools/scan.mts', revision === 'head' ? 'export const value = 1;\n' : reader);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mts';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved nested predecessor helper loaded\n');
    if (revision !== 'unchanged') write('tools/scan.mts', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved nested predecessor helper loaded\n');
    write('tools/scan.mts', 'export const dirty = true;\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      /Unresolved indirect directory call at tools\/scan\.mts/);
    assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('unused nested predecessor helpers preserve narrow selection', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', `import {readdirSync} from 'node:fs';
const scan = [[], 0, readdirSync, null][2];
scan(new URL(['..', ''].join('/'), import.meta.url));
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
}));

test('ordinary nested arrays and named directory imports preserve narrow selection', () => fixture(({root, write, commit, plan}) => {
  write('packages/portal/src/index.mjs', `import {readdirSync, opendirSync} from 'node:fs';
console.log([[], 0, 'ordinary value', null][2]);
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'ordinary value\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));


test('delimiters before inert reader text preserve package isolation', async t => {
  for (const [name, expression] of [
    ['object', "function unrelated() {}\nconsole.log({value: 'a, readdirSync, b'}.value);\n"],
    ['statement', "function unrelated() {};\nconsole.log('a, readdirSync, b');\n"],
  ]) await t.test(name, () => fixture(({root, write, commit, plan}) => {
    write('packages/portal/src/index.mjs', expression);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'a, readdirSync, b\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
  }));
});
