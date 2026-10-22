import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const browserStep = workflow.match(/      - name: Install Chromium with bounded retry\n[\s\S]*?        run: \|\n([\s\S]*?)(?=      - )/)[1]
  .split('\n').map(line => line.replace(/^          /, '')).join('\n');

// Execute the workflow's shell. Only the outside installer and sudo boundary are controlled.
async function install(t, scenario = {}) {
  const mirror = createServer((request, response) => {
    if (request.url === '/archive.ubuntu.com/font.deb') response.end('qualified dependency bytes');
    // The other source accepts the connection but never supplies its package.
  });
  await new Promise(resolve => mirror.listen(0, '127.0.0.1', resolve));
  t.after(async () => { mirror.closeAllConnections(); await new Promise(resolve => mirror.close(resolve)); });
  const root = await mkdtemp(join(tmpdir(), 'cloud-ci-download-'));
  t.after(async () => {
    try { process.kill(Number(await readFile(join(root, 'holder.pid'), 'utf8')), 'SIGKILL'); } catch {}
    await rm(root, {recursive: true, force: true});
  });
  await mkdir(join(root, 'sources.list.d'));
  await writeFile(join(root, 'sources.list.d', 'ubuntu.sources'), 'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n');
  await writeFile(join(root, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o700});
  await writeFile(join(root, 'pnpm'), `#!/usr/bin/env python3
import fcntl, os, pathlib, signal, subprocess, sys, time, urllib.request
root = pathlib.Path(os.environ['DOWNLOAD_FIXTURE'])
count = root / 'attempts'
n = int(count.read_text()) + 1 if count.exists() else 1
count.write_text(str(n))
assert sys.argv[1:] == ['--filter', '@waitron-cloud/ui-smoke', 'exec', 'playwright', 'install', '--with-deps', 'chromium']
if os.environ.get('DOWNLOAD_SOURCE_REQUIRED') == '1':
    source = (root / 'sources.list.d' / 'ubuntu.sources').read_text()
    host = 'azure.archive.ubuntu.com' if 'mirror+file:/etc/apt/apt-mirrors.txt' in source else 'archive.ubuntu.com'
    print('fetching controlled dependency from ' + host, flush=True)
    with urllib.request.urlopen(os.environ['DOWNLOAD_MIRROR'] + '/' + host + '/font.deb') as response:
        assert response.read() == b'qualified dependency bytes'
    (root / 'installed').write_text('yes')
    sys.exit(0)
if os.environ.get('DOWNLOAD_FAIL') == '1':
    sys.exit(9)
if n == 1:
    holder = subprocess.Popen([sys.executable, '-c', """
import fcntl, os, pathlib, signal, time
root = pathlib.Path(os.environ['DOWNLOAD_FIXTURE'])
signal.signal(signal.SIGTERM, signal.SIG_IGN)
lock = (root / 'apt.lock').open('a+')
fcntl.lockf(lock, fcntl.LOCK_EX)
(root / 'holder.pid').write_text(str(os.getpid()))
while True: time.sleep(0.1)
"""], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    while not (root / 'holder.pid').exists(): time.sleep(0.01)
    while True: time.sleep(0.1)
with (root / 'apt.lock').open('a+') as lock:
    try: fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('first attempt still holds apt lock', flush=True)
        sys.exit(8)
(root / 'installed').write_text('yes')
`, {mode: 0o700});
  // Shorten only elapsed waits; keep the workflow's command, retry and cleanup wiring.
  const shell = browserStep.replaceAll('scripts/ci-browser-source.py', `scripts/ci-browser-source.py --apt-root ${root}`).replaceAll('120s', '1s').replaceAll('10s', '0.2s')
    .replaceAll('sleep 5', 'sleep 0.01').replaceAll('--timeout 120', '--timeout 1')
    .replaceAll('--grace 10', '--grace 0.2').replaceAll('--lock-wait 30', '--lock-wait 0.3')
    .replaceAll('--retry-delay 5', '--retry-delay 0.01')
    .replaceAll(/--lock \/var\/[^\s]+/g, `--lock ${join(root, 'apt.lock')}`);
  const child = spawn('bash', ['-e', '-o', 'pipefail', '-c', shell], {
    cwd: new URL('../', import.meta.url),
    env: {...process.env, PATH: `${root}:${process.env.PATH}`, DOWNLOAD_FIXTURE: root,
      DOWNLOAD_MIRROR: `http://127.0.0.1:${mirror.address().port}`, DOWNLOAD_FAIL: scenario.fail ? '1' : '0', DOWNLOAD_SOURCE_REQUIRED: scenario.source ? '1' : '0'}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return {code, output, attempts: Number(await readFile(join(root, 'attempts'), 'utf8')),
    installed: await readFile(join(root, 'installed'), 'utf8').catch(() => null)};
}

test('workflow stops the timed-out lock holder before the browser retry succeeds', {timeout: 15000}, async t => {
  const result = await install(t);
  assert.equal(result.code, 0, result.output);
  assert.equal(result.attempts, 2);
  assert.equal(result.installed, 'yes');
});

test('workflow fails after two failed install attempts without reporting success', async t => {
  const result = await install(t, {fail: true});
  assert.equal(result.code, 1, result.output);
  assert.equal(result.attempts, 2);
  assert.equal(result.installed, null);
});

// Removing workflow delegation or privileged supervision would reintroduce escaping apt children.
test('browser workflow delegates retries to owned cleanup with permission to stop apt descendants', () => {
  assert.match(browserStep, /sudo env/);
  assert.match(browserStep, /PLAYWRIGHT_BROWSERS_PATH=/);
  assert.match(browserStep, /python3 scripts\/ci-download.py/);
  assert.match(browserStep, /--timeout 120 --attempts 2/);
  assert.match(browserStep, /--grace 10 --lock-wait 30 --retry-delay 5/);
  for (const lock of ['/var/lib/dpkg/lock-frontend', '/var/lib/dpkg/lock', '/var/lib/apt/lists/lock', '/var/cache/apt/archives/lock']) {
    assert.ok(browserStep.includes(`--lock ${lock}`));
  }
  assert.doesNotMatch(browserStep, /for attempt|pkill|killall|rm .*lock/);
});

async function retry(t, command, options = []) {
  const child = spawn('python3', ['scripts/ci-download.py', '--timeout', '1', '--attempts', '2',
    '--grace', '0.2', '--lock-wait', '0.3', '--retry-delay', '0.01', ...options, '--', ...command], {
    cwd: new URL('../', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve({code, output}));
  });
  return {child, result};
}

async function heldLock(t, seconds = 30) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-ci-lock-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const lock = join(root, 'lock');
  const holder = spawn('python3', ['-u', '-c', `
import fcntl, sys, time
with open(sys.argv[1], 'a+') as lock:
    fcntl.lockf(lock, fcntl.LOCK_EX)
    print('locked', flush=True)
    time.sleep(float(sys.argv[2]))
`, lock, String(seconds)], {stdio: ['ignore', 'pipe', 'inherit']});
  const closed = new Promise(resolve => holder.once('close', resolve));
  t.after(async () => { holder.kill('SIGKILL'); await closed; });
  await new Promise((resolve, reject) => {
    holder.once('error', reject);
    holder.stdout.once('data', resolve);
  });
  return {holder, lock};
}

test('a lock held by an unrelated process prevents any install and is never removed or killed', async t => {
  const {holder, lock} = await heldLock(t);
  const {result} = await retry(t, ['python3', '-c', 'print("INSTALL STARTED")'], ['--lock', lock]);
  const done = await result;
  assert.equal(done.code, 1, done.output);
  assert.match(done.output, /lock is still held/);
  assert.doesNotMatch(done.output, /INSTALL STARTED|Download attempt/);
  assert.equal(holder.exitCode, null);
  assert.equal(holder.signalCode, null);
  assert.equal(await readFile(lock, 'utf8'), '');
});

test('a lock released inside the bounded wait permits one successful attempt', async t => {
  const {lock} = await heldLock(t, 0.15);
  const {result} = await retry(t, ['python3', '-c', 'print("INSTALLED")'], ['--lock', lock]);
  const done = await result;
  assert.equal(done.code, 0, done.output);
  assert.match(done.output, /INSTALLED/);
  assert.equal((done.output.match(/Download attempt/g) ?? []).length, 1);
});

test('each stalled attempt is stopped and the final timeout fails without a third attempt', async t => {
  const {result} = await retry(t, ['python3', '-c', 'import time; time.sleep(30)']);
  const done = await result;
  assert.equal(done.code, 1, done.output);
  assert.equal((done.output.match(/exceeded its time limit/g) ?? []).length, 2);
  assert.equal((done.output.match(/Download attempt \d/g) ?? []).length, 2);
});

test('cancelling supervision stops its child and does not start a retry', {timeout: 5000}, async t => {
  const {child, result} = await retry(t, ['python3', '-u', '-c', `
import os, signal, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
print('CHILD=' + str(os.getpid()), flush=True)
while True: time.sleep(0.1)
`]);
  let output = '';
  const pid = await new Promise(resolve => child.stdout.on('data', data => {
    output += data;
    const match = output.match(/CHILD=(\d+)/);
    if (match) resolve(Number(match[1]));
  }));
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch {} });
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  assert.equal(await exited, 143);
  const done = await result;
  assert.equal((done.output.match(/Download attempt \d/g) ?? []).length, 1);
  assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'});
});

// Leaving Azure configured must exhaust the real supervisor instead of reaching installation.
test('workflow escapes an unavailable Ubuntu mirror before installing browser dependencies', {timeout: 15000}, async t => {
  const result = await install(t, {source: true});
  assert.equal(result.code, 0, result.output);
  assert.equal(result.attempts, 1);
  assert.equal(result.installed, 'yes');
});
