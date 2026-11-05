import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadWorkspace, scopeForPaths} from './ci-scope.mjs';
import {scopeForRevisions} from './ci-package-revisions.mjs';
import {createPlan} from './ci-plan.mjs';

const direct = {direct: true};
const members = [
  {name: 'catalogue', directory: 'packages/catalogue', sources: [], exports: './src/index.mjs'},
  {name: 'gateway', directory: 'packages/gateway', sources: [], dependencies: {catalogue: 'workspace:*'}},
  {name: 'portal', directory: 'apps/portal', sources: [], devDependencies: {gateway: 'workspace:*'}},
];

test('source changes select direct consumers without walking a second level or a cycle', () => {
  const graph = members.map(pkg => ({...pkg}));
  graph[0].dependencies = {portal: 'workspace:*'};
  assert.deepEqual(scopeForPaths(['packages/catalogue/src/index.mjs'], graph, direct),
    {full: false, packages: ['catalogue', 'gateway']});
  assert.deepEqual(scopeForPaths(['packages/catalogue/src/index.mjs', 'packages/gateway/src/index.mjs'], graph, direct),
    {full: false, packages: ['catalogue', 'gateway', 'portal']});
  // Lockfile selection retains the original conservative graph policy.
  assert.deepEqual(scopeForPaths(['packages/catalogue/package.json'], graph).packages,
    ['catalogue', 'gateway', 'portal']);
});

test('own tests select their package without its manifest consumers', () => {
  assert.deepEqual(scopeForPaths(['packages/catalogue/test/prices.test.mjs'], members, direct),
    {full: false, packages: ['catalogue']});
  assert.deepEqual(scopeForPaths(['packages/catalogue/test/prices.test.mjs', 'packages/gateway/src/index.mjs'], members, direct),
    {full: false, packages: ['catalogue', 'gateway', 'portal']});
});

test('direct test-file readers remain selected without widening through their dependents', () => {
  for (const reference of [
    '../../catalogue/test/prices.test.mjs',
    'packages/catalogue/test/prices.test.mjs',
    'catalogue/test/prices.test.mjs',
    '../../catalogue/test/${name}.mjs',
  ]) {
    const graph = members.map(pkg => ({...pkg}));
    graph[1].sources = [{path: 'packages/gateway/test/read.mjs', source: `await import(${JSON.stringify(reference)});`}];
    assert.deepEqual(scopeForPaths(['packages/catalogue/test/prices.test.mjs'], graph, direct).packages,
      ['catalogue', 'gateway'], reference);
  }
});

test('ordinary package imports do not imply importing its tests, but exported tests do', () => {
  const graph = members.map(pkg => ({...pkg}));
  graph[1].sources = [{path: 'packages/gateway/src/read.mjs', source: "import 'catalogue';"}];
  assert.deepEqual(scopeForPaths(['packages/catalogue/test/prices.test.mjs'], graph, direct).packages, ['catalogue']);
  graph[0].exports = {'.': {import: './test/prices.test.mjs'}};
  assert.deepEqual(scopeForPaths(['packages/catalogue/test/prices.test.mjs'], graph, direct).packages, ['catalogue', 'gateway']);
});

test('package subpath exports and extension substitution retain their test-file readers', () => {
  const graph = members.map(pkg => ({...pkg}));
  graph[0].exports = {'./prices': './test/prices.test.ts'};
  graph[1].sources = [{path: 'packages/gateway/src/read.mjs', source: "import 'catalogue/prices';"}];
  assert.deepEqual(scopeForPaths(['packages/catalogue/test/prices.test.ts'], graph, direct).packages, ['catalogue', 'gateway']);
  graph[1].sources[0].source = "import '../../catalogue/test/prices.test.js';";
  assert.deepEqual(scopeForPaths(['packages/catalogue/test/prices.test.ts'], graph, direct).packages, ['catalogue', 'gateway']);
});

test('an ordinary package directory value does not import every test below that directory', () => {
  const graph = members.map(pkg => ({...pkg}));
  graph[1].sources = [{path: 'packages/gateway/test/read.mjs', source: "const fixture = '../../catalogue';"}];
  assert.deepEqual(scopeForPaths(['packages/catalogue/test/prices.test.mjs'], graph, direct).packages, ['catalogue']);
});

test('URL routes and generated labels are not workspace file templates', () => {
  for (const source of ['const route = `/${name}`;', 'const label = `p${index}`;']) {
    const graph = members.map(pkg => ({...pkg}));
    graph[1].sources = [{path: 'packages/gateway/src/read.mjs', source}];
    assert.deepEqual(scopeForPaths(['packages/catalogue/test/prices.test.mjs'], graph, direct).packages, ['catalogue']);
  }
});

