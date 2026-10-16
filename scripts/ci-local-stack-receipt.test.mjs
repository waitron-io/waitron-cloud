import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {seedReceiptDependencyInputs} from './ci-dependency-fixture.mjs';
import {createPlan} from './ci-plan.mjs';
import {receiptPlan} from './ci-receipts.mjs';
import {loadWorkspace, receiptSuites} from './ci-scope.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';

const suite = 'test:local-stack';
const workspace = loadWorkspace();
const files = [
  'scripts/ci-package-groups.mjs', 'scripts/ci-run-package-group.mjs',
  'scripts/ci-run-receipts.mjs', 'scripts/ci-scope.mjs', '.github/workflows/ci.yml',
  'packages/operations/src/metrics.ts', 'packages/remote-access/src/manifest.ts',
  'packages/registration/src/migrate.ts', 'packages/registration/src/transaction.ts',
  'scripts/local-stack-compose.mjs', 'scripts/local-stack-compose.test.mjs',
  'scripts/local-stack-lifecycle.mjs', 'scripts/local-stack-lifecycle.test.mjs',
  'scripts/verify-local-stack-receipt.mjs', 'scripts/verify-local-stack-receipt.test.mjs',
  'scripts/scheduled-usage-proof.mjs', 'scripts/scheduled-usage-proof.test.mjs',
  'scripts/verify-schema-upgrade-receipt.mjs', 'scripts/verify-schema-upgrade-receipt.test.mjs',
  'scripts/schema-upgrade-fixture.mjs', 'scripts/schema-upgrade-fixture.test.mjs',
];
const directories = ['deploy/local-stack', 'packages/registration/migrations'];
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-local-stack-inputs-'));
  // Disposable repositories must not start detached Git maintenance.
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  // Use the planner's batch protocol so source discovery does not spawn once per file.
  git.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['-c', 'maintenance.auto=false', 'cat-file', '--batch'],
    {cwd: root, input, timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']}));
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', '--no-checkout', process.cwd(), root], {stdio: 'pipe'});
    git('checkout', '--quiet', 'HEAD', '--', '.');
    git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    seedReceiptDependencyInputs(root);
    if (git('status', '--porcelain').trim()) {
      git('add', '-A'); git('commit', '-s', '-qm', 'Seed audited dependency inputs');
    }
    const base = git('rev-parse', 'HEAD').trim();
    writeFileSync(join(root, 'packages/registration/src/local-stack-control.ts'), 'export const control = true;\n');
    const commit = (paths = ['.']) => {git('add', '-f', ...paths); git('commit', '-s', '-qm', 'Change receipt input'); return git('rev-parse', 'HEAD').trim();};
    const head = commit();
    const select = (old = base, next = head, execute = git, scope = {full: false}) => receiptPlan(receiptSuites, scope, old, next, execute);
    run({root, git, base, head, commit, select});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('unrelated package changes omit all audited receipts and retain actual package and type checks', () => {
  fixture(({git, base, head, select}) => {
    assert.deepEqual(select().receipts, []);
    const plan = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {}, workspace, git, () => {throw Error('No reuse');});
    assert.deepEqual(plan.receipts, []);
    assert.equal(plan.packages.length, 16);
    assert.equal(plan.typecheck, true);
    assert.match(plan.reason, /omitted local.stack receipt.*both revisions/i);
    assert.doesNotMatch(plan.reason, /Unverified package revisions:/);
  });
});

test('changed, deleted, linked and executable readers in either revision retain local-stack', () => {
  fixture(({root, git, base, head, select, commit}) => {
    for (const path of files) {
      for (const kind of ['changed', 'deleted', 'linked', 'executable']) {
        git('reset', '--hard', head);
        const target = join(root, path);
        if (kind === 'changed') writeFileSync(target, '// Changed reader\n');
        if (kind === 'deleted') rmSync(target);
        if (kind === 'linked') {rmSync(target); symlinkSync('unaudited-target', target);}
        if (kind === 'executable') chmodSync(target, 0o755);
        const changed = commit();
        assert.ok(select(base, changed).receipts.includes(suite), `${path}: ${kind} head`);
        assert.ok(select(changed, head).receipts.includes(suite), `${path}: ${kind} base`);
      }
    }
  });
});

