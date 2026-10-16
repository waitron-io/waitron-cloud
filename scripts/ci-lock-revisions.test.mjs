import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-lock-revisions-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const write = (path, text) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), text);};
  const commit = () => {git('add', '.'); git('commit', '-sm', 'Lock graph fixture'); return git('rev-parse', 'HEAD').trim();};
  const lock = {
    lockfileVersion: '9.0', settings: {autoInstallPeers: true, excludeLinksFromLockfile: false},
    importers: {'.': {}, 'packages/catalogue': {dependencies: {adapter: {specifier: '1.0.0', version: '1.0.0'}}},
      'packages/page': {dependencies: {catalogue: {specifier: 'workspace:*', version: 'link:../catalogue'}}}, 'packages/unrelated': {}},
    packages: {'adapter@1.0.0': {resolution: {integrity: 'sha512-YQ=='}}, 'leaf@1.0.0': {resolution: {integrity: 'sha512-Yg=='}}},
    snapshots: {'adapter@1.0.0': {dependencies: {leaf: '1.0.0'}}, 'leaf@1.0.0': {}},
  };
  const save = () => write('pnpm-lock.yaml', Object.entries(lock).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join(''));
  const workspace = ['catalogue', 'page', 'unrelated'].map(name => ({name, directory: `packages/${name}`, scripts: {test: 'node --test'}}));
  const plan = (base, head, read = git) => createPlan({pull_request: {base: {sha: base}, head: {sha: head}}},
    {sha: head, repository: 'waitron-io/waitron-cloud'}, workspace, read, () => {throw Error('No API expected');});
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    save();
    run({git, write, commit, lock, save, plan});
  } finally {rmSync(root, {recursive: true, force: true});}
}

function assertFull(plan) {
  assert.deepEqual(plan.packages, ['catalogue', 'page', 'unrelated'].map(packageName => ({package: packageName, shard: 1})));
  assert.equal(plan.receipts.length, 5);
  assert.equal(plan.typecheck, true);
  assert.equal(plan.reuse, null);
}

test('lock diagnostics name indirect consumers from saved trees without narrowing unaudited root work', () => fixture(({lock, save, commit, plan}) => {
  const base = commit();
  lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
  const head = commit();
  lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Yg=='; save();
  const result = plan(base, head);
  assertFull(result);
  assert.match(result.reason, /pnpm-lock.yaml: resolved dependency inputs changed for packages\/catalogue, packages\/page/);
  assert.match(result.reason, /full suite retained until root readers are covered/);
}));

test('removed resolutions and mixed paths keep diagnostics and every original test suite', () => fixture(({lock, save, write, commit, plan}) => {
  const base = commit();
  delete lock.snapshots['leaf@1.0.0']; delete lock.packages['leaf@1.0.0'];
  lock.snapshots['adapter@1.0.0'] = {}; save();
  write('packages/unrelated/src/index.mjs', 'export const value = 2;\n');
  const result = plan(base, commit());
  assertFull(result);
  assert.match(result.reason, /resolved dependency inputs changed for packages\/catalogue, packages\/page/);
}));

test('formatting-only locks report no resolved changes and keep full root work', () => fixture(({git, write, commit, plan}) => {
  const base = commit();
  write('pnpm-lock.yaml', '# Formatting only\n' + git('show', `${base}:pnpm-lock.yaml`));
  const result = plan(base, commit());
  assertFull(result);
  assert.match(result.reason, /pnpm-lock.yaml: resolved dependency inputs unchanged/);
}));

test('unsupported or missing lock evidence in either revision keeps every suite with an unavailable-evidence diagnostic', () => fixture(({lock, save, git, commit, plan}) => {
  const base = commit();
  lock.packages['leaf@1.0.0'].hasBin = true; save();
  const head = commit();
  for (const sha of [base, head]) for (const fault of ['missing', 'unsupported', 'malformed-tree', 'symlink']) {
    const read = (...args) => {
      if (args[0] === 'show' && args[1] === `${sha}:pnpm-lock.yaml`) {
        if (fault === 'missing') throw Error('Object unavailable');
        if (fault === 'unsupported') return git(...args).replace('"autoInstallPeers":true', '"autoInstallPeers":false');
      }
      if (args[0] === 'ls-tree' && args.includes(sha)) {
        if (fault === 'malformed-tree') return 'malformed';
        if (fault === 'symlink') return git(...args).replace('100644', '120000');
      }
      return git(...args);
    };
    const result = plan(base, head, read);
    assertFull(result);
    assert.match(result.reason, /pnpm-lock.yaml: resolved dependency evidence unavailable; full suite retained/, `${sha} ${fault}`);
  }
}));

test('ordinary package diffs do not read or diagnose the lockfile', () => fixture(({write, commit, plan, git}) => {
  const base = commit();
  write('packages/catalogue/src/index.mjs', 'export const value = 2;\n');
  const head = commit();
  const read = (...args) => {
    assert.ok(!args.some(arg => arg.includes(':pnpm-lock.yaml')), 'Unchanged lock must not be read');
    return git(...args);
  };
  assert.doesNotMatch(plan(base, head, read).reason, /resolved dependency/);
}));
