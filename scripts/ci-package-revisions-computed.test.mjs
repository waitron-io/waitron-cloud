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

test('quoted computed directory members retain consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const quote of ["'", '"', '`']) {
      await t.test(`${api} ${quote}`, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('computed helper loaded');\n");
        write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await fs[${quote}${api}${quote}](directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'computed helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('computed directory members survive wrappers comments and stored references', async t => {
  for (const expression of [
    "(fs)[ /* open */ 'readdirSync' /* close */ ]",
    "fs['readdirSync'!]",
    "fs['readdirSync' satisfies string]",
    "fs[('readdirSync')]",
    "fs[ /* key */ ( /* nested */ ('readdirSync') )]",
    'fs!?.[ // open\n "readdirSync" // close\n ]!',
    "[fs['readdirSync'], null][0]",
    "[[], 0, fs['readdirSync'], null][2]",
    "[0, ns.nested.fs['readdirSync'], null][1]",
  ]) await t.test(expression, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('wrapped computed helper loaded');\n");
    write('packages/portal/src/reader.mts', `import * as fs from 'node:fs';
const ns = {nested: {fs}};
const directory = new URL('../../../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'wrapped computed helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('saved computed directory helpers retain either revision and transitive consumers', () => {
  for (const revision of ['base', 'head', 'unchanged']) fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved computed helper loaded');\n");
    const reader = `import * as fs from 'node:fs';
const directory = new URL('../', import.meta.url);
for (const name of fs['readdirSync'](directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('tools/scan.mjs', revision === 'head' ? 'export const value = 1;\n' : reader);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved computed helper loaded\n');
    if (revision !== 'unchanged') write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved computed helper loaded\n');
    write('tools/scan.mjs', 'export const changedLocally = true;\n');
    write('catalogue-adapter.mjs', 'export const changedLocally = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      /Unresolved indirect directory call at tools\/scan\.mjs/, revision);
    assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  });
});

test('unused computed directory helpers keep narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', `import * as fs from 'node:fs';
fs['readdirSync'](new URL('../', import.meta.url));
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('escaped computed directory keys retain consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const [quote, prefix] of [["'", String.raw`\u0072`], ['"', String.raw`\x72`], ['`', String.raw`\u{72}`]]) {
      const key = quote + (api.startsWith('r') ? prefix + api.slice(1) : prefix.replace('72', '6f') + api.slice(1)) + quote;
      await t.test(`${api} ${key}`, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('escaped helper loaded');\n");
        write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await fs[${key}](directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'escaped helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved escaped directory key at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('escaped computed keys survive line continuations comments and erased wrappers', async t => {
  for (const expression of [
    String.raw`fs['read\u0064irSync']`,
    "fs['read\\\ndirSync']",
    'fs[`read\\\r\ndirSync`]',
    String.raw`fs[ /* key */ ( /* nested */ ('\u0072eaddirSync' satisfies string) )]`,
    String.raw`fs!?.[ // key
      "\x72eaddirSync"! // close
    ]!`,
    String.raw`[[], 0, fs['\u{72}eaddirSync'], null][2]`,
  ]) await t.test(expression, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('wrapped escaped helper loaded');\n");
    write('packages/portal/src/reader.mts', `import * as fs from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'wrapped escaped helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('saved escaped keys retain both revisions and unchanged transitive readers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) await t.test(revision, () => fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved escaped helper loaded');\n");
    const reader = String.raw`import * as fs from 'node:fs';
const directory = new URL('../', import.meta.url);
for (const name of fs['\u0072eaddirSync'](directory)) {
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
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      /Unresolved escaped directory key at tools\/scan\.mjs/);
    assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('unused escaped key helpers retain narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', String.raw`import * as fs from 'node:fs';
fs['\u0072eaddirSync'](new URL('../', import.meta.url));
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('escaped array values without member access retain narrow package work', async t => {
  for (const value of [String.raw`'bad\ninput'`, String.raw`"bad\ninput"`, '`bad\\ninput`']) {
    await t.test(value, () => fixture(({root, write, commit, plan}) => {
      write('packages/portal/src/values.mjs', `const values = [${value}];\nfunction array() { return [${value}]; }\nfor (const item of [${value}]) console.log(values.length + array().length);\n`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/values.mjs'], {cwd: root, encoding: 'utf8'}), '2\n');
      assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
    }));
  }
});


test('parenthesized namespace directory readers retain consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    await t.test(api, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('parenthesized helper loaded');\n");
      write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await (fs).${api}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'parenthesized helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
      assert.match(result.reason, /Unresolved parenthesized directory member at packages\/portal\/src\/reader\.mts/);
    }));
  }
});

test('parenthesized namespace readers survive erased wrappers and expression positions', async t => {
  for (const expression of [
    '(fs!).readdirSync',
    '(fs)!.readdirSync',
    '(fs)!?.readdirSync',
    '( /* receiver */ fs /* close */ ) /* member */ . /* name */ readdirSync',
    '(fs) // member\n ?. // name\n readdirSync',
    '(fs as typeof fs).readdirSync',
    '(fs satisfies typeof fs).readdirSync',
    '[(fs).readdirSync, null][0]',
    '[[], 0, (fs).readdirSync, null][2]',
    '(ns.nested.fs).readdirSync',
  ]) await t.test(expression, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('wrapped namespace helper loaded');\n");
    write('packages/portal/src/reader.mts', `import * as fs from 'node:fs';
const ns = {nested: {fs}};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'wrapped namespace helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('saved parenthesized namespace readers retain either revision and unchanged transitive consumers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) await t.test(revision, () => fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved namespace helper loaded');\n");
    const reader = `import * as fs from 'node:fs';
const directory = new URL(['..', ''].join('/'), import.meta.url);
for (const name of (fs).readdirSync(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('tools/scan.mjs', revision === 'head' ? 'export const value = 1;\n' : reader);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved namespace helper loaded\n');
    if (revision !== 'unchanged') write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved namespace helper loaded\n');
    write('tools/scan.mjs', 'export const dirty = true;\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      /Unresolved parenthesized directory member at tools\/scan\.mjs/);
    assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('unused parenthesized namespace helpers retain narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', `import * as fs from 'node:fs';
(fs).readdirSync(new URL(['..', ''].join('/'), import.meta.url));
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('deep parenthesized namespace directory readers retain consumers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    await t.test(api, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('parenthesized helper loaded');\n");
      write('packages/portal/src/reader.mts', `import * as fs from 'node:fs';
const ns = {nested: {fs}};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await (ns).nested.fs.${api.endsWith('Sync') ? '' : 'promises.'}${api}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'parenthesized helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
      assert.match(result.reason, /Unresolved parenthesized directory member at packages\/portal\/src\/reader\.mts/);
    }));
  }
});

test('deep parenthesized namespace readers survive erased wrappers and expression positions', async t => {
  for (const expression of [
    '(ns).nested.fs.readdirSync',
    '(ns)!.nested!.fs!?.readdirSync',
    '(ns)!?.nested?.fs.readdirSync',
    '(ns) /* receiver */ . /* member */ nested /* next */ . fs . readdirSync',
    '(ns) // receiver\n ?. // member\n nested . fs . readdirSync',
    '(ns as typeof ns).nested.fs.readdirSync',
    '(ns satisfies typeof ns).nested.fs.readdirSync',
    '[[], 0, (ns).nested.fs.readdirSync, null][2]',
  ]) await t.test(expression, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('wrapped namespace helper loaded');\n");
    write('packages/portal/src/reader.mts', `import * as fs from 'node:fs';
const ns = {nested: {fs}};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const readDirectory = ${expression};
for (const name of readDirectory(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'wrapped namespace helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('saved deep parenthesized namespace readers retain either revision and unchanged transitive consumers', async t => {
  for (const revision of ['base', 'head', 'unchanged']) await t.test(revision, () => fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved namespace helper loaded');\n");
    const reader = `import * as fs from 'node:fs/promises';
const ns = {nested: {fs}};
const directory = new URL(['..', ''].join('/'), import.meta.url);
for (const name of await (ns).nested.fs.readdir(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('tools/scan.mjs', revision === 'head' ? 'export const value = 1;\n' : reader);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved namespace helper loaded\n');
    if (revision !== 'unchanged') write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved namespace helper loaded\n');
    write('tools/scan.mjs', 'export const dirty = true;\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      /Unresolved parenthesized directory member at tools\/scan\.mjs/);
    assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('unused deep parenthesized namespace helpers retain narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', `import * as fs from 'node:fs';
({nested: {fs}}).nested.fs.readdirSync(new URL(['..', ''].join('/'), import.meta.url));
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));
