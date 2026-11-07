import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {checkDocumentation, documentationPlan} from './ci-docs.mjs';
import {checkScripts, scriptPlan} from './ci-scripts.mjs';
import {lockPackageScope} from './ci-lock-selection.mjs';

const identity = ['scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs'];
const gateway = ['scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs'];
const modes = ['docs', 'identity', 'gateway', 'lock'];
const workspace = ['stock', 'view', 'other'].map(name => ({name, directory: `packages/${name}`, scripts: {test: 'node --test'}}));
const manifestPaths = workspace.map(pkg => `${pkg.directory}/package.json`);

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-input-audit-admission-'));
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', ['-c', 'maintenance.auto=false', ...args],
      {cwd: root, encoding: binary ? undefined : 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  };
  const put = (path, content) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), content);};
  const commit = () => {git('add', '-A'); git('commit', '-sm', 'Audited input fixture'); return git('rev-parse', 'HEAD').trim();};
  const plan = (base, head, read = git) => createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {sha: head}, workspace, read, () => {throw Error('No API');});
  const lock = {lockfileVersion: '9.0', settings: {autoInstallPeers: true, excludeLinksFromLockfile: false},
    importers: {'.': {}, 'packages/stock': {dependencies: {adapter: {specifier: '^1', version: '1.0.0'}}}, 'packages/view': {}, 'packages/other': {}},
    packages: {'adapter@1.0.0': {resolution: {integrity: 'sha512-YQ=='}}}, snapshots: {'adapter@1.0.0': {}}};
  const saveLock = () => put('pnpm-lock.yaml', Object.entries(lock).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join(''));
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    put('README.md', '# Cloud\n'); put('docs/guide.md', '# Guide\n');
    put('package.json', '{"private":true}\n');
    put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    for (const pkg of workspace) put(`${pkg.directory}/package.json`, JSON.stringify({name: pkg.name, scripts: pkg.scripts}) + '\n');
    for (const path of [...identity, ...gateway]) put(path, 'export const result = 1;\n');
    put('scripts/gateway-reconnection-receipt.mjs', 'export const fixture = true;\n');
    put('packages/stock/src/index.mjs', 'export const stock = 1;\n');
    put('packages/view/src/index.mjs', 'import "../../stock/src/index.mjs";\n');
    saveLock();
    const base = commit();
    const change = mode => {
      if (mode === 'docs') put('docs/guide.md', '# Changed\n');
      else if (mode === 'lock') {lock.packages['adapter@1.0.0'].resolution.integrity = 'sha512-Yw=='; saveLock();}
      else put((mode === 'identity' ? identity : gateway)[0], 'export const result = 2;\n');
      return commit();
    };
    run({root, git, put, commit, plan, base, change, lock, saveLock});
  } finally {rmSync(root, {recursive: true, force: true});}
}

function assertNarrow(mode, selected) {
  assert.deepEqual(selected.packages, mode === 'lock' ? ['stock', 'view'].map(packageName => ({package: packageName, shard: 1})) : []);
  assert.equal(selected.typecheck, mode === 'lock');
  assert.equal(selected.receipts.length, mode === 'lock' ? 6 : 0);
  if (mode === 'docs') assert.ok(selected.documentation);
  if (mode === 'identity' || mode === 'gateway') assert.ok(selected.scripts);
}

test('shared policy admits the four existing isolated modes', () => fixture(({root, git, put, commit, plan, base, change}) => {
  for (const mode of modes) {
    git('reset', '--hard', base);
    assertNarrow(mode, plan(base, change(mode)));
  }
  git('reset', '--hard', base);
  put('docs/new guide.md', '# New\n'); unlinkSync(join(root, 'README.md'));
  const selected = plan(base, commit()); assertNarrow('docs', selected);
  assert.deepEqual(selected.documentation.paths, ['README.md', 'docs/new guide.md']);
  for (const target of [identity[1], gateway[1]]) {
    git('reset', '--hard', base); put(target, 'export const revisedTest = true;\n');
    assertNarrow(target === identity[1] ? 'identity' : 'gateway', plan(base, commit()));
  }
}));

test('each isolated mode runs its original checks', () => {
  for (const mode of modes) fixture(({root, git, plan, base, change}) => {
    const head = change(mode); assertNarrow(mode, plan(base, head));
    if (mode === 'docs') {
      assert.ok(documentationPlan(['docs/guide.md'], base, head, git));
      assert.equal(checkDocumentation({documentation: {base, head, paths: ['docs/guide.md']}}, git), 1);
    } else if (mode === 'lock') assert.equal(lockPackageScope(base, head, workspace, git).scope.full, false);
    else {
      const commands = [], targets = mode === 'identity' ? identity : gateway;
      assert.ok(scriptPlan([targets[0]], base, head, git));
      checkScripts({packages: [], receipts: [], typecheck: false, scripts: {base, head, paths: [targets[0]]}}, git,
        args => commands.push(args));
      assert.deepEqual(commands, [...targets.map(path => ['--check', path]),
        ...(mode === 'gateway' ? [['--check', 'scripts/gateway-reconnection-receipt.mjs']] : []), ['--test', targets[1]]]);
    }
  });
});

