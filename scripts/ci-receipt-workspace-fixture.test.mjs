import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('receipt fixtures keep their original positive assertions after live package test commands change', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-receipt-command-fixture-'));
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    cpSync('scripts', join(root, 'scripts'), {recursive: true});
    for (const parent of ['apps', 'packages']) {
      for (const entry of readdirSync(join(root, parent), {withFileTypes: true})) {
        if (!entry.isDirectory()) continue;
        const path = join(root, parent, entry.name, 'package.json');
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        manifest.scripts.test = manifest.scripts.test.replace('node --test', 'node --test --test-concurrency=7');
        writeFileSync(path, JSON.stringify(manifest) + '\n');
      }
    }
    const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', '-c', 'user.name=CI test',
      '-c', 'user.email=ci@example.test', ...args], {cwd: root, stdio: 'pipe'});
    git('add', '-A'); git('commit', '-s', '-qm', 'Change live package test commands');
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1',
      '--test-name-pattern=^unrelated package changes omit',
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
    ].sort(), 'All four original receipt assertions must execute');
  } finally {rmSync(root, {recursive: true, force: true});}
});
