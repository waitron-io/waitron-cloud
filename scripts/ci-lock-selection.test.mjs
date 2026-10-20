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

test('audited lock changes retain consumers behind escaped bare directory APIs', async t => {
  for (const reader of [false, 'readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('bare lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import {${reader}} from '${reader.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await \\u{00000${reader.charCodeAt(0).toString(16)}}${reader.slice(1)}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'bare lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});

test('audited lock changes retain consumers behind closing bracket receivers', async t => {
  for (const reader of [false, 'readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('bracket lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import * as fs from '${reader.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const ns = {nested: {fs}};
const keys = ['nested'];
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await (ns)[keys[0]].fs.${reader}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'bracket lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});

test('audited lock changes retain consumers behind tagged template receivers', async t => {
  for (const reader of [false, 'readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('tagged lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import * as fs from '${reader.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const ns = {nested: () => ({fs})};
const keys = ['nested'];
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await ns[keys[0]]\`\`.fs.${reader}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'tagged lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});


test('audited lock changes retain readers after nested and ordinary array predecessors', async t => {
  for (const reader of [false, 'readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('nested predecessor lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import {${reader}} from '${reader.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const scan = [[], 0, ${reader}, null][2];
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'nested predecessor lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});

test('audited lock changes retain first array namespace directory readers', async t => {
  for (const reader of [false, 'readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('first namespace lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import * as fs from '${reader.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const scan = [fs.${reader}, null][0];
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'first namespace lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});

test('audited lock changes retain first array Unicode namespace directory readers', async t => {
  for (const reader of [false, 'readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(`reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('first Unicode namespace lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import * as fs from '${reader.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const ñs = fs;
const scan = [ñs.${reader}, null][0];
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'first Unicode namespace lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});

test('audited lock changes retain middle array Unicode namespace directory readers', async t => {
  for (const prefix of ['0', '[], 0']) for (const reader of [false, 'readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(`${prefix}: reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('middle Unicode namespace lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import * as fs from '${reader.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const ñs = fs;
const scan = [${prefix}, ñs.${reader}, null].at(-2);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'middle Unicode namespace lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});

test('audited lock changes retain Unicode logical and conditional directory readers', async t => {
  for (const operator of ['null ||', 'false ? null :']) for (const reader of [false, 'readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(`${operator}: reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    if (reader) {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('Unicode operand lock helper loaded');\n");
      write('packages/page/test/scan.mjs', `import * as ñs from '${reader.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const scan = ${operator} ñs.${reader};
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
    }
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
      {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'Unicode operand lock helper loaded\n');
    assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
  }));
});

test('audited lock changes retain assigned and awaited directory readers', async t => {
  for (const operation of ['scan ||= ñs.readdirSync;', 'scan ??= ñs.readdir;', 'scan &&= ñs.opendirSync;', 'scan ||= ñs.opendir;', 'scan = null || await ñs.readdirSync;', 'scan ??= await ñs.readdir;']) {
    for (const reader of [false, true]) await t.test(`${operation} reader ${reader}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (reader) {
        write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('operator lock helper loaded');\n");
        write('packages/page/test/scan.mjs', `import * as ñs from '${/Sync/.test(operation) ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
let scan = ${operation.includes('&&=') ? 'true' : 'null'};
${operation}
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      }
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      if (reader) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'],
        {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'operator lock helper loaded\n');
      assertSelected(plan(base, head), reader ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    }));
  }
});

test('audited lock changes retain readers after quoted or commented predecessors', async t => {
  for (const prefix of ["'a;b'", '"a;b"', '`a;b`', '0 /* ; */', '0 // ;\n', '/[;{]/']) {
    for (const nested of [false, true]) await t.test(`${nested ? 'nested ' : ''}${prefix}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      write('packages/catalogue/src/adapter.mjs', 'export const price = 1;\n');
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/adapter.mjs';\nconsole.log('quoted lock helper loaded');\n");
      write('packages/page/test/scan.mts', `import * as ñs from 'node:fs';
const directory = new URL('../../../', import.meta.url);
const scan = [${nested ? '[], ' : ''}${prefix}, ñs.readdirSync, null].at(-2);
for (const name of scan(directory)) if (name.endsWith('.mjs')) await import(new URL(name, directory));
`);
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'quoted lock helper loaded\n');
      assertSelected(plan(base, head), ['catalogue', 'page', 'unrelated']);
    }));
  }
  await t.test('without a directory reader', () => fixture(({lock, save, commit, plan}) => {
    const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    assertSelected(plan(base, commit()));
  }));
});


test('audited lock changes retain semicolon-terminated directory references', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir', null]) {
    await t.test(api ?? 'without a reader', () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (api) {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('stored lock helper loaded');\n");
        write('packages/page/test/scan.mts', `import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const scan = ñs.${api};
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      }
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      if (api) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'],
        {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'stored lock helper loaded\n');
      assertSelected(plan(base, head), api ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    }));
  }
});


test('audited lock changes retain newline and comma reader declarations', async t => {
  for (const ending of ['\n', ', unused = 1;']) for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir', null]) {
    await t.test(`${JSON.stringify(ending)} ${api ?? 'without a reader'}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (api) {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('declaration lock helper loaded');\n");
        write('packages/page/test/scan.mts', `import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
const scan = ñs.${api}${ending}
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      }
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      if (api) assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), 'declaration lock helper loaded\n');
      assertSelected(plan(base, head), api ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    }));
  }
});


test('audited lock changes retain exported directory readers at EOF', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir', null]) {
    await t.test(api ?? 'without a reader', () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (api) {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('EOF lock helper loaded');\n");
        write('tools/reader.mts', `import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
export const scan = ñs.${api}`);
      } else {
        write('tools/reader.mts', 'export const scan = () => []');
      }
      write('packages/page/test/scan.mts', `import {scan} from '../../../tools/reader.mts';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), api ? 'EOF lock helper loaded\n' : '');
      assertSelected(plan(base, head), api ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    }));
  }
});


test('audited lock changes retain default-exported directory readers', async t => {
  for (const [api, prefix] of ['readdirSync', 'readdir', 'opendirSync', 'opendir'].flatMap(api => [[api, ''], [api, 'await ']]).concat([[null, '']])) {
    await t.test(api ? prefix + api : 'without a reader', () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (api) {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('default lock helper loaded');\n");
        write('tools/reader.mts', `import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
export default ${prefix}ñs.${api}`);
      } else {
        write('tools/reader.mts', 'export default () => []');
      }
      write('packages/page/test/scan.mts', `import scan from '../../../tools/reader.mts';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), api ? 'default lock helper loaded\n' : '');
      assertSelected(plan(base, head), api ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    }));
  }
});

test('audited lock changes retain class-field and arrow-return directory readers', async t => {
  for (const form of ['field', 'arrow']) for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir', null]) {
    await t.test(`${form}: ${api ?? 'without a reader'}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      if (api) {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('retained lock helper loaded');\n");
        write('tools/reader.mts', `import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
${form === 'field' ? `export default class { scan = ñs.${api}}` : `export default () => ñs.${api}`}`);
      } else {
        write('tools/reader.mts', "import {readdirSync} from 'node:fs';\n" + (form === 'field' ? 'export default class { scan = () => []}' : 'export default () => () => []'));
      }
      write('packages/page/test/scan.mts', `import makeReader from '../../../tools/reader.mts';
const scan = ${form === 'field' ? 'new makeReader().scan' : 'makeReader()'};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), api ? 'retained lock helper loaded\n' : '');
      assertSelected(plan(base, head), api ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    }));
  }
});


test('audited lock changes retain block-returned directory readers', async t => {
  for (const form of ['arrow', 'method', 'awaited']) for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir', null]) {
    await t.test(`${form}: ${api ?? 'without a reader'}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      const value = api ? `ñs.${api}` : '(() => [])';
      write('tools/reader.mts', `import {readdirSync} from 'node:fs';
${api ? `import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';` : ''}
${form === 'method' ? `export default class { scan() { return ${value} } }` :
  form === 'awaited' ? `export default async () => { return await ${value} }` : `export default () => { return ${value} }`}`);
      if (api) write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('returned lock helper loaded');\n");
      write('packages/page/test/scan.mts', `import makeReader from '../../../tools/reader.mts';
const scan = ${form === 'method' ? 'await new makeReader().scan()' : 'await makeReader()'};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), api ? 'returned lock helper loaded\n' : '');
      assertSelected(plan(base, head), api ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    }));
  }
});


test('audited lock changes retain generator-yielded directory readers', async t => {
  for (const form of ['generator', 'async', 'method']) for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir', null]) {
    await t.test(`${form}: ${api ?? 'without a reader'}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      const value = api ? `ñs.${api}` : '(() => [])';
      write('tools/reader.mts', `import {readdirSync} from 'node:fs';
${api ? `import * as ñs from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';` : ''}
${form === 'method' ? `export default class { *scan() { yield ${value} } }` :
  form === 'async' ? `export default async function* makeReader() { yield await ${value} }` : `export default function* makeReader() { yield ${value} }`}`);
      if (api) write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('yielded lock helper loaded');\n");
      write('packages/page/test/scan.mts', `import makeReader from '../../../tools/reader.mts';
const scan = ${form === 'method' ? 'new makeReader().scan().next().value' : form === 'async' ? '(await makeReader().next()).value' : 'makeReader().next().value'};
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), api ? 'yielded lock helper loaded\n' : '');
      assertSelected(plan(base, head), api ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    }));
  }
});


test('audited lock changes retain object-shorthand directory readers', async t => {
  for (const object of ['{API}', '{API, n: 1}', '{n: 1, API}']) for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir', null]) {
    await t.test(`${object}: ${api ?? 'without a reader'}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      const value = api ? object.replaceAll('API', api) : '{scan: () => []}';
      write('tools/reader.mts', `import {readdirSync} from 'node:fs';
${api && api !== 'readdirSync' ? `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';` : ''}
export default function* makeReader() { yield ${value} }`);
      if (api) write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('object lock helper loaded');\n");
      write('packages/page/test/scan.mts', `import makeReader from '../../../tools/reader.mts';
const scan = Object.values(makeReader().next().value).find(value => typeof value === 'function');
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), api ? 'object lock helper loaded\n' : '');
      assertSelected(plan(base, head), api ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    }));
  }
});


test('audited lock changes retain call-argument directory readers', async t => {
  for (const args of ['0, API, 2', '0, ns /* member */ ! ?. API!, 2']) for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir', null]) {
    await t.test(`${args}: ${api ?? 'without a reader'}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      write('tools/reader.mts', `import {readFileSync, readdirSync, opendirSync} from 'node:fs';
${api ? `import * as ns from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';` : ''}
${api && !api.endsWith('Sync') ? `import {${api}} from 'node:fs/promises';` : ''}
const pass = (...values) => values.find(value => typeof value === 'function');
export default pass(${api ? args.replaceAll('API', api) : '0, () => [], 2'});`);
      if (api) write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('argument lock helper loaded');\n");
      write('packages/page/test/scan.mts', `import scan from '../../../tools/reader.mts';
const directory = new URL(['..', '..', '..', ''].join('/'), import.meta.url);
for await (const item of await scan(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL(name, directory));
}
`);
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8'}), api ? 'argument lock helper loaded\n' : '');
      assertSelected(plan(base, head), api ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    }));
  }
});


// Losing the URL base drops a real root-helper consumer from audited lock work.
test('audited lock changes retain commented URL directory consumers', async t => {
  for (const binding of ['direct', 'stored']) for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir', null]) {
    await t.test(`${binding}: ${api ?? 'without a reader'}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('commented URL lock helper loaded');\n");
      const directory = "new URL('../../../', import /* base */ . meta // base\n . url)";
      write('packages/unrelated/test/scan.mjs', api ? `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
${binding === 'stored' ? `const directory = ${directory};` : ''}
for await (const item of await ${api}(${binding === 'stored' ? 'directory' : directory})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('.mjs')) await import(new URL('../../../' + name, import.meta.url));
}` : `const directory = ${directory};`);
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/unrelated/test/scan.mjs'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8', timeout: 5000}), api ? 'commented URL lock helper loaded\n' : '');
      write('packages/unrelated/test/scan.mjs', 'export const dirty = true;');
      assertSelected(plan(base, head), api ? ['catalogue', 'page', 'unrelated'] : ['catalogue', 'page']);
    }));
  }
});


// Missing recursive-option discovery must not make an audited lock change skip a reader.
test('audited lock changes retain commented URL recursive scans', async t => {
  for (const binding of ['direct', 'stored']) for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    await t.test(`${binding}: ${api}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
      write('adapters/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.ts';\nconsole.log('recursive URL lock helper loaded');\n");
      const directory = "new URL('../../../', import /* base */ . meta // base\n . url)";
      write('packages/unrelated/test/scan.mjs', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
import {pathToFileURL} from 'node:url';
${binding === 'stored' ? `const directory = ${directory};` : ''}
for await (const item of await ${api}(${binding === 'stored' ? 'directory' : directory}, {recursive: true})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(typeof item === 'string' ? new URL(item, new URL('../../../', import.meta.url)) : pathToFileURL(item.parentPath + '/' + item.name));
}`);
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      assert.equal(execFileSync(process.execPath, ['packages/unrelated/test/scan.mjs'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8', timeout: 5000}), 'recursive URL lock helper loaded\n');
      write('packages/unrelated/test/scan.mjs', 'export const dirty = true;');
      assertSelected(plan(base, head), ['catalogue', 'page', 'unrelated']);
    }));
  }
});

