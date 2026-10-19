import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';

const policy = 'scripts/ci-input-audit.json';
const completeAudit = values => ({
  version: 1,
  docsInputSha256: '1'.repeat(64), identityInputSha256: '2'.repeat(64),
  gatewayInputSha256: '3'.repeat(64), lockInputSha256: '4'.repeat(64),
  manifests: {}, ...values,
});

function fixture(run, unrelatedDirectory = 'packages/unrelated') {
  const root = mkdtempSync(join(tmpdir(), 'cloud-lock-selection-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const write = (path, text) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), text);};
  const commit = () => {git('add', '.'); git('commit', '-sm', 'Lock selection fixture'); return git('rev-parse', 'HEAD').trim();};
  const lock = {
    lockfileVersion: '9.0', settings: {autoInstallPeers: true, excludeLinksFromLockfile: false},
    importers: {'.': {}, 'packages/catalogue': {dependencies: {adapter: {specifier: '^1.0.0', version: '1.0.0'}}},
      'packages/page': {}, 'packages/unrelated': {}},
    packages: {'adapter@1.0.0': {resolution: {integrity: 'sha512-YQ=='}}, 'leaf@1.0.0': {resolution: {integrity: 'sha512-Yg=='}}},
    snapshots: {'adapter@1.0.0': {dependencies: {leaf: '1.0.0'}}, 'leaf@1.0.0': {}},
  };
  if (unrelatedDirectory !== 'packages/unrelated') {
    delete lock.importers['packages/unrelated'];
    lock.importers[unrelatedDirectory] = {};
  }
  const save = () => write('pnpm-lock.yaml', Object.entries(lock).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join(''));
  const workspace = ['catalogue', 'page', 'unrelated'].map(name => ({name, directory: name === 'unrelated' ? unrelatedDirectory : `packages/${name}`, scripts: {test: 'node --test'}}));
  const audit = () => {
    git('add', '.');
    const entries = git('ls-files', '--stage', '-z').split('\0').filter(Boolean).map(entry => entry.replace(/ 0\t/, '\t'));
    const manifests = Object.fromEntries(workspace.map(pkg => [`${pkg.directory}/package.json`,
      createHash('sha256').update(JSON.stringify({directory: pkg.directory, name: pkg.name, scripts: pkg.scripts})).digest('hex')]));
    const inputs = entries.filter(entry => !['pnpm-lock.yaml', policy, ...Object.keys(manifests)].includes(entry.split('\t')[1]));
    write(policy, JSON.stringify(completeAudit({manifests, lockInputSha256: createHash('sha256').update(inputs.map(entry => entry.replace(/^([0-7]+) /, '$1 blob ') + '\0').join('')).digest('hex')})) + '\n');
  };
  const plan = (base, head, read = git) => createPlan({pull_request: {base: {sha: base}, head: {sha: head}}},
    {sha: head, repository: 'waitron-io/waitron-cloud'}, workspace, read, () => {throw Error('No API expected');});
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    write('package.json', '{"private":true}\n');
    for (const pkg of workspace) write(`${pkg.directory}/package.json`, JSON.stringify(pkg) + '\n');
    write('packages/page/test/reader.mjs', "import '../../../scripts/page-fixture.mjs';\n");
    write('scripts/page-fixture.mjs', "export const catalogue = '../packages/catalogue/src/index.ts';\n");
    write('packages/catalogue/src/index.ts', 'export const price = 1;\n');
    save(); audit();
    run({git, write, commit, lock, save, audit, plan});
  } finally {rmSync(root, {recursive: true, force: true});}
}

function assertSelected(plan, names = ['catalogue', 'page']) {
  assert.deepEqual(plan.packages, names.map(packageName => ({package: packageName, shard: 1})));
  assert.equal(plan.receipts.length, 5, 'Lock narrowing retains every receipt');
  assert.equal(plan.typecheck, true);
  assert.equal(plan.reuse, null);
}

test('audited lock-only changes select resolved importers and saved helper consumers despite a dirty worktree', () => fixture(({lock, save, commit, plan}) => {
  const base = commit();
  lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
  const head = commit();
  lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Yg=='; save();
  const result = plan(base, head);
  assertSelected(result);
  assert.match(result.reason, /pnpm-lock.yaml.*packages\/catalogue/);
  assert.match(result.reason, /audited.*package|package.*audit/i);
}));

test('removing an indirect resolution still runs its former importer and readers', () => fixture(({lock, save, commit, plan}) => {
  const base = commit();
  delete lock.snapshots['leaf@1.0.0']; delete lock.packages['leaf@1.0.0'];
  lock.snapshots['adapter@1.0.0'] = {}; save();
  assertSelected(plan(base, commit()));
}));

test('a new resolved version can select one isolated package without a manifest edit', () => fixture(({lock, save, commit, plan}) => {
  lock.importers['packages/unrelated'] = {dependencies: {leaf: {specifier: '^1.0.0', version: '1.0.0'}}};
  save(); const base = commit();
  lock.importers['packages/unrelated'].dependencies.leaf.version = '1.1.0';
  lock.packages['leaf@1.1.0'] = {resolution: {integrity: 'sha512-bmV3'}};
  lock.snapshots['leaf@1.1.0'] = {}; save();
  assertSelected(plan(base, commit()), ['unrelated']);
}));

test('stale, missing or malformed reader audit in either tree retains the full suite', () => fixture(({lock, save, commit, plan, git, write, audit}) => {
  const base = commit();
  lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
  const head = commit();
  for (const sha of [base, head]) for (const fault of ['missing', 'digest', 'version', 'symlink', 'lock-symlink', 'inventory']) {
    const read = (...args) => {
      if (args[0] === 'show' && args[1] === `${sha}:${policy}`) {
        if (fault === 'missing') throw Error('Missing audit');
        if (fault === 'digest') return JSON.stringify(completeAudit({lockInputSha256: '0'.repeat(64)}));
        if (fault === 'version') return JSON.stringify({...JSON.parse(git(...args)), version: 2});
      }
      if (args[0] === 'ls-tree' && args.includes(sha) && args.includes('--full-tree')) {
        if (fault === 'inventory') return 'malformed\0';
        if (fault === 'symlink') return git(...args).replace(/100644(?= blob [a-f0-9]+\tscripts\/ci-input-audit.json)/, '120000');
        if (fault === 'lock-symlink') return git(...args).replace(/100644(?= blob [a-f0-9]+\tpnpm-lock.yaml)/, '120000');
      }
      return git(...args);
    };
    assertSelected(plan(base, head, read), ['catalogue', 'page', 'unrelated']);
  }
  // A certificate for the new reader alone cannot qualify the old revision.
  write('scripts/new-reader.mjs', "export const lock = '../pnpm-lock.yaml';\n");
  audit(); const refreshed = commit();
  assertSelected(plan(base, refreshed), ['catalogue', 'page', 'unrelated']);
}));

test('an isolated application lock change retains all five receipts as well as the compiler', () => fixture(({lock, save, commit, plan}) => {
  lock.importers['apps/desk'] = {dependencies: {view: {specifier: '^1.0.0', version: '1.0.0'}}};
  lock.packages['view@1.0.0'] = {resolution: {integrity: 'sha512-dmlldw=='}};
  lock.snapshots['view@1.0.0'] = {}; save();
  const base = commit();
  lock.packages['view@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
  assertSelected(plan(base, commit()), ['unrelated']);
}, 'apps/desk'));

test('root, unknown or removed importers and no-op locks remain full even with valid audits', () => {
  for (const change of [
    ({lock}) => {lock.importers['.'] = {dependencies: {leaf: {specifier: '1.0.0', version: '1.0.0'}}};},
    ({lock}) => {lock.importers['packages/missing'] = {};},
    ({lock}) => {delete lock.importers['packages/page'];},
    () => {},
  ]) fixture(({lock, save, write, commit, plan}) => {
    const base = commit(); change({lock}); save();
    write('pnpm-lock.yaml', '# Lock change\n' + Object.entries(lock).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join(''));
    const result = plan(base, commit());
    assertSelected(result, ['catalogue', 'page', 'unrelated']);
    assert.doesNotMatch(result.reason, /audited package selection/);
  });
});

test('mixed paths, unsupported locks and lost package evidence cannot narrow package selection', () => fixture(({lock, save, write, commit, plan, git}) => {
  const base = commit();
  lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
  const head = commit();
  for (const sha of [base, head]) {
    const missing = (...args) => {
      if (args[0] === 'show' && args[1] === `${sha}:scripts/page-fixture.mjs`) throw Error('Missing saved helper');
      return git(...args);
    };
    assertSelected(plan(base, head, missing), ['catalogue', 'page', 'unrelated']);
    const unsupported = (...args) => args[0] === 'show' && args[1] === `${sha}:pnpm-lock.yaml` ? 'unsupported' : git(...args);
    assertSelected(plan(base, head, unsupported), ['catalogue', 'page', 'unrelated']);
  }
  write('packages/unrelated/src/index.ts', 'export const price = 2;\n');
  assertSelected(plan(base, commit()), ['catalogue', 'page', 'unrelated']);
}));

test('audited lock changes retain every package for an unchanged indirect directory reader', () => {
  for (const reader of [false, true]) fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('lock reader helper loaded');\n");
      write('packages/page/test/scan.mjs', `import {readdirSync} from 'node:fs';
for (const name of readdirSync?.call(null, new URL('../../../', import.meta.url))) {
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'lock reader helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  });
});

test('audited lock changes retain consumers behind direct non-null directory calls', () => {
  for (const reader of [false, true]) fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('non-null lock helper loaded');\n");
      write('packages/page/test/scan.mts', `import {readdirSync} from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for (const name of readdirSync!(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'non-null lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  });
});

test('audited lock changes retain consumers behind parenthesized directory calls', () => {
  for (const expression of ['(readdirSync)', '((readdirSync!)!)']) {
    for (const reader of [false, true]) fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (reader) {
        write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('parenthesized lock helper loaded');\n");
        write('packages/page/test/scan.mts', `import {readdirSync} from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      }
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'],
        {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'parenthesized lock helper loaded\n');
      assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    });
  }
});


test('audited lock changes retain consumers behind array directory readers', () => {
  for (const expression of ['[readdirSync][0]', '[readdirSync!,][0]', '[null, readdirSync][1]', '[null, readdirSync!,][1]']) {
    for (const reader of [false, true]) fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (reader) {
        write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('array lock helper loaded');\n");
        write('packages/page/test/scan.mts', `import {readdirSync} from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      }
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'],
        {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'array lock helper loaded\n');
      assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    });
  }
});

test('audited lock changes retain consumers behind middle array directory readers', () => {
  for (const expression of ['[null, readdirSync, null][1]']) {
    for (const reader of [false, true]) fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (reader) {
        write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('array lock helper loaded');\n");
        write('packages/page/test/scan.mts', `import {readdirSync} from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      }
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'],
        {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'array lock helper loaded\n');
      assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    });
  }
});

test('audited lock changes retain consumers behind logical and conditional directory readers', () => {
  for (const expression of ['[null, readdirSync || null, null][1]', '[null, false ? null : readdirSync, null][1]']) {
    for (const reader of [false, true]) fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (reader) {
        write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('array lock helper loaded');\n");
        write('packages/page/test/scan.mts', `import {readdirSync} from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      }
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'],
        {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'array lock helper loaded\n');
      assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    });
  }
});


test('audited lock changes retain consumers behind nested predecessor array readers', () => {
  for (const expression of ['[[], readdirSync, null][1]', '[{nested: [null]}, readdirSync, null][1]']) {
    for (const reader of [false, true]) fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (reader) {
        write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('nested lock helper loaded');\n");
        write('packages/page/test/scan.mts', `import {readdirSync} from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      }
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'],
        {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'nested lock helper loaded\n');
      assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    });
  }
});

test('audited lock changes retain consumers behind namespace middle array readers', () => {
  for (const expression of ['[0, fs.readdirSync, null][1]', '[0, fs /* namespace */ ! ?. readdirSync!, null].at(1)']) {
    for (const reader of [false, true]) fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (reader) {
        write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('nested lock helper loaded');\n");
        write('packages/page/test/scan.mts', `import * as fs from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      }
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'],
        {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'nested lock helper loaded\n');
      assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    });
  }
});


test('audited lock changes retain consumers behind deep namespace middle array readers', () => {
  for (const expression of ['[0, ns.fs.readdirSync, null][1]', '[[], ns!.nested?.fs!.readdirSync!, null][1]']) {
    for (const reader of [false, true]) fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (reader) {
        write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('deep lock helper loaded');\n");
        write('packages/page/test/scan.mts', `import * as fs from 'node:fs';
const ns = {fs, nested: {fs}};
const directory = new URL('../../../', import.meta.url);
for (const name of ${expression}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      }
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'],
        {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'deep lock helper loaded\n');
      assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    });
  }
});

test('audited lock changes retain consumers behind computed directory members', () => {
  for (const reader of [false, true]) fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('computed lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import * as fs from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for (const name of fs['readdirSync'](directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'computed lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  });
});

test('audited lock changes retain consumers behind escaped computed directory keys', async t => {
  for (const reader of [false, true]) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('escaped lock helper loaded');\n");
      write('packages/page/test/scan.mjs', String.raw`import * as fs from 'node:fs';
const directory = new URL('../../../', import.meta.url);
for (const name of fs['\u0072eaddirSync'](directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'escaped lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});


test('audited lock changes retain consumers behind parenthesized namespace readers', async t => {
  for (const reader of [false, true]) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('parenthesized lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import * as fs from 'node:fs';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for (const name of (fs).readdirSync(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'parenthesized lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});

test('audited lock changes retain consumers behind deep parenthesized namespace readers', async t => {
  for (const reader of [false, 'readdirSync', 'readdir']) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('parenthesized lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import * as fs from '${reader === 'readdir' ? 'node:fs/promises' : 'node:fs'}';
const ns = {nested: {fs}};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for (const name of await (ns).nested.fs.${reader}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'parenthesized lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});

test('audited lock changes retain consumers behind Unicode parenthesized namespace readers', async t => {
  for (const reader of [false, 'readdirSync', 'readdir']) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('parenthesized lock helper loaded');\n");
      write('packages/page/test/scan.mjs', String.raw`import * as fs from '${reader === 'readdir' ? 'node:fs/promises' : 'node:fs'}';
const ns = {nested: {fs}};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for (const name of await (ns).\u{000006e}ested.fs.${reader}(directory)) {
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'parenthesized lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});

test('audited lock changes retain consumers behind computed intermediate directory members', async t => {
  for (const reader of [false, 'readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('indexed lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import * as fs from '${reader.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const ns = {nested: {fs}};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await (ns)['nested'].fs.${reader}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'indexed lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});

test('audited lock changes retain consumers behind escaped final API members', async t => {
  for (const reader of [false, 'readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('indexed lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import * as fs from '${reader.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const ns = {nested: {fs}};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await fs.${reader.slice(0, -1)}\\u${reader.charCodeAt(reader.length - 1).toString(16).padStart(4, '0')}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'indexed lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});
