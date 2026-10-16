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

test('unresolved glob scans retain packages whose helpers they actually load', () => {
  for (const api of ['globSync', 'glob']) for (const binding of ['direct', 'stored', 'default', 'absolute']) fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('glob helper loaded');\n");
    const directory = "new URL('../../../', import.meta.url)";
    const args = binding === 'default' ? "'*.mjs'" : binding === 'absolute'
      ? "new URL('../../../*.mjs', import.meta.url).pathname"
      : `'*.mjs', {cwd: ${binding === 'stored' ? 'directory' : directory}}`;
    write('packages/portal/src/index.mjs', `import {${api}} from '${api === 'glob' ? 'node:fs/promises' : 'node:fs'}';
import {pathToFileURL} from 'node:url';
${binding === 'stored' ? `const directory = ${directory};` : ''}
for await (const name of ${api} /* scan */ (${args})) {
  await import(${binding === 'absolute' ? 'pathToFileURL(name)' : `new URL('../../../' + name, import.meta.url)`});
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'glob helper loaded\n');
    const result = plan(base, head);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], `${api} ${binding}`);
    assert.match(result.reason, /Unverified package revisions:.*Unresolved glob scan at packages\/portal\/src\/index\.mjs.*full package suite/s);
  });
});

test('glob readers in saved helpers keep full package work from either revision', () => {
  for (const api of ['globSync', 'glob']) for (const revision of ['base', 'head']) fixture(({root, git, write, commit}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved glob helper loaded');\n");
    const reader = `import {${api}} from '${api === 'glob' ? 'node:fs/promises' : 'node:fs'}';
for await (const name of ${api}('*.mjs', {cwd: new URL('../', import.meta.url)})) {
  await import(new URL('../' + name, import.meta.url));
}
`;
    write('tools/scan.mjs', revision === 'base' ? reader : 'export const value = 1;\n');
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision === 'base') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved glob helper loaded\n');
    write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision === 'head') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved glob helper loaded\n');
    write('tools/scan.mjs', 'export const value = 3;\n');
    write('catalogue-adapter.mjs', 'export const value = 3;\n');
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
      /Unresolved glob scan at tools\/scan\.mjs/, `${api} ${revision}`);
  });
});

test('root directory APIs retain helpers loaded by real immediate-entry scans', () => {
  for (const [api, module, entry] of [
    ['readdir', 'node:fs/promises', 'item'],
    ['opendir', 'node:fs/promises', 'item.name'],
    ['opendirSync', 'node:fs', 'item.name'],
  ]) for (const binding of ['direct', 'stored']) fixture(({root, git, write, commit}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('root helper loaded');\n");
    write('nested/unrelated-adapter.mjs', "import '../packages/unrelated/src/index.mjs';\n");
    const directory = "new URL('../../../', import.meta.url)";
    write('packages/portal/src/index.mjs', `import {${api}} from '${module}';
${binding === 'stored' ? `const directory = ${directory};` : ''}
for await (const item of await ${api}(${binding === 'direct' ? directory : 'directory'})) {
  const name = ${entry};
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'root helper loaded\n');
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
      {full: false, packages: ['catalogue', 'portal']}, `${api} ${binding}`);
    assert.deepEqual(scopeForRevisions(['packages/unrelated/src/index.mjs'], loadWorkspace(root), base, head, git),
      {full: false, packages: ['unrelated']}, `${api} ${binding}`);
  });
});

test('directory API options keep every package when a root scan is unresolved', () => {
  for (const [api, module, entry] of [
    ['readdir', 'node:fs/promises', 'item'],
    ['opendir', 'node:fs/promises', 'item.name'],
    ['opendirSync', 'node:fs', 'item.name'],
  ]) for (const binding of ['direct', 'stored']) fixture(({root, write, commit, plan}) => {
    write('adapters/catalogue-reader.mjs', "import '../packages/catalogue/src/index.mjs';\nconsole.log('nested helper loaded');\n");
    const directory = "new URL('../../../', import.meta.url)";
    write('packages/portal/src/index.mjs', `import {${api}} from '${module}';
import {pathToFileURL} from 'node:url';
${binding === 'stored' ? `const directory = ${directory};` : ''}
for await (const item of await ${api}(${binding === 'direct' ? directory : 'directory'}, {recursive: true})) {
  const name = ${entry};
  if (name.endsWith('-reader.mjs')) {
    const target = typeof item === 'string' ? new URL(item, new URL('../../../', import.meta.url)) : pathToFileURL(item.parentPath + '/' + item.name);
    await import(target);
  }
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'nested helper loaded\n');
    const result = plan(base, head);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], `${api} ${binding}`);
    assert.equal(result.receipts.length, 5);
    assert.match(result.reason, /Unverified package revisions:.*repository-root directory scan options at packages\/portal\/src\/index\.mjs.*full package suite/s);
  });
});

test('directory API readers in saved helpers survive either revision and dirty local files', () => {
  for (const api of ['readdir', 'opendir', 'opendirSync']) for (const revision of ['base', 'head']) fixture(({root, git, write, commit}) => {
    const reader = `import {${api}} from '${api === 'opendirSync' ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL('../', import.meta.url);
for await (const item of await ${api}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('saved helper loaded');\n");
    write('tools/scan.mjs', revision === 'base' ? reader : 'export const value = 1;\n');
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    if (revision === 'base') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved helper loaded\n');
    write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 2;\n');
    const head = commit();
    if (revision === 'head') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'saved helper loaded\n');
    write('tools/scan.mjs', 'export const value = 3;\n');
    write('catalogue-adapter.mjs', 'export const value = 3;\n');
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
      {full: false, packages: ['catalogue', 'gateway', 'portal']}, `${api} ${revision}`);
  });
});

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

