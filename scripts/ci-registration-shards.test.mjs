import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {registrationFiles} from './ci-run-registration-shard.mjs';

test('measured packing keeps files that were heavy together within the average plus one file', () => {
  const durations = {'a.test.ts': 600, 'b.test.ts': 10, 'c.test.ts': 10, 'd.test.ts': 10,
    'e.test.ts': 10, 'f.test.ts': 10, 'g.test.ts': 600, 'h.test.ts': 10};
  const files = Object.keys(durations);
  const groups = Array.from({length: 6}, (_, index) => registrationFiles(index + 1, files, durations));
  const totals = groups.map(group => group.reduce((sum, file) => sum + durations[file], 0));
  assert.deepEqual(groups.flat().sort(), files);
  assert.ok(Math.max(...totals) <= 210 + 600, `Heavy files still share a job: ${totals}`);
  assert.deepEqual(groups, Array.from({length: 6}, (_, index) => registrationFiles(index + 1, [...files].reverse(), durations)),
    'Input order must not change the six assignments');
});

test('new files use the live measured mean while stale names do not move work', () => {
  const files = ['a.test.ts', 'b.test.ts', 'new.test.ts'];
  const durations = {'a.test.ts': 600, 'b.test.ts': 300, 'deleted.test.ts': 99999};
  assert.deepEqual(registrationFiles(1, files, durations), ['a.test.ts']);
  assert.deepEqual(registrationFiles(2, files, durations), ['new.test.ts']);
  assert.deepEqual(registrationFiles(3, files, durations), ['b.test.ts']);
  assert.deepEqual(registrationFiles(1, ['b.test.ts', 'a.test.ts'], {}), ['a.test.ts']);
  assert.deepEqual(registrationFiles(2, ['b.test.ts', 'a.test.ts'], {}), ['b.test.ts']);
});

test('the measured duration table contains sorted, finite nonnegative millisecond weights', () => {
  const durations = JSON.parse(readFileSync(new URL('./ci-registration-durations.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(durations), Object.keys(durations).sort());
  assert.ok(Object.keys(durations).length > 0);
  for (const [file, duration] of Object.entries(durations)) {
    assert.match(file, /^[^/]+\.test\.ts$/);
    assert.ok(Number.isFinite(duration) && duration >= 0, file);
  }
});

test('a symlinked registration command executes selected tests and refuses invalid partitions', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-registration-link-'));
  try {
    mkdirSync(join(root, 'scripts'));
    cpSync('scripts/ci-run-registration-shard.mjs', join(root, 'scripts/ci-run-registration-shard.mjs'));
    cpSync('scripts/ci-registration-durations.json', join(root, 'scripts/ci-registration-durations.json'));
    cpSync(new URL('./ci-required-cases.mjs', import.meta.url), join(root, 'scripts/ci-required-cases.mjs'));
    writeFileSync(join(root, 'scripts/ci-required-cases.json'), '{}\n');
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

test('registration runner executes all current and future files exactly once with measured packing', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-registration-balanced-'));
  try {
    mkdirSync(join(root, 'scripts'));
    cpSync('scripts/ci-run-registration-shard.mjs', join(root, 'scripts/ci-run-registration-shard.mjs'));
    cpSync('scripts/ci-registration-durations.json', join(root, 'scripts/ci-registration-durations.json'));
    cpSync(new URL('./ci-required-cases.mjs', import.meta.url), join(root, 'scripts/ci-required-cases.mjs'));
    writeFileSync(join(root, 'scripts/ci-required-cases.json'), '{}\n');
    const directory = join(root, 'packages/registration/test');
    mkdirSync(directory, {recursive: true});
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    const files = readdirSync('packages/registration/test').filter(name => name.endsWith('.test.ts'))
      .concat('zz-future-registration.test.ts').sort();
    for (const file of files) writeFileSync(join(directory, file),
      `import test from 'node:test'; import assert from 'node:assert/strict'; test(${JSON.stringify(file)}, () => {assert.ok(process.execArgv.includes('--test-timeout=30000')); console.log(${JSON.stringify(`D576_FILE ${file}`)}); console.log('D576_PARENT '+process.ppid);});\n`);
    writeFileSync(join(directory, 'metadata.json'), '{"not a test":true}\n');
    writeFileSync(join(directory, '.hidden.test.ts'), "throw Error('HIDDEN_REGISTRATION_TEST_RAN');\n");
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
      groups.push(selected);
    }
    assert.deepEqual(groups.flat().sort(), files);
    assert.equal(groups.flat().includes('venue-service-legacy-schema-guards.test.ts'), false);
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
    cpSync('scripts/ci-registration-durations.json', join(root, 'scripts/ci-registration-durations.json'));
    cpSync(new URL('./ci-required-cases.mjs', import.meta.url), join(root, 'scripts/ci-required-cases.mjs'));
    writeFileSync(join(root, 'scripts/ci-required-cases.json'), '{}\n');
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
