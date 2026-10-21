import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {copyReceiptFixtureInput} from './ci-dependency-fixture.mjs';
import {createPlan} from './ci-plan.mjs';
import {receiptPlan} from './ci-receipts.mjs';
import {loadWorkspace, receiptSuites} from './ci-scope.mjs';

const workspace = loadWorkspace();
const inputs = [
  '.github/workflows/ci.yml',
  'scripts/cloud-two-venue-milestone-receipt.mjs',
  'scripts/managed-recovery-receipt.fixture.mjs',
  'scripts/milestone-proof-helpers.mjs',
  'scripts/milestone-proof-helpers.test.mjs',
  'scripts/verify-backup-capacity-receipt.mjs',
  'scripts/verify-backup-transfer-receipt.mjs',
  'scripts/verify-managed-recovery-receipt.mjs',
  'scripts/verify-managed-recovery-receipt.test.mjs',
  'scripts/verify-two-venue-milestone-receipt.mjs',
  'scripts/verify-two-venue-milestone-receipt.test.mjs',
  'scripts/ci-run-receipts.mjs',
  'scripts/ci-package-groups.mjs', 'scripts/ci-run-package-group.mjs',
  'scripts/ci-scope.mjs',
];
function fixture(run, alter = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-receipt-inputs-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  try {
    git('init', '-q');
    git('config', 'user.name', 'CI test');
    git('config', 'user.email', 'ci@example.test');
    for (const path of [...inputs, 'package.json']) {
      mkdirSync(dirname(join(root, path)), {recursive: true});
      copyReceiptFixtureInput(path, join(root, path));
    }
    alter(root, git);
    git('add', '.'); git('commit', '-s', '-qm', 'Seed audited receipt fixture');
    const base = git('rev-parse', 'HEAD').trim();
    mkdirSync(join(root, 'packages/registration/src'), {recursive: true});
    writeFileSync(join(root, 'packages/registration/src/receipt-control.ts'), 'export const receiptControl = true;\n');
    git('add', '.'); git('commit', '-s', '-qm', 'Change backend package');
    const head = git('rev-parse', 'HEAD').trim();
    const plan = () => createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, workspace, git, () => { throw Error('No reuse API'); });
    run({root, git, base, head, plan});
  } finally { rmSync(root, {recursive: true, force: true}); }
}

test('backend-only changes omit the unchanged pure milestone receipt and preserve all other work', () => {
  fixture(({plan}) => {
    const result = plan();
    assert.deepEqual(result.receipts, ['test:backup-capacity', 'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt','test:cloud-cost']);
    assert.equal(result.packages.length, 17);
    assert.equal(result.typecheck, true);
    assert.match(result.reason, /unchanged audited milestone inputs/i);
  });
});

test('every changed or missing audited reader keeps the milestone receipt', () => {
  for (const path of inputs) {
    fixture(({plan}) => assert.deepEqual(plan().receipts, receiptSuites), root => writeFileSync(join(root, path), '// Changed reader\n'));
    fixture(({plan}) => assert.deepEqual(plan().receipts, receiptSuites), root => rmSync(join(root, path)));
  }
});

test('changed receipt commands and symbolic-link readers keep the milestone receipt', () => {
  fixture(({plan}) => assert.deepEqual(plan().receipts, receiptSuites), root => {
    const path = join(root, 'package.json'), manifest = JSON.parse(readFileSync(path));
    manifest.scripts['test:two-venue-milestone-receipt'] += ' scripts/backend-proof.test.mjs';
    writeFileSync(path, JSON.stringify(manifest));
  });
  fixture(({plan}) => assert.deepEqual(plan().receipts, receiptSuites), root => {
    const path = join(root, inputs[1]); rmSync(path); symlinkSync('milestone-proof-helpers.mjs', path);
  });
});

test('mixed input changes and unknown diffs preserve every receipt', () => {
  fixture(({root, git, base, plan}) => {
    writeFileSync(join(root, inputs[1]), '// Added executable backend import\n');
    git('add', '.'); git('commit', '-s', '-qm', 'Change receipt reader');
    const head = git('rev-parse', 'HEAD').trim();
    const result = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, workspace, git, () => {});
    assert.deepEqual(result.receipts, receiptSuites);
    assert.equal(result.packages.length, 17);
    const missing = (...args) => args[0] === 'ls-tree' ? (() => { throw Error('Missing tree'); })() : git(...args);
    assert.deepEqual(createPlan({pull_request: {base: {sha: base}, head: {sha: git('rev-parse', 'HEAD^').trim()}}}, {}, workspace, missing, () => {}).receipts, receiptSuites);
  });
});

test('the audited inputs must also match the head revision when called with package scope', () => {
  fixture(({root, git, base, head}) => {
    for (const path of inputs) {
      const original = readFileSync(join(root, path));
      writeFileSync(join(root, path), '// Changed head reader\n');
      git('add', '.'); git('commit', '-s', '-qm', 'Change head reader');
      const changed = git('rev-parse', 'HEAD').trim();
      assert.deepEqual(receiptPlan(receiptSuites, {full: false}, base, changed, git).receipts, receiptSuites, path);
      writeFileSync(join(root, path), original);
      git('add', '.'); git('commit', '-s', '-qm', 'Restore head reader');
    }
    assert.deepEqual(receiptPlan(receiptSuites, {full: true}, base, head, git).receipts, receiptSuites);
    assert.deepEqual(receiptPlan(receiptSuites, {full: false}, '', head, git).receipts, receiptSuites);
    assert.deepEqual(receiptPlan(receiptSuites, {full: false}, base, '', git).receipts, receiptSuites);
    const incomplete = (...args) => args[0] === 'ls-tree' ? git(...args).slice(0, -1) : git(...args);
    assert.deepEqual(receiptPlan(receiptSuites, {full: false}, base, head, incomplete).receipts, receiptSuites);
  });
});

test('restoring a reader in the head cannot hide unaudited base inputs', () => {
  fixture(({root, git, base}) => {
    copyFileSync(inputs[1], join(root, inputs[1]));
    git('add', '.'); git('commit', '-s', '-qm', 'Restore audited head reader');
    const head = git('rev-parse', 'HEAD').trim();
    assert.deepEqual(receiptPlan(receiptSuites, {full: false}, base, head, git).receipts, receiptSuites);
  }, root => writeFileSync(join(root, inputs[1]), '// Unaudited base reader\n'));
});

test('floating revisions and incomplete inventories cannot omit receipt work', () => {
  fixture(({git, base, head}) => {
    for (const [old, next] of [['HEAD', head], [base, 'HEAD']]) {
      assert.deepEqual(receiptPlan(receiptSuites, {full: false}, old, next, git).receipts, receiptSuites);
    }
    const incomplete = (...args) => args[0] === 'ls-tree' ? git(...args) + 'unfinished tree entry' : git(...args);
    assert.deepEqual(receiptPlan(receiptSuites, {full: false}, base, head, incomplete).receipts, receiptSuites);
  });
});

test('a changed file mode invalidates the audit even when its contents match', () => {
  fixture(({plan}) => assert.deepEqual(plan().receipts, receiptSuites), root => chmodSync(join(root, inputs[1]), 0o755));
});