test('an unchanged committed transitive reader survives dirty local import removal', () => fixture(({write, commit, plan}) => {
  write('packages/gateway/src/index.mjs', "import '../../catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', "import '../../gateway/src/index.mjs';\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
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
      if (fault === 'malformed-tree') assert.match(result.reason, /Malformed package tree inventory/);
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

test('revision graph callers cannot substitute mutable Git revision names for commit IDs', () => fixture(({root, git, commit}) => {
  const sha = commit(), members = loadWorkspace(root);
  for (const [base, head] of [['HEAD', sha], [sha, 'HEAD']]) {
    assert.throws(() => scopeForRevisions(['packages/catalogue/src/index.mjs'], members, base, head, git), {code: 'ERR_ASSERTION'});
  }
}));

test('a path above the repository cannot become a sibling package input', () => fixture(({root, write, commit}) => {
  write('packages/gateway/src/index.mjs', "import '../../../../packages/catalogue/src/index.mjs';\n");
  commit();
  assert.deepEqual(scopeForPaths(['packages/catalogue/src/index.mjs'], loadWorkspace(root)),
    {full: false, packages: ['catalogue']});
}));

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


test('batch-capable Git readers preserve removed consumers without per-blob processes', () => fixture(({root, git, write, commit}) => {
  write('packages/gateway/src/index.mjs', "import '../../catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', "import '../../gateway/src/index.mjs';\n");
  const base = commit();
  write('packages/gateway/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  const read = (...args) => {
    assert.notEqual(args[0], 'show', 'Batch reader must not spawn one process per blob');
    return git(...args);
  };
  read.readBlobs = ids => new Map(ids.map(id => [id, git('show', id)]));
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
    {full: false, packages: ['catalogue', 'gateway', 'portal']});
}));


test('the real Git batch protocol reads binary-framed UTF-8 blobs and deduplicates requests', () => fixture(({git, write, commit, root}) => {
  const content = 'café\n\0literal header blob 999\n';
  write('packages/catalogue/src/unusual name.mjs', content);
  const head = commit();
  const id = git('rev-parse', `${head}:packages/catalogue/src/unusual name.mjs`).trim();
  let calls = 0;
  const result = packageInputs.readGitBlobs([id, id], input => {
    calls++;
    assert.equal(input, `${id}\n`);
    return execFileSync('git', ['cat-file', '--batch'], {cwd: root, input});
  });
  assert.deepEqual([...result], [[id, content]]);
  assert.equal(calls, 1);
}));

test('malformed or incomplete batch evidence keeps every package with an explicit reason', () => fixture(({git, write, commit, plan, root}) => {
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  for (const damage of ['missing', 'non-ascii-header', 'wrong-id', 'wrong-type', 'wrong-size', 'short-body', 'separator', 'trailing', 'corrupted-content', 'not-buffer']) {
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => {
      const bytes = execFileSync('git', ['cat-file', '--batch'], {cwd: root, input});
      const newline = bytes.indexOf(10);
      const header = bytes.subarray(0, newline).toString();
      if (damage === 'non-ascii-header') {bytes[0] |= 128; return bytes;}
      if (damage === 'missing') return Buffer.from(`${ids[0]} missing\n`);
      if (damage === 'wrong-id') return Buffer.concat([Buffer.from('0'.repeat(40)), bytes.subarray(40)]);
      if (damage === 'wrong-type') return Buffer.concat([Buffer.from(header.replace(' blob ', ' tree ')), bytes.subarray(newline)]);
      if (damage === 'wrong-size') return Buffer.concat([Buffer.from(header.replace(/ \d+$/, ' 9007199254740992')), bytes.subarray(newline)]);
      if (damage === 'short-body') return bytes.subarray(0, newline + 2);
      if (damage === 'separator') { bytes[newline + 1 + Number(header.split(' ')[2])] = 0; return bytes; }
      if (damage === 'trailing') return Buffer.concat([bytes, Buffer.from('unexpected')]);
      if (damage === 'corrupted-content') {bytes[newline + 1] ^= 1; return bytes;}
      return bytes.toString();
    });
    const result = plan(base, head, read);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], damage);
    assert.match(result.reason, /Unverified package revisions:.*batch.*full package suite/is, damage);
  }
}));


test('the real planner command batches both saved revisions and retains former readers', () => fixture(({root, git, write, commit}) => {
  write('packages/gateway/src/index.mjs', "import '../../catalogue/src/index.mjs';\n");
  const base = commit();
  write('packages/gateway/src/index.mjs', 'export const value = 2;\n');
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  const event = join(root, 'event.json');
  const output = join(root, 'outputs.txt');
  const trace = join(root, 'git-trace.log');
  writeFileSync(event, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
  execFileSync(process.execPath, [new URL('./ci-plan.mjs', import.meta.url).pathname], {
    cwd: root, env: {...process.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output,
      GITHUB_SHA: head, GITHUB_REPOSITORY: 'waitron-io/waitron-cloud', GITHUB_REF_NAME: 'fixture', GIT_TRACE: trace},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = JSON.parse(readFileSync(output, 'utf8').split('\n').find(line => line.startsWith('plan=')).slice(5));
  assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway']);
  assert.equal((readFileSync(trace, 'utf8').match(/built-in: git cat-file --batch\n/g) ?? []).length, 2);
}));


test('absent batch results or a failed command in either revision cannot hide a consumer', () => fixture(({git, write, commit, plan, root}) => {
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  for (const failedRevision of [1, 2]) for (const fault of ['no-map', 'missing-blob', 'command-error']) {
    let revision = 0;
    const read = (...args) => git(...args);
    read.readBlobs = ids => {
      if (++revision === failedRevision) {
        if (fault === 'command-error') throw Error('Git batch command failed');
        return fault === 'no-map' ? null : new Map();
      }
      return packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    };
    const result = plan(base, head, read);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], `${failedRevision} ${fault}`);
    assert.match(result.reason, /Unverified package revisions:.*batch.*full package suite/is);
  }
}));


test('batched objects retain the legacy one-MiB per-file fallback', () => fixture(({root, git, write, commit, plan}) => {
  write('packages/gateway/src/large.mjs', '/*' + 'x'.repeat(1024 * 1024) + "*/\nimport '../../catalogue/src/index.mjs';\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  const read = (...args) => git(...args);
  read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input, maxBuffer: 64 * 1024 * 1024}));
  const expected = ['catalogue', 'gateway', 'portal', 'unrelated'];
  assert.deepEqual(plan(base, head).packages.map(row => row.package), expected);
  const result = plan(base, head, read);
  assert.deepEqual(result.packages.map(row => row.package), expected);
  assert.match(result.reason, /Unverified package revisions:.*batch.*full package suite/is);
}));