// Losing a Unicode URL binding must not hide a reader of a changed importer.
test('audited lock changes retain Unicode URL-variable directory consumers', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) for (const name of ['ñdirectorio', 'directorioñ']) {
    await t.test(`${api} ${name}`, () => fixture(({write, lock, save, audit, commit, plan}) => {
      write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\n");
      write('scripts/page-fixture.mjs', 'export const inert = true;\n');
      write('packages/page/test/scan.mjs', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const ${name} = new URL('../../../', import.meta.url);
${api}(${name});
`);
      audit(); const base = commit();
      lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
      const head = commit();
      write('catalogue-adapter.mjs', 'export const dirty = true;\n');
      assertSelected(plan(base, head), ['catalogue', 'page']);
    }));
  }
});

test('audited lock changes keep recursive Unicode URL-variable readers full', async t => {
  for (const name of ['ñdirectorio', 'directorioñ']) await t.test(name, () => fixture(({write, lock, save, audit, commit, plan}) => {
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.ts';\n");
    write('packages/page/test/scan.mjs', `import {readdirSync} from 'node:fs';
const ${name} = new URL('../../../', import.meta.url);
readdirSync(${name}, {recursive: true});
`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    assertSelected(plan(base, commit()), ['catalogue', 'page', 'unrelated']);
  }));
});

test('audited lock changes keep unused Unicode URL bindings narrow', () => fixture(({write, lock, save, audit, commit, plan}) => {
  write('scripts/page-fixture.mjs', 'export const inert = true;\n');
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\n");
  write('packages/page/test/scan.mjs', "const ñdirectorio = new URL('../../../', import.meta.url);\n");
  audit(); const base = commit();
  lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
  assertSelected(plan(base, commit()), ['catalogue']);
}));

// Losing escaped URL binding discovery or normalization must retain real lock consumers.
test('audited lock changes retain escaped URL-variable directory consumers', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) {
    for (const [binding, use] of [[String.raw`\u0064irectory`, 'directory'], ['directory', String.raw`\u{64}irectory`]]) {
      await t.test(`${api} ${binding} / ${use}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
        write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('escaped URL lock helper loaded');\n");
        write('scripts/page-fixture.mjs', 'export const inert = true;\n');
        write('packages/page/test/scan.mjs', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const ${binding} = new URL('../../../', import.meta.url);
for await (const item of await ${api}(${use})) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(new URL('../../../' + name, import.meta.url));
}`);
        audit(); const base = commit();
        lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
        const head = commit();
        assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mjs'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8', timeout: 5000}), 'escaped URL lock helper loaded\n');
        write('catalogue-adapter.mjs', 'export const dirty = true;\n');
        assertSelected(plan(base, head), ['catalogue', 'page']);
      }));
    }
  }
});

test('audited lock changes keep recursive escaped URL-variable readers full', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({write, lock, save, audit, commit, plan}) => {
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.ts';\n");
    write('packages/page/test/scan.mjs', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const \\u0064irectory = new URL('../../../', import.meta.url);
${api}(\\u{64}irectory, {recursive: true});
`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    assertSelected(plan(base, commit()), ['catalogue', 'page', 'unrelated']);
  }));
});