test('directory enumeration cannot hide a test-file reader behind its parent directory', () => {
  const graph = members.map(pkg => ({...pkg}));
  graph[1].sources = [{path: 'packages/gateway/test/read.mjs', source:
    "import {readdirSync} from 'node:fs'; for (const file of readdirSync(new URL('../../catalogue/test/', import.meta.url))) await import('../../catalogue/test/' + file);"}];
  assert.deepEqual(scopeForPaths(['packages/catalogue/test/prices.test.mjs'], graph, direct).packages, ['catalogue', 'gateway']);
});

test('missing reader evidence and unknown paths retain conservative work', () => {
  const graph = members.map(({sources, ...pkg}) => pkg);
  assert.deepEqual(scopeForPaths(['packages/catalogue/test/prices.test.mjs'], graph, direct).packages,
    ['catalogue', 'gateway']);
  for (const paths of [[], ['scripts/tool.mjs'], ['packages/deleted/test/a.mjs'], ['pnpm-lock.yaml']]) {
    assert.deepEqual(scopeForPaths(paths, members, direct), {full: true, packages: ['catalogue', 'gateway', 'portal']});
  }
});

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-ci-direct-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8'});
  const write = (path, value) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), value);};
  const commit = () => {git('add', '.'); git('commit', '-sm', 'Direct selection fixture'); return git('rev-parse', 'HEAD').trim();};
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    write('package.json', JSON.stringify({name: 'fixture', private: true}));
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    for (const pkg of members) {
      const {sources, ...manifest} = pkg;
      write(`${pkg.directory}/package.json`, JSON.stringify({...manifest, scripts: {test: 'node --test'}}));
      write(`${pkg.directory}/src/index.mjs`, 'export const value = 1;\n');
    }
    run({root, git, write, commit});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('real PR plans distinguish own tests from source changes and keep compiler and receipts', () => fixture(({root, git, write, commit}) => {
  write('packages/catalogue/test/prices.test.mjs', 'export const price = 1;\n');
  const base = commit();
  write('packages/catalogue/test/prices.test.mjs', 'export const price = 2;\n');
  const head = commit();
  const plan = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, loadWorkspace(root), git);
  assert.deepEqual(plan.packages.map(row => row.package), ['catalogue']);
  assert.equal(plan.typecheck, true);
  assert.equal(plan.receipts.length, 6);
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const source = commit();
  const changed = createPlan({pull_request: {base: {sha: head}, head: {sha: source}}}, {}, loadWorkspace(root), git);
  assert.deepEqual(changed.packages.map(row => row.package), ['catalogue', 'gateway']);
}));

test('saved base and head test consumers survive dirty local removal and do not follow a second level', () => {
  for (const revision of ['base', 'head']) fixture(({root, git, write, commit}) => {
    const reader = "import '../../catalogue/test/prices.test.mjs';\n";
    write('packages/catalogue/test/prices.test.mjs', 'export const price = 1;\n');
    write('packages/gateway/src/index.mjs', revision === 'base' ? reader : 'export const value = 1;\n');
    const base = commit();
    write('packages/catalogue/test/prices.test.mjs', 'export const price = 2;\n');
    write('packages/gateway/src/index.mjs', revision === 'head' ? reader : 'export const value = 1;\n');
    const head = commit();
    write('packages/gateway/src/index.mjs', 'export const value = 3;\n');
    assert.deepEqual(scopeForRevisions(['packages/catalogue/test/prices.test.mjs'], loadWorkspace(root), base, head, git, direct),
      {full: false, packages: ['catalogue', 'gateway']}, revision);
  });
});

test('removing a test export cannot erase a former named importer from saved evidence', () => fixture(({root, git, write, commit}) => {
  write('packages/catalogue/test/prices.test.mjs', 'export const price = 1;\n');
  write('packages/catalogue/package.json', JSON.stringify({...members[0], exports: './test/prices.test.mjs', scripts: {test: 'node --test'}}));
  write('packages/gateway/src/index.mjs', "import 'catalogue';\n");
  const base = commit();
  write('packages/catalogue/package.json', JSON.stringify({...members[0], scripts: {test: 'node --test'}}));
  write('packages/catalogue/test/prices.test.mjs', 'export const price = 2;\n');
  const head = commit();
  assert.deepEqual(scopeForRevisions(['packages/catalogue/test/prices.test.mjs'], loadWorkspace(root), base, head, git, direct).packages,
    ['catalogue', 'gateway']);
}));