test('real source symlinks and submodules retain full package work with a batch reader', () => {
  for (const kind of ['symbolic-link', 'submodule']) fixture(({root, git, write, commit, plan}) => {
    const base = commit();
    const members = loadWorkspace(root);
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    if (kind === 'symbolic-link') symlinkSync('index.mjs', join(root, 'packages/portal/src/linked.mjs'));
    git('add', '.');
    if (kind === 'submodule') git('update-index', '--add', '--cacheinfo', `160000,${base},packages/portal/reader.mjs`);
    git('commit', '-sm', 'Nonregular input fixture');
    const head = git('rev-parse', 'HEAD').trim();
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    const result = plan(base, head, read, members);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], kind);
    assert.match(result.reason, /Unverified package revisions:.*full package suite/s);
  });
});


test('package changes retain consumers reached through root helpers in both revisions', () => fixture(({root, git, write, commit, plan}) => {
  write('scripts/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.mjs';\n");
  write('scripts/adapter-entry.mjs', "import './catalogue-adapter.mjs';\n");
  write('packages/portal/src/index.mjs', "import '../../../scripts/adapter-entry.mjs';\n");
  const base = commit();
  write('scripts/catalogue-adapter.mjs', 'export const value = 2;\n');
  const head = commit();
  // Query the provider alone so the helper edit cannot force a full diff fallback.
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue', 'portal']});
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const providerHead = commit();
  const result = plan(base, providerHead, (...args) => args[0] === 'diff'
    ? 'packages/catalogue/src/index.mjs\0' : git(...args));
  assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'portal']);
}));

test('head-only root helper readers include transitive package dependents and terminate cycles', () => fixture(({root, git, write, commit}) => {
  const base = commit();
  write('scripts/adapter.mjs', "import './cycle.mjs'; import '../packages/catalogue/src/index.mjs';\n");
  write('scripts/cycle.mjs', "import './adapter.mjs';\n");
  write('packages/gateway/src/index.mjs', "import '../../../scripts/adapter.mjs';\n");
  write('packages/portal/src/index.mjs', "import '../../gateway/src/index.mjs';\n");
  const head = commit();
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue', 'gateway', 'portal']});
}));


