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

test('comments in directory calls retain consumers of helpers Node actually loads', () => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const binding of ['direct', 'stored']) for (const gap of ['/* scan */', '// scan\n']) {
      fixture(({root, git, write, commit}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('commented helper loaded');\n");
        write('nested/unrelated-adapter.mjs', "import '../packages/unrelated/src/index.mjs';\n");
        const directory = `new${gap} URL${gap}(${gap}'../../../'${gap},${gap}import.meta.url${gap},${gap})`;
        write('packages/portal/src/index.mjs', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
${binding === 'stored' ? `const${gap}directory${gap}=${gap}${directory};` : ''}
for await (const item of await ${api}${gap}(${gap}${binding === 'direct' ? directory : 'directory'}${gap},${gap})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}
`);
        const base = commit();
        write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'commented helper loaded\n');
        assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
          {full: false, packages: ['catalogue', 'portal']}, `${api} ${binding} ${gap}`);
        assert.deepEqual(scopeForRevisions(['packages/unrelated/src/index.mjs'], loadWorkspace(root), base, head, git),
          {full: false, packages: ['unrelated']}, `${api} ${binding} ${gap}`);
      });
    }
  }
});

test('comments before directory options cannot hide unresolved recursive scans', () => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const binding of ['direct', 'stored']) fixture(({root, write, commit, plan}) => {
      write('adapters/catalogue-reader.mjs', "import '../packages/catalogue/src/index.mjs';\nconsole.log('commented recursive helper loaded');\n");
      const directory = "new /* target */ URL(/* relative */ '../../../', /* base */ import.meta.url)";
      write('packages/portal/src/index.mjs', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
import {pathToFileURL} from 'node:url';
${binding === 'stored' ? `const /* binding */ directory /* value */ = ${directory};` : ''}
for await (const item of await ${api}(/* start */ ${binding === 'direct' ? directory : 'directory'} /* end */, /* options */ {recursive: true})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-reader.mjs')) {
    const target = typeof item === 'string' ? new URL(item, new URL('../../../', import.meta.url)) : pathToFileURL(item.parentPath + '/' + item.name);
    await import(target);
  }
}
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'commented recursive helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], `${api} ${binding}`);
      assert.match(result.reason, /repository-root directory scan options at packages\/portal\/src\/index\.mjs/);
    });
  }
});


test('line comments in saved helper scans end at every JavaScript line terminator', () => {
  for (const ending of ['\r', '\u2028', '\u2029']) for (const revision of ['base', 'head']) fixture(({root, git, write, commit}) => {
    const reader = `import {readdirSync} from 'node:fs';
const directory = new URL('../', import.meta.url);
for (const name of readdirSync(// scan${ending}directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved commented helper loaded');\n");
    write('tools/scan.mjs', revision === 'base' ? reader : 'export const value = 1;\n');
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision === 'base') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved commented helper loaded\n');
    write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
    const head = commit();
    if (revision === 'head') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved commented helper loaded\n');
    write('tools/scan.mjs', 'export const changedLocally = true;\n');
    write('catalogue-adapter.mjs', 'export const changedLocally = true;\n');
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
      {full: false, packages: ['catalogue', 'gateway', 'portal']}, `${JSON.stringify(ending)} ${revision}`);
  });
});


test('a block comment cannot swallow options through an adjacent or later comment', () => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const binding of ['direct', 'stored']) for (const ending of ['/* end */', '']) fixture(({root, write, commit, plan}) => {
      write('adapters/catalogue-reader.mjs', "import '../packages/catalogue/src/index.mjs';\nconsole.log('bounded comment helper loaded');\n");
      const directory = "new URL('../../../', import.meta.url)";
      write('packages/portal/src/index.mjs', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
import {pathToFileURL} from 'node:url';
${binding === 'stored' ? `const directory = ${directory};` : ''}
for await (const item of await ${api}(${binding === 'direct' ? directory : 'directory'}, /* options */ {recursive: true} ${ending})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-reader.mjs')) {
    const target = typeof item === 'string' ? new URL(item, new URL('../../../', import.meta.url)) : pathToFileURL(item.parentPath + '/' + item.name);
    await import(target);
  }
}
(() => {})(/* later */);
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'bounded comment helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], `${api} ${binding} ${ending || 'later'}`);
      assert.match(result.reason, /repository-root directory scan options at packages\/portal\/src\/index\.mjs/);
    });
  }
});

