import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';

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

// Removing the escaped-member refusal must omit the portal consumer and fail these checks.
test('escaped final directory APIs retain consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const escaped of [api.slice(0, -1) + String.raw`\u` + api.charCodeAt(api.length - 1).toString(16).padStart(4, '0'),
      String.raw`\u{00000` + api.charCodeAt(0).toString(16) + '}' + api.slice(1)]) {
      await t.test(escaped, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('escaped API helper loaded');\n");
        write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const readDirectory = (fs).${escaped};
for await (const item of await readDirectory(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'escaped API helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved escaped member at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('escaped API members retain optional access comments and erased assertions', async t => {
  for (const expression of [String.raw`fs.re\u0061ddirSync`, String.raw`(fs)!?.re\u0061ddirSync!`,
    String.raw`(fs as typeof fs) /* receiver */ ?. /* member */ \u0072eaddirSync`,
    String.raw`(fs satisfies typeof fs) // receiver` + '\n . // member\n ' + String.raw`readdir\u0053ync`]) {
    await t.test(expression, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('wrapped API helper loaded');\n");
      write('packages/portal/src/reader.mts', `import * as fs from 'node:fs';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const readDirectory = ${expression};
for (const name of readDirectory(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'wrapped API helper loaded\n');
      assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    }));
  }
});

test('saved escaped API readers retain base head and unchanged transitive consumers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) await t.test(revision, () => fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved escaped helper loaded');\n");
    const reader = String.raw`import * as fs from 'node:fs';
const directory = new URL(['..', ''].join('/'), import.meta.url);
for (const name of fs.re\u0061ddirSync(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('tools/scan.mjs', revision === 'head' ? 'export const value = 1;\n' : reader);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved escaped helper loaded\n');
    if (revision !== 'unchanged') write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved escaped helper loaded\n');
    write('tools/scan.mjs', 'export const dirty = true;\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('unused escaped API helpers and plain escaped strings preserve isolation', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', String.raw`import * as fs from 'node:fs'; fs.re\u0061ddirSync(process.cwd());`);
  write('packages/portal/src/index.mjs', String.raw`export const labels = ['\u0072eaddirSync'];`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));