test('typed helper imports retain their source readers when emitted JavaScript paths are used', () => fixture(({root, git, write, commit}) => {
  write('scripts/adapter.ts', "import '../packages/catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', "import '../../../scripts/adapter.js';\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue', 'portal']});
}));


test('unreferenced helpers do not add package consumers', () => fixture(({root, git, write, commit}) => {
  write('scripts/unused.mjs', "import '../packages/catalogue/src/index.mjs';\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue']});
}));

test('the planner command follows immutable helper readers despite dirty source and batches both trees', () => fixture(({root, git, write, commit}) => {
  write('scripts/adapter.mjs', "import '../packages/catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', "import '../../../scripts/adapter.mjs';\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  write('scripts/adapter.mjs', 'export const value = 3;\n');
  const event = join(root, 'event.json'), output = join(root, 'outputs.txt'), trace = join(root, 'git-trace.log');
  writeFileSync(event, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
  execFileSync(process.execPath, [new URL('./ci-plan.mjs', import.meta.url).pathname], {
    cwd: root, env: {...process.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_SHA: head,
      GITHUB_REPOSITORY: 'waitron-io/waitron-cloud', GITHUB_REF_NAME: 'fixture', GIT_TRACE: trace},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = JSON.parse(readFileSync(output, 'utf8').split('\n').find(line => line.startsWith('plan=')).slice(5));
  assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'portal']);
  assert.equal((readFileSync(trace, 'utf8').match(/built-in: git cat-file --batch\n/g) ?? []).length, 2);
}));

test('missing helper evidence in either tree retains every package', () => fixture(({root, git, write, commit, plan}) => {
  write('scripts/adapter.mjs', "import '../packages/catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', "import '../../../scripts/adapter.mjs';\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  const validRead = (...args) => git(...args);
  validRead.readBlobs = ids => packageInputs.readGitBlobs(ids,
    input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
  assert.deepEqual(plan(base, head, validRead).packages.map(row => row.package), ['catalogue', 'portal']);
  const id = git('rev-parse', `${base}:scripts/adapter.mjs`).trim();
  for (const revision of [1, 2]) {
    let current = 0;
    const read = (...args) => git(...args);
    read.readBlobs = ids => {
      const result = packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
      if (++current === revision) result.delete(id);
      return result;
    };
    const result = plan(base, head, read);
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated']);
    assert.match(result.reason, /Unverified package revisions:.*Missing batched package input: scripts\/adapter.mjs.*full package suite/s);
  }
}));


test('directory helper entry points retain package readers', () => {
  for (const entry of ['index.mjs', 'index.ts']) fixture(({root, git, write, commit}) => {
    write(`scripts/helpers/${entry}`, "import '../catalogue-adapter.mjs';\n");
    write('scripts/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.mjs';\n");
    write('packages/portal/src/index.mjs', "import '../../../scripts/helpers';\n");
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
      {full: false, packages: ['catalogue', 'portal']});
  });
});

test('JavaScript and JSX helper imports retain TSX source readers', () => {
  for (const extension of ['js', 'jsx']) fixture(({root, git, write, commit}) => {
    write('scripts/adapter.tsx', "import '../packages/catalogue/src/index.mjs';\n");
    write('packages/portal/src/index.mjs', `import '../../../scripts/adapter.${extension}';\n`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
      {full: false, packages: ['catalogue', 'portal']});
  });
});

test('mixed quote marks cannot hide package imports or helper chains', () => fixture(({root, git, write, commit}) => {
  write('packages/gateway/src/index.mjs', `const text = "it's"; import '../../catalogue/src/index.mjs';\n`);
  write('scripts/adapter.mjs', `const text = "it's"; import '../packages/catalogue/src/index.mjs';\n`);
  write('packages/portal/src/index.mjs', `const text = "it's"; import '../../../scripts/adapter.mjs';\n`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(scopeForPaths(['packages/catalogue/src/index.mjs'], loadWorkspace(root)),
    {full: false, packages: ['catalogue', 'gateway']});
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue', 'gateway', 'portal']});
}));


test('quoted generated programs retain the broad scanner consumer floor', () => fixture(({root, git, write, commit}) => {
  write('scripts/adapter.mjs', "const program = `const text=\"it's\"; import '../packages/catalogue/src/index.mjs';`;\n");
  write('packages/portal/src/index.mjs', "import '../../../scripts/adapter.mjs';\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue', 'portal']});
}));

test('a package scanning a root helper directory retains the loaded package consumer', () => fixture(({root, write, commit, plan}) => {
  write('scripts/readers/catalogue.mjs', "import '../catalogue-adapter.mjs';\nconsole.log('catalogue reader loaded');\n");
  write('scripts/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', `import {readdirSync} from 'node:fs';
const directory = new URL('../../../scripts/readers/', import.meta.url);
for (const name of readdirSync(directory)) await import(new URL(name, directory));
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'catalogue reader loaded\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'portal']);
}));

test('saved helper directories retain removed and newly added readers despite dirty local files', () => {
  for (const revision of ['base', 'head']) fixture(({root, git, write, commit}) => {
    const reader = "import '../packages/catalogue/src/index.mjs';\n";
    write('scripts/reader set/nested/adapter.mjs', "import '../../catalogue-adapter.mjs';\nimport '../cycle.mjs';\n");
    write('scripts/reader set/cycle.mjs', "import './cycle.mjs';\n");
    write('scripts/reader set-other/adapter.mjs', "import '../../packages/unrelated/src/index.mjs';\n");
    write('scripts/catalogue-adapter.mjs', revision === 'base' ? reader : 'export const value = 0;\n');
    write('packages/portal/src/index.mjs', "const directory = new URL('../../../scripts/reader set', import.meta.url);\n");
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    const base = commit();
    write('scripts/catalogue-adapter.mjs', revision === 'head' ? reader : 'export const value = 0;\n');
    const head = commit();
    write('scripts/reader set/nested/adapter.mjs', 'export const value = 0;\n');
    write('scripts/catalogue-adapter.mjs', 'export const value = 0;\n');
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
      {full: false, packages: ['catalogue', 'gateway', 'portal']}, revision);
    assert.deepEqual(scopeForRevisions(['packages/unrelated/src/index.mjs'], loadWorkspace(root), base, head, git),
      {full: false, packages: ['unrelated']}, revision);
  });
});

test('new and deleted helper files under a root-relative directory retain their consumers', () => {
  for (const change of ['add', 'delete']) fixture(({root, git, write, commit}) => {
    write('packages/portal/src/index.mjs', "const directory = 'scripts/readers/';\n");
    if (change === 'delete') write('scripts/readers/adapter.mjs', "import '../../packages/catalogue/src/index.mjs';\n");
    const base = commit();
    if (change === 'add') write('scripts/readers/adapter.mjs', "import '../../packages/catalogue/src/index.mjs';\n");
    else rmSync(join(root, 'scripts/readers/adapter.mjs'));
    const head = commit();
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      {full: false, packages: ['catalogue', 'portal']}, change);
  });
});

test('shared directory discovery preserves actual portal isolation and identity consumers', () => {
  const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  git.readBlobs = packageInputs.readGitBlobs;
  const sha = git('rev-parse', 'HEAD').trim(), workspace = loadWorkspace();
  assert.deepEqual(scopeForRevisions(['apps/portal/src/app.ts'], workspace, sha, sha, git),
    {full: false, packages: ['@waitron-cloud/portal']});
  assert.deepEqual(scopeForRevisions(['packages/identity/src/index.ts'], workspace, sha, sha, git).packages,
    ['@waitron-cloud/account-http', '@waitron-cloud/backups', '@waitron-cloud/fiscal-allocation', '@waitron-cloud/identity',
      '@waitron-cloud/operations', '@waitron-cloud/portal', '@waitron-cloud/registration', '@waitron-cloud/remote-access', '@waitron-cloud/ui-smoke']);
});

test('equivalent root-relative directory spellings retain the same helper consumers', () => {
  for (const directory of ['scripts/./readers', 'scripts/readers//', 'scripts/readers/../readers']) fixture(({root, write, commit, plan}) => {
    write('scripts/readers/adapter.mjs', "import '../../packages/catalogue/src/index.mjs';\nconsole.log('catalogue reader loaded');\n");
    write('packages/portal/src/index.mjs', `import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const directory = '${directory}';
for (const name of readdirSync(directory)) await import(pathToFileURL(resolve(directory, name)));
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'catalogue reader loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'portal'], directory);
  });
});


test('equivalent root-relative package files retain live and saved consumers', () => {
  for (const input of ['packages/./catalogue/src/index.mjs', 'packages/catalogue//src/index.mjs',
    'packages/catalogue/src/../src/index.mjs', 'packages/portal/../catalogue/src/index.mjs']) fixture(({root, git, write, commit}) => {
    write('packages/catalogue/src/index.mjs', "console.log('catalogue loaded');\n");
    write('packages/portal/src/index.mjs', `import {pathToFileURL} from 'node:url';
await import(pathToFileURL('${input}'));
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', "console.log('catalogue changed');\n");
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'catalogue changed\n');
    assert.deepEqual(scopeForPaths(['packages/catalogue/src/index.mjs'], loadWorkspace(root)),
      {full: false, packages: ['catalogue', 'portal']}, input);
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
      {full: false, packages: ['catalogue', 'portal']}, input);
  });
});

test('equivalent root-relative helper files retain their package consumers in both saved trees', () => {
  for (const input of ['scripts/./adapter.mjs', 'scripts//adapter.mjs', 'scripts/nested/../adapter.mjs']) {
    for (const revision of ['base', 'head']) fixture(({root, git, write, commit, plan}) => {
      mkdirSync(join(root, 'scripts/nested'), {recursive: true});
      const reader = "import '../packages/catalogue/src/index.mjs';\nconsole.log('helper loaded');\n";
      write('scripts/adapter.mjs', revision === 'base' ? reader : 'export const value = 0;\n');
      write('packages/portal/src/index.mjs', `import {pathToFileURL} from 'node:url';
await import(pathToFileURL('${input}'));
`);
      write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
      const base = commit();
      if (revision === 'base') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'helper loaded\n');
      write('scripts/adapter.mjs', revision === 'head' ? reader : 'export const value = 0;\n');
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      if (revision === 'head') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'helper loaded\n');
      write('scripts/adapter.mjs', 'export const value = 0;\n');
      assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
        {full: false, packages: ['catalogue', 'gateway', 'portal']}, input + ' ' + revision);
      const result = plan(base, head, (...args) => args[0] === 'diff' ? 'packages/catalogue/src/index.mjs\0' : git(...args));
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal'], input + ' ' + revision);
    });
  }
});


test('a normalized path crossing package directories selects the loaded provider instead of the discarded prefix', () => fixture(({root, git, write, commit}) => {
  write('packages/unrelated/src/index.mjs', "console.log('unrelated loaded');\n");
  write('packages/portal/src/index.mjs', `import {pathToFileURL} from 'node:url';
await import(pathToFileURL('packages/catalogue/../unrelated/src/index.mjs'));
`);
  write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
  const base = commit();
  write('packages/unrelated/src/index.mjs', "console.log('unrelated changed');\n");
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'unrelated changed\n');
  for (const [path, expected] of [
    ['packages/catalogue/src/index.mjs', ['catalogue']],
    ['packages/unrelated/src/index.mjs', ['gateway', 'portal', 'unrelated']],
  ]) {
    assert.deepEqual(scopeForPaths([path], loadWorkspace(root)), {full: false, packages: expected});
    assert.deepEqual(scopeForRevisions([path], loadWorkspace(root), base, head, git), {full: false, packages: expected});
  }
}));

test('unresolved root-relative package templates retain possible consumers after parent normalization', () => fixture(({root, git, write, commit}) => {
  write('packages/unrelated/src/index.mjs', "console.log('unrelated loaded');\n");
  write('packages/portal/src/index.mjs', `import {pathToFileURL} from 'node:url';
const name = process.argv[2];
await import(pathToFileURL(\`packages/catalogue/../\${name}/src/index.mjs\`));
`);
  write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
  const base = commit();
  write('packages/unrelated/src/index.mjs', "console.log('unrelated changed');\n");
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs', 'unrelated'], {cwd: root, encoding: 'utf8'}), 'unrelated changed\n');
  for (const [path, expected] of [
    ['packages/catalogue/src/index.mjs', ['catalogue', 'gateway', 'portal']],
    ['packages/unrelated/src/index.mjs', ['gateway', 'portal', 'unrelated']],
  ]) {
    assert.deepEqual(scopeForPaths([path], loadWorkspace(root)), {full: false, packages: expected});
    assert.deepEqual(scopeForRevisions([path], loadWorkspace(root), base, head, git), {full: false, packages: expected});
  }
}));


test('a direct repository-root directory scan retains the package loaded through a root helper', () => fixture(({root, write, commit, plan}) => {
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('root helper loaded');\n");
  write('packages/portal/src/index.mjs', `import {readdirSync} from 'node:fs';
for (const name of readdirSync(new URL('../../../', import.meta.url))) {
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'root helper loaded\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'portal']);
}));


test('root scans keep old and new immediate helpers without traversing nested directories', () => {
  for (const change of ['add', 'delete']) fixture(({root, git, write, commit}) => {
    write('packages/portal/src/index.mjs', `import {readdirSync} from 'node:fs';
for (const name of readdirSync(new URL('../../.././', import.meta.url))) {
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}
`);
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    write('nested/unrelated-adapter.mjs', "import '../packages/unrelated/src/index.mjs';\n");
    if (change === 'delete') write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\n");
    const base = commit();
    if (change === 'add') write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\n");
    else rmSync(join(root, 'catalogue-adapter.mjs'));
    const head = commit();
    write('catalogue-adapter.mjs', 'export const value = 0;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      {full: false, packages: ['catalogue', 'gateway', 'portal']}, change);
    assert.deepEqual(scopeForRevisions(['packages/unrelated/src/index.mjs'], loadWorkspace(root), base, head, read),
      {full: false, packages: ['unrelated']}, change);
  });
});

test('a repository-root command working directory alone does not load root helper inputs', () => fixture(({root, git, write, commit}) => {
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', `import {execFileSync} from 'node:child_process';
execFileSync(process.execPath, ['--version'], {cwd: new URL('../../../', import.meta.url)});
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root});
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue']});
}));


test('trailing commas in direct root directory calls retain the runtime-loaded consumer', () => {
  for (const call of [
    "readdirSync(\n  new URL('../../../', import.meta.url),\n)",
    "readdirSync(new URL('../../../', import.meta.url,))",
    "readdirSync(\n  new URL('../../../', import.meta.url,),\n)",
  ]) fixture(({root, write, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('root helper loaded');\n");
    write('packages/portal/src/index.mjs', `import {readdirSync} from 'node:fs';
for (const name of ${call}) {
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'root helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'portal'], call);
  });
});

test('root directory variables retain the package loaded by a real nonrecursive scan', () => {
  for (const declaration of ['const directory', 'let $root', 'var root_2']) fixture(({root, git, write, commit, plan}) => {
    const name = declaration.split(' ')[1];
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('root helper loaded');\n");
    write('nested/unrelated-adapter.mjs', "import '../packages/unrelated/src/index.mjs';\n");
    write('packages/portal/src/index.mjs', `import {readdirSync} from 'node:fs';
${declaration} = new URL('../../.././', import.meta.url,);
for (const name of readdirSync(${name},)) {
  if (name.endsWith('.mjs')) await import(new URL(name, ${name}));
}
`);
    const base = commit();
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'root helper loaded\n');
    assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'portal'], declaration);
    assert.deepEqual(scopeForRevisions(['packages/unrelated/src/index.mjs'], loadWorkspace(root), base, head, git),
      {full: false, packages: ['unrelated']}, declaration);
  });
});

test('saved root directory variables retain added and removed helpers and former transitive readers', () => {
  for (const [readerRevision, change] of [['both', 'add'], ['both', 'delete'], ['base', 'unchanged'], ['head', 'unchanged']]) fixture(({root, git, write, commit}) => {
    const reader = `import {readdirSync} from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for (const name of readdirSync(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`;
    write('packages/gateway/src/index.mjs', "import '../../portal/src/index.mjs';\n");
    if (readerRevision !== 'head') write('packages/portal/src/index.mjs', reader);
    if (change !== 'add') write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\n");
    const base = commit();
    write('packages/portal/src/index.mjs', readerRevision !== 'base' ? reader : 'export const value = 2;\n');
    if (change === 'add') write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\n");
    else if (change === 'delete') rmSync(join(root, 'catalogue-adapter.mjs'));
    const head = commit();
    write('packages/portal/src/index.mjs', 'export const value = 3;\n');
    write('catalogue-adapter.mjs', 'export const value = 3;\n');
    const read = (...args) => git(...args);
    read.readBlobs = ids => packageInputs.readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input}));
    assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, read),
      {full: false, packages: ['catalogue', 'gateway', 'portal']}, `${readerRevision} ${change}`);
  });
});

test('a stored root command working directory does not imply a helper scan', () => fixture(({root, git, write, commit}) => {
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', `import {execFileSync} from 'node:child_process';
const directory = new URL('../../../', import.meta.url);
execFileSync(process.execPath, ['--version'], {cwd: directory});
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root});
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue']});
}));

test('typed root URL declarations retain their runtime-loaded package consumer', () => fixture(({root, write, commit, plan}) => {
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('root helper loaded');\n");
  write('packages/portal/src/scan.ts', `import {readdirSync} from 'node:fs';
const directory: URL = new URL('../../../', import.meta.url);
for (const name of readdirSync(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/scan.ts'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}), 'root helper loaded\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'portal']);
}));

test('later bindings in a root URL declaration retain their runtime-loaded package consumer', () => fixture(({root, write, commit, plan}) => {
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('root helper loaded');\n");
  write('packages/portal/src/index.mjs', `import {readdirSync} from 'node:fs';
const suffix = '.mjs', directory = new URL('../../../', import.meta.url);
for (const name of readdirSync(directory)) {
  if (name.endsWith(suffix)) await import(new URL(name, directory));
}
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'root helper loaded\n');
  assert.deepEqual(plan(base, head).packages.map(row => row.package), ['catalogue', 'portal']);
}));

test('checking root directory existence alone does not load root helpers', () => fixture(({root, git, write, commit}) => {
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\n");
  write('packages/portal/src/index.mjs', `import {existsSync} from 'node:fs';
const directory = new URL('../../../', import.meta.url);
console.log(existsSync(directory));
`);
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'true\n');
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue']});
}));

test('a shared helper scanning its own directory does not scan repository-root helpers', () => fixture(({root, git, write, commit}) => {
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.mjs';\nconsole.log('root helper loaded');\n");
  write('tools/venue-adapter.mjs', "console.log('local helper loaded');\n");
  write('tools/scan.mjs', `import {readdirSync} from 'node:fs';
const directory = new URL('./', import.meta.url);
for (const name of readdirSync(directory)) {
  if (name === 'venue-adapter.mjs') await import(new URL(name, directory));
}
`);
  write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'local helper loaded\n');
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue']});
}));


test('root scans with options cannot omit runtime-loaded helper consumers', () => {
  for (const binding of ['direct', 'stored']) {
    for (const [options, helper, entry] of [
      ['{recursive: true}', 'adapters/catalogue-reader.mjs', "name"],
      ["'utf8'", 'catalogue-reader.mjs', "name"],
      ['{withFileTypes: true}', 'catalogue-reader.mjs', "name.name"],
      ['options', 'adapters/catalogue-reader.mjs', "name"],
    ]) fixture(({root, write, commit, plan}) => {
      const directory = "new URL('../../../', import.meta.url)";
      const call = `readdirSync(${binding === 'direct' ? directory : 'directory'}, ${options})`;
      write(helper, `import '${helper.includes('/') ? '../' : './'}packages/catalogue/src/index.mjs';\nconsole.log('options helper loaded');\n`);
      write('packages/portal/src/index.mjs', `import {readdirSync} from 'node:fs';
const options = JSON.parse(process.argv[2] || '{}');
${binding === 'stored' ? `const directory = ${directory};` : ''}
for (const name of ${call}) {
  const entry = ${entry};
  if (entry.endsWith('-reader.mjs')) await import(new URL('../../../' + entry, import.meta.url));
}
`);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs', '{"recursive":true}'],
        {cwd: root, encoding: 'utf8'}), 'options helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], binding + ' ' + options);
      assert.equal(result.receipts.length, 5);
      assert.match(result.reason, /Unverified package revisions:.*repository-root directory scan options.*packages\/portal\/src\/index\.mjs.*full package suite/s);
    });
  }
});


test('root scan options in saved shared helpers require full work from either revision', () => {
  for (const revision of ['base', 'head']) fixture(({root, git, write, commit, plan}) => {
    const reader = `import {readdirSync} from 'node:fs';
const directory = new URL('../', import.meta.url);
for (const name of readdirSync(directory, {recursive: true})) {
  if (name.endsWith('catalogue-reader.mjs')) await import(new URL(name, directory));
}
`;
    write('adapters/catalogue-reader.mjs', "import '../packages/catalogue/src/index.mjs';\nconsole.log('shared options helper loaded');\n");
    write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
    write('tools/scan.mjs', revision === 'base' ? reader : 'export const value = 0;\n');
    const base = commit();
    if (revision === 'base') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'],
      {cwd: root, encoding: 'utf8'}), 'shared options helper loaded\n');
    write('tools/scan.mjs', revision === 'head' ? reader : 'export const value = 0;\n');
    write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    const head = commit();
    if (revision === 'head') assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'],
      {cwd: root, encoding: 'utf8'}), 'shared options helper loaded\n');
    write('tools/scan.mjs', 'export const value = 3;\n');
    const result = plan(base, head, (...args) => args[0] === 'diff' ? 'packages/catalogue/src/index.mjs\0' : git(...args));
    assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], revision);
    assert.match(result.reason, /repository-root directory scan options at tools\/scan\.mjs/);
  });
});

test('options on a shared helper scan of its own directory do not imply a repository-root scan', () => fixture(({root, git, write, commit}) => {
  write('catalogue-reader.mjs', "import './packages/catalogue/src/index.mjs';\n");
  write('tools/local-reader.mjs', "console.log('local options helper loaded');\n");
  write('tools/scan.mjs', `import {readdirSync} from 'node:fs';
for (const name of readdirSync(new URL('./', import.meta.url), {withFileTypes: true})) {
  if (name.name === 'local-reader.mjs') await import(new URL(name.name, import.meta.url));
}
`);
  write('packages/portal/src/index.mjs', "import '../../../tools/scan.mjs';\n");
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.equal(execFileSync(process.execPath, ['packages/portal/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'local options helper loaded\n');
  assert.deepEqual(scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), base, head, git),
    {full: false, packages: ['catalogue']});
}));


test('URL syntax and ancestor directories cannot hide root scan option consumers', () => {
  for (const value of ['../../../?x', '../../../#x', '%2e%2e/%2e%2e/%2e%2e/', '../../../../']) {
    for (const binding of ['direct', 'stored']) fixture(({root, write, commit, plan}) => {
      const directory = `new URL('${value}', import.meta.url)`;
      const reader = `import {readdirSync} from 'node:fs';
${binding === 'stored' ? `const directory = ${directory};` : ''}
for (const name of readdirSync(${binding === 'direct' ? directory : 'directory'}, {recursive: true})) {
  if (name.endsWith('-reader.mjs')) await import(new URL(name, ${directory}));
}
`;
      const helper = "import '../packages/catalogue/src/index.mjs';\nconsole.log('URL options helper loaded');\n";
      write('adapters/catalogue-reader.mjs', helper);
      write('packages/portal/src/index.mjs', reader);
      const base = commit();
      write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      const head = commit();
      // Keep ancestor enumeration inside an owned parent instead of scanning /tmp.
      const program = value === '../../../../' ? 'proof/repo/packages/portal/src/index.mjs' : 'packages/portal/src/index.mjs';
      if (value === '../../../../') {
        write(program, reader);
        write('proof/repo/adapters/catalogue-reader.mjs', helper);
        write('proof/repo/packages/catalogue/src/index.mjs', 'export const value = 2;\n');
      }
      assert.equal(execFileSync(process.execPath, [program], {cwd: root, encoding: 'utf8'}), 'URL options helper loaded\n');
      const result = plan(base, head);
      assert.deepEqual(result.packages.map(row => row.package), ['catalogue', 'gateway', 'portal', 'unrelated'], value + ' ' + binding);
      assert.match(result.reason, /repository-root directory scan options at packages\/portal\/src\/index\.mjs/);
    });
  }
});


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
import {scopeForRevisions} from ${JSON.stringify(new URL('./ci-package-revisions.mjs', import.meta.url).href)};
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});
console.log(JSON.stringify(scopeForRevisions(['packages/catalogue/src/index.mjs'], ${JSON.stringify(members)}, '${base}', '${head}', git)));
`;
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program],
    {cwd: root, encoding: 'utf8', timeout: 10_000})), {full: false, packages: ['catalogue']});
}));
