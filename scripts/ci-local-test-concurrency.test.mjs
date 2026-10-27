import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

function runPackageCommand(t, packageName, failingFile) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-local-test-concurrency-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const directory of ['bin', 'test', 'active']) mkdirSync(join(root, directory));
  const manifest = JSON.parse(readFileSync(new URL(`../packages/${packageName}/package.json`, import.meta.url), 'utf8'));
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  // Simulate a high-core host; the package's explicit bound must override this default.
  writeFileSync(join(root, 'bin/node'), `#!/bin/sh\nexec ${quote(process.execPath)} --test-concurrency=8 --test-reporter=tap "$@"\n`, {mode: 0o700});
  const files = ['account', 'leases', 'newly-added', 'recovery', 'sessions', 'venues'];
  for (const name of files) writeFileSync(join(root, 'test', `${name}.test.ts`), `
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
    assert.ok(concurrent <= 2, 'Too many concurrent database test files: ' + concurrent);
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
  const result = spawnSync('sh', ['-c', `exec ${manifest.scripts.test}`], {
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
