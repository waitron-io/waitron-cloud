import {remoteFiles} from './ci-run-remote-shard.mjs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-remote-runner-'));
  try {
    mkdirSync(join(root, 'scripts'));
    cpSync(new URL('./ci-run-remote-shard.mjs', import.meta.url), join(root, 'scripts/ci-run-remote-shard.mjs'));
    cpSync(new URL('./ci-required-cases.mjs', import.meta.url), join(root, 'scripts/ci-required-cases.mjs'));
    writeFileSync(join(root, 'scripts/ci-required-cases.json'), '{}\n');
    mkdirSync(join(root, 'packages/remote-access/test'), {recursive: true});
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    symlinkSync('scripts/ci-run-remote-shard.mjs', join(root, 'linked-runner.mjs'));
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const execute = (shard, command = 'scripts/ci-run-remote-shard.mjs') => spawnSync(process.execPath, [command, shard],
      {cwd: root, env, encoding: 'utf8', timeout: 10_000});
    run({root, execute});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('remote allocation can be imported from an explicit standard-input program', () => {
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: "import {remoteFiles} from './scripts/ci-run-remote-shard.mjs';console.log(JSON.stringify(remoteFiles(1,['a.test.ts','b.test.ts'])));",
    env, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), ['a.test.ts']);
});

test('invalid and empty remote partitions refuse without discovering unrelated tests', () => {
  fixture(({root, execute}) => {
    writeFileSync(join(root, 'packages/remote-access/unrelated.test.ts'),
      "import test from 'node:test';test('unrelated',()=>console.log('UNRELATED_TEST_RAN'));\n");
    for (const shard of ['', '0', '5', '1.5', 'invalid', '1']) {
      const result = execute(shard);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, shard === '1' ? /Empty remote shard/ : /Invalid remote shard/);
      assert.doesNotMatch(result.stdout, /UNRELATED_TEST_RAN/);
    }
  });
});

test('the remote runner becomes the test process through a symlink and propagates a selected failure', () => {
  fixture(({root, execute}) => {
    const selected = join(root, 'packages/remote-access/test/a.test.ts');
    writeFileSync(selected, "import test from 'node:test';test('selected',()=>console.log('TEST_PARENT '+process.ppid));\n");
    const pass = execute('1', 'linked-runner.mjs');
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    assert.match(pass.stdout, new RegExp('TEST_PARENT ' + pass.pid));
    writeFileSync(selected, "import test from 'node:test';test('selected fails',()=>{throw Error('CONTROLLED_REMOTE_FAILURE')});\n");
    const failed = execute('1');
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stdout + failed.stderr, /CONTROLLED_REMOTE_FAILURE/);
  });
});

test('ordinary remote files without an active pin follow the native partition', () => {
  assert.deepEqual(remoteFiles(2, ['a.test.ts', 'venue-service-remote-guards.test.ts']),
    ['venue-service-remote-guards.test.ts']);
});
