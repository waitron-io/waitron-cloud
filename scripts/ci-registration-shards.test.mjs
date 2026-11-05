import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('a symlinked registration command executes selected tests and refuses invalid partitions', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-registration-link-'));
  try {
    mkdirSync(join(root, 'scripts'));
    cpSync('scripts/ci-run-registration-shard.mjs', join(root, 'scripts/ci-run-registration-shard.mjs'));
    mkdirSync(join(root, 'packages/registration/test'), {recursive: true});
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(root, 'packages/registration/test/a.test.ts'),
      "import test from 'node:test'; test('selected through link',()=>console.log('LINK_SELECTED_TEST_RAN'));\n");
    symlinkSync('scripts', join(root, 'linked-scripts'));
    symlinkSync('scripts/ci-run-registration-shard.mjs', join(root, 'linked-runner.mjs'));
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    for (const command of ['linked-scripts/ci-run-registration-shard.mjs', 'linked-runner.mjs']) {
      const selected = spawnSync(process.execPath, [command, '1'], {cwd: root, env, encoding: 'utf8', timeout: 10_000});
      assert.equal(selected.status, 0, selected.stderr + selected.stdout);
      assert.match(selected.stdout, /LINK_SELECTED_TEST_RAN/);
      const invalid = spawnSync(process.execPath, [command, '0'], {cwd: root, env, encoding: 'utf8', timeout: 10_000});
      assert.equal(invalid.status, 1, invalid.stderr + invalid.stdout);
      assert.doesNotMatch(invalid.stdout, /LINK_SELECTED_TEST_RAN/);
    }
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('registration runner moves the three measured slow files and executes all current and future files exactly once', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-registration-balanced-'));
  try {
    mkdirSync(join(root, 'scripts'));
    cpSync('scripts/ci-run-registration-shard.mjs', join(root, 'scripts/ci-run-registration-shard.mjs'));
    const directory = join(root, 'packages/registration/test');
    mkdirSync(directory, {recursive: true});
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    const files = readdirSync('packages/registration/test').filter(name => name.endsWith('.test.ts'))
      .concat('zz-future-registration.test.ts').sort();
    for (const file of files) writeFileSync(join(directory, file),
      `import test from 'node:test'; import assert from 'node:assert/strict'; test(${JSON.stringify(file)}, () => {assert.ok(process.execArgv.includes('--test-timeout=30000')); console.log(${JSON.stringify(`D576_FILE ${file}`)}); console.log('D576_PARENT '+process.ppid);});\n`);
    writeFileSync(join(directory, 'metadata.json'), '{"not a test":true}\n');
    mkdirSync(join(directory, 'fixtures'));
    writeFileSync(join(directory, 'fixtures/unrelated.test.ts'), "throw Error('UNRELATED_FIXTURE_RAN');\n");
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const groups = [];
    for (let shard = 1; shard <= 6; shard++) {
      const result = spawnSync(process.execPath, ['scripts/ci-run-registration-shard.mjs', String(shard)],
        {cwd: root, env, encoding: 'utf8', timeout: 30_000});
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const selected = [...result.stdout.matchAll(/D576_FILE ([\w.-]+\.test\.ts)/g)].map(match => match[1]);
      assert.ok(selected.length > 0, `Empty shard ${shard}`);
      const parents = [...result.stdout.matchAll(/D576_PARENT (\d+)/g)].map(match => Number(match[1]));
      assert.deepEqual(parents, selected.map(() => result.pid), 'The runner must become the Node test process');
      const original = spawnSync(process.execPath, ['--test', '--test-timeout=30000', `--test-shard=${shard}/6`,
        ...files.map(file => `test/${file}`)], {cwd: join(root, 'packages/registration'), env, encoding: 'utf8', timeout: 30_000});
      assert.equal(original.status, 0, original.stderr + original.stdout);
      const originallySelected = [...original.stdout.matchAll(/D576_FILE ([\w.-]+\.test\.ts)/g)].map(match => match[1]);
      const unmoved = file => !['monitoring.test.ts', 'support-grants.test.ts', 'venue-service-legacy-schema-guards.test.ts'].includes(file);
      assert.deepEqual(selected.filter(unmoved).sort(), originallySelected.filter(unmoved).sort(),
        'Files outside the three measured moves must keep Node\'s original partition');
      groups.push(selected);
    }
    assert.deepEqual(groups.flat().sort(), files);
    assert.ok(groups[0].includes('monitoring.test.ts'));
    assert.ok(groups[0].includes('venue-service-legacy-schema-guards.test.ts'));
    assert.ok(groups[1].includes('support-grants.test.ts'));
    for (const shard of ['', '0', '7', '1.5', 'invalid']) {
      const result = spawnSync(process.execPath, ['scripts/ci-run-registration-shard.mjs', shard],
        {cwd: root, env, encoding: 'utf8', timeout: 10_000});
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /D576_FILE/);
    }
  } finally {rmSync(root, {recursive: true, force: true});}
});

for (const empty of [true, false]) test(empty ? 'an empty registration shard refuses before Node can discover unrelated tests' : 'a failed selected registration file fails the runner', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-registration-refusal-'));
  try {
    mkdirSync(join(root, 'scripts'));
    cpSync('scripts/ci-run-registration-shard.mjs', join(root, 'scripts/ci-run-registration-shard.mjs'));
    const directory = join(root, 'packages/registration/test');
    mkdirSync(directory, {recursive: true});
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    writeFileSync(empty ? join(root, 'packages/registration/unrelated.test.ts') : join(directory, 'a.test.ts'), empty
      ? "import test from 'node:test'; test('unrelated',()=>console.log('UNRELATED_DISCOVERY_RAN'));\n"
      : "import test from 'node:test'; test('controlled selected failure',()=>{throw Error('CONTROLLED_SELECTED_FAILURE')});\n");
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['scripts/ci-run-registration-shard.mjs', '1'],
      {cwd: root, env, encoding: 'utf8', timeout: 10_000});
    assert.equal(result.status, 1, result.stderr + result.stdout);
    if (empty) assert.doesNotMatch(result.stdout, /UNRELATED_DISCOVERY_RAN/);
    else assert.match(result.stdout + result.stderr, /CONTROLLED_SELECTED_FAILURE/);
  } finally {rmSync(root, {recursive: true, force: true});}
});
