import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('receipt selector fixtures retain their assertions after dependency inputs change', () => {
  const inputs = JSON.parse(readFileSync(new URL('./fixtures/ci-dependency-inputs.json', import.meta.url), 'utf8'));
  const certificate = new URL('./fixtures/ci-historical-manifests.json', import.meta.url);
  assert.ok(existsSync(certificate), 'Missing independent historical manifest certificate');
  const audit = JSON.parse(readFileSync(certificate, 'utf8'));
  assert.deepEqual(audit, {
    "manifests": {
      "apps/portal/package.json": "d50ea3ff6254050ace02a8739ae7b83130f8e4a75dc4a2ea6c5b40380aab6d76",
      "packages/account-http/package.json": "2741c09445a8141969a5f5f051144eb61f8c762ff9afb7c4433b4e9bab681811",
      "packages/backups/package.json": "ae439c7a9f978fa926cfffe93b4011c6b6038b9fb07556594de61676057113f2",
      "packages/fiscal-allocation/package.json": "764e62f73ff0cee22c33c4ebc97d14ace6b3d9669472e2b08cf88a8359abe4ac",
      "packages/identity/package.json": "a620ea90e55cf3f38ace9fc79a1181d95f2a485e7faf196c9f39af795ac39ec1",
      "packages/operations/package.json": "3f9975e5fcf2146b680b151f34f35da22adbe57bfb3f6f4663c9f89fa126e9a5",
      "packages/registration/package.json": "42aa16d5c38b9264408381fe5ab5f5285f6583bc9be8671dc16b55f732d508ea",
      "packages/remote-access/package.json": "f3a47e3c2732ed839ab8440796627f40996d1badc3957abafd32707cbff74f05",
      "packages/ui-smoke/package.json": "7ad9d87459b73546a124fd3dee526dd0f8aa7e382178460e0cad6f81dc89efc3"
    }
  }, 'Historical manifest evidence must retain its independently pinned original map');
  assert.deepEqual(Object.keys(audit.manifests).sort(), Object.keys(inputs).filter(path => /^(apps|packages)\/.+\/package\.json$/.test(path)).sort());
  for (const [path, expected] of Object.entries(audit.manifests)) {
    const metadata = JSON.parse(inputs[path]);
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) delete metadata[field];
    const canonical = Object.fromEntries(Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b, 'en')));
    assert.equal(createHash('sha256').update(JSON.stringify(canonical)).digest('hex'), expected, `Saved manifest metadata must match its audit: ${path}`);
  }
  const root = mkdtempSync(join(tmpdir(), 'cloud-dependency-fixture-control-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: 'pipe'});
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    // Include candidate fixture repairs before they have been committed.
    cpSync('scripts', join(root, 'scripts'), {recursive: true});
    git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    appendFileSync(join(root, 'pnpm-lock.yaml'), '\n# Dependency control\n');
    for (const parent of ['apps', 'packages']) {
      for (const entry of readdirSync(join(root, parent), {withFileTypes: true})) {
        if (entry.isDirectory()) appendFileSync(join(root, parent, entry.name, 'package.json'), '\n');
      }
    }
    git('add', '-A'); git('commit', '-s', '-qm', 'Change dependency fixture inputs');
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync('node', ['--test', '--test-reporter=tap', '--test-concurrency=1', '--test-name-pattern=unrelated package changes omit',
      'scripts/ci-capacity-receipt.test.mjs', 'scripts/ci-database-receipt.test.mjs',
      'scripts/ci-gateway-receipt.test.mjs', 'scripts/ci-local-stack-receipt.test.mjs'],
    {cwd: root, env, encoding: 'utf8', timeout: 60_000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /(?:ℹ |# )tests 4\b/);
    assert.match(result.stdout, /(?:ℹ |# )pass 4\b/);
    assert.match(result.stdout, /(?:ℹ |# )fail 0\b/);
    assert.deepEqual([...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]).sort(), [
      'unrelated package changes omit capacity while retaining packages, types and other receipts',
      'unrelated package changes omit database recovery while retaining packages, types and other receipts',
      'unrelated package changes omit public gateway while retaining packages, types and other receipts',
      'unrelated package changes omit all audited receipts and retain actual package and type checks',
    ].sort(), 'Every required receipt test must execute; a passing file placeholder is not a test');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('receipt selector fixtures retain their positive checks after the package runner changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-runner-fixture-control-'));
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    cpSync('scripts', join(root, 'scripts'), {recursive: true});
    appendFileSync(join(root, 'scripts/ci-run-package-group.mjs'), '\n// Changed execution input\n');
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync('node', ['--test', '--test-reporter=tap', '--test-concurrency=1',
      '--test-name-pattern=^(?:unrelated package changes omit|backend-only changes omit)',
      'scripts/ci-capacity-receipt.test.mjs', 'scripts/ci-database-receipt.test.mjs',
      'scripts/ci-gateway-receipt.test.mjs', 'scripts/ci-local-stack-receipt.test.mjs', 'scripts/ci-receipts.test.mjs'],
    {cwd: root, env, encoding: 'utf8', timeout: 60_000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual([...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]).sort(), [
      'unrelated package changes omit capacity while retaining packages, types and other receipts',
      'unrelated package changes omit database recovery while retaining packages, types and other receipts',
      'unrelated package changes omit public gateway while retaining packages, types and other receipts',
      'unrelated package changes omit all audited receipts and retain actual package and type checks',
      'backend-only changes omit the unchanged pure milestone receipt and preserve all other work',
    ].sort(), 'All five positive receipt checks must execute');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('receipt selector fixtures retain their positive checks after package path discovery changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-scope-fixture-control-'));
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    cpSync('scripts', join(root, 'scripts'), {recursive: true});
    appendFileSync(join(root, 'scripts/ci-scope.mjs'), '\n// Changed package discovery input\n');
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync('node', ['--test', '--test-reporter=tap', '--test-concurrency=1',
      '--test-name-pattern=^(?:unrelated package changes omit|backend-only changes omit)',
      'scripts/ci-capacity-receipt.test.mjs', 'scripts/ci-database-receipt.test.mjs',
      'scripts/ci-gateway-receipt.test.mjs', 'scripts/ci-local-stack-receipt.test.mjs', 'scripts/ci-receipts.test.mjs'],
    {cwd: root, env, encoding: 'utf8', timeout: 60_000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual([...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]).sort(), [
      'unrelated package changes omit capacity while retaining packages, types and other receipts',
      'unrelated package changes omit database recovery while retaining packages, types and other receipts',
      'unrelated package changes omit public gateway while retaining packages, types and other receipts',
      'unrelated package changes omit all audited receipts and retain actual package and type checks',
      'backend-only changes omit the unchanged pure milestone receipt and preserve all other work',
    ].sort(), 'All five positive receipt checks must execute');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('receipt selector fixtures retain their positive checks after migration inventory changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-migration-fixture-control-'));
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    cpSync('scripts', join(root, 'scripts'), {recursive: true});
    appendFileSync(join(root, 'packages/registration/src/migrate.ts'), '\n// Changed migration reader\n');
    appendFileSync(join(root, 'packages/registration/migrations/999_fixture_control.sql'), 'SELECT 1;\n');
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync('node', ['--test', '--test-reporter=tap', '--test-concurrency=1',
      '--test-name-pattern=unrelated package changes omit|combined audits',
      'scripts/ci-capacity-receipt.test.mjs', 'scripts/ci-database-receipt.test.mjs',
      'scripts/ci-gateway-receipt.test.mjs', 'scripts/ci-local-stack-receipt.test.mjs'],
    {cwd: root, env, encoding: 'utf8', timeout: 60_000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual([...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]).sort(), [
      'unrelated package changes omit capacity while retaining packages, types and other receipts',
      'unrelated package changes omit database recovery while retaining packages, types and other receipts',
      'unrelated package changes omit public gateway while retaining packages, types and other receipts',
      'unrelated package changes omit all audited receipts and retain actual package and type checks',
      'combined audits retain earlier omissions and ignore unrelated top-level prose',
      'combined audits preserve three earlier omissions and retain only local-stack',
    ].sort(), 'Every positive receipt check must execute with the saved schema inputs');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('receipt selector fixtures retain their positive checks after workflow checkout changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-workflow-fixture-control-'));
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    cpSync('scripts', join(root, 'scripts'), {recursive: true});
    appendFileSync(join(root, '.github/workflows/ci.yml'), '\n# Changed checkout history input\n');
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync('node', ['--test', '--test-reporter=tap', '--test-concurrency=1',
      '--test-name-pattern=^(?:unrelated package changes omit|backend-only changes omit)',
      'scripts/ci-capacity-receipt.test.mjs', 'scripts/ci-database-receipt.test.mjs',
      'scripts/ci-gateway-receipt.test.mjs', 'scripts/ci-local-stack-receipt.test.mjs', 'scripts/ci-receipts.test.mjs'],
    {cwd: root, env, encoding: 'utf8', timeout: 60_000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual([...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]).sort(), [
      'unrelated package changes omit capacity while retaining packages, types and other receipts',
      'unrelated package changes omit database recovery while retaining packages, types and other receipts',
      'unrelated package changes omit public gateway while retaining packages, types and other receipts',
      'unrelated package changes omit all audited receipts and retain actual package and type checks',
      'backend-only changes omit the unchanged pure milestone receipt and preserve all other work',
    ].sort(), 'Every original positive receipt assertion must execute with its audited workflow');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('receipt selector fixtures retain their positive checks after deployment and licence inputs change', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-deployment-fixture-control-'));
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    cpSync('scripts', join(root, 'scripts'), {recursive: true});
    appendFileSync(join(root, '.env.example'), '\n# Changed configuration example\n');
    appendFileSync(join(root, 'compose.yaml'), '\n# Changed deployment profile\n');
    appendFileSync(join(root, 'deploy/local-stack/runtime.mjs'), '\n// Changed runtime role\n');
    appendFileSync(join(root, 'deploy/local-stack/new-control.mjs'), 'export const control = true;\n');
    appendFileSync(join(root, 'LICENSE'), 'New licence input\n');
    const git=(...args)=>execFileSync('git',['-c','maintenance.auto=false','-c','user.name=CI test','-c','user.email=ci@example.test',...args],{cwd:root,stdio:'pipe'});
    git('add','-A');git('commit','-s','-qm','Change deployment fixture inputs');
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync('node', ['--test', '--test-reporter=tap', '--test-concurrency=1',
      '--test-name-pattern=unrelated package changes omit|combined audits',
      'scripts/ci-capacity-receipt.test.mjs', 'scripts/ci-database-receipt.test.mjs',
      'scripts/ci-gateway-receipt.test.mjs', 'scripts/ci-local-stack-receipt.test.mjs'],
    {cwd: root, env, encoding: 'utf8', timeout: 60_000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual([...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]).sort(), [
      'unrelated package changes omit capacity while retaining packages, types and other receipts',
      'unrelated package changes omit database recovery while retaining packages, types and other receipts',
      'unrelated package changes omit public gateway while retaining packages, types and other receipts',
      'unrelated package changes omit all audited receipts and retain actual package and type checks',
      'combined audits retain earlier omissions and ignore unrelated top-level prose',
      'combined audits preserve three earlier omissions and retain only local-stack',
    ].sort(), 'Every positive receipt check must execute with saved deployment and installation inputs');
  } finally {rmSync(root, {recursive: true, force: true});}
});
