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

// Reverting escaped declaration discovery, call discovery or name decoding must lose a consumer Node loads.
const apis = ['readdirSync', 'readdir', 'opendirSync', 'opendir'];
const spellings = [
  [String.raw`\u0064irectory`, 'directory'],
  ['directory', String.raw`\u{64}irectory`],
  [String.raw`d\u0069rectory`, String.raw`d\u{69}rectory`],
  [String.raw`\u{000000f1}dir`, 'ñdir'],
  ['𐐀dir', String.raw`\u{10400}dir`],
  [String.raw`a\u200cb`, 'a\u200cb'],
  [String.raw`a\u{200d}b`, String.raw`a\u200db`],
  [String.raw`\u0024dir`, '$dir'],
];
const helper = "import './packages/catalogue/src/index.mjs';\nconsole.log('Unicode URL helper loaded');\n";
function reader(api, name, declaration = `const ${name}`, options = '') {
  return `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
${declaration} = new URL('../../../', import /* base */ . meta . url);
for await (const item of await ${api}(${name}${options})) {
  const entry = typeof item === 'string' ? item : item.name;
  if (entry.endsWith('-adapter.mjs')) await import(new URL('../../../' + entry, import.meta.url));
}`;
}
const execute = root => execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8', timeout: 5000});

test('escaped URL variables retain immediate root helpers loaded by every directory API', async t => {
  for (const api of apis) for (const [binding, use] of spellings) await t.test(`${api} ${binding} / ${use}`, () => fixture(({root, git, write, commit, workspace}) => {
    write('catalogue-adapter.mjs', helper);
    write('nested/unrelated-adapter.mjs', "import '../packages/unrelated/src/index.mjs';\n");
    write('packages/portal/src/index.mjs', reader(api, use, `const ${binding}`));
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execute(root), 'Unicode URL helper loaded\n');
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
      {full: false, packages: ['catalogue', 'portal']});
    assert.deepEqual(scopeForRevisions(['packages/unrelated/src/index.mjs'], workspace, base, head, git),
      {full: false, packages: ['unrelated']});
  }));
});

test('escaped URL declarations preserve let var annotations and later bindings', async t => {
  for (const declaration of [String.raw`let \u00f1dir`, String.raw`var \u00f1dir`, String.raw`const \u00f1dir: URL`, String.raw`let \u00f1dir: URL`, String.raw`const earlier = 0, \u00f1dir`, String.raw`var earlier = 0, \u00f1dir: URL`]) {
    await t.test(declaration, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', helper);
      const path = 'packages/portal/src/index.mts';
      write(path, reader('readdirSync', 'ñdir', declaration));
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, [path], {cwd: root, encoding: 'utf8', timeout: 5000}), 'Unicode URL helper loaded\n');
      assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'portal']);
    }));
  }
});

test('escaped URL readers retain saved helper consumers from both revisions', async t => {
  for (const [revision, change, expected] of [
    ['base', 'edit', ['catalogue', 'gateway', 'portal']],
    ['base', 'add', ['catalogue']],
    ['base', 'delete', ['catalogue', 'gateway', 'portal']],
    ['head', 'edit', ['catalogue', 'gateway', 'portal']],
    ['head', 'add', ['catalogue', 'gateway', 'portal']],
    ['head', 'delete', ['catalogue']],
    ['unchanged', 'edit', ['catalogue', 'gateway', 'portal']],
    ['unchanged', 'add', ['catalogue', 'gateway', 'portal']],
    ['unchanged', 'delete', ['catalogue', 'gateway', 'portal']],
  ]) {
    await t.test(`${revision} ${change}`, () => fixture(({root, git, write, commit, workspace}) => {
      if (change !== 'add') write('catalogue-adapter.mjs', helper);
      const active = reader('readdirSync', 'ñdirectorio', String.raw`const \u{f1}directorio`).replaceAll('../../../', '../');
      write('tools/scan.mjs', revision === 'head' ? 'export const inert = true;\n' : active);
      write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision !== 'head') assert.equal(execute(root), change === 'add' ? '' : 'Unicode URL helper loaded\n');
      if (revision !== 'unchanged') write('tools/scan.mjs', revision === 'head' ? active : 'export const inert = true;\n');
      if (change === 'delete') rmSync(join(root, 'catalogue-adapter.mjs'));
      else write('catalogue-adapter.mjs', helper + '// changed helper\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execute(root), change === 'delete' ? '' : 'Unicode URL helper loaded\n');
      write('tools/scan.mjs', 'export const dirty = true;\n');
      write('catalogue-adapter.mjs', 'export const dirty = true;\n');
      assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
        {full: false, packages: expected});
    }));
  }
});

test('escaped root URL variables cannot hide recursive options', async t => {
  for (const api of apis) for (const name of [String.raw`\u00f1directorio`, String.raw`directorio\u{f1}`]) await t.test(`${api} ${name}`, () => fixture(({root, write, commit, plan}) => {
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.mjs';\nconsole.log('nested Unicode helper loaded');\n");
    write('packages/portal/src/index.mjs', reader(api, name, `const ${name}`, ', {recursive: true}')
      .replace("import {", "import {pathToFileURL} from 'node:url';\nimport {")
      .replace("await import(new URL('../../../' + entry, import.meta.url))", "await import(typeof item === 'string' ? new URL(item, new URL('../../../', import.meta.url)) : pathToFileURL(item.parentPath + '/' + entry))"));
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execute(root), 'nested Unicode helper loaded\n');
    const result = plan(base, head);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    assert.match(result.reason, /repository-root directory scan options at packages\/portal\/src\/index\.mjs/);
  }));
});

test('escaped URLs without a root reader keep unrelated consumers narrow', async t => {
  for (const operation of ['unused', 'local', 'different-name', 'root-cwd']) await t.test(operation, () => fixture(({write, commit, plan}) => {
    write('catalogue-adapter.mjs', helper);
    write('packages/portal/src/index.mjs', operation === 'local' ? reader('readdirSync', String.raw`\u00f1dir`).replace("new URL('../../../',", "new URL('./',") : `import {readdirSync} from 'node:fs';
const \\u00f1dir = new URL('../../../', import.meta.url);
${operation === 'different-name' ? "const ñdirectory = new URL('./', import.meta.url); readdirSync(ñdirectory);" : operation === 'root-cwd' ? 'process.chdir(ñdir);' : 'export {ñdir};'}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    assert.deepEqual(plan(base, commit()).packages.map(row => row.package), ['catalogue']);
  }));
});
