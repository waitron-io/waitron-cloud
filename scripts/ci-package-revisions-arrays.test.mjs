import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace, scopeForPaths} from './ci-scope.mjs';
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

test('unused middle array directory helpers keep narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mts', `import {readdirSync} from 'node:fs';
const directory = new URL('../', import.meta.url);
[null, readdirSync, null][1](directory);
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));


test('another unproved URL use keeps a multi-name directory reader full', () => fixture(({root, write, commit, plan}) => {
  write('packages/portal/src/reader.mts', `import {readdir, stat} from 'node:fs/promises';
const directory = new URL('./', import.meta.url);
console.log((await readdir(directory)).length, (await stat(directory)).isDirectory());
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), '2 true\n');
  const result = plan(base, head);
  assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  assert.match(result.reason, /Unresolved directory input/);
}));

test('logical and conditional directory readers retain helpers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const expression of [
      `${api} || null`, `null || ${api}`, `${api} ?? null`, `null ?? ${api}`,
      `${api} && fallback`, `true && ${api}`, `true ? ${api} : null`, `false ? null : ${api}`,
      `${api}! /* operand */ || null`, `false ? null : // reader\n ${api}!`,
    ]) {
      await t.test(expression, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('expression helper loaded');\n");
        write('packages/portal/src/reader.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
const fallback = ${api};
for await (const item of await [null, ${expression}, null][1](directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'expression helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});


test('saved logical and conditional helpers retain either revision and unchanged transitive consumers', () => {
  for (const expression of ['[null, readdirSync || null, null][1]', '[null, false ? null : readdirSync, null][1]']) {
    for (const revision of ['base', 'head', 'unchanged']) fixture(({root, git, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved expression helper loaded');\n");
      const reader = `import {readdirSync} from 'node:fs';
const directory = new URL('../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
      write('tools/scan.mts', revision === 'head' ? 'export const value = 1;\n' : reader);
      write('packages/portal/src/index.mjs', "import '../../../tools/scan.mts';\n");
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved expression helper loaded\n');
      if (revision !== 'unchanged') write('tools/scan.mts', revision === 'head' ? reader : 'export const value = 2;\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved expression helper loaded\n');
      write('tools/scan.mts', 'export const changedLocally = true;\n');
      write('catalogue-adapter.mjs', 'export const changedLocally = true;\n');
      const read = (...args) => git(...args);
      read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
      assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
        /Unresolved indirect directory call at tools\/scan\.mts/, revision);
      assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    });
  }
});


test('unused logical and conditional directory helpers keep narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mts', `import {readdirSync} from 'node:fs';
const directory = new URL('../', import.meta.url);
[null, readdirSync || null, null][1](directory);
[null, false ? null : readdirSync, null][1](directory);
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('namespace logical and conditional directory readers retain helpers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const expression of [`null || fs.${api}`, `false ? null : fs /* namespace */ . ${api}`]) {
      await t.test(expression, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('expression helper loaded');\n");
        write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await [null, ${expression}, null][1](directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'expression helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});


test('nested predecessor array readers retain helpers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const prefix of ['[]', '{}', '[[null]]', '{nested: [null]}', '[] /* nested */']) {
      const reference = prefix.includes('/*') ? `fs /* member */ . ${api}!` : api;
      await t.test(`${prefix}, ${reference}`, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('nested helper loaded');\n");
        write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await [${prefix}, ${reference}, null][1](directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'nested helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('saved nested predecessor readers retain either revision and unchanged transitive consumers', () => {
  for (const expression of ['[[], readdirSync, null][1]', '[{nested: [null]}, readdirSync, null].at(1)']) {
    for (const revision of ['base', 'head', 'unchanged']) fixture(({root, git, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved nested helper loaded');\n");
      const reader = `import {readdirSync} from 'node:fs';
const directory = new URL('../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
      write('tools/scan.mts', revision === 'head' ? 'export const value = 1;\n' : reader);
      write('packages/portal/src/index.mjs', "import '../../../tools/scan.mts';\n");
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved nested helper loaded\n');
      if (revision !== 'unchanged') write('tools/scan.mts', revision === 'head' ? reader : 'export const value = 2;\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved nested helper loaded\n');
      write('tools/scan.mts', 'export const changedLocally = true;\n');
      write('catalogue-adapter.mjs', 'export const changedLocally = true;\n');
      const read = (...args) => git(...args);
      read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
      assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
        /Unresolved indirect directory call at tools\/scan\.mts/, revision);
      assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    });
  }
});

test('unused nested predecessor directory helpers keep narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mts', `import {readdirSync} from 'node:fs';
const directory = new URL('../', import.meta.url);
[[], readdirSync, null][1](directory);
[{}, readdirSync, null][1](directory);
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));


test('asserted and optional namespaces after nested predecessors retain loaded consumers', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const member of [' /* namespace */ ! /* access */ . ', ' /* namespace */ ?. ']) {
      await t.test(`fs${member}${api}`, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('namespace nested helper loaded');\n");
        write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await [[], fs${member}${api}, null][1](directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'namespace nested helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('namespace array readers after simple values retain loaded consumers', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const member of ['.', ' /* namespace */ ! /* access */ . ', ' /* namespace */ ?. ']) {
      await t.test(`fs${member}${api}`, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('namespace nested helper loaded');\n");
        write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await [0, fs${member}${api}, null][1](directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'namespace nested helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('saved namespace middle array readers retain either revision and unchanged transitive consumers', () => {
  for (const expression of ['[0, fs.readdirSync, null][1]', '[0, fs /* namespace */ ! ?. readdirSync!, null].at(1)']) {
    for (const revision of ['base', 'head', 'unchanged']) fixture(({root, git, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved nested helper loaded');\n");
      const reader = `import * as fs from 'node:fs';
const directory = new URL('../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
      write('tools/scan.mts', revision === 'head' ? 'export const value = 1;\n' : reader);
      write('packages/portal/src/index.mjs', "import '../../../tools/scan.mts';\n");
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved nested helper loaded\n');
      if (revision !== 'unchanged') write('tools/scan.mts', revision === 'head' ? reader : 'export const value = 2;\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved nested helper loaded\n');
      write('tools/scan.mts', 'export const changedLocally = true;\n');
      write('catalogue-adapter.mjs', 'export const changedLocally = true;\n');
      const read = (...args) => git(...args);
      read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
      assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
        /Unresolved indirect directory call at tools\/scan\.mts/, revision);
      assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    });
  }
});


test('unused namespace middle array directory helpers keep narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mts', `import * as fs from 'node:fs';
const directory = new URL('../', import.meta.url);
[0, fs.readdirSync, null][1](directory);
[0, fs?.readdirSync, null][1](directory);
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));


test('deep namespace middle array readers retain actually loaded consumers', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const prefix of ['0', '[]']) {
      for (const member of ['ns.fs.', 'ns.nested.fs.', 'ns /* a */ ! ?. nested /* b */ . fs /* c */ ! ?. ']) {
        await t.test(`${prefix}, ${member}${api}`, () => fixture(({root, write, commit, plan}) => {
          write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('deep helper loaded');\n");
          write('packages/portal/src/reader.mts', `import * as fs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const ns = {fs, nested: {fs}};
const directory = new URL('../../../', import.meta.url);
for await (const item of await [${prefix}, ${member}${api}!, null][1](directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
          const base = commit();
          write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
          const head = commit();
          assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'deep helper loaded\n');
          const result = plan(base, head);
          assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
          assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
        }));
      }
    }
  }
});

test('native fs promises middle array readers retain loaded consumers', async t => {
  for (const api of ['readdir', 'opendir']) await t.test(api, () => fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('native promises helper loaded');\n");
    write('packages/portal/src/reader.mjs', `import * as fs from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for await (const item of await [0, fs.promises.${api}, null][1](directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mjs'], {cwd: root, encoding: 'utf8'}), 'native promises helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  }));
});

test('saved deep namespace middle array readers retain revisions despite dirty local helpers', () => {
  for (const expression of ['[0, ns.fs.readdirSync, null][1]', '[[], ns!.nested?.fs!.readdirSync!, null][1]']) {
    for (const revision of ['base', 'head', 'unchanged']) fixture(({root, git, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved deep helper loaded');\n");
      const reader = `import * as fs from 'node:fs';
const ns = {fs, nested: {fs}};
const directory = new URL('../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
      write('tools/scan.mts', revision === 'head' ? 'export const value = 1;\n' : reader);
      write('packages/portal/src/index.mjs', "import '../../../tools/scan.mts';\n");
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved deep helper loaded\n');
      if (revision !== 'unchanged') write('tools/scan.mts', revision === 'head' ? reader : 'export const value = 2;\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved deep helper loaded\n');
      write('tools/scan.mts', 'export const changedLocally = true;\n');
      write('catalogue-adapter.mjs', 'export const changedLocally = true;\n');
      const read = (...args) => git(...args);
      read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
      assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
        /Unresolved indirect directory call at tools\/scan\.mts/, revision);
      assert.deepEqual(plan(base, head, read).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    });
  }
});

test('unused deep namespace directory helpers retain narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', `import * as fs from 'node:fs';
const ns = {fs, nested: {fs}};
[0, ns.fs.readdirSync, null][1](new URL('../', import.meta.url));
[[], ns.nested.fs.readdirSync, null][1](new URL('../', import.meta.url));
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));


test('deep namespace reader after a nested object retains its loaded consumer', () => fixture(({root, write, commit, plan}) => {
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('object deep helper loaded');\n");
  write('packages/portal/src/reader.mjs', `import * as fs from 'node:fs';
const ns = {nested: {fs}};
const directory = new URL('../../../', import.meta.url);
for (const name of [{nested: [0]}, ns.nested.fs.readdirSync, null][1](directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mjs'], {cwd: root, encoding: 'utf8'}), 'object deep helper loaded\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
}));