test('added changed and deleted nonregular Markdown never earns document-only work', () => {
  for (const kind of ['executable', 'link', 'gitlink']) fixture(({root, git, put, commit, plan, base}) => {
    const path = 'docs/indirect.md';
    if (kind === 'executable') {
      put(path, '# Indirect\n'); git('add', path); git('update-index', '--chmod=+x', path);
    } else if (kind === 'link') {symlinkSync('../README.md', join(root, path)); git('add', path);}
    else git('update-index', '--add', '--cacheinfo', `160000,${base},${path}`);
    git('commit', '-sm', 'Add nonregular Markdown');
    const added = git('rev-parse', 'HEAD').trim();
    assert.equal(plan(base, added).packages.length, 3, `${kind} added`);
    if (kind === 'executable') {
      put(path, '# Changed indirect\n'); git('add', path); git('update-index', '--chmod=+x', path);
    } else if (kind === 'link') {unlinkSync(join(root, path)); symlinkSync('guide.md', join(root, path)); git('add', path);}
    else git('update-index', '--add', '--cacheinfo', `160000,${added},${path}`);
    git('commit', '-sm', 'Change nonregular Markdown');
    const changed = git('rev-parse', 'HEAD').trim();
    assert.equal(plan(added, changed).packages.length, 3, `${kind} changed`);
    git('update-index', '--force-remove', path); rmSync(join(root, path), {recursive: true, force: true});
    git('commit', '-sm', 'Delete nonregular Markdown');
    assert.equal(plan(changed, git('rev-parse', 'HEAD').trim()).packages.length, 3, `${kind} deleted`);
  });
});

test('real policy and target modes refuse executable links and gitlinks in either revision', () => {
  const cases = [...identity.map(path => [path, 'identity']), ...gateway.map(path => [path, 'gateway']),
    ['pnpm-lock.yaml', 'lock'], [manifestPaths[0], 'lock'], ['docs/guide.md', 'docs']];
  for (const [path, mode] of cases) for (const kind of ['executable', 'link', 'gitlink']) fixture(({root, git, put, plan, base, change, lock, saveLock}) => {
    const original = readFileSync(join(root, path));
    if (path === manifestPaths[0]) {
      lock.packages['adapter@1.0.0'].resolution.integrity = 'sha512-Yg=='; saveLock();
      git('add', 'pnpm-lock.yaml');
    }
    if (kind === 'executable') git('update-index', '--chmod=+x', path);
    else {
      unlinkSync(join(root, path));
      if (kind === 'link') {symlinkSync('README.md', join(root, path)); git('add', path);}
      else git('update-index', '--add', '--cacheinfo', `160000,${base},${path}`);
    }
    git('commit', '-sm', 'Nonregular input');
    const bad = git('rev-parse', 'HEAD').trim();
    assert.equal(plan(base, bad).packages.length, 3, `${path}: ${kind} head`);
    git('update-index', '--force-remove', path);
    rmSync(join(root, path), {recursive: true, force: true});
    put(path, original);
    const good = change(mode);
    assertNarrow(mode, plan(base, good));
    assert.equal(plan(bad, good).packages.length, 3, `${path}: ${kind} base`);
  });
});

test('invalid saved inventories retain full work', () => {
  for (const mode of modes) fixture(({git, plan, base, change}) => {
    const head = change(mode); assertNarrow(mode, plan(base, head));
    for (const side of [base, head]) for (const fault of ['truncated', 'duplicate-tree', 'malformed-tree']) {
      const read = (...args) => {
        if (args[0] === 'ls-tree' && args.at(-1) === side) {
          const raw = git(...args);
          if (fault === 'truncated') return raw.slice(0, -1);
          if (fault === 'duplicate-tree') return raw + raw.split('\0')[0] + '\0';
          if (fault === 'malformed-tree') return 'malformed\0';
        }
        return git(...args);
      };
      if (['truncated', 'duplicate-tree', 'malformed-tree'].includes(fault)) {
        assert.equal(plan(base, head, read).packages.length, 3, `${mode}: ${side}: ${fault}`);
      } else assertNarrow(mode, plan(base, head, read));
    }
  });
});