test('audited lock changes keep unused escaped URL bindings narrow', () => fixture(({write, lock, save, audit, commit, plan}) => {
  write('scripts/page-fixture.mjs', 'export const inert = true;\n');
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\n");
  write('packages/page/test/scan.mjs', "const \\u0064irectory = new URL('../../../', import.meta.url);\n");
  audit(); const base = commit();
  lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
  assertSelected(plan(base, commit()), ['catalogue']);
}));

// Literal-only URL labels must not drop a reader of a changed lock importer.
test('audited lock changes retain escaped URL constructor and type consumers', async t => {
  for (const [constructor, annotation, binding] of [
    [String.raw`\u0055RL`, '', 'direct'],
    [String.raw`UR\u{4C}`, '', 'stored'],
    ['URL', String.raw`: U\u0052L`, 'stored'],
    [String.raw`\u{000055}RL`, String.raw`: UR\u004c`, 'stored'],
  ]) await t.test(`${constructor}${annotation} ${binding}`, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('URL label lock helper loaded');\n");
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    const directory = `new ${constructor}('../../../', import.meta.url)`;
    write('packages/page/test/scan.mts', `import {readdirSync} from 'node:fs';
${binding === 'stored' ? `const directory${annotation} = ${directory};` : ''}
for (const name of readdirSync(${binding === 'stored' ? 'directory' : directory})) {
  if (name.endsWith('-adapter.mjs')) await import(new URL('../../../' + name, import.meta.url));
}`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8', timeout: 5000}), 'URL label lock helper loaded\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assertSelected(plan(base, head), ['catalogue', 'page']);
  }));
});

