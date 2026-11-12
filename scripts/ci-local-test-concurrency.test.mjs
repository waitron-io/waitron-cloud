import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, mkdirSync, cpSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

async function runPackageCommand(t, packageName, failingFile, args = [], lingering) {
  const holder = mkdtempSync(join(tmpdir(), 'cloud-local-test-concurrency-'));
  const root = join(holder, 'packages', packageName);
  t.after(() => rmSync(holder, {recursive: true, force: true}));
  mkdirSync(root, {recursive: true});
  mkdirSync(join(holder, 'scripts'));
  cpSync(new URL('./ci-required-cases.mjs', import.meta.url), join(holder, 'scripts/ci-required-cases.mjs'));
  writeFileSync(join(holder, 'scripts/ci-required-cases.json'), '{}\n');
  for (const directory of ['bin', 'test', 'quality', 'active']) mkdirSync(join(root, directory));
  const manifest = JSON.parse(readFileSync(new URL(`../packages/${packageName}/package.json`, import.meta.url), 'utf8'));
  if (lingering) {
    assert.equal(manifest.scripts.test.match(/--test-timeout=30000\b/g)?.length, 1);
    manifest.scripts.test = manifest.scripts.test.replace('--test-timeout=30000', '--test-timeout=2000');
  }
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
test(${JSON.stringify(name)}, async t => {
  const active = 'active/' + process.pid;
  writeFileSync(active, '', {flag: 'wx'});
  t.after(() => {
    unlinkSync(active);
    appendFileSync('events.jsonl', JSON.stringify({name: ${JSON.stringify(name)}, phase: 'finish'}) + '\\n');
  });
    const concurrent = readdirSync('active').length;
    appendFileSync('events.jsonl', JSON.stringify({name: ${JSON.stringify(name)}, phase: 'start', concurrent}) + '\\n');
    ${packageName === 'translation' ? '' : "assert.ok(concurrent <= 2, 'Too many concurrent database test files: ' + concurrent);"}
    await delay(120);
    ${name === 'account' && lingering ? `setInterval(() => {}, 1000); ${lingering === 'timeout' ? 'await new Promise(() => {});' : "throw new Error('controlled live-handle failure');"}` : ''}
    assert.notEqual(${JSON.stringify(name)}, ${JSON.stringify(failingFile ?? null)}, 'controlled package failure');
});
`);
  const env = {...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`};
  delete env.NODE_TEST_CONTEXT;
  const child = spawn('sh', ['-c', `${manifest.scripts.test} ${args.map(quote).join(' ')}`], {
    cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  // This process group contains only the command and file workers created by this probe.
  let stopped = false;
  const stop = () => {
    if (child.pid && !stopped) {
      stopped = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  };
  let stdout = '', stderr = '', error, timedOut = false;
  child.stdout.setEncoding('utf8').on('data', text => { stdout += text; });
  child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
  child.once('error', cause => { error = cause; });
  const timer = setTimeout(() => { timedOut = true; stop(); }, 15_000);
  let result;
  try {
    result = await new Promise(resolve => child.once('close', (status, signal) => resolve({status, signal})));
  } finally {
    clearTimeout(timer);
    stop();
  }
  Object.assign(result, {stdout, stderr, error});
  assert.equal(timedOut, false, 'package command exceeded its 15-second outer safety bound');
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
  test(`${packageName} full local command discovers every file without exceeding two active files`, async t => {
    const result = await runPackageCommand(t, packageName);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# tests 6\n# suites 0\n# pass 6\n# fail 0/);
  });

  test(`${packageName} full local command reports a failed file and completes the remaining files`, async t => {
    const result = await runPackageCommand(t, packageName, 'account');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /controlled package failure/);
    assert.match(result.stdout, /# tests 6\n# suites 0\n# pass 5\n# fail 1/);
    assert.doesNotMatch(result.stdout + result.stderr, /Too many concurrent database test files/);
  });

  test(`${packageName} completes later files after a failure with a live handle`, async t => {
    const result = await runPackageCommand(t, packageName, undefined, [], 'failure');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /controlled live-handle failure/);
    assert.match(result.stdout, /# tests 6\n# suites 0\n# pass 5\n# fail 1\n# cancelled 0/);
    assert.match(result.stdout, /# Required cases: 0 passed\n/);
  });

  test(`${packageName} reports timeout and completes later files with a live handle`, async t => {
    const result = await runPackageCommand(t, packageName, undefined, [], 'timeout');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /test timed out after 2000ms/);
    assert.match(result.stdout, /# tests 6\n# suites 0\n# pass 5\n# fail 0\n# cancelled 1/);
    assert.match(result.stdout, /# Required cases: 0 passed\n/);
  });
}

test('translation runs the launcher alone, then discovers every test and quality file once', async t => {
  const result = await runPackageCommand(t, 'translation');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('translation runs both phases and preserves a failure from either phase', async t => {
  for (const failingFile of ['test/local-stack-runtime', 'quality/newly-added']) {
    const result = await runPackageCommand(t, 'translation', failingFile);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /controlled package failure/);
  }
});

test('translation accepts test runner arguments after the package command', async t => {
  const result = await runPackageCommand(t, 'translation', undefined, ['--test-reporter=spec', '--test-reporter-destination=stdout']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /✔ quality\/newly-added/, 'the second phase must use the requested reporter');
  assert.doesNotMatch(result.stdout, /✔ test\/local-stack-runtime/, 'the launcher remains unfiltered');
});