test('a run of block comments cannot trap package selection in backtracking', () => fixture(({root, git, write, commit}) => {
  write('packages/portal/src/index.mjs', 'readdirSync(' + '/**/'.repeat(40) + 'undefined);\n');
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  const members = loadWorkspace(root);
  const program = `import {execFileSync} from 'node:child_process';
import {createPlan} from ${JSON.stringify(new URL('./ci-plan.mjs', import.meta.url).href)};
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});
const plan = createPlan({pull_request: {base: {sha: '${base}'}, head: {sha: '${head}'}}}, {sha: '${head}'}, ${JSON.stringify(members)}, git, () => {throw Error('No API expected');});
console.log(JSON.stringify({packages: plan.packages.map(row => row.package), reason: plan.reason}));
`;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program],
    {cwd: root, encoding: 'utf8', timeout: 10_000}));
  assert.deepEqual(result.packages, ['catalogue', 'gateway', 'portal', 'unrelated']);
  assert.match(result.reason, /Unresolved directory input/);
}));

test('directory import aliases retain consumers of helpers Node actually loads', () => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const gap of [' ', ' /* alias */ ', ' // alias\n']) fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('aliased helper loaded');\n");
      write('packages/portal/src/index.mjs', `import {${api}${gap}as scanDirectory} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
for await (const item of await scanDirectory(new URL('../../../', import.meta.url))) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'aliased helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], `${api} ${gap}`);
      assert.match(result.reason, /Unresolved directory import alias at packages\/portal\/src\/index\.mjs/);
    });
  }
});

test('directory import aliases in saved helpers keep full work from either revision', () => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const revision of ['base', 'head']) fixture(({root, git, write, commit}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved alias helper loaded');\n");
      const reader = `import {${api} as scanDirectory} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../', import.meta.url);
for await (const item of await scanDirectory(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
      write('tools/scan.mjs', revision === 'base' ? reader : 'export const value = 1;\n');
      write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision === 'base') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved alias helper loaded\n');
      write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision === 'head') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved alias helper loaded\n');
      write('tools/scan.mjs', 'export const changedLocally = true;\n');
      write('catalogue-adapter.mjs', 'export const changedLocally = true;\n');
      const read = (...args) => git(...args);
      read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
      assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
        /Unresolved directory import alias at tools\/scan\.mjs/, `${api} ${revision}`);
    });
  }
});

