import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {readGitBlobs} from '../ci-package-revisions.mjs';

const identity = ['scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs'];
const gateway = ['scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs'];

function gitFixture(seed, run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-ci-selection-'));
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root,
      encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: 'pipe'});
  };
  git.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'],
    {cwd: root, input, maxBuffer: 64 * 1024 * 1024, stdio: 'pipe'}));
  const put = (path, value) => {
    mkdirSync(dirname(join(root, path)), {recursive: true});
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value) + '\n');
  };
  const commit = () => {git('add', '-A'); git('commit', '--allow-empty', '-sqm', 'Save synthetic selection fixture'); return git('rev-parse', 'HEAD').trim();};
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.test');
    put('package.json', {private: true});
    put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    for (const path of [...identity, ...gateway, 'scripts/gateway-reconnection-receipt.mjs']) put(path, 'export const value = 1;\n');
    seed(put);
    const base = commit(); run({root, git, put, write: put, commit, base});
  } finally {rmSync(root, {recursive: true, force: true});}
}

export function selectionFixture(run) {
  gitFixture(put => {
    put('README.md', '# Cloud\n'); put('docs/backlog.md', '# Backlog\n');
    put('docs/waitron-integration-contract.md', '# Contract\n'); put('docs/cloud-cost-model.md', '# Cost\n');
    put('packages/stock/package.json', {name: 'stock', scripts: {test: 'node --test'}, dependencies: {adapter: '^1'}});
    put('packages/stock/src/index.mjs', 'export const value = 1;\n'); put('pnpm-lock.yaml', 'lockfileVersion: 9\n');
  }, run);
}

export function rootSelectionFixture(run) {
  gitFixture(put => {
    for (const path of ['scripts/ci-root-shards.test.mjs', 'scripts/verify-backup-capacity-receipt.test.mjs',
      'deploy/local-stack/operations-health.test.mjs', 'scripts/reader.mjs']) put(path, 'export const value = 1;\n');
    put('docs/explanation.md', '# Explanation\n');
  }, run);
}
