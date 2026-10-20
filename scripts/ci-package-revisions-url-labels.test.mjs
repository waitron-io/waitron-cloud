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

// Literal-only constructor or type matching loses a helper that the executed reader loads.
const apis = ['readdirSync', 'readdir', 'opendirSync', 'opendir'];
const labels = [
  [String.raw`\u0055RL`, ''],
  [String.raw`U\u{52}L`, ''],
  [String.raw`UR\u004c`, ''],
  [String.raw`\u{00000055}\u0052\u{4C}`, ''],
  ['URL', String.raw`: \u0055RL`],
  [String.raw`U\u{52}L`, String.raw`: UR\u{00004c}`],
];
const helper = "import './packages/catalogue/src/index.mjs';\nconsole.log('escaped URL label helper loaded');\n";
function reader(api, constructor, annotation = '', binding = 'stored', options = '') {
  const directory = `new ${constructor}('../../../', import /* base */ . meta . url)`;
  return `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
${binding === 'stored' ? `const directory${annotation} = ${directory};` : ''}
for await (const item of await ${api}(${binding === 'stored' ? 'directory' : directory}${options})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(new URL('../../../' + name, import.meta.url));
}`;
}
const execute = root => execFileSync(process.execPath, ['packages/portal/src/scan.mts'], {cwd: root, encoding: 'utf8', timeout: 5000});

test('escaped URL constructor and type labels retain executed directory consumers', async t => {
  for (const [index, [constructor, annotation]] of labels.entries()) {
    const api = apis[index % apis.length];
    for (const binding of annotation ? ['stored'] : ['direct', 'stored']) {
      await t.test(`${api} ${constructor}${annotation} ${binding}`, () => fixture(({root, git, write, commit, workspace}) => {
        write('catalogue-adapter.mjs', helper);
        write('nested/unrelated-adapter.mjs', "import '../packages/unrelated/src/index.mjs';\n");
        write('packages/portal/src/scan.mts', reader(api, constructor, annotation, binding));
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execute(root), 'escaped URL label helper loaded\n');
        assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
          {full: false, packages: ['catalogue', 'portal']});
        assert.deepEqual(scopeForRevisions(['packages/unrelated/src/index.mjs'], workspace, base, head, git),
          {full: false, packages: ['unrelated']});
      }));
    }
  }
});

test('escaped URL labels retain saved old and new transitive helper consumers', async t => {
  for (const [revision, change, expected] of [
    ['base', 'edit', ['catalogue', 'gateway', 'portal']],
    ['base', 'delete', ['catalogue', 'gateway', 'portal']],
    ['head', 'add', ['catalogue', 'gateway', 'portal']],
    ['head', 'edit', ['catalogue', 'gateway', 'portal']],
  ]) await t.test(`${revision} ${change}`, () => fixture(({root, git, write, commit, workspace}) => {
    if (change !== 'add') write('catalogue-adapter.mjs', helper);
    const active = reader('readdirSync', String.raw`\u0055R\u{4c}`, String.raw`: U\u0052L`).replaceAll('../../../', '../');
    write('tools/scan.mts', revision === 'head' ? 'export const inert = true;\n' : active);
    write('packages/portal/src/scan.mts', "import '../../../tools/scan.mts';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/scan.mts';\n");
    const base = commit();
    if (revision === 'base') assert.equal(execute(root), 'escaped URL label helper loaded\n');
    write('tools/scan.mts', revision === 'head' ? active : 'export const inert = true;\n');
    if (change === 'delete') rmSync(join(root, 'catalogue-adapter.mjs'));
    else write('catalogue-adapter.mjs', helper + '// changed helper\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision === 'head') assert.equal(execute(root), 'escaped URL label helper loaded\n');
    write('tools/scan.mts', 'export const dirty = true;\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
      {full: false, packages: expected});
  }));
});

test('escaped URL labels with root scan options retain every possible package', async t => {
  for (const api of apis) for (const binding of ['direct', 'stored']) await t.test(`${api} ${binding}`, () => fixture(({root, write, commit, plan}) => {
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.mjs';\nconsole.log('recursive escaped label helper loaded');\n");
    write('packages/portal/src/scan.mts', reader(api, String.raw`UR\u{4c}`, String.raw`: \u0055RL`, binding, ', {recursive: true}')
      .replace('import {', "import {pathToFileURL} from 'node:url';\nimport {")
      .replace("await import(new URL('../../../' + name, import.meta.url))", "await import(typeof item === 'string' ? new URL(item, new URL('../../../', import.meta.url)) : pathToFileURL(item.parentPath + '/' + name))"));
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execute(root), 'recursive escaped label helper loaded\n');
    const result = plan(base, head);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    assert.match(result.reason, /repository-root directory scan options at packages\/portal\/src\/scan\.mts/);
  }));
});

test('escaped URL labels without a repository root read keep consumers narrow', async t => {
  for (const operation of ['unused', 'local', 'cwd', 'different-name', 'other-constructor', 'other-type']) {
    await t.test(operation, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', helper);
      let source = reader('readdirSync', String.raw`\u0055RL`, String.raw`: U\u0052L`);
      if (operation === 'unused') source = String.raw`const directory: U\u0052L = new \u0055RL('../../../', import.meta.url);`;
      if (operation === 'local') source = source.replace("new \\u0055RL('../../../',", "new \\u0055RL('./',");
      if (operation === 'cwd') source = String.raw`const directory = new \u0055RL('../../../', import.meta.url); process.chdir(directory.pathname);`;
      if (operation === 'different-name') source = source.replace('readdirSync(directory)', "readdirSync(new URL('./', import.meta.url))");
      // These unrelated names evaluate to the source directory despite the root-looking arguments.
      if (operation === 'other-constructor') source = String.raw`const URLish = class { constructor() { return new URL('./', import.meta.url); } };` + source.replace('new \\u0055RL', 'new URLish');
      if (operation === 'other-type') source = source.replace(String.raw`U\u0052L`, 'URLish').replace("new \\u0055RL('../../../',", "new \\u0055RL('./',");
      write('packages/portal/src/scan.mts', source);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      assert.equal(execute(root), '');
      assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
    }));
  }
});