test('an unreachable directory import alias does not expand package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', "import {readdirSync as scanDirectory} from 'node:fs';\nscanDirectory(new URL('../', import.meta.url));\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('quoted and escaped directory import names retain helpers Node actually loads', () => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    const names = [api.replace('r', '\\u0072'), `'${api}'`, `"${api}"`,
      `'${api.replace('r', '\\x72')}'`, `"${api.replace('r', '\\u{72}')}"`,
      `'${api.slice(0, 2)}\\\n${api.slice(2)}'`];
    for (const name of names) fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('encoded alias helper loaded');\n");
      write('packages/portal/src/index.mjs', `import {${name} as scanDirectory} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
for await (const item of await scanDirectory(new URL('../../../', import.meta.url))) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'encoded alias helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], name);
      assert.match(result.reason, /Unresolved directory import alias at packages\/portal\/src\/index\.mjs/);
    });
  }
});

test('large escaped source strings cannot trap package selection in backtracking', () => {
  for (const text of ['\\'.repeat(50_000), 'a'.repeat(100_000)]) fixture(({root, write, commit}) => {
    write('packages/portal/src/index.mjs', `export const text = ${JSON.stringify(text)};\n`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '');
    const program = `import {execFileSync} from 'node:child_process';
import {scopeForRevisions} from ${JSON.stringify(new URL('./ci-package-revisions.mjs', import.meta.url).href)};
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});
console.log(JSON.stringify(scopeForRevisions(['packages/catalogue/src/index.mjs'], ${JSON.stringify(loadWorkspace(root))}, '${base}', '${head}', git)));
`;
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program],
    {cwd: root, encoding: 'utf8', timeout: 5_000})), {full: false, packages: ['catalogue']});
  });
});

test('an ordinary escaped token does not borrow as from later unrelated text', () => fixture(({write, commit, plan}) => {
  write('packages/portal/src/index.mjs', `export const path = ${JSON.stringify('\\')};\nconst label = 'unrelated as text';\n`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));

test('indirect directory calls retain consumers of helpers Node actually loads', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const binding of ['optional', 'call', 'apply', 'bind']) await t.test(`${api} ${binding}`, () => fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('indirect helper loaded');\n");
      const directory = "new URL('../../../', import.meta.url)";
      const invocation = binding === 'optional' ? `${api}?.(${directory})`
        : binding === 'call' ? `${api}.call(null, ${directory})`
        : binding === 'apply' ? `${api}.apply(null, [${directory}])`
        : `${api}.bind(null)(${directory})`;
      write('packages/portal/src/index.mjs', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
for await (const item of await ${invocation}) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'indirect helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], `${api} ${binding}`);
      assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/index\.mjs/);
    }));
  }
});

test('indirect directory syntax variants retain actual helper consumers', () => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const suffix of ["['call']", '?.call', '. /* method */ call', ' // method\n.call']) fixture(({root, write, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('member helper loaded');\n");
      write('packages/portal/src/index.mjs', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
for await (const item of await ${api}${suffix}(null, new URL('../../../', import.meta.url))) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'member helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], `${api} ${suffix}`);
      assert.match(result.reason, /Unresolved indirect directory call at packages\/portal\/src\/index\.mjs/);
    });
  }
});

test('saved indirect directory helpers retain full work from either revision', () => {
  for (const [api, invocation] of [
    ['readdirSync', 'readdirSync?.(directory)'],
    ['readdir', 'readdir.call(null, directory)'],
    ['opendirSync', 'opendirSync.apply(null, [directory])'],
    ['opendir', 'opendir.bind(null)(directory)'],
  ]) for (const revision of ['base', 'head']) fixture(({root, git, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved indirect helper loaded');\n");
    const reader = `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../', import.meta.url);
for await (const item of await ${invocation}) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('tools/scan.mjs', revision === 'base' ? reader : 'export const value = 1;\n');
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision === 'base') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved indirect helper loaded\n');
    write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision === 'head') assert.equal(execFileSync(process.execPath, ['packages/gateway/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved indirect helper loaded\n');
    write('tools/scan.mjs', 'export const changedLocally = true;\n');
    write('catalogue-adapter.mjs', 'export const changedLocally = true;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      /Unresolved indirect directory call at tools\/scan\.mjs/, `${api} ${revision}`);
    const result = plan(base, head, read);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    assert.match(result.reason, /full suite.*tools\/scan\.mjs/);
  });
});

test('unreachable indirect directory helpers preserve narrow package work', () => fixture(({write, commit, plan}) => {
  write('tools/unused.mjs', `import {readdirSync, opendirSync} from 'node:fs';
import {readdir, opendir} from 'node:fs/promises';
const directory = new URL('../', import.meta.url);
readdirSync?.(directory);
readdir.call(null, directory);
opendirSync.apply(null, [directory]);
opendir.bind(null)(directory);
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue']);
}));
