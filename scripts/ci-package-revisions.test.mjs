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
    write('scripts/reader set/cycle.mjs', "import './nested/adapter.mjs';\n");
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
