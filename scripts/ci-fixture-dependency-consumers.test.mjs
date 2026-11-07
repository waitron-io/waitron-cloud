import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, chownSync, cpSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const consumers = [
  ['report omissions', 'packages/remote-access/test/forward-report-omissions.manual.ts', 'native: deleting report cell binding'],
  ['collection guards', 'packages/remote-access/test/forward-collection-guards.manual.ts', 'native: deleting hard link refusal'],
  ['portal omissions', 'apps/portal/test/forwarding-causes-omissions.manual.ts', 'native: deleting canonical timestamp validation'],
];
const env = {...process.env};
delete env.NODE_TEST_CONTEXT;

function temporary(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  // The real file-denial cases require the directory group to match their reader.
  chownSync(directory, process.geteuid(), process.getegid());
  chmodSync(directory, 0o2700);
  return directory;
}

for (const [name, file, pattern] of consumers) {
  for (const kind of ['stdout', 'stderr', 'signal', 'missing executable']) test(`${name} prints ${kind} setup refusals as readable text`, {timeout: 90_000}, () => {
    const scratch = temporary('cloud-consumer-setup-output-');
    const marker = kind === 'missing executable' ? 'ENOENT' : 'DEPENDENCY_FIXTURE_SETUP_REFUSED';
    try {
      const failure = join(scratch, 'failure.mjs'), preload = join(scratch, 'preload.mjs');
      writeFileSync(failure, `console.${kind === 'stdout' ? 'log' : 'error'}('x'.repeat(256) + ${JSON.stringify(marker)}); ${kind === 'signal' ? "process.kill(process.pid, 'SIGTERM');" : 'process.exit(67);'}\n`);
      writeFileSync(preload, `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
for (const method of ['execFileSync', 'spawnSync']) {
  const original = cp[method];
  cp[method] = function(command, args, options) {
    if (command === 'pnpm' || args?.[0] === 'scripts/ci-audit-fixture-dependencies.mjs') {
      return ${kind === 'missing executable' ? `original(${JSON.stringify(join(scratch, 'missing-command'))}, [], options)` : `original(process.execPath, [${JSON.stringify(failure)}], options)`};
    }
    return original(command, args, options);
  };
} syncBuiltinESMExports();\n`);
      const result = spawnSync(process.execPath, ['--import', preload, '--test', '--test-reporter=tap', `--test-name-pattern=${pattern}`, file],
      {env: {...env, TMPDIR: scratch}, encoding: 'utf8', timeout: 80_000});
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.ok((result.stdout + result.stderr).includes(marker), result.stdout + result.stderr);
      if (kind === 'signal') assert.match(result.stdout + result.stderr, /SIGTERM/);
      assert.doesNotMatch(result.stdout + result.stderr, /stdout: <Buffer/);
    } finally {rmSync(scratch, {recursive: true, force: true});}
  });
}

test('the report omission fixture preserves non-UTF-8 bytes in tracked candidate edits', {timeout: 90_000}, () => {
  const scratch = temporary('cloud-consumer-patch-bytes-');
  const source = join(scratch, 'source'), file = 'packages/remote-access/test/forward-report-omissions.manual.ts';
  const target = 'docs/backlog/ci-pnpm-setup.md', expected = [0x63, 0x61, 0x66, 0xe9, 0x0a];
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), source], {stdio: 'pipe', timeout: 30_000});
    cpSync(file, join(source, file));
    writeFileSync(join(source, target), Buffer.from(expected));
    const helper = new URL('./ci-audit-fixture-dependencies.mjs', import.meta.url).pathname;
    const prepared = spawnSync(process.execPath, [helper, process.cwd(), source], {env, encoding: 'utf8', timeout: 60_000});
    assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
    const preload = join(scratch, 'observe.mjs');
    writeFileSync(preload, `import cp from 'node:child_process'; import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs'; import {join} from 'node:path'; import {syncBuiltinESMExports} from 'node:module';
const original = cp.spawnSync;
cp.spawnSync = function(command, args, options) {
  if (args?.[0] === 'scripts/ci-audit-fixture-dependencies.mjs') {
    assert.deepEqual([...readFileSync(join(options.cwd, ${JSON.stringify(target)}))], ${JSON.stringify(expected)}, 'candidate patch bytes must be preserved');
    throw Error('CANDIDATE_PATCH_BYTES_VERIFIED');
  }
  return original(command, args, options);
}; syncBuiltinESMExports();\n`);
    const result = spawnSync(process.execPath, ['--import', preload, '--test', '--test-reporter=tap', '--test-name-pattern=native: deleting report cell binding', file],
    {cwd: source, env: {...env, TMPDIR: scratch}, encoding: 'utf8', timeout: 80_000});
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /CANDIDATE_PATCH_BYTES_VERIFIED/);
  } finally {rmSync(scratch, {recursive: true, force: true});}
});
