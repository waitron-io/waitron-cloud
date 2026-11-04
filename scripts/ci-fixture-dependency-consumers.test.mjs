import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const consumers = [
  ['report omissions', 'packages/remote-access/test/forward-report-omissions.test.ts', 'native: deleting report cell binding'],
  ['collection guards', 'packages/remote-access/test/forward-collection-guards.test.ts', 'native: deleting hard link refusal'],
];
const env = {...process.env};
delete env.NODE_TEST_CONTEXT;

for (const [name, file, pattern] of consumers) {
  // Reintroducing a download-store install must break the real omission check.
  test(`${name} runs its original denial check with an empty download store`, {timeout: 90_000}, () => {
    const scratch = mkdtempSync(join(tmpdir(), 'cloud-consumer-empty-store-'));
    try {
      const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${pattern}`, file],
      {env: {...env, npm_config_store_dir: scratch, npm_config_registry: 'http://127.0.0.1:9'}, encoding: 'utf8', timeout: 80_000});
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /# pass 1\b/);
      assert.match(result.stdout, /# fail 0\b/);
    } finally {rmSync(scratch, {recursive: true, force: true});}
  });

  // Buffer inspection truncates the stdout that carries pnpm's missing-package reason.
  test(`${name} prints the setup child's refusal as readable text`, {timeout: 90_000}, () => {
    const scratch = mkdtempSync(join(tmpdir(), 'cloud-consumer-setup-output-'));
    const marker = 'DEPENDENCY_FIXTURE_SETUP_REFUSED';
    try {
      const failure = join(scratch, 'failure.mjs'), preload = join(scratch, 'preload.mjs');
      writeFileSync(failure, `console.log('x'.repeat(256) + ${JSON.stringify(marker)}); process.exit(67);\n`);
      writeFileSync(preload, `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
for (const method of ['execFileSync', 'spawnSync']) {
  const original = cp[method];
  cp[method] = function(command, args, options) {
    if (command === 'pnpm' || args?.[0] === 'scripts/ci-audit-fixture-dependencies.mjs') {
      return original(process.execPath, [${JSON.stringify(failure)}], options);
    }
    return original(command, args, options);
  };
} syncBuiltinESMExports();\n`);
      const result = spawnSync(process.execPath, ['--import', preload, '--test', '--test-reporter=tap', `--test-name-pattern=${pattern}`, file],
      {env, encoding: 'utf8', timeout: 80_000});
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.ok((result.stdout + result.stderr).includes(marker), result.stdout + result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, /stdout: <Buffer/);
    } finally {rmSync(scratch, {recursive: true, force: true});}
  });
}
