import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {receiptPlan} from './ci-receipts.mjs';
import {loadWorkspace, receiptSuites} from './ci-scope.mjs';

const suite = 'test:database-recovery-receipt';
const inputs = [
  '.dockerignore',
  '.env.example',
  '.gitignore',
  'apps/portal/package.json',
  'compose.yaml',
  'packages/account-http/package.json',
  'packages/fiscal-allocation/package.json',
  'packages/identity/package.json',
  'packages/operations/package.json',
  'packages/registration/package.json',
  'packages/remote-access/package.json',
  'packages/ui-smoke/package.json',

  '.github/workflows/ci.yml', '.npmrc', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
  'packages/backups/package.json',
  'packages/registration/src/migrate.ts', 'packages/registration/src/transaction.ts',
  'scripts/database-recovery-fixture.mjs', 'scripts/database-recovery-receipt.mjs',
  'scripts/database-recovery-migrations.mjs', 'scripts/database-recovery-migrations.test.mjs',
  'scripts/verify-database-recovery-receipt.mjs', 'scripts/verify-database-recovery-receipt.test.mjs',
];
const workspace = loadWorkspace();
const expected = receiptSuites.filter(name => name !== suite);
function fixture(run, alter = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-database-inputs-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  try {
    git('init', '-q');
    git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    for (const path of inputs) {
      mkdirSync(dirname(join(root, path)), {recursive: true});
      copyFileSync(path, join(root, path));
    }
    alter(root);
    git('add', '-f', '.'); git('commit', '-s', '-qm', 'Seed database recovery inputs');
    const base = git('rev-parse', 'HEAD').trim();
    mkdirSync(join(root, 'packages/registration/src'), {recursive: true});
    writeFileSync(join(root, 'packages/registration/src/database-control.ts'), 'export const databaseControl = true;\n');
    git('add', '-f', '.'); git('commit', '-s', '-qm', 'Change unrelated package');
    const head = git('rev-parse', 'HEAD').trim();
    const select = (old = base, next = head, execute = git, scope = {full: false}) => receiptPlan(receiptSuites, scope, old, next, execute);
    const commit = () => {git('add', '-f', '.'); git('commit', '-s', '-qm', 'Change audited input'); return git('rev-parse', 'HEAD').trim();};
    run({root, git, base, head, select, commit});
  } finally { rmSync(root, {recursive: true, force: true}); }
}

test('unrelated package changes omit database recovery while retaining packages, types and other receipts', () => {
  fixture(({git, base, head, select}) => {
    assert.deepEqual(select().receipts, expected);
    const plan = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, workspace, git, () => {throw Error('No reuse');});
    assert.deepEqual(plan.receipts, expected);
    assert.equal(plan.packages.length, 19);
    assert.equal(plan.typecheck, true);
    assert.match(plan.reason, /omitted database recovery receipt.*both revisions/i);
  });
});

test('every changed or removed database recovery input in either revision retains database recovery', () => {
  for (const path of inputs) {
    fixture(({root, base, select, commit}) => {
      writeFileSync(join(root, path), '// Changed input\n');
      assert.deepEqual(select(base, commit()).receipts, receiptSuites, path);
    });
    fixture(({root, base, select, commit}) => {
      rmSync(join(root, path));
      assert.deepEqual(select(base, commit()).receipts, receiptSuites, path);
    });
    fixture(({root, base, select, commit}) => {
      copyFileSync(path, join(root, path));
      assert.deepEqual(select(base, commit()).receipts, receiptSuites, path);
    }, root => writeFileSync(join(root, path), '// Unaudited base input\n'));
  }
});

test('linked and executable database recovery inputs invalidate otherwise identical contents', () => {
  for (const path of inputs) {
    fixture(({select}) => assert.deepEqual(select().receipts, receiptSuites, path), root => chmodSync(join(root, path), 0o755));
    fixture(({select}) => assert.deepEqual(select().receipts, receiptSuites, path), root => {
      const target = join(root, path); rmSync(target); symlinkSync('unaudited-target', target);
    });
  }
});

test('unknown, full and incomplete evidence cannot omit database recovery', () => {
  fixture(({git, base, head, select}) => {
    for (const [old, next] of [['', head], [base, ''], ['HEAD', head], [base, 'HEAD']]) {
      assert.deepEqual(select(old, next).receipts, receiptSuites);
    }
    assert.deepEqual(select(base, head, git, {full: true}).receipts, receiptSuites);
    for (const execute of [
      (...args) => {if (args[0] === 'ls-tree') throw Error('Missing tree'); return git(...args);},
      (...args) => args[0] === 'ls-tree' ? git(...args).slice(0, -1) : git(...args),
      (...args) => args[0] === 'ls-tree' ? git(...args) + 'unfinished' : git(...args),
    ]) assert.deepEqual(select(base, head, execute).receipts, receiptSuites);
  });
});

test('migration module changes keep database recovery in the actual PR plan', () => {
  fixture(({root, git, base, commit}) => {
    writeFileSync(join(root, 'packages/registration/src/migrate.ts'), '// Changed migration module\n');
    const head = commit();
    const plan = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, workspace, git, () => {});
    assert.ok(plan.receipts.includes(suite));
    assert.ok(plan.packages.some(row => row.package === '@waitron-cloud/registration'));
  });
});

test('new install hooks and changed sibling install manifests retain database recovery', () => {
  fixture(({root, base, select, commit}) => {
    writeFileSync(join(root, '.pnpmfile.cjs'), 'module.exports = {hooks: {}};\n');
    assert.deepEqual(select(base, commit()).receipts, receiptSuites);
  });
  fixture(({root, base, select, commit}) => {
    mkdirSync(join(root, 'packages/install-fixture'), {recursive: true});
    writeFileSync(join(root, 'packages/install-fixture/package.json'), '{"name":"install-fixture","scripts":{"postinstall":"node setup.mjs"}}\n');
    assert.deepEqual(select(base, commit()).receipts, receiptSuites);
  });
});

for (const [name, path, value] of [
  ['nested module manifests', 'packages/registration/src/package.json', '{"type":"commonjs"}\n'],
  ['tracked dependency overrides', 'packages/registration/src/node_modules/pg/index.js', 'module.exports = {};\n'],
]) test(`${name} in either revision retain database recovery`, () => {
  const change = root => {
    mkdirSync(dirname(join(root, path)), {recursive: true});
    writeFileSync(join(root, path), value);
  };
  fixture(({root, base, select, commit}) => {
    change(root);
    assert.deepEqual(select(base, commit()).receipts, receiptSuites);
  });
  fixture(({root, base, select, commit}) => {
    rmSync(join(root, path));
    assert.deepEqual(select(base, commit()).receipts, receiptSuites);
  }, change);
});
