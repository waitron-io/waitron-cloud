import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {receiptFixtureWorkspace, copyReceiptFixtureInput} from './ci-dependency-fixture.mjs';
import {createPlan} from './ci-plan.mjs';
import {receiptPlan} from './ci-receipts.mjs';
import {receiptSuites} from './ci-scope.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';

const suite = 'test:public-gateway-limits';
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
  'packages/remote-access/src/public-gate.ts', 'packages/remote-access/src/public-unavailable.ts',
  'scripts/public-gateway-limits.mjs', 'scripts/public-gateway-limits.test.mjs',
  'scripts/public-gateway-limits-receipt-fixture.mjs',
  'scripts/verify-public-gateway-limits-receipt.mjs', 'scripts/verify-public-gateway-limits-receipt.test.mjs',
  'scripts/ci-run-receipts.mjs',
  'scripts/ci-package-groups.mjs', 'scripts/ci-run-package-group.mjs',
  'scripts/ci-scope.mjs',
];
const workspace = receiptFixtureWorkspace();
const expected = receiptSuites.filter(name => name !== suite);
function fixture(run, alter = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-gateway-inputs-'));
  // Disposable repositories must not start detached Git maintenance.
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  // Use the planner's batch protocol so source discovery does not spawn once per file.
  git.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['-c', 'maintenance.auto=false', 'cat-file', '--batch'],
    {cwd: root, input, timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']}));
  try {
    git('init', '-q');
    git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    for (const path of inputs) {
      mkdirSync(dirname(join(root, path)), {recursive: true});
      copyReceiptFixtureInput(path, join(root, path));
    }
    alter(root);
    git('add', '-f', '.'); git('commit', '-s', '-qm', 'Seed public gateway inputs');
    const base = git('rev-parse', 'HEAD').trim();
    mkdirSync(join(root, 'packages/registration/src'), {recursive: true});
    writeFileSync(join(root, 'packages/registration/src/gateway-control.ts'), 'export const gatewayControl = true;\n');
    git('add', '-f', '.'); git('commit', '-s', '-qm', 'Change unrelated package');
    const head = git('rev-parse', 'HEAD').trim();
    const select = (old = base, next = head, execute = git, scope = {full: false}) => receiptPlan(receiptSuites, scope, old, next, execute);
    const commit = () => {git('add', '-f', '.'); git('commit', '-s', '-qm', 'Change audited input'); return git('rev-parse', 'HEAD').trim();};
    run({root, git, base, head, select, commit});
  } finally { rmSync(root, {recursive: true, force: true}); }
}

test('unrelated package changes omit public gateway while retaining packages, types and other receipts', () => {
  fixture(({git, base, head, select}) => {
    assert.deepEqual(select().receipts, expected);
    const plan = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, workspace, git, () => {throw Error('No reuse');});
    assert.deepEqual(plan.receipts, expected);
    assert.equal(plan.packages.length, 16);
    assert.equal(plan.typecheck, true);
    assert.match(plan.reason, /omitted public gateway receipt.*both revisions/i);
    assert.doesNotMatch(plan.reason, /Unverified package revisions:/);
  });
});

