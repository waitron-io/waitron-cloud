import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('receipt selector fixtures retain their assertions after dependency inputs change', () => {
  const inputs = JSON.parse(readFileSync(new URL('./fixtures/ci-dependency-inputs.json', import.meta.url), 'utf8'));
  const audit = JSON.parse(readFileSync(new URL('./ci-lock-selection-audit.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(audit.manifests).sort(), Object.keys(inputs).filter(path => /^(apps|packages)\/.+\/package\.json$/.test(path)).sort());
  for (const [path, expected] of Object.entries(audit.manifests)) {
    const metadata = JSON.parse(inputs[path]);
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) delete metadata[field];
    const canonical = Object.fromEntries(Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b, 'en')));
    assert.equal(createHash('sha256').update(JSON.stringify(canonical)).digest('hex'), expected, `Saved manifest metadata must match its audit: ${path}`);
  }
  const root = mkdtempSync(join(tmpdir(), 'cloud-dependency-fixture-control-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: 'pipe'});
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
