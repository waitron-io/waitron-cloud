import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-mixed-docs-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args],
    {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const put = (path, content) => {
    mkdirSync(join(root, path, '..'), {recursive: true});
    writeFileSync(join(root, path), content);
  };
  const commit = () => {
    git('add', '-A'); git('commit', '-sm', 'Mixed document fixture');
    return git('rev-parse', 'HEAD').trim();
  };
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.test');
    put('package.json', JSON.stringify({name: 'mixed-docs-fixture', private: true}));
    put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    put('pnpm-lock.yaml', 'lockfileVersion: \'9.0\'\n');
    for (const name of ['catalogue', 'consumer', 'unrelated']) {
      put(`packages/${name}/package.json`, JSON.stringify({name: `@waitron-cloud/${name}`, private: true,
        scripts: {test: 'node --test test/index.test.mjs'}}));
      put(`packages/${name}/src/index.mjs`, 'export const value = 1;\n');
    }
    put('packages/consumer/src/index.mjs', "import {value} from '../../catalogue/src/index.mjs';\nconsole.log(value);\n");
    for (const path of ['scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs',
      'scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs']) put(path, 'export {};\n');
    put('docs/backlog.md', '# Backlog\n');
    put('README.md', '# Cloud\n');
    const base = commit();
    const plan = (head, old = base) => createPlan({pull_request: {base: {sha: old}, head: {sha: head}}},
      {sha: head}, loadWorkspace(root), git);
    run({root, git, put, commit, base, plan});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('mixed audited prose and package code select its real consumer without unrelated packages', () => fixture(({root, put, commit, plan}) => {
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  put('docs/backlog.md', '# Updated\n');
  put('docs/a plan.md', '# Plan\n');
  unlinkSync(join(root, 'README.md'));

  const selected = plan(commit());
  assert.deepEqual(selected.packages.map(row => row.package), ['@waitron-cloud/catalogue', '@waitron-cloud/consumer']);
  assert.equal(selected.typecheck, true);
  assert.equal(selected.reuse, null);
  assert.equal(selected.documentation, undefined);
  assert.equal(execFileSync(process.execPath, ['packages/consumer/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '2\n');
}));

test('dirty local source cannot hide a committed consumer in a mixed prose change', () => fixture(({put, commit, plan}) => {
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  put('docs/backlog.md', '# Updated\n');

  const head = commit();
  put('packages/consumer/src/index.mjs', 'export const value = 3;\n');
  const selected = plan(head);
  assert.deepEqual(selected.packages.map(row => row.package), ['@waitron-cloud/catalogue', '@waitron-cloud/consumer']);
}));

test('a docs-only base does not prevent the next reviewed mixed package selection', () => fixture(({root, put, commit, plan}) => {
  put('README.md', '# Previous prose-only change\n');
  const base = commit();
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  put('docs/backlog.md', '# Updated\n');

  const selected = plan(commit(), base);
  assert.deepEqual(selected.packages.map(row => row.package), ['@waitron-cloud/catalogue', '@waitron-cloud/consumer']);
}));

for (const kind of ['head-executable', 'base-executable', 'base-link']) {
  test(`mixed package selection retains ${kind} Markdown`, () => fixture(({root, git, put, commit, base, plan}) => {
    const path = join(root, 'README.md');
    if (kind.startsWith('base-')) {
      if (kind === 'base-link') {
        unlinkSync(path);
        symlinkSync('docs/backlog.md', path);
      } else chmodSync(path, 0o755);

      base = commit();
      assert.match(git('ls-tree', base, '--', 'README.md'), new RegExp(`^${kind === 'base-link' ? '120000' : '100755'} blob`));
      if (kind === 'base-link') {
        unlinkSync(path);
        put('README.md', '# Regular again\n');
      } else chmodSync(path, 0o644);
    } else chmodSync(path, 0o755);
    put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    put('docs/backlog.md', '# Updated\n');

    const head = commit();
    if (kind === 'head-executable') assert.match(git('ls-tree', head, '--', 'README.md'), /^100755 blob/);
    assert.deepEqual(plan(head, base).packages.map(row => row.package),
      ['@waitron-cloud/catalogue', '@waitron-cloud/consumer', '@waitron-cloud/unrelated']);
  }));
}

test('pinned Markdown keeps the package that actually reads its contents', () => fixture(({root, put, commit, plan}) => {
  const path = 'docs/waitron-integration-contract.md';
  put(path, 'published-value\n');
  put('packages/consumer/src/index.mjs', "import {readFileSync} from 'node:fs';\nconsole.log(readFileSync(new URL('../../../docs/waitron-integration-contract.md', import.meta.url), 'utf8').trim());\n");

  const base = commit();
  put(path, 'changed-value\n');
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  put('docs/backlog.md', '# Updated\n');

  const selected = plan(commit(), base);
  assert.ok(selected.packages.some(row => row.package === '@waitron-cloud/consumer'));
  assert.equal(execFileSync(process.execPath, ['packages/consumer/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'changed-value\n');
}));

test('mixed prose keeps real refusals and saved package membership', () => {
  for (const change of ['earlier-source', 'linked-document', 'unknown']) fixture(({root, put, commit, base, plan}) => {
    if (change === 'earlier-source') {put('packages/unrelated/src/index.mjs', 'export const value = 3;\n'); base = commit();}
    put('packages/catalogue/src/index.mjs', 'export const value = 2;\n'); put('docs/backlog.md', '# Updated\n');
    if (change === 'linked-document') {unlinkSync(join(root, 'docs/backlog.md')); symlinkSync('../README.md', join(root, 'docs/backlog.md'));}
    if (change === 'unknown') put('unmapped.txt', 'unknown input\n');
    assert.deepEqual(plan(commit(), base).packages.map(row => row.package),
      ['@waitron-cloud/catalogue', '@waitron-cloud/consumer', ...(['linked-document', 'unknown'].includes(change) ? ['@waitron-cloud/unrelated'] : [])], change);
  });
});

test('prose plus unknown JSON retains complete work', () => fixture(({put, commit, plan}) => {
  put('docs/backlog.md', '# Updated\n'); put('scripts/unknown.json', '{}\n');
  const selected = plan(commit());
  assert.equal(selected.packages.length, 3); assert.equal(selected.typecheck, true);
  assert.equal(selected.documentation, undefined);
}));

test('unknown JSON alone cannot create an empty successful plan', () => fixture(({put, commit, plan}) => {
  put('scripts/unknown.json', '{}\n'); const selected = plan(commit());
  assert.equal(selected.packages.length, 3); assert.equal(selected.typecheck, true);
  assert.equal(selected.documentation, undefined); assert.equal(selected.scripts, undefined);
}));