test('audited lock changes keep recursive escaped URL-label readers full', async t => {
  for (const binding of ['direct', 'stored']) await t.test(binding, () => fixture(({write, lock, save, audit, commit, plan}) => {
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.ts';\n");
    const directory = String.raw`new \u0055RL('../../../', import.meta.url)`;
    write('packages/page/test/scan.mts', `import {readdirSync} from 'node:fs';
${binding === 'stored' ? String.raw`const directory: U\u{52}L = ` + directory + ';' : ''}
readdirSync(${binding === 'stored' ? 'directory' : directory}, {recursive: true});
`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    assertSelected(plan(base, commit()), ['catalogue', 'page', 'unrelated']);
  }));
});

test('audited lock changes keep unused escaped URL-label bindings narrow', () => fixture(({write, lock, save, audit, commit, plan}) => {
  write('scripts/page-fixture.mjs', 'export const inert = true;\n');
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\n");
  write('packages/page/test/scan.mts', String.raw`const directory: U\u0052L = new \u0055RL('../../../', import.meta.url);`);
  audit(); const base = commit();
  lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
  assertSelected(plan(base, commit()), ['catalogue']);
}));

// A missing URL alias edge must not omit a changed importer's executed consumer.
test('audited lock changes retain URL declaration alias consumers', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('URL alias lock helper loaded');\n");
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('packages/page/test/scan.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const original = new URL('../../../', import.meta.url), middle = original, directory = middle;
for await (const item of await ${api}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(new URL('../../../' + name, import.meta.url));
}`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8', timeout: 5000}), 'URL alias lock helper loaded\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assertSelected(plan(base, head), ['catalogue', 'page']);
  }));
});

test('audited lock changes keep root URL aliases with options full', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({write, lock, save, audit, commit, plan}) => {
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.ts';\n");
    write('packages/page/test/scan.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const original = new URL('../../../', import.meta.url), middle = original, directory = middle;
${api}(directory, {recursive: true});
`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const selected = plan(base, commit());
    assertSelected(selected, ['catalogue', 'page', 'unrelated']);
    assert.match(selected.reason, /full suite retained until root readers are covered/);
  }));
});