test('every changed or removed public gateway input in either revision retains public gateway', () => {
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

test('linked and executable public gateway inputs invalidate otherwise identical contents', () => {
  for (const path of inputs) {
    fixture(({select}) => assert.deepEqual(select().receipts, receiptSuites, path), root => chmodSync(join(root, path), 0o755));
    fixture(({select}) => assert.deepEqual(select().receipts, receiptSuites, path), root => {
      const target = join(root, path); rmSync(target); symlinkSync('unaudited-target', target);
    });
  }
});

test('unknown, full and incomplete evidence cannot omit public gateway', () => {
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

test('unrelated migration module changes omit gateway checks while retaining package work', () => {
  fixture(({root, git, base, commit}) => {
    writeFileSync(join(root, 'packages/registration/src/migrate.ts'), '// Changed migration module\n');
    const head = commit();
    const plan = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, workspace, git, () => {});
    assert.deepEqual(plan.receipts, expected);
    assert.ok(plan.packages.some(row => row.package === '@waitron-cloud/registration'));
  });
});

test('new install hooks and changed sibling install manifests retain public gateway', () => {
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
  ['nested module manifests', 'packages/remote-access/src/package.json', '{"type":"commonjs"}\n'],
  ['tracked dependency overrides', 'packages/remote-access/src/node_modules/gateway-override/index.js', 'module.exports = {};\n'],
]) test(`${name} in either revision retain public gateway`, () => {
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


test('package-scoped installation hooks in either revision retain public gateway', () => {
  for (const path of ['packages/remote-access/.npmrc', 'packages/remote-access/.pnpmfile.cjs']) {
    fixture(({root, base, head, select, commit}) => {
      writeFileSync(join(root, path), path.endsWith('.npmrc') ? 'node-linker=hoisted\n' : 'module.exports = {hooks: {}};\n');
      const changed = commit();
      assert.deepEqual(select(base, changed).receipts, receiptSuites, path);
      assert.deepEqual(select(changed, head).receipts, receiptSuites, path);
    });
  }
});

test('checkout attributes in either revision retain gateway checks without changing stored reader blobs', () => {
  fixture(({root, git, base, head, select}) => {
    const path = 'packages/remote-access/.gitattributes';
    writeFileSync(join(root, path), 'src/public-gate.ts working-tree-encoding=UTF-16LE\n');
    git('add', path); git('commit', '-s', '-qm', 'Change gateway checkout encoding');
    const changed = git('rev-parse', 'HEAD').trim();
    assert.equal(git('ls-tree', base, 'packages/remote-access/src/public-gate.ts'), git('ls-tree', changed, 'packages/remote-access/src/public-gate.ts'));
    assert.deepEqual(select(base, changed).receipts, receiptSuites);
    assert.deepEqual(select(changed, head).receipts, receiptSuites);
  });
});

test('changed public gate and fallback page select gateway checks in actual package plans', () => {
  for (const path of ['packages/remote-access/src/public-gate.ts', 'packages/remote-access/src/public-unavailable.ts']) {
    fixture(({root, git, base, select, commit}) => {
      writeFileSync(join(root, path), '// Changed gateway behavior\n');
      const head = commit();
      assert.deepEqual(select(base, head).receipts, receiptSuites);
      const plan = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, workspace, git, () => {});
      assert.ok(plan.receipts.includes(suite));
      assert.ok(plan.packages.some(row => (row.members ?? [row.package]).includes('@waitron-cloud/remote-access')));
    });
  }
});

test('combined audits preserve three earlier omissions and retain only local-stack', () => {
  fixture(({select}) => {
    assert.deepEqual(select().receipts, ['test:local-stack']);
  }, root => {
    writeFileSync(join(root, 'README.md'), '# Gateway fixture\n');
    for (const path of [
      'packages/backups/src/object-transfer.ts', 'packages/backups/src/storage.ts',
      'packages/registration/src/migrate.ts', 'packages/registration/src/transaction.ts',
      'scripts/backup-capacity-fixture.mjs', 'scripts/backup-capacity-fixture.test.mjs',
      'scripts/cloud-two-venue-milestone-receipt.mjs', 'scripts/managed-recovery-receipt.fixture.mjs',
      'scripts/milestone-proof-helpers.mjs', 'scripts/milestone-proof-helpers.test.mjs',
      'scripts/verify-backup-capacity-receipt.mjs', 'scripts/verify-backup-capacity-receipt.test.mjs',
      'scripts/verify-backup-transfer-receipt.mjs', 'scripts/verify-backup-transfer-receipt.test.mjs',
      'scripts/verify-managed-recovery-receipt.mjs', 'scripts/verify-managed-recovery-receipt.test.mjs',
      'scripts/verify-two-venue-milestone-receipt.mjs', 'scripts/verify-two-venue-milestone-receipt.test.mjs',
      'scripts/database-recovery-fixture.mjs', 'scripts/database-recovery-receipt.mjs',
      'scripts/database-recovery-migrations.mjs', 'scripts/database-recovery-migrations.test.mjs',
      'scripts/verify-database-recovery-receipt.mjs', 'scripts/verify-database-recovery-receipt.test.mjs',
    ]) {
      mkdirSync(dirname(join(root, path)), {recursive: true});
      copyReceiptFixtureInput(path, join(root, path));
    }
  });
});
