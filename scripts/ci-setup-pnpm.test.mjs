import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const repository = new URL('../', import.meta.url).pathname;
const script = join(repository, 'scripts/ci-setup-pnpm.mjs');

test('every workflow installs pnpm through bounded verified setup before using or caching it', () => {
  for (const name of readdirSync(join(repository, '.github/workflows')).filter(name => /\.ya?ml$/.test(name))) {
    const source = readFileSync(join(repository, '.github/workflows', name), 'utf8');
    assert.doesNotMatch(source, /uses:\s*pnpm\/action-setup@/, `${name} retains an unbounded installer`);
    for (const job of source.split(/^  [\w-]+:\s*$/m).slice(1)) {
      if (!/cache:\s*pnpm|run:.*\bpnpm\b/.test(job)) continue;
      const setup = job.indexOf('run: node scripts/ci-setup-pnpm.mjs');
      assert.ok(setup >= 0, `${name} uses pnpm without the verified supervisor`);
      const use = job.search(/cache:\s*pnpm|run: pnpm\b/);
      assert.ok(use < 0 || setup < use, `${name} uses pnpm before setup`);
    }
  }
});

// Only the external installer is replaced. The real supervisor runs real children,
// publishes its selected executable, and must contain their failures and stalls.
async function run(mode, extraEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-pnpm-attempt-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(root, 'github-path'), '');
  writeFileSync(join(root, 'github-env'), '');
  writeFileSync(join(root, 'unrelated'), 'preserve me');
  writeFileSync(join(root, 'descendant.mjs'), `
import {appendFileSync, writeFileSync} from 'node:fs';
appendFileSync(process.env.FIXTURE_ROOT + '/pids', process.pid + '\\n');
process.on('SIGTERM', () => {});
setTimeout(() => writeFileSync(process.env.FIXTURE_ROOT + '/escaped', 'escaped'), 1500);
setInterval(() => {}, 1000);
`);
  const bootstrap = `
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
appendFileSync(join(process.env.FIXTURE_ROOT, 'pids'), process.pid + '\\n');
if (process.argv.slice(2).join(' ') !== 'self-update 9.15.0') throw Error('wrong self-update');
const mode = process.env.FIXTURE_MODE;
if (mode === 'signature') {console.error('ERR_PNPM_INVALID_SIGNATURE ECONNRESET'); process.exit(1);}
if (mode === 'identity') {console.error('ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE terminated'); process.exit(1);}
if (mode === 'self-update-reset') {console.error('ERR_PNPM_ECONNRESET'); process.exit(1);}
if (mode === 'self-update-hang') {setInterval(() => {}, 1000);} else {
  mkdirSync(join(process.env.PNPM_HOME, 'bin'), {recursive: true});
  const output = mode === 'wrong-version' ? '0.0.1' : '9.15.0';
  const after = mode === 'version-exit' ? 'exit 1' : mode === 'version-hang' ? 'exec sleep 60' : '';
  writeFileSync(join(process.env.PNPM_HOME, 'bin/pnpm'), '#!/bin/sh\\necho $$ >> "' + process.env.FIXTURE_ROOT + '/pids"\\necho ' + output + '\\n' + after + '\\n', {mode: 0o755});
}
`;
  writeFileSync(join(root, 'bootstrap.mjs'), bootstrap);
  writeFileSync(join(bin, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const root = process.env.FIXTURE_ROOT;
fs.appendFileSync(path.join(root, 'pids'), process.pid + '\\n');
const countPath = path.join(root, 'count');
const attempt = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, 'utf8') : 0) + 1;
fs.writeFileSync(countPath, String(attempt));
const lock = JSON.parse(fs.readFileSync('package-lock.json'));
if (process.argv.slice(2).join(' ') !== 'ci --no-audit --no-fund' ||
    lock.packages['node_modules/pnpm'].version !== '11.19.0' ||
    lock.packages['node_modules/pnpm'].integrity !== 'sha512-eIHz7VkNRyxKlV4riLISF5ERYGbcyIy8o4SeybYPG7qm0syyIfqR2k4cZb7yvL43k2Wup6xTnHv4be3DobItzg==') {
  console.error('fixture: installer or locked integrity changed'); process.exit(9);
}
if (attempt > 1 && fs.existsSync(path.join(process.cwd(), 'partial'))) {
  console.error('fixture: stale failed installation'); process.exit(9);
}
fs.writeFileSync('partial', 'incomplete');
console.error('attempt evidence ' + attempt);
const mode = process.env.FIXTURE_MODE;
if (mode === 'reset' || (mode === 'reset-first' && attempt === 1) || (mode === 'reset-twice' && attempt < 3)) {console.error('npm error code ECONNRESET'); process.exit(1);}
if (mode === 'integrity') {console.error('npm error code EINTEGRITY ECONNRESET'); process.exit(1);}
if (mode === 'reset-then-permission') {console.error('npm error code ECONNRESET\\nnpm error code EACCES'); process.exit(1);}
if (mode === 'unknown') {console.error('unclassified failure'); process.exit(1);}
if (mode === 'hang' || mode === 'ignore-term' || mode === 'descendant') {
  if (mode !== 'hang') process.on('SIGTERM', () => {});
  if (mode === 'descendant') require('node:child_process').spawn(process.execPath, [path.join(root, 'descendant.mjs')], {stdio: 'inherit'});
  setInterval(() => {}, 1000);
} else {
  fs.mkdirSync('node_modules/pnpm/bin', {recursive: true});
  fs.copyFileSync(path.join(root, 'bootstrap.mjs'), 'node_modules/pnpm/bin/pnpm.mjs');
}
`);
  chmodSync(join(bin, 'npm'), 0o755);
  const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root,
    GITHUB_PATH: join(root, 'github-path'), GITHUB_ENV: join(root, 'github-env'),
    FIXTURE_ROOT: root, FIXTURE_MODE: mode, PNPM_SETUP_ATTEMPT_MS: '3000', PNPM_SETUP_KILL_MS: '100', ...extraEnv};
  delete env.NODE_TEST_CONTEXT;
  const started = performance.now();
  const child = spawn(process.execPath, [script], {cwd: repository, env, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => {stdout += chunk;});
  let cancellationSent = false;
  child.stderr.on('data', chunk => {
    stderr += chunk;
    if (extraEnv.FIXTURE_CANCEL && !cancellationSent && stderr.includes('attempt evidence 1')) {
      cancellationSent = true;
      child.kill('SIGTERM');
    }
  });
  const stop = setTimeout(() => {
    if (existsSync(join(root, 'pids'))) for (const line of readFileSync(join(root, 'pids'), 'utf8').trim().split('\n')) {
      try {process.kill(Number(line), 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
    }
    child.kill('SIGKILL');
  }, 15_000);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({code, signal}));
    });
    const read = name => existsSync(join(root, name)) ? readFileSync(join(root, name), 'utf8') : '';
    if (mode === 'descendant') await new Promise(resolve => setTimeout(resolve, 1800));
    return {...result, stdout, stderr, elapsed: performance.now() - started, escaped: existsSync(join(root, 'escaped')),
      attempts: Number(read('count')), recordedChildren: read('pids').trim().split('\n').length,
      published: read('github-path'), exported: read('github-env'),
      unrelated: read('unrelated'), root};
  } finally {
    clearTimeout(stop);
    if (existsSync(join(root, 'pids'))) for (const line of readFileSync(join(root, 'pids'), 'utf8').trim().split('\n')) {
      try {process.kill(Number(line), 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
    }
    rmSync(root, {recursive: true, force: true});
  }
}

test('a healthy verified install needs one attempt', async () => {
  const result = await run('ok');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.attempts, 1);
  assert.match(result.published, /\/bin\n$/);
});

test('the third and final attempt can recover a transient reset', async () => {
  const result = await run('reset-twice');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.attempts, 3);
  assert.match(result.published, /\/bin\n$/);
});

test('cancellation stops an unresponsive child promptly and prevents another attempt', async () => {
  const result = await run('ignore-term', {FIXTURE_CANCEL: '1'});
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.attempts, 1);
  assert.equal(result.published, '');
  assert.ok(result.elapsed < 2000, `cancelled setup took ${result.elapsed}ms`);
});

test('timed-out attempts stop descendants that ignore the polite signal', async () => {
  const result = await run('descendant', {PNPM_SETUP_ATTEMPT_MS: '500'});
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.attempts, 3);
  assert.equal(result.recordedChildren, 6, 'each attempt must start the stubborn descendant it claims to stop');
  assert.equal(result.escaped, false, 'an owned descendant outlived setup');
});

test('a registry reset retries a fresh verified install and publishes only its pinned executable', async () => {
  const result = await run('reset-first');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.attempts, 2, 'one transient reset needs a second install');
  assert.match(result.published, /\/bin\n$/);
  assert.match(result.exported, /^PNPM_HOME=.+\n$/);
  assert.match(result.stderr, /attempt evidence 1[\s\S]*attempt evidence 2/);
  assert.ok(result.stderr.split('\n').filter(line => line.includes('"event":"process-start"')).length >= 2,
    'failed attempts retain the real diagnostic observer');
  assert.equal(result.unrelated, 'preserve me');
});

test('three registry resets fail without publishing an unverified installation', async () => {
  const result = await run('reset');
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.attempts, 3);
  assert.equal(result.published, '');
  assert.equal(result.exported, '');
  assert.match(result.stderr, /attempt evidence 3/);
});

for (const mode of ['integrity', 'signature', 'identity', 'unknown', 'reset-then-permission', 'wrong-version', 'version-exit']) {
  test(`${mode} fails immediately without publishing or retrying`, async () => {
    const result = await run(mode);
    assert.equal(result.code, 1, result.stderr);
    assert.equal(result.attempts, 1, 'a permanent or unknown refusal must not be retried');
    assert.equal(result.published, '');
    assert.equal(result.exported, '');
  });
}

for (const mode of ['hang', 'ignore-term', 'self-update-hang', 'version-hang']) {
  test(`${mode} is stopped within each attempt's bound`, async () => {
    const result = await run(mode, {PNPM_SETUP_ATTEMPT_MS: '750'});
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.code, 1, result.stderr);
    assert.equal(result.attempts, mode === 'version-hang' ? 1 : 3);
    assert.equal(result.published, '');
    assert.equal(result.exported, '');
    assert.ok(result.elapsed < 12_000, `setup took ${result.elapsed}ms`);
  });
}

test('a transient self-update failure never publishes bootstrap pnpm', async () => {
  const result = await run('self-update-reset');
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.attempts, 3);
  assert.equal(result.published, '');
});

for (const value of ['0', '-1', 'NaN', 'Infinity']) {
  test(`invalid attempt budget ${value} fails before installing`, async () => {
    const result = await run('reset-first', {PNPM_SETUP_ATTEMPT_MS: value});
    assert.equal(result.code, 1);
    assert.equal(result.attempts, 0);
    assert.equal(result.published, '');
    assert.match(result.stderr, /PNPM_SETUP_ATTEMPT_MS must be a positive whole number/);
    assert.doesNotMatch(result.stderr, /pnpm setup attempt/);
  });
}
