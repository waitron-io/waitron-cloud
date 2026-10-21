import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {checkDocumentation, documentationPlan} from './ci-docs.mjs';
import {checkScripts, scriptPlan} from './ci-scripts.mjs';
import {lockPackageScope} from './ci-lock-selection.mjs';
import {auditInputMode} from './ci-input-audit.mjs';

const policyPath = 'scripts/ci-input-audit.json';
const identity = ['scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs'];
const gateway = ['scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs'];
const fields = {docs: 'docsInputSha256', identity: 'identityInputSha256', gateway: 'gatewayInputSha256', lock: 'lockInputSha256'};
const workspace = ['stock', 'view', 'other'].map(name => ({name, directory: `packages/${name}`, scripts: {test: 'node --test'}}));
const manifestPaths = workspace.map(pkg => `${pkg.directory}/package.json`);
const hash = text => createHash('sha256').update(text).digest('hex');

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-input-audit-admission-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args],
    {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const put = (path, content) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), content);};
  const commit = () => {git('add', '-A'); git('commit', '-sm', 'Audited input fixture'); return git('rev-parse', 'HEAD').trim();};
  const plan = (base, head, read = git) => createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {sha: head}, workspace, read, () => {throw Error('No API');});
  const lock = {lockfileVersion: '9.0', settings: {autoInstallPeers: true, excludeLinksFromLockfile: false},
    importers: {'.': {}, 'packages/stock': {dependencies: {adapter: {specifier: '^1', version: '1.0.0'}}}, 'packages/view': {}, 'packages/other': {}},
    packages: {'adapter@1.0.0': {resolution: {integrity: 'sha512-YQ=='}}}, snapshots: {'adapter@1.0.0': {}}};
  const saveLock = () => put('pnpm-lock.yaml', Object.entries(lock).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join(''));
  // Independent fixed fixture inventories; none calls production audit helpers.
  const certify = () => {
    git('add', '-A');
    const tree = git('write-tree').trim();
    const rows = git('ls-tree', '-rz', '--full-tree', tree).split('\0').filter(Boolean);
    const exclusions = {
      docs: [policyPath, 'README.md', 'docs/guide.md'], identity: [policyPath, ...identity],
      gateway: [policyPath, ...gateway], lock: [policyPath, 'pnpm-lock.yaml', ...manifestPaths],
    };
    const digest = mode => hash(rows.filter(row => !exclusions[mode].includes(row.split('\t')[1])).map(row => row + '\0').join(''));
    const manifests = Object.fromEntries(workspace.map(pkg => [`${pkg.directory}/package.json`, hash(JSON.stringify({name: pkg.name, scripts: pkg.scripts}))]));
    put(policyPath, JSON.stringify({version: 1, docsInputSha256: digest('docs'), identityInputSha256: digest('identity'),
      gatewayInputSha256: digest('gateway'), lockInputSha256: digest('lock'), manifests}) + '\n');
    return commit();
  };
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
    const base = certify();
    const change = mode => {
      if (mode === 'docs') put('docs/guide.md', '# Changed\n');
      else if (mode === 'lock') {lock.packages['adapter@1.0.0'].resolution.integrity = 'sha512-Yw=='; saveLock();}
      else put((mode === 'identity' ? identity : gateway)[0], 'export const result = 2;\n');
      return commit();
    };
    run({root, git, put, commit, certify, plan, base, change, lock, saveLock});
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
  for (const mode of Object.keys(fields)) {
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

test('head renewal cannot qualify an unaudited base', () => {
  for (const mode of Object.keys(fields)) for (const fault of ['missing', 'stale']) fixture(({root, git, put, commit, certify, plan, change}) => {
    if (fault === 'missing') unlinkSync(join(root, policyPath));
    else {const policy = JSON.parse(readFileSync(join(root, policyPath))); policy[fields[mode]] = '0'.repeat(64); put(policyPath, JSON.stringify(policy));}
    const base = commit();
    change(mode); const head = certify();
    assert.equal(plan(base, head).packages.length, 3, `${mode}: ${fault}`);
    assert.doesNotThrow(() => auditInputMode(mode, head, git, manifestPaths));
    if (mode === 'docs') assert.throws(() => documentationPlan(['docs/guide.md'], base, head, git));
    else if (mode === 'lock') assert.throws(() => lockPackageScope(base, head, workspace, git));
    else assert.throws(() => scriptPlan([(mode === 'identity' ? identity : gateway)[0]], base, head, git));
    // Direct checkers also revalidate the bad base when the claimed diff is exact.
    const paths = git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean);
    if (mode === 'docs') assert.throws(() => checkDocumentation({documentation: {base, head, paths}}, git));
    if (mode === 'identity' || mode === 'gateway') assert.throws(() => checkScripts({packages: [], receipts: [], typecheck: false,
      scripts: {base, head, paths}}, git, () => assert.fail('Unaudited work must never execute')));
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

test('legacy certificates alone retain full work', () => {
  for (const mode of Object.keys(fields)) fixture(({root, put, commit, plan, change}) => {
    unlinkSync(join(root, policyPath));
    put('scripts/ci-docs-audit.json', JSON.stringify({version: 1, inputSha256: '1'.repeat(64)}));
    put('scripts/ci-scripts-audit.json', JSON.stringify({version: 1, inputSha256: '2'.repeat(64), gatewayInputSha256: '3'.repeat(64)}));
    put('scripts/ci-lock-selection-audit.json', JSON.stringify({version: 2, inputSha256: '4'.repeat(64), manifests: {}}));
    const base = commit();
    assert.equal(plan(base, change(mode)).packages.length, 3, mode);
  });
});

test('real policy and target modes refuse executable links and gitlinks in either revision', () => {
  const cases = [[policyPath, 'docs'], ...identity.map(path => [path, 'identity']), ...gateway.map(path => [path, 'gateway']),
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
    assert.throws(() => auditInputMode(mode, bad, git, manifestPaths), path === 'docs/guide.md' ? /changed/ : /regular/);
    git('update-index', '--force-remove', path);
    rmSync(join(root, path), {recursive: true, force: true});
    put(path, original);
    const good = change(mode);
    assertNarrow(mode, plan(base, good));
    assert.equal(plan(bad, good).packages.length, 3, `${path}: ${kind} base`);
    assert.doesNotThrow(() => auditInputMode(mode, good, git, manifestPaths));
  });
});

test('malformed shared peer evidence and incomplete inventories refuse every mode in either revision', () => {
  for (const mode of Object.keys(fields)) fixture(({git, plan, base, change}) => {
    const head = change(mode); assertNarrow(mode, plan(base, head));
    for (const side of [base, head]) for (const fault of ['missing', 'malformed', 'schema', 'peer', 'duplicate-json', 'truncated', 'duplicate-tree', 'malformed-tree', 'missing-blob']) {
      const read = (...args) => {
        if (args[0] === 'ls-tree' && args.at(-1) === side) {
          const raw = git(...args);
          if (fault === 'truncated') return raw.slice(0, -1);
          if (fault === 'duplicate-tree') return raw + raw.split('\0')[0] + '\0';
          if (fault === 'malformed-tree') return 'malformed\0';
        }
        if (args[0] === 'show' && args[1] === `${side}:${policyPath}`) {
          if (fault === 'missing' || fault === 'missing-blob') throw Error('Missing saved policy');
          if (fault === 'malformed') return '{';
          const raw = git(...args), policy = JSON.parse(raw);
          if (fault === 'schema') policy.version = 2;
          if (fault === 'peer') policy[mode === 'identity' ? fields.gateway : fields.identity] = 'damaged';
          if (fault === 'duplicate-json') return raw.replace('"version":1', '"version":1,"version":1');
          return JSON.stringify(policy);
        }
        return git(...args);
      };
      assert.equal(plan(base, head, read).packages.length, 3, `${mode}: ${side}: ${fault}`);
    }
  });
});
