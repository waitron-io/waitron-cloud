import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';
import {scopeForRevisions} from './ci-package-revisions.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-package-revisions-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
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

test('a removed sibling import keeps its former transitive consumers selected', () => fixture(({write, commit, plan}) => {
  write('packages/gateway/src/index.mjs', "import '../../catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', "import '../../gateway/src/index.mjs';\n");
  const base = commit();
  write('packages/gateway/src/index.mjs', 'export const value = 2;\n');
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  // Neither the caller's graph nor dirty source may erase the committed reader.
  write('packages/portal/src/index.mjs', 'export const value = 3;\n');
  const result = plan(base, head);
  assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal']);
  assert.equal(result.typecheck, true);
}));

test('committed new readers remain selected when dirty source hides their imports', () => fixture(({write, commit, plan}) => {
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  write('packages/gateway/src/index.mjs', "import '../../catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', "import '../../gateway/src/index.mjs';\n");
  const head = commit();
  write('packages/portal/src/index.mjs', 'export const value = 3;\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal']);
}));

test('removed manifest dependencies keep former consumers of another changed package', () => fixture(({write, commit, plan}) => {
  write('packages/portal/package.json', JSON.stringify({name: 'portal', private: true, scripts: {test: 'node --test'}, optionalDependencies: {gateway: 'workspace:*'}}));
  const base = commit();
  write('packages/portal/package.json', JSON.stringify({name: 'portal', private: true, scripts: {test: 'node --test'}}));
  write('packages/gateway/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['gateway', 'portal']);
}));

test('the revision graph unions removed and added source and manifest edges', () => fixture(({root, git, write, commit}) => {
  write('packages/gateway/src/index.mjs', "import '../../catalogue/src/index.mjs';\n");
  write('packages/portal/package.json', JSON.stringify({name: 'portal', private: true, scripts: {test: 'node --test'}, peerDependencies: {gateway: 'workspace:*'}}));
  const base = commit();
  write('packages/gateway/src/index.mjs', 'export const value = 2;\n');
  write('packages/portal/package.json', JSON.stringify({name: 'portal', private: true, scripts: {test: 'node --test'}}));
  const head = commit();
  const workspace = loadWorkspace(root);
  // Query the provider independently of the diff's changed consumer paths.
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
    {full: false, packages: ['catalogue', 'gateway', 'portal']});
}));

test('the head graph contributes new transitive consumers independently of changed consumer paths', () => fixture(({root, git, write, commit}) => {
  const base = commit();
  write('packages/gateway/src/index.mjs', "import '../../catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', "import '../../gateway/src/index.mjs';\n");
  const head = commit();
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue', 'gateway', 'portal']});
}));

test('revision evidence cannot remove a package already selected by the caller graph', () => fixture(({root, git, write, commit, plan}) => {
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  const members = loadWorkspace(root);
  members.find(pkg => pkg.name === 'portal').pathDependencies = {catalogue: 'file'};
  assert.deepEqual(plan(base, head, git, members).packages.map(row => row.package), ['catalogue', 'portal']);
}));

test('immutable source discovery retains named, root-relative and opaque sibling readers', () => fixture(({root, git, write, commit}) => {
  write('packages/gateway/src/index.mjs', "import 'catalogue';\n");
  write('packages/portal/src/index.mjs', "const input = 'packages/gateway/src/index.mjs';\n");
  write('packages/unrelated/src/index.mjs', 'import(`../../${name}/src/index.mjs`);\n');
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue', 'gateway', 'portal', 'unrelated']});
}));

test('missing or malformed evidence from either revision selects every package and names the failure', () => fixture(({git, write, commit, plan}) => {
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  for (const sha of [base, head]) {
    for (const fault of ['unreadable-tree', 'unterminated-tree', 'malformed-tree', 'duplicate-tree', 'unreadable-source']) {
      const read = (...args) => {
        if (args[0] === 'ls-tree' && args.at(-1) === sha) {
          if (fault === 'unreadable-tree') throw Error('Object unavailable');
          const actual = git(...args);
          if (fault === 'unterminated-tree') return actual.slice(0, -1);
          if (fault === 'malformed-tree') return actual + 'malformed\0';
          if (fault === 'duplicate-tree') return actual + actual.split('\0')[0] + '\0';
        }
        if (fault === 'unreadable-source' && args[0] === 'show' && args[1] === `${sha}:packages/portal/src/index.mjs`) throw Error('Blob unavailable');
        return git(...args);
      };
      const result = plan(base, head, read);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], `${sha} ${fault}`);
      assert.match(result.reason, /Unverified package revisions:.*full package suite/s);
      assert.equal(result.receipts.length, 5);
    }
  }
}));

test('unsupported discovery, membership and checkout inputs keep full work', () => {
  const changes = [
    ['pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n"],
    ['packages/new/package.json', JSON.stringify({name: 'new', private: true, scripts: {test: 'node --test'}})],
    ['.gitattributes', '*.mjs working-tree-encoding=UTF-16\n'],
    ['packages/portal/package.json', JSON.stringify({name: 'renamed-portal', private: true, scripts: {test: 'node --test'}})],
    ['packages/portal/package.json', JSON.stringify({name: 'portal', private: true, scripts: {test: 'node --test different.mjs'}})],
  ];
  for (const [path, content] of changes) fixture(({git, write, commit, plan}) => {
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    // Supply an unsupported committed object independently of the checkout.
    // The planner's package-only diff still must refuse that snapshot's evidence.
    const read = (...args) => {
      const identity = path.endsWith('package.json') && JSON.parse(content).name === 'renamed-portal';
      if (args[0] === 'show' && (args[1] === `${head}:${path}` || identity && args[1] === `${base}:${path}`)) return content;
      if (args[0] === 'ls-tree' && args.at(-1) === head && !git(...args).includes(`\t${path}\0`)) {
        return git(...args) + `100644 blob ${'e'.repeat(40)}\t${path}\0`;
      }
      return git(...args);
    };
    const result = plan(base, head, read);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], path);
    assert.match(result.reason, /Unverified package revisions:.*full package suite/s);
  });
});

test('symbolic links, submodules and tracked dependency overrides cannot earn narrow selection', () => {
  for (const [mode, type, path] of [
    ['120000', 'blob', 'pnpm-workspace.yaml'],
    ['120000', 'blob', 'packages/portal/package.json'],
    ['120000', 'blob', 'packages/portal/src/linked.mjs'],
    ['160000', 'commit', 'packages/portal/reader'],
    ['100644', 'blob', 'packages/portal/node_modules/reader.json'],
  ]) fixture(({git, write, commit, plan}) => {
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    const read = (...args) => {
      if (args[0] !== 'ls-tree' || args.at(-1) !== head) return git(...args);
      const entries = git(...args).split('\0').filter(entry => entry && !entry.endsWith(`\t${path}`));
      return entries.join('\0') + `\0${mode} ${type} ${'e'.repeat(40)}\t${path}\0`;
    };
    const result = plan(base, head, read);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], path);
    assert.match(result.reason, /Unverified package revisions:.*full package suite/s);
  });
});
