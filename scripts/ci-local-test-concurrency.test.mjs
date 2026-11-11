import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, cpSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

function runPackageCommand(t, packageName, failingFile) {
  const holder = mkdtempSync(join(tmpdir(), 'cloud-local-test-concurrency-'));
  const root = join(holder, 'packages', packageName);
  t.after(() => rmSync(holder, {recursive: true, force: true}));
  mkdirSync(root, {recursive: true});
  mkdirSync(join(holder, 'scripts'));
  cpSync(new URL('./ci-required-cases.mjs', import.meta.url), join(holder, 'scripts/ci-required-cases.mjs'));
  writeFileSync(join(holder, 'scripts/ci-required-cases.json'), '{}\n');
  for (const directory of ['bin', 'test', 'quality', 'active']) mkdirSync(join(root, directory));
  const manifest = JSON.parse(readFileSync(new URL(`../packages/${packageName}/package.json`, import.meta.url), 'utf8'));
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  // Simulate a high-core host; the package's explicit bound must override this default.
  writeFileSync(join(root, 'bin/node'), `#!/bin/sh\nexec ${quote(process.execPath)} --test-concurrency=8 "$@"\n`, {mode: 0o700});
  const files = packageName === 'translation'
    ? ['test', 'quality'].flatMap(directory => [
      ...readdirSync(new URL(`../packages/translation/${directory}/`, import.meta.url))
        .filter(name => name.endsWith('.test.ts')).map(name => `${directory}/${name.slice(0, -8)}`),
      `${directory}/newly-added`,
    ]).sort()
    : ['account', 'leases', 'newly-added', 'recovery', 'sessions', 'venues'];
  for (const name of files) writeFileSync(join(root, name.includes('/') ? `${name}.test.ts` : `test/${name}.test.ts`), `
import assert from 'node:assert/strict';
import {appendFileSync, readdirSync, unlinkSync, writeFileSync} from 'node:fs';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
test(${JSON.stringify(name)}, async () => {
  const active = 'active/' + process.pid;
  writeFileSync(active, '', {flag: 'wx'});
  try {
    const concurrent = readdirSync('active').length;
    appendFileSync('events.jsonl', JSON.stringify({name: ${JSON.stringify(name)}, phase: 'start', concurrent}) + '\\n');
    ${packageName === 'translation' ? '' : "assert.ok(concurrent <= 2, 'Too many concurrent database test files: ' + concurrent);"}
    await delay(120);
    assert.notEqual(${JSON.stringify(name)}, ${JSON.stringify(failingFile ?? null)}, 'controlled package failure');
  } finally {
    unlinkSync(active);
    appendFileSync('events.jsonl', JSON.stringify({name: ${JSON.stringify(name)}, phase: 'finish'}) + '\\n');
  }
});
`);
  const env = {...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`};
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync('sh', ['-c', manifest.scripts.test], {
    cwd: root, env, encoding: 'utf8', timeout: 15_000, detached: true,
  });
  // This process group contains only the command and file workers created by this probe.
  if (result.pid) {
    try { process.kill(-result.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stdout + result.stderr);
  const events = readFileSync(join(root, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.filter(event => event.phase === 'start').map(event => event.name).sort(), files);
  assert.deepEqual(events.filter(event => event.phase === 'finish').map(event => event.name).sort(), files);
  assert.deepEqual(readdirSync(join(root, 'active')), []);
  if (packageName === 'translation') {
    const launcher = 'test/local-stack-runtime';
    const launcherStart = events.findIndex(event => event.name === launcher && event.phase === 'start');
    const launcherFinish = events.findIndex(event => event.name === launcher && event.phase === 'finish');
    assert.equal(events[launcherStart].concurrent, 1, 'the launcher must run alone');
    assert.equal(launcherStart, 0, 'the launcher must start first');
    assert.ok(events.every((event, index) => event.name === launcher || index > launcherFinish),
      'every other file must start after the launcher finishes');
  }
  return result;
}

for (const packageName of ['registration', 'account-http']) {
  test(`${packageName} full local command discovers every file without exceeding two active files`, t => {
    const result = runPackageCommand(t, packageName);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# tests 6\n# suites 0\n# pass 6\n# fail 0/);
  });

  test(`${packageName} full local command reports a failed file and completes the remaining files`, t => {
    const result = runPackageCommand(t, packageName, 'account');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /controlled package failure/);
    assert.match(result.stdout, /# tests 6\n# suites 0\n# pass 5\n# fail 1/);
    assert.doesNotMatch(result.stdout + result.stderr, /Too many concurrent database test files/);
  });
}

test('translation runs the launcher alone, then discovers every test and quality file once', t => {
  const result = runPackageCommand(t, 'translation');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('translation runs both phases and preserves a failure from either phase', t => {
  for (const failingFile of ['test/local-stack-runtime', 'quality/newly-added']) {
    const result = runPackageCommand(t, 'translation', failingFile);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /controlled package failure/);
  }
});
