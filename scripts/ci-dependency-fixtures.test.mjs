import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {appendFileSync, cpSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('receipt selector fixtures retain their assertions after dependency inputs change', () => {
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
  } finally { rmSync(root, {recursive: true, force: true}); }
});