test('audited lock changes keep unused URL aliases narrow', () => fixture(({write, lock, save, audit, commit, plan}) => {
  write('scripts/page-fixture.mjs', 'export const inert = true;\n');
  write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\n");
  write('packages/page/test/scan.mts', "const original = new URL('../../../', import.meta.url), directory = original;\n");
  audit(); const base = commit();
  lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
  assertSelected(plan(base, commit()), ['catalogue']);
}));


test('audited lock changes retain URL aliases ending in a line comment without a semicolon', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('commented alias lock helper loaded');\n");
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('packages/page/test/scan.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const original = new URL('../../../', import.meta.url), intermediate = original, directory = intermediate // URL alias
for await (const item of await ${api}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(new URL('../../../' + name, import.meta.url));
}`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8', timeout: 5000}), 'commented alias lock helper loaded\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assertSelected(plan(base, head), ['catalogue', 'page']);
  }));
});


// Missing a later URL transfer must not hide an executed lock dependency consumer.
test('audited lock changes retain later URL assignment chains', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('assigned URL lock helper loaded');\n");
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('packages/page/test/scan.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const original = new URL('../../../', import.meta.url); let middle, directory;
directory = middle = original;
for await (const item of await ${api}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(new URL('../../../' + name, import.meta.url));
}`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8', timeout: 5000}), 'assigned URL lock helper loaded\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assertSelected(plan(base, head), ['catalogue', 'page']);
  }));
});