test('whole deployment and migration inventories retain new, deleted and changed directory entries', () => {
  fixture(({root, git, base, head, select, commit}) => {
    for (const path of [...directories.map(dir => `${dir}/new-input.mjs`), 'deploy/local-stack/runtime.mjs', 'packages/registration/migrations/001_registration.sql']) {
      git('reset', '--hard', head);
      writeFileSync(join(root, path), '// Changed directory input\n');
      const changed = commit();
      assert.ok(select(base, changed).receipts.includes(suite), path);
      assert.ok(select(changed, head).receipts.includes(suite), `old ${path}`);
      git('reset', '--hard', head); git('clean', '-fdq');
    }
  });
});

test('installation, checkout encoding and dependency overrides in either revision retain local-stack', () => {
  fixture(({root, git, base, head, select, commit}) => {
    for (const [path, value] of [
      ['package.json', '{"scripts":{}}\n'], ['pnpm-lock.yaml', 'lockfileVersion: invalid\n'],
      ['.pnpmfile.cjs', 'module.exports = {};\n'],
      ['scripts/.gitattributes', '*.mjs working-tree-encoding=UTF-16LE\n'],
      ['deploy/package.json', '{"type":"commonjs"}\n'],
      ['packages/operations/.npmrc', 'node-linker=hoisted\n'],
      ['scripts/node_modules/override/index.js', 'module.exports = {};\n'],
    ]) {
      git('reset', '--hard', head); git('clean', '-fdq');
      mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), value);
      if (path === 'scripts/.gitattributes') {
        // Force Git to reconsider unchanged bytes if staging accidentally includes readers.
        const touched = new Date(Date.now() + 2000);
        utimesSync(join(root, 'scripts/backup-capacity-fixture.mjs'), touched, touched);
      }
      const changed = commit(path === 'scripts/.gitattributes' ? [path] : ['.']);
      if (path === 'scripts/.gitattributes') assert.equal(git('ls-tree', head, 'scripts/backup-capacity-fixture.mjs'), git('ls-tree', changed, 'scripts/backup-capacity-fixture.mjs'));
      assert.ok(select(base, changed).receipts.includes(suite), path);
      assert.ok(select(changed, head).receipts.includes(suite), `old ${path}`);
    }
  });
});

test('unknown full scope, invalid revisions and incomplete inventories retain local-stack', () => {
  fixture(({git, base, head, select}) => {
    for (const [old, next] of [['', head], [base, ''], ['HEAD', head], [base, 'HEAD']]) assert.ok(select(old, next).receipts.includes(suite));
    assert.ok(select(base, head, git, {full: true}).receipts.includes(suite));
    for (const execute of [
      (...args) => {if (args[0] === 'ls-tree') throw Error('Missing tree'); return git(...args);},
      (...args) => args[0] === 'ls-tree' ? git(...args).replace(/\0$/, '') : git(...args),
      (...args) => args[0] === 'ls-tree' ? git(...args) + 'unfinished' : git(...args),
      (...args) => args[1] === '-rz' ? git(...args) + 'unfinished' : git(...args),
      (...args) => args[1] === '-z' ? git(...args) + 'unfinished' : git(...args),
    ]) assert.ok(select(base, head, execute).receipts.includes(suite));
  });
});

test('consumed package readers retain local-stack in the actual PR plan', () => {
  fixture(({root, git, base, head, commit}) => {
    for (const path of ['packages/operations/src/metrics.ts', 'packages/registration/src/migrate.ts', 'packages/remote-access/src/manifest.ts']) {
      git('reset', '--hard', head); writeFileSync(join(root, path), '// Changed consumed package reader\n');
      const plan = createPlan({pull_request: {base: {sha: base}, head: {sha: commit()}}}, {}, workspace, git, () => {});
      assert.ok(plan.receipts.includes(suite), path);
      assert.ok(plan.packages.length > 0); assert.equal(plan.typecheck, true);
    }
  });
});
