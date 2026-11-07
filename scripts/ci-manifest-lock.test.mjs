import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';

const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-manifest-lock-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const write = (path, text) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), text);};
  const commit = () => {git('add', '.'); git('commit', '-sm', 'Manifest lock fixture'); return git('rev-parse', 'HEAD').trim();};
  const workspace = ['catalogue', 'page', 'unrelated'].map(name => ({name, directory: `packages/${name}`, scripts: {test: 'node --test'}}));
  const manifests = Object.fromEntries(workspace.map(pkg => [pkg.directory, {...pkg}]));
  const lock = {lockfileVersion: '9.0', settings: {autoInstallPeers: true, excludeLinksFromLockfile: false},
    importers: {'.': {}, 'packages/catalogue': {}, 'packages/page': {}, 'packages/unrelated': {}}, packages: {}, snapshots: {}};
  const save = () => {
    for (const [directory, manifest] of Object.entries(manifests)) write(`${directory}/package.json`, JSON.stringify(manifest) + '\n');
    write('pnpm-lock.yaml', Object.entries(lock).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join(''));
  };

  const add = (directory = 'packages/catalogue', kind = 'dependencies', name = 'adapter') => {
    manifests[directory][kind] = {...manifests[directory][kind], [name]: '^1.0.0'};
    const lockKind = kind === 'peerDependencies' ? 'dependencies' : kind;
    lock.importers[directory][lockKind] = {...lock.importers[directory][lockKind], [name]: {specifier: '^1.0.0', version: '1.0.0'}};
    lock.packages[`${name}@1.0.0`] = {resolution: {integrity: 'sha512-YQ=='}};
    lock.snapshots[`${name}@1.0.0`] = {};
  };
  const plan = (base, head, read = git) => createPlan({pull_request: {base: {sha: base}, head: {sha: head}}},
    {sha: head, repository: 'waitron-io/waitron-cloud'}, workspace, read, () => {throw Error('No API expected');});
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    write('package.json', '{"private":true}\n');
    write('packages/page/test/reader.mjs', "import '../../../scripts/page-fixture.mjs';\n");
    write('scripts/page-fixture.mjs', "export const catalogue = '../packages/catalogue/src/index.ts';\n");
    write('packages/catalogue/src/index.ts', 'export const price = 1;\n');
    save();
    run({git, write, commit, lock, manifests, save, add, plan});
  } finally {rmSync(root, {recursive: true, force: true});}
}

function selected(plan, names = ['catalogue', 'page']) {
  assert.deepEqual(plan.packages, names.map(packageName => ({package: packageName, shard: 1})));
  assert.equal(plan.receipts.length, 6);
  assert.equal(plan.typecheck, true);
  assert.equal(plan.reuse, null);
}

test('manifest and resolved dependency additions select the importer and saved helper readers for every dependency kind', () => {
  for (const kind of dependencyFields) fixture(({commit, add, save, plan}) => {
    const base = commit(); add('packages/catalogue', kind); save();
    const result = plan(base, commit()); selected(result);
    assert.match(result.reason, /saved package selection/);
  });
});

test('dependency removal retains former consumers from both manifests', () => fixture(({manifests, lock, save, add, commit, plan}) => {
  add('packages/catalogue');
  manifests['packages/unrelated'].dependencies = {catalogue: 'workspace:*'};
  lock.importers['packages/unrelated'].dependencies = {catalogue: {specifier: 'workspace:*', version: 'link:../catalogue'}};
  save(); const base = commit();
  delete manifests['packages/catalogue'].dependencies;
  delete manifests['packages/unrelated'].dependencies;
  lock.importers['packages/catalogue'] = {}; lock.importers['packages/unrelated'] = {}; lock.packages = {}; lock.snapshots = {};
  save(); const result = plan(base, commit()); selected(result, ['catalogue', 'page', 'unrelated']);
  assert.match(result.reason, /saved package selection/);
}));

test('independent manifest dependency additions combine their consumers without unrelated packages', () => fixture(({commit, add, save, plan}) => {
  const base = commit(); add('packages/unrelated'); save();
  selected(plan(base, commit()), ['unrelated']);
}));

