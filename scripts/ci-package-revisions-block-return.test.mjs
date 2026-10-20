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

const forms = [
  {name: 'block arrow', declaration: value => `export default () => { return ${value} }`, scan: 'await makeReader()', inert: 'export default () => { return () => [] }'},
  {name: 'function', declaration: value => `export default function makeReader() { return ${value} }`, scan: 'await makeReader()', inert: 'export default function makeReader() { return () => [] }'},
  {name: 'instance method', declaration: value => `export default class { scan() { return ${value} } }`, scan: 'await new makeReader().scan()', inert: 'export default class { scan() { return () => [] } }'},
  {name: 'static method', declaration: value => `export default class { static scan() { return ${value} } }`, scan: 'await makeReader.scan()', inert: 'export default class { static scan() { return () => [] } }'},
  {name: 'awaited return', declaration: value => `export default async () => { return await ${value} }`, scan: 'await makeReader()', inert: 'export default async () => { return () => [] }'},
];

function reader(api, form, expression = api) {
  const module = api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises';
  return `import {${api}} from '${module}';
import * as ñs from '${module}';
${form.declaration(expression)}`;
}

function consumer(form) {
  return `import makeReader from '../../../tools/reader.mts';
const scan = ${form.scan};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
}

// Omitting returned references must lose a consumer this program loads.
test('block returns retain directory consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const form of forms) {
      for (const expression of [api, `ñs! /* receiver */ ?. ${api}! /* stored */`]) {
        await t.test(`${form.name}: ${expression}`, () => fixture(({root, write, commit, plan}) => {
          write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('returned reader helper loaded');\n");
          write('tools/reader.mts', reader(api, form, expression));
          write('packages/portal/src/reader.mts', consumer(form));
          const base = commit();
          write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
          const head = commit();
          assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'returned reader helper loaded\n');
          const result = plan(base, head);
          assert.deepEqual(result.packages.map(row => row.package), allPackages);
          assert.match(result.reason, /Unresolved indirect directory call at tools\/reader\.mts/);
        }));
      }
    }
  }
});

test('returned readers retain saved base head and unchanged transitive consumers', async t => {
  for (const form of forms) for (const revision of ['base', 'head', 'unchanged']) {
    await t.test(`${form.name}: ${revision}`, () => fixture(({root, git, write, commit, plan, workspace}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('returned reader helper loaded');\n");
      const source = reader('readdirSync', form, 'ñs.readdirSync');
      write('tools/reader.mts', revision === 'head' ? form.inert : source);
      write('packages/portal/src/index.mjs', consumer(form));
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'returned reader helper loaded\n');
      if (revision !== 'unchanged') write('tools/reader.mts', revision === 'head' ? source : form.inert);
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'returned reader helper loaded\n');
      write('tools/reader.mts', form.inert);
      write('catalogue-adapter.mjs', 'export const dirty = true;\n');
      assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git), /Unresolved indirect directory call at tools\/reader\.mts/);
      assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
    }));
  }
});

test('unused returned readers keep isolated package selection', async t => {
  for (const form of forms) await t.test(form.name, () => fixture(({write, commit, plan}) => {
    write('tools/unused.mts', reader('readdirSync', form, 'ñs.readdirSync'));
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
  }));
});

test('ordinary block return values keep isolated package selection', async t => {
  for (const form of forms) await t.test(form.name, () => fixture(({root, write, commit, plan}) => {
    write('tools/reader.mts', reader('readdirSync', form, '1'));
    write('packages/portal/src/index.mjs', `import makeReader from '../../../tools/reader.mts';\nconsole.log(${form.scan});\n`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '1\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
  }));
});

test('resolved directory calls in block returns keep isolated package selection', async t => {
  for (const form of forms) await t.test(form.name, () => fixture(({root, write, commit, plan}) => {
    write('tools/reader.mts', reader('readdirSync', form, "readdirSync(new URL('./', import.meta.url))"));
    write('packages/portal/src/index.mjs', `import makeReader from '../../../tools/reader.mts';\nconsole.log((${form.scan}).includes('reader.mts'));\n`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'true\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
  }));
});
