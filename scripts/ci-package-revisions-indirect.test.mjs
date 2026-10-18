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

test('TypeScript non-null directory calls retain actual helper consumers', () => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const assertion of ['!', '! /* asserted */ !']) {
      for (const binding of ['optional', 'call', 'apply', 'bind']) fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('TypeScript indirect helper loaded');\n");
        const directory = "new URL('../../../', import.meta.url)";
        const fn = `${api}${assertion}`;
        const invocation = binding === 'optional' ? `${fn}?.(${directory})`
          : binding === 'call' ? `${fn}.call(null, ${directory})`
          : binding === 'apply' ? `${fn}.apply(null, [${directory}])`
          : `${fn}.bind(null)(${directory})`;
        write('packages/portal/src/reader.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
for await (const item of await ${invocation}) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'TypeScript indirect helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], `${api} ${assertion} ${binding}`);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      });
    }
  }
});

test('unchanged saved indirect helpers trigger the package planner guard', () => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('unchanged indirect helper loaded');\n");
    write('tools/scan.mjs', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../', import.meta.url);
for await (const item of await ${api}.call(null, directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'unchanged indirect helper loaded\n');
    write('tools/scan.mjs', 'export const changedLocally = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    const result = plan(base, head, read);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    assert.match(result.reason, /Unverified package revisions:.*Unresolved indirect directory call at tools\/scan\.mjs/);
  });
});

test('inert directory member text conservatively retains full package work', () => fixture(({root, write, commit, plan}) => {
  write('packages/portal/src/index.mjs', "console.log('readdirSync.name');\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'readdirSync.name\n');
  const result = plan(base, head);
  assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
  assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/index\.mjs/);
}));

