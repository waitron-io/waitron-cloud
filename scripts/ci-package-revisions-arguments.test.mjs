import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
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

const argumentsFor = [
  '0, API, 2',
  'API, 2',
  '0, API,',
  'nested({list: [1, 2]}), API, 2',
  '0, ns /* member */ ! ?. API /* reader */ !, 2',
  '0, await ns.API, 2',
];

function reader(api, args = '0, API, 2') {
  return `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
import * as ns from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const nested = value => value;
const pass = (...values) => values.find(value => typeof value === 'function');
export default pass(${args.replaceAll('API', api)});`;
}

const consumer = `import scan from '../../../tools/reader.mts';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
const helper = "import './packages/catalogue/src/index.mjs';\nconsole.log('argument helper loaded');\n";

// Removing argument discovery must lose a consumer the same saved program loads.
test('call arguments retain directory consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) for (const args of argumentsFor) {
    await t.test(`${api}: ${args}`, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', helper);
      write('tools/reader.mts', reader(api, args));
      write('packages/portal/src/reader.mts', consumer);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'argument helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), allPackages);
      assert.match(result.reason, /Unresolved (?:call argument directory reference|indirect directory call) at tools\/reader\.mts/);
    }));
  }
});

test('argument readers retain saved base head and unchanged transitive consumers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) await t.test(revision, () => fixture(({root, git, write, commit, plan, workspace}) => {
    const active = reader('readdirSync');
    const inert = "import {readdirSync} from 'node:fs'; export default () => [];";
    write('catalogue-adapter.mjs', helper);
    write('tools/reader.mts', revision === 'head' ? inert : active);
    write('packages/portal/src/index.mjs', consumer);
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'argument helper loaded\n');
    if (revision !== 'unchanged') write('tools/reader.mts', revision === 'head' ? active : inert);
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'argument helper loaded\n');
    write('tools/reader.mts', inert);
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git), /Unresolved call argument directory reference at tools\/reader\.mts/);
    assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
  }));
});

test('unused argument readers keep isolated package selection', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mts', reader('readdirSync'));
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
}));

test('ordinary arguments imports and resolved calls keep isolated package selection', async t => {
  for (const value of ['1', 'readdirSync(new URL(\'./\', import.meta.url)).length']) await t.test(value, () => fixture(({root, write, commit, plan}) => {
    write('tools/reader.mts', `import {readFileSync, readdirSync, opendirSync} from 'node:fs';
const pass = (...values) => values[1];
export default pass(0, ${value}, 2);`);
    write('packages/portal/src/index.mjs', "import value from '../../../tools/reader.mts'; console.log(typeof value);");
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'number\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
  }));
});

test('executed generated argument transfers retain their consumers', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', helper);
    write('tools/reader.mts', `const program = ${JSON.stringify(reader(api))};
export default (await import('data:text/javascript,' + encodeURIComponent(program))).default;`);
    write('packages/portal/src/reader.mts', consumer);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'argument helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
  }));
});

test('division around a reader transfer retains its executed consumer', () => fixture(({root, write, commit, plan}) => {
  write('catalogue-adapter.mjs', helper);
  write('tools/reader.mts', `import {readdirSync} from 'node:fs';
let saved;
const pass = (...values) => { saved = values[1]; return 1; };
2 / pass(0, readdirSync, 2) / 2;
export default saved;`);
  write('packages/portal/src/reader.mts', consumer);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'argument helper loaded\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
}));

test('separate inert argument fragments do not form a reader transfer', () => fixture(({write, commit, plan}) => {
  write('packages/portal/src/index.mjs', `const before = 'pass(0,';
const after = 'readdirSync,2)';
export const value = 1;`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
}));

test('division in neighboring arguments cannot hide a transferred reader', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', helper);
    write('tools/reader.mts', reader(api, '0 / 1, API, 2 / 1'));
    write('packages/portal/src/reader.mts', consumer);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'argument helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
  }));
});

test('review division beside a path-string argument retains consumers', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', helper);
    write('tools/reader.mts', reader(api, "6 / 2, API, 'a/b'"));
    write('packages/portal/src/reader.mts', consumer);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'argument helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
  }));
});

test('review division in neighboring object values retains consumers', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', helper);
    write('tools/reader.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
export default Object.values({a: 6 / 2, ${api}, b: 9 / 3}).find(value => typeof value === 'function');`);
    write('packages/portal/src/reader.mts', consumer);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'argument helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), allPackages);
  }));
});