test('audited lock changes keep assigned root URLs with options full', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({write, lock, save, audit, commit, plan}) => {
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.ts';\n");
    write('packages/page/test/scan.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const original = new URL('../../../', import.meta.url); let middle, directory;
directory = middle = original;
${api}(directory, {recursive: true});
`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const selected = plan(base, commit());
    assertSelected(selected, ['catalogue', 'page', 'unrelated']);
    assert.match(selected.reason, /full suite retained until root readers are covered/);
  }));
});

// Missing a later URL constructor input must not hide an executed lock dependency consumer.
test('audited lock changes retain later URL constructor assignment chains', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('assigned URL lock helper loaded');\n");
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('packages/page/test/scan.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
let middle, directory;
directory = middle = new URL('../../../', import.meta.url);
for await (const item of await ${api}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(new URL('../../../' + name, import.meta.url));
}`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8', timeout: 5000}), 'assigned URL lock helper loaded\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assertSelected(plan(base, head), ['catalogue', 'page']);
  }));
});

test('audited lock changes keep later constructor root URLs with options full', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({write, lock, save, audit, commit, plan}) => {
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.ts';\n");
    write('packages/page/test/scan.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
let middle, directory;
directory = middle = new URL('../../../', import.meta.url);
${api}(directory, {recursive: true});
`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const selected = plan(base, commit());
    assertSelected(selected, ['catalogue', 'page', 'unrelated']);
    assert.match(selected.reason, /full suite retained until root readers are covered/);
  }));
});

// Missing a later URL constructor input must not hide an executed lock dependency consumer.
test('audited lock changes retain parenthesized URL value chains', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('assigned URL lock helper loaded');\n");
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('packages/page/test/scan.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
let middle, directory;
const original = (new URL('../../../', import.meta.url));
directory = (middle = ((original)));
for await (const item of await ${api}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(new URL('../../../' + name, import.meta.url));
}`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8', timeout: 5000}), 'assigned URL lock helper loaded\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assertSelected(plan(base, head), ['catalogue', 'page']);
  }));
});

test('audited lock changes keep parenthesized root URL values with options full', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({write, lock, save, audit, commit, plan}) => {
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.ts';\n");
    write('packages/page/test/scan.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
let middle, directory;
const original = (new URL('../../../', import.meta.url));
directory = (middle = ((original)));
${api}(directory, {recursive: true});
`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const selected = plan(base, commit());
    assertSelected(selected, ['catalogue', 'page', 'unrelated']);
    assert.match(selected.reason, /full suite retained until root readers are covered/);
  }));
});

// Missing a later URL constructor input must not hide an executed lock dependency consumer.
test('audited lock changes retain parenthesized default parameter URL values', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({git, write, lock, save, audit, commit, plan}) => {
    write('catalogue-adapter.mjs', "import './packages/catalogue/src/index.ts';\nconsole.log('assigned URL lock helper loaded');\n");
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('packages/page/test/scan.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const original = new URL('../../../', import.meta.url);
function target(directory = ((original))) { return directory; }
const directory = target();
for await (const item of await ${api}(directory)) {
  const name = typeof item === 'string' ? item : item.name;
  if (name.endsWith('-adapter.mjs')) await import(new URL('../../../' + name, import.meta.url));
}`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const head = commit();
    assert.equal(execFileSync(process.execPath, ['packages/page/test/scan.mts'], {cwd: git('rev-parse', '--show-toplevel').trim(), encoding: 'utf8', timeout: 5000}), 'assigned URL lock helper loaded\n');
    write('catalogue-adapter.mjs', 'export const dirty = true;\n');
    assertSelected(plan(base, head), ['catalogue', 'page']);
  }));
});

test('audited lock changes keep parenthesized default parameter root URL values with options full', async t => {
  for (const api of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) await t.test(api, () => fixture(({write, lock, save, audit, commit, plan}) => {
    write('scripts/page-fixture.mjs', 'export const inert = true;\n');
    write('nested/catalogue-adapter.mjs', "import '../packages/catalogue/src/index.ts';\n");
    write('packages/page/test/scan.mts', `import {${api}} from '${api.endsWith('Sync') ? 'node:fs' : 'node:fs/promises'}';
const original = new URL('../../../', import.meta.url);
function target(directory = ((original))) { return directory; }
const directory = target();
${api}(directory, {recursive: true});
`);
    audit(); const base = commit();
    lock.packages['leaf@1.0.0'].resolution.integrity = 'sha512-Y2hhbmdlZA=='; save();
    const selected = plan(base, commit());
    assertSelected(selected, ['catalogue', 'page', 'unrelated']);
    assert.match(selected.reason, /full suite retained until root readers are covered/);
  }));
});
