import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {loadWorkspace, scopeForPaths, workPlan} from './ci-scope.mjs';
import {readGitBlobs, scopeForRevisions} from './ci-package-revisions.mjs';
import {createPlan} from './ci-plan.mjs';

const helper = 'scripts/ci-audit-fixture-dependencies.mjs';
const installedReader = readFileSync(new URL('./ci-audit-fixture-dependencies.mjs', import.meta.url), 'utf8');

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-installed-reader-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args],
    {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const put = (path, content) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), content);};
  const commit = () => {git('add', '-A'); git('commit', '-sm', 'Installed reader fixture'); return git('rev-parse', 'HEAD').trim();};
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.test');
    put('package.json', JSON.stringify({name: 'installed-reader-fixture', private: true}));
    put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    for (const name of ['catalogue', 'consumer', 'unrelated']) {
      put(`packages/${name}/package.json`, JSON.stringify({name, private: true, scripts: {test: 'node --test'}}));
      put(`packages/${name}/src/index.mjs`, 'export const value = 1;\n');
    }
    put('packages/consumer/src/index.mjs', "import {value} from '../../catalogue/src/index.mjs';\nconsole.log(value);\n");
    put('packages/consumer/test/prepare.mjs', `const helper = '${helper}';\n`);
    put(helper, installedReader);
    const base = commit();
    const scope = (head, before = base) => scopeForRevisions(['packages/catalogue/src/index.mjs'], loadWorkspace(root), before, head, git);
    run({root, git, put, commit, base, scope});
  } finally {rmSync(root, {recursive: true, force: true});}
}

// Removing the installed-reader declaration must add unrelated work again.
test('the reviewed installed-graph copier keeps a real saved consumer without unrelated packages', () => fixture(({root, put, commit, scope}) => {
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.deepEqual(scope(head), {full: false, packages: ['catalogue', 'consumer']});
  assert.equal(execFileSync(process.execPath, ['packages/consumer/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '2\n');
}));

// Omitting either revision's pin check must accept a changed reader here.
for (const revision of ['base', 'head']) test(`a changed installed reader in the ${revision} retains full work`, () => fixture(({put, commit, base, scope}) => {
  put(helper, installedReader + "\nimport '../packages/unrelated/src/index.mjs';\n");
  const changed = commit();
  if (revision === 'base') {base = changed; put(helper, installedReader);}
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  assert.throws(() => scope(head, base), /Unreviewed installed dependency reader/);
}));

for (const kind of ['executable', 'link']) test(`a ${kind} installed reader cannot use the declaration`, () => fixture(({root, put, commit, scope}) => {
  if (kind === 'executable') chmodSync(join(root, helper), 0o755);
  else {put('scripts/other.mjs', installedReader); unlinkSync(join(root, helper)); symlinkSync('other.mjs', join(root, helper));}
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  assert.throws(() => scope(commit()), /Unreviewed installed dependency reader|Nonregular or missing package input/);
}));

test('the real immutable portal graph selects six package jobs while retaining backend consumers', {timeout: 60_000}, () => {
  const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  git.readBlobs = readGitBlobs;
  const sha = git('rev-parse', 'HEAD').trim(), workspace = loadWorkspace();
  const scope = scopeForRevisions(['apps/portal/src/app.ts'], workspace, sha, sha, git);
  assert.deepEqual(scope, {full: false, packages: ['@waitron-cloud/portal']});
  assert.equal(workPlan(scope, workspace).packages.length, 6);
  for (const [changed, consumer] of [['account-http', 'backups'], ['registration', 'operations'], ['remote-access', 'ui-smoke']]) {
    assert.ok(scopeForPaths([`packages/${changed}/src/change.ts`], workspace).packages.includes(`@waitron-cloud/${consumer}`));
  }
});

test('a real mixed portal revision narrows while a new unknown reader restores every package', {timeout: 60_000}, () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-real-portal-plan-'));
  const generator = resolve('scripts/ci-input-audit.mjs');
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', args, {cwd: root, encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024});
  };
  git.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'], {cwd: root, input, maxBuffer: 64 * 1024 * 1024}));
  const save = () => {
    git('add', '-A');
    const inputs = git('diff', '--cached', '--name-only').trim().split('\n').filter(path => !path.startsWith('docs/'));
    assert.ok(inputs.length && inputs.every(path => ['apps/portal/src/app.ts', 'apps/portal/src/unreviewed-reader.mjs'].includes(path)));
    execFileSync(process.execPath, [resolve('scripts/ci-root-review.mjs'), '--write-staged',
      ...inputs.flatMap(path => ['--input', path]), '--reviewer', 'CI fixture',
      '--reference', 'Controlled portal whitespace or unresolved source reader'], {cwd: root, stdio: 'pipe'});
    git('add', 'scripts/ci-root-review.d');
    execFileSync(process.execPath, [generator, '--write-staged'], {cwd: root, stdio: 'pipe'});
    git('add', 'scripts/ci-input-audit.json', 'scripts/ci-input-audit.d');
    git('-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.test', 'commit', '-sm', 'Portal selection fixture');
    return git('rev-parse', 'HEAD').trim();
  };
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    const base = git('rev-parse', 'HEAD').trim();
    for (const path of ['apps/portal/src/app.ts', 'docs/backlog.md']) {
      const target = join(root, path);
      writeFileSync(target, readFileSync(target, 'utf8') + '\n');
    }
    const head = save(), workspace = loadWorkspace(root);
    const plan = sha => createPlan({pull_request: {base: {sha: base}, head: {sha}}}, {sha}, workspace, git);
    const selected = plan(head);
    assert.deepEqual(selected.packages.map(row => row.package), Array(6).fill('@waitron-cloud/portal'), selected.reason);
    assert.equal(selected.typecheck, true);
    assert.deepEqual(selected.receipts, ['test:two-venue-milestone-receipt', 'test:backup-capacity',
      'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt', 'test:cloud-cost']);
    writeFileSync(join(root, 'apps/portal/src/unreviewed-reader.mjs'),
      "import {readdirSync} from 'node:fs';\nexport const discover = directory => readdirSync(directory);\n");
    const unknown = plan(save());
    assert.deepEqual([...new Set(unknown.packages.flatMap(row => row.members ?? [row.package]))].sort(),
      ['@waitron-cloud/account-http', '@waitron-cloud/backups', '@waitron-cloud/identity', '@waitron-cloud/operations',
        '@waitron-cloud/portal', '@waitron-cloud/registration', '@waitron-cloud/remote-access', '@waitron-cloud/translation', '@waitron-cloud/ui-smoke']);
    assert.match(unknown.reason, /Unresolved directory input at apps\/portal\/src\/unreviewed-reader.mjs/);
  } finally {rmSync(root, {recursive: true, force: true});}
});


test('qualifying the real UI-smoke graph retains every existing receipt suite', {timeout: 60_000}, () => {
  const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  git.readBlobs = readGitBlobs;
  const sha = git('rev-parse', 'HEAD').trim(), workspace = loadWorkspace();
  const changed = (...args) => args[0] === 'diff' ? 'packages/ui-smoke/test.mjs\0' : git(...args);
  changed.readBlobs = git.readBlobs;
  const base = git('rev-parse', 'HEAD^').trim();
  const selected = createPlan({pull_request: {base: {sha: base}, head: {sha}}}, {sha}, workspace, changed);
  assert.deepEqual(selected.packages, [{package: '@waitron-cloud/ui-smoke', shard: 1}]);
  assert.deepEqual(selected.receipts, ['test:two-venue-milestone-receipt', 'test:backup-capacity',
    'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt', 'test:cloud-cost']);
});