test('scripts, package metadata, root inputs and unrelated paths cannot bypass the reader audit', () => {
  for (const change of [
    ({manifests}) => {manifests['packages/catalogue'].scripts.install = 'node install.mjs';},
    ({manifests}) => {manifests['packages/catalogue'].exports = './other.js';},
    ({manifests}) => {manifests['packages/catalogue'].type = 'commonjs';},
    ({manifests}) => {manifests['packages/catalogue'].dependencies.adapter = {bad: 'value'};},
    ({write}) => {write('.npmrc', 'node-linker=hoisted\n');},
    ({write}) => {write('package.json', '{"scripts":{"postinstall":"node install.mjs"}}\n');},
    ({write}) => {write('scripts/new-reader.mjs', "export const manifest = '../packages/catalogue/package.json';\n");},
    ({write}) => {write('docs/backlog.md', 'A mixed change\n');},
    ({write}) => {write('packages/unrelated/src/new.ts', 'export const value = 1;\n');},
  ]) fixture(context => {
    const {commit, add, save, plan} = context;
    const base = commit(); add(); change(context); save();
    selected(plan(base, commit()), ['catalogue', 'page', 'unrelated']);
  });
});

test('nonregular and unavailable saved manifests retain full work', () => fixture(({git, commit, add, save, plan}) => {
  const base = commit(); add(); save(); const head = commit();
  for (const sha of [base, head]) for (const fault of ['symlink', 'blob']) {
    const read = (...args) => {
      if (fault === 'symlink' && args[0] === 'ls-tree' && args.includes(sha)) return git(...args).replace(/100644(?= blob [a-f0-9]+\tpackages\/catalogue\/package.json)/, '120000');
      if (fault === 'blob' && args[0] === 'show' && args[1] === `${sha}:packages/catalogue/package.json`) throw Error('Missing manifest');
      return git(...args);
    };
    selected(plan(base, head, read), ['symlink', 'blob'].includes(fault) ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }
}));

test('manifest owner runs even when its dependency edit leaves the resolved importer graph unchanged', () => fixture(({commit, add, save, manifests, lock, plan}) => {
  add('packages/unrelated'); save(); const base = commit();
  manifests['packages/catalogue'].dependencies = {};
  lock.packages['adapter@1.0.0'].resolution.integrity = 'sha512-Yg=='; save();
  const result = plan(base, commit()); selected(result, ['catalogue', 'page', 'unrelated']);
  assert.match(result.reason, /saved package selection/);
}));

for (const {directories, names, expected} of [
  {directories: ['packages/catalogue'], names: ['catalogue', 'page', 'unrelated'], expected: 'packages/catalogue/package.json'},
  {directories: ['packages/page', 'packages/catalogue'], names: ['catalogue', 'page', 'unrelated'], expected: 'packages/catalogue/package.json, packages/page/package.json'},
  {directories: ['packages/unrelated'], names: ['unrelated'], expected: 'packages/unrelated/package.json'},
]) test(`lock explanation names changed manifests separately from resolved importers: ${expected}`, () => fixture(({commit, add, save, manifests, lock, plan}) => {
  add('packages/unrelated'); save(); const base = commit();
  for (const directory of directories) manifests[directory].optionalDependencies = {};
  lock.packages['adapter@1.0.0'].resolution.integrity = 'sha512-Yg=='; save();
  const result = plan(base, commit());
  selected(result, names);
  const lockReason = result.reason.split('; pnpm-lock.yaml: ')[1];
  assert.ok(lockReason, 'The dependency plan explains its lock selection');
  assert.match(lockReason, /resolved dependency inputs changed for packages\/unrelated;/);
  assert.equal(lockReason.match(/; changed manifests: ([^;]+);/)?.[1], expected);
}));

test('lock-only explanation does not report unedited consumer manifests as changed', () => fixture(({commit, add, save, lock, plan}) => {
  add(); save(); const base = commit();
  lock.packages['adapter@1.0.0'].resolution.integrity = 'sha512-Yg=='; save();
  const result = plan(base, commit());
  selected(result);
  assert.match(result.reason, /resolved dependency inputs changed for packages\/catalogue;/);
  assert.doesNotMatch(result.reason, /changed manifests:/);
}));
