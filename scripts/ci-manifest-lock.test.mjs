import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';

const policy = 'scripts/ci-lock-selection-audit.json';
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const hash = text => createHash('sha256').update(text).digest('hex');

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-manifest-lock-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
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
  const audit = () => {
    git('add', '.');
    const entries = git('ls-files', '--stage', '-z').split('\0').filter(Boolean).map(entry => entry.replace(/ 0\t/, '\t').replace(/^([0-7]+) /, '$1 blob '));
    const projected = Object.fromEntries(Object.entries(manifests).map(([directory, manifest]) => [
      `${directory}/package.json`, hash(JSON.stringify(Object.fromEntries(Object.entries(manifest).filter(([key]) => !dependencyFields.includes(key)).sort(([a], [b]) => a.localeCompare(b, 'en'))))),
    ]));
    const inputs = entries.filter(entry => !['pnpm-lock.yaml', policy, ...Object.keys(projected)].includes(entry.split('\t')[1]));
    write(policy, JSON.stringify({version: 2, inputSha256: hash(inputs.map(entry => entry + '\0').join('')), manifests: projected}) + '\n');
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
    save(); audit();
    run({git, write, commit, lock, manifests, save, audit, add, plan});
  } finally {rmSync(root, {recursive: true, force: true});}
}

function selected(plan, names = ['catalogue', 'page']) {
  assert.deepEqual(plan.packages, names.map(packageName => ({package: packageName, shard: 1})));
  assert.equal(plan.receipts.length, 5);
  assert.equal(plan.typecheck, true);
  assert.equal(plan.reuse, null);
}

test('manifest and resolved dependency additions select the importer and saved helper readers for every dependency kind', () => {
  for (const kind of dependencyFields) fixture(({commit, add, save, plan}) => {
    const base = commit(); add('packages/catalogue', kind); save();
    const result = plan(base, commit()); selected(result);
    assert.match(result.reason, /audited package selection/);
  });
});

test('dependency removal retains former consumers from both manifests', () => fixture(({manifests, lock, save, audit, add, commit, plan}) => {
  add('packages/catalogue');
  manifests['packages/unrelated'].dependencies = {catalogue: 'workspace:*'};
  lock.importers['packages/unrelated'].dependencies = {catalogue: {specifier: 'workspace:*', version: 'link:../catalogue'}};
  save(); audit(); const base = commit();
  delete manifests['packages/catalogue'].dependencies;
  delete manifests['packages/unrelated'].dependencies;
  lock.importers['packages/catalogue'] = {}; lock.importers['packages/unrelated'] = {}; lock.packages = {}; lock.snapshots = {};
  save(); const result = plan(base, commit()); selected(result, ['catalogue', 'page', 'unrelated']);
  assert.match(result.reason, /audited package selection/);
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

test('missing, forged or nonregular projected manifest evidence in either saved revision keeps full work', () => fixture(({git, commit, add, save, plan}) => {
  const base = commit(); add(); save(); const head = commit();
  for (const sha of [base, head]) for (const fault of ['digest', 'missing', 'extra', 'version', 'symlink', 'blob']) {
    const read = (...args) => {
      if (args[0] === 'show' && args[1] === `${sha}:${policy}`) {
        const audit = JSON.parse(git(...args));
        if (fault === 'digest') audit.manifests['packages/catalogue/package.json'] = '0'.repeat(64);
        if (fault === 'missing') delete audit.manifests['packages/catalogue/package.json'];
        if (fault === 'extra') audit.manifests['packages/unknown/package.json'] = '0'.repeat(64);
        if (fault === 'version') audit.version = 3;
        return JSON.stringify(audit);
      }
      if (fault === 'symlink' && args[0] === 'ls-tree' && args.includes(sha)) return git(...args).replace(/100644(?= blob [a-f0-9]+\tpackages\/catalogue\/package.json)/, '120000');
      if (fault === 'blob' && args[0] === 'show' && args[1] === `${sha}:packages/catalogue/package.json`) throw Error('Missing manifest');
      return git(...args);
    };
    selected(plan(base, head, read), ['catalogue', 'page', 'unrelated']);
  }
}));

test('manifest owner runs even when its dependency edit leaves the resolved importer graph unchanged', () => fixture(({commit, add, save, manifests, lock, plan}) => {
  add('packages/unrelated'); save(); const base = commit();
  manifests['packages/catalogue'].dependencies = {};
  lock.packages['adapter@1.0.0'].resolution.integrity = 'sha512-Yg=='; save();
  const result = plan(base, commit()); selected(result, ['catalogue', 'page', 'unrelated']);
  assert.match(result.reason, /audited package selection/);
}));
