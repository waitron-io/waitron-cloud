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

// Dropping token gaps in the URL base loses a consumer that Node loads.
const apis = ['readdirSync', 'readdir', 'opendirSync', 'opendir'];
const helper = "import './packages/catalogue/src/index.mjs';\nconsole.log('URL helper loaded');\n";
function reader(api, binding, meta, options = '') {
  const directory = `new URL('../../../', ${meta})`;
  return `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
${binding === 'stored' ? `const directory = ${directory};` : ''}
for await (const item of await ${api}(${binding === 'stored' ? 'directory' : directory}${options})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}`;
}

test('commented URL bases retain immediate helpers Node actually loads', async t => {
  for (const api of apis) for (const binding of ['direct', 'stored']) {
    for (const [label, gap] of [['space', ' '], ['block', '/* base */'], ['LF', '// base\n'], ['CR', '// base\r'], ['U+2028', '// base\u2028'], ['U+2029', '// base\u2029']]) {
      await t.test(`${api} ${binding} ${label}`, () => fixture(({root, git, write, commit, workspace}) => {
        write('catalogue-adapter.mjs', helper);
        write('nested/unrelated-adapter.mjs', "import '../packages/unrelated/src/index.mjs';\n");
        write('packages/portal/src/index.mjs', reader(api, binding, `import${gap}.${gap}meta${gap}.${gap}url`));
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8', timeout: 5000}), 'URL helper loaded\n');
        assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
          {full: false, packages: ['catalogue', 'portal']});
        assert.deepEqual(scopeForRevisions(['packages/unrelated/src/index.mjs'], workspace, base, head, git),
          {full: false, packages: ['unrelated']});
      }));
    }
  }
});

test('commented URL readers retain saved base head and unchanged transitive consumers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) for (const binding of ['direct', 'stored']) {
    await t.test(`${revision} ${binding}`, () => fixture(({root, git, write, commit, workspace}) => {
      write('catalogue-adapter.mjs', helper);
      const active = reader('readdirSync', binding, 'import /* a */ . meta // b\n . url').replaceAll('../../../', '../');
      write('tools/scan.mjs', revision === 'head' ? 'export const inert = true;' : active);
      write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8', timeout: 5000}), 'URL helper loaded\n');
      if (revision !== 'unchanged') write('tools/scan.mjs', revision === 'head' ? active : 'export const inert = true;');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision === 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8', timeout: 5000}), 'URL helper loaded\n');
      write('tools/scan.mjs', 'export const dirty = true;');
      write('catalogue-adapter.mjs', 'export const dirty = true;');
      assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], workspace, base, head, git),
        {full: false, packages: ['catalogue', 'gateway', 'portal']});
    }));
  }
});

test('commented URL bases cannot hide recursive directory options', async t => {
  for (const api of apis) for (const binding of ['direct', 'stored']) {
    await t.test(`${api} ${binding}`, () => fixture(({root, write, commit, plan}) => {
      write('adapters/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.mjs';\nconsole.log('recursive URL helper loaded');\n");
      const directory = "new URL('../../../', import /* base */ . meta // base\n . url)";
      write('packages/portal/src/index.mjs', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
import {pathToFileURL} from 'node:url';
${binding === 'stored' ? `const directory = ${directory};` : ''}
for await (const item of await ${api}(${binding === 'stored' ? 'directory' : directory}, {recursive: true})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(typeof item === 'string' ? new URL(item, new URL('../../../', import.meta.url)) : pathToFileURL(item.parentPath + '/' + item.name));
}`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8', timeout: 5000}), 'recursive URL helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
      assert.match(result.reason, /repository-root directory scan options at packages\/portal\/src\/index\.mjs/);
    }));
  }
});


// Accepting URL token gaps must not turn a command directory into a scan.
test('commented URL bases keep command directories and non-root options narrow', async t => {
  for (const binding of ['direct', 'stored']) for (const api of apis) for (const scan of [false, true]) {
    await t.test(`${api} ${binding} ${scan ? 'non-root scan' : 'command directory'}`, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', helper);
      write('packages/portal/src/local.mjs', "console.log('local helper loaded');\n");
      const directory = "new URL('./', import /* base */ . meta // base\n . url)";
      write('packages/portal/src/index.mjs', scan ? `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
${binding === 'stored' ? `const directory = ${directory};` : ''}
for await (const item of await ${api}(${binding === 'stored' ? 'directory' : directory}, {recursive: true})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name === 'local.mjs') await import('./local.mjs');
}` : `import {execFileSync} from 'node:child_process';
const directory = new URL('../../../', import /* base */ . meta // base\n . url);
console.log(execFileSync(process.execPath, ['-e', 'process.stdout.write("command ran")'], {cwd: directory, encoding: 'utf8'}));`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8', timeout: 5000}), scan ? 'local helper loaded\n' : 'command ran\n');
      assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
    }));
  }
});