test('direct non-null directory calls retain helpers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const assertion of ['!', '! /* asserted */ !', '/* scan */ !', '! /* asserted */ ! /* call */ ']) {
      await t.test(`${api} ${JSON.stringify(assertion)}`, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('direct non-null helper loaded');\n");
        write('packages/portal/src/reader.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await ${api}${assertion}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'direct non-null helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('saved direct non-null helpers retain consumers from both revisions and unchanged readers', () => {
  for (const revision of ['base', 'head', 'unchanged']) fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved non-null helper loaded');\n");
    const reader = `import {readdirSync} from 'node:fs';
const directory = new URL('../', import.meta.url);
for (const name of readdirSync!(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('tools/scan.mts', revision === 'head' ? 'export const value = 1;\n' : reader);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mts';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved non-null helper loaded\n');
    if (revision !== 'unchanged') write('tools/scan.mts', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved non-null helper loaded\n');
    write('tools/scan.mts', 'export const changedLocally = true;\n');
    write('catalogue-adapter.mjs', 'export const changedLocally = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      /Unresolved indirect directory call at tools\/scan\.mts/, revision);
    const result = plan(base, head, read);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    if (revision === 'unchanged') assert.match(result.reason, /Unverified package revisions:.*tools\/scan\.mts/);
  });
});

test('unused direct non-null helpers keep narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mts', `import {readdirSync, opendirSync} from 'node:fs';
import {readdir, opendir} from 'node:fs/promises';
const directory = new URL('../', import.meta.url);
readdirSync!(directory);
readdir!(directory);
opendirSync!(directory);
opendir!(directory);
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('parenthesized directory calls retain helpers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const expression of [`(${api})`, `((${api}))`, `(${api}!)!`, `( /* reader */ ${api} /* close */ )`, `(\n${api}! // asserted\n)!?.`]) {
      await t.test(expression, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('parenthesized helper loaded');\n");
        write('packages/portal/src/reader.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await ${expression}(directory)) {
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
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('saved parenthesized helpers retain both revisions and unchanged transitive consumers', () => {
  for (const revision of ['base', 'head', 'unchanged']) fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved parenthesized helper loaded');\n");
    const reader = `import {readdirSync} from 'node:fs';
const directory = new URL('../', import.meta.url);
for (const name of ((readdirSync!)!)(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('tools/scan.mts', revision === 'head' ? 'export const value = 1;\n' : reader);
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mts';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved parenthesized helper loaded\n');
    if (revision !== 'unchanged') write('tools/scan.mts', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved parenthesized helper loaded\n');
    write('tools/scan.mts', 'export const changedLocally = true;\n');
    write('catalogue-adapter.mjs', 'export const changedLocally = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      /Unresolved indirect directory call at tools\/scan\.mts/, revision);
    const result = plan(base, head, read);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    if (revision === 'unchanged') assert.match(result.reason, /Unverified package revisions:.*tools\/scan\.mts/);
  });
});

test('unused parenthesized directory helpers keep narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mts', `import {readdirSync, opendirSync} from 'node:fs';
import {readdir, opendir} from 'node:fs/promises';
const directory = new URL('../', import.meta.url);
(readdirSync)(directory);
(readdir!)(directory);
((opendirSync))(directory);
(opendir)!?.(directory);
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('TypeScript satisfies and generic directory references retain actual helper consumers', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const expression of [`(${api} satisfies unknown)`, `(${api}<any>)`, `${api}<any>`, `(${api}! /* check */ satisfies /* type */ unknown)`]) {
      await t.test(expression, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('typed helper loaded');\n");
        write('packages/portal/src/reader.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await ${expression}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'typed helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});


test('array directory readers retain helpers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const expression of [`[${api}][0]`, `[${api}, null][0]`, `[null, ${api}][1]`, `[${api}!,][0]`, `[null, ${api}!,][1]`, `[\n null,\n ${api} /* final */ , // trailing\n][1]`, `[[${api}]][0][0]`, `[ /* reader */ ${api} /* end */ ].at(0)!`]) {
      await t.test(expression, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('array helper loaded');\n");
        write('packages/portal/src/reader.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await ${expression}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'array helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('saved array helpers retain either revision and unchanged transitive consumers', () => {
  for (const expression of ['[readdirSync][0]', '[null, readdirSync][1]', '[null, readdirSync,][1]']) {
    for (const revision of ['base', 'head', 'unchanged']) fixture(({root, git, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved array helper loaded');\n");
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
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved array helper loaded\n');
      if (revision !== 'unchanged') write('tools/scan.mts', revision === 'head' ? reader : 'export const value = 2;\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved array helper loaded\n');
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

test('unused array directory helpers keep narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mts', `import {readdirSync, opendirSync} from 'node:fs';
import {readdir, opendir} from 'node:fs/promises';
const directory = new URL('../', import.meta.url);
[readdirSync][0](directory);
[readdir!,][0](directory);
[null, opendirSync][1](directory);
[opendir, null][0](directory);
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('middle array directory readers retain helpers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const expression of [`[null, ${api}, null][1]`, `[null, ${api}!, null,][1]`, `[
 null,
 ${api} /* middle */ , // next
 null
].at(1)!`]) {
      await t.test(expression, () => fixture(({root, write, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('array helper loaded');\n");
        write('packages/portal/src/reader.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../../../', import.meta.url);
for await (const item of await ${expression}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/reader.mts'], {cwd: root, encoding: 'utf8'}), 'array helper loaded\n');
        const result = plan(base, head);
        assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
        assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/reader\.mts/);
      }));
    }
  }
});

test('saved middle array helpers retain either revision and unchanged transitive consumers', () => {
  for (const expression of ['[null, readdirSync, null][1]']) {
    for (const revision of ['base', 'head', 'unchanged']) fixture(({root, git, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved array helper loaded');\n");
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
      if (revision !== 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved array helper loaded\n');
      if (revision !== 'unchanged') write('tools/scan.mts', revision === 'head' ? reader : 'export const value = 2;\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision !== 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved array helper loaded\n');
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
