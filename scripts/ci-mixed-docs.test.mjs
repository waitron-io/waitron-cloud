import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';

const generator = resolve('scripts/ci-input-audit.mjs');
const policy = 'scripts/ci-input-audit.json';

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
  const renew = () => {
    git('add', '-A');
    execFileSync(process.execPath, [generator, '--write-staged'], {cwd: root, stdio: 'pipe'});
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
    put(policy, JSON.stringify({version: 1, docsInputSha256: '0'.repeat(64), identityInputSha256: '0'.repeat(64),
      gatewayInputSha256: '0'.repeat(64), lockInputSha256: '0'.repeat(64), manifests: {}}));
    renew();
    const base = commit();
    const plan = (head, old = base) => createPlan({pull_request: {base: {sha: old}, head: {sha: head}}},
      {sha: head}, loadWorkspace(root), git);
    run({root, git, put, commit, renew, base, plan});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('mixed audited prose and package code select its real consumer without unrelated packages', () => fixture(({root, put, renew, commit, plan}) => {
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  put('docs/backlog.md', '# Updated\n');
  put('docs/a plan.md', '# Plan\n');
  unlinkSync(join(root, 'README.md'));
  renew();
  const selected = plan(commit());
  assert.deepEqual(selected.packages.map(row => row.package), ['@waitron-cloud/catalogue', '@waitron-cloud/consumer']);
  assert.equal(selected.typecheck, true);
  assert.equal(selected.reuse, null);
  assert.equal(selected.documentation, undefined);
  assert.equal(execFileSync(process.execPath, ['packages/consumer/src/index.mjs'], {cwd: root, encoding: 'utf8'}), '2\n');
}));

test('dirty local source cannot hide a committed consumer in a mixed prose change', () => fixture(({put, renew, commit, plan}) => {
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  put('docs/backlog.md', '# Updated\n');
  renew();
  const head = commit();
  put('packages/consumer/src/index.mjs', 'export const value = 3;\n');
  const selected = plan(head);
  assert.deepEqual(selected.packages.map(row => row.package), ['@waitron-cloud/catalogue', '@waitron-cloud/consumer']);
}));

test('a docs-only base does not prevent the next reviewed mixed package selection', () => fixture(({root, put, renew, commit, plan}) => {
  put('README.md', '# Previous prose-only change\n');
  const base = commit();
  assert.throws(() => execFileSync(process.execPath, [generator, '--check', base], {cwd: root, stdio: 'pipe'}),
    error => error.status === 1 && error.stdout.toString().includes('docs: current') &&
      error.stderr.toString().includes('root-script consumer audit'));
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  put('docs/backlog.md', '# Updated\n');
  renew();
  const selected = plan(commit(), base);
  assert.deepEqual(selected.packages.map(row => row.package), ['@waitron-cloud/catalogue', '@waitron-cloud/consumer']);
}));

test('pinned Markdown keeps the package that actually reads its contents', () => fixture(({root, put, renew, commit, plan}) => {
  const path = 'docs/waitron-integration-contract.md';
  put(path, 'published-value\n');
  put('packages/consumer/src/index.mjs', "import {readFileSync} from 'node:fs';\nconsole.log(readFileSync(new URL('../../../docs/waitron-integration-contract.md', import.meta.url), 'utf8').trim());\n");
  renew();
  const base = commit();
  put(path, 'changed-value\n');
  put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  put('docs/backlog.md', '# Updated\n');
  renew();
  const selected = plan(commit(), base);
  assert.ok(selected.packages.some(row => row.package === '@waitron-cloud/consumer'));
  assert.equal(execFileSync(process.execPath, ['packages/consumer/src/index.mjs'], {cwd: root, encoding: 'utf8'}), 'changed-value\n');
}));

test('mixed prose preserves full work for stale audits, linked documents, unknown paths and damaged peer evidence', () => {
  for (const change of ['stale-head', 'stale-base', 'linked-document', 'unknown', 'identity-hash', 'gateway-hash', 'lock-hash', 'missing-policy']) fixture(({root, put, renew, commit, base, plan}) => {
    if (change === 'stale-base') {
      put('packages/unrelated/src/index.mjs', 'export const value = 3;\n');
      base = commit();
    }
    put('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
    put('docs/backlog.md', '# Updated\n');
    if (change === 'linked-document') {
      unlinkSync(join(root, 'docs/backlog.md'));
      symlinkSync('../README.md', join(root, 'docs/backlog.md'));
    }
    if (change === 'unknown') put('unmapped.txt', 'unknown input\n');
    if (change !== 'stale-head') renew();
    if (change.endsWith('-hash')) {
      const audit = JSON.parse(readFileSync(join(root, policy), 'utf8'));
      audit[`${change.split('-')[0]}InputSha256`] = 'f'.repeat(64);
      put(policy, JSON.stringify(audit));
    }
    if (change === 'missing-policy') unlinkSync(join(root, policy));
    assert.deepEqual(plan(commit(), base).packages.map(row => row.package),
      ['@waitron-cloud/catalogue', '@waitron-cloud/consumer', '@waitron-cloud/unrelated'], change);
  });
});

test('prose plus an audit-only edit cannot become successful empty work', () => fixture(({root, put, renew, commit, plan}) => {
  put('docs/backlog.md', '# Updated\n');
  renew();
  // Whitespace changes the policy blob without changing any admitted digest.
  // There is no executable change to justify a nonempty package selection.
  put(policy, JSON.stringify(JSON.parse(readFileSync(join(root, policy), 'utf8')), null, 4));
  const selected = plan(commit());
  assert.equal(selected.packages.length, 3);
  assert.equal(selected.typecheck, true);
}));
