import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, writeFile, rm, mkdir, access, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {reserveRelease, appendReleaseEvent} from './ui-ledger.mjs';
import {readLedger, persistLedger} from './ui-ledger-git.mjs';

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  env: {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}}).trim();
const request = {source: {repository: 'clintongormley/waitron', commit: 'a'.repeat(40), version: '0.1.0'},
  inputsSha512: 'b'.repeat(128), recipeSha512: 'c'.repeat(128), sourceChecksSha512: 'd'.repeat(128),
  registryVersions: ['0.1.0'], at: '2026-11-05T20:00:00.000Z'};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ui-ledger-git-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const remote = join(root, 'remote.git');
  git(root, 'init', '--bare', remote);
  const one = join(root, 'one');
  git(root, 'clone', remote, one);
  const configure = path => {
    git(path, 'config', 'user.name', 'Ledger test');
    git(path, 'config', 'user.email', 'ledger@example.invalid');
  };
  configure(one);
  git(one, 'switch', '--orphan', 'ui-release-ledger');
  await writeFile(join(one, 'releases.json'), JSON.stringify({schema: 1, events: []}) + '\n');
  git(one, 'add', 'releases.json');
  git(one, 'commit', '-s', '-m', 'Initialise test ledger');
  git(one, 'push', 'origin', 'HEAD:refs/heads/ui-release-ledger');
  const two = join(root, 'two');
  git(root, 'clone', '--branch', 'ui-release-ledger', remote, two);
  configure(two);
  return {root, remote, one, two};
}

test('a reservation survives a fresh checkout, with a signed-off commit and normal hooks', async t => {
  const {one, two} = await fixture(t);
  const hooks = join(one, '.git/hooks');
  await mkdir(hooks, {recursive: true});
  await writeFile(join(hooks, 'pre-push'), '#!/bin/sh\n: > .git/push-hook-ran\n', {mode: 0o755});
  const before = await readLedger(one);
  const next = reserveRelease(before.ledger, request);
  const after = await persistLedger(one, before, next);
  git(two, 'pull', '--ff-only');
  assert.deepEqual((await readLedger(two)).ledger, next);
  assert.equal(after.head, git(two, 'rev-parse', 'HEAD'));
  assert.match(git(two, 'log', '-1', '--format=%B'), /Signed-off-by: Ledger test <ledger@example.invalid>/);
  assert.equal(await readFile(join(one, '.git/push-hook-ran'), 'utf8'), '');
  assert.equal(git(one, 'status', '--porcelain'), '');
});

test('two writers of the same snapshot cannot overwrite a reservation or retry automatically', async t => {
  const {one, two, remote} = await fixture(t);
  const first = await readLedger(one);
  const stale = await readLedger(two);
  const next = reserveRelease(first.ledger, request);
  await persistLedger(one, first, next);
  const winner = git(one, 'rev-parse', 'HEAD');
  await assert.rejects(() => persistLedger(two, stale, reserveRelease(stale.ledger, {
    ...request, source: {...request.source, commit: 'e'.repeat(40)},
  })), /stale|lease|rejected/);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/ui-release-ledger'), winner);
  assert.equal(git(two, 'rev-parse', 'HEAD'), stale.head, 'a known stale remote refuses before committing');
  assert.equal(JSON.parse(git(remote, 'show', winner + ':releases.json')).events[0].source.commit, 'a'.repeat(40));
});

test('a stale local snapshot, dirty checkout and ordinary branch refuse before any commit', async t => {
  const {one} = await fixture(t);
  const snapshot = await readLedger(one);
  const next = reserveRelease(snapshot.ledger, request);
  await writeFile(join(one, 'stray'), 'unrelated');
  await assert.rejects(() => persistLedger(one, snapshot, next), /clean/);
  await rm(join(one, 'stray'));
  git(one, 'switch', '-c', 'main');
  await assert.rejects(() => persistLedger(one, snapshot, next), /dedicated/);
  git(one, 'switch', 'ui-release-ledger');
  await assert.rejects(() => persistLedger(one, {...snapshot, head: 'f'.repeat(40)}, next), /snapshot/);
  assert.equal(git(one, 'rev-parse', 'HEAD'), snapshot.head);
});

test('persistence refuses removal or editing of published history and unrelated tracked files', async t => {
  const {one} = await fixture(t);
  let snapshot = await readLedger(one);
  const next = reserveRelease(snapshot.ledger, request);
  await persistLedger(one, snapshot, next);
  snapshot = await readLedger(one);
  const changed = reserveRelease({schema: 1, events: []}, {...request, source: {...request.source, commit: 'e'.repeat(40)}});
  await assert.rejects(() => persistLedger(one, snapshot, changed), /append-only/);
  await assert.rejects(() => persistLedger(one, snapshot, {schema: 1, events: []}), /append-only/);
  await writeFile(join(one, 'unrelated'), 'preserve');
  git(one, 'add', 'unrelated');
  git(one, 'commit', '-s', '-m', 'Track unrelated file');
  await assert.rejects(() => readLedger(one), /only releases.json/);
});

test('an identical retry writes no extra commit and a failing hook cannot advance the remote', async t => {
  const {one, remote} = await fixture(t);
  const snapshot = await readLedger(one);
  assert.deepEqual(await persistLedger(one, snapshot, snapshot.ledger), snapshot);
  assert.equal(git(one, 'rev-parse', 'HEAD'), snapshot.head);
  await writeFile(join(one, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 7\n', {mode: 0o755});
  await assert.rejects(() => persistLedger(one, snapshot, reserveRelease(snapshot.ledger, request)), /commit/);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/ui-release-ledger'), snapshot.head);
});

test('two simultaneous pushes from one remote revision keep exactly one durable reservation', async t => {
  const {one, two, remote, root} = await fixture(t);
  const release = join(root, 'release-pushes');
  for (const path of [one, two]) {
    await writeFile(join(path, '.git/hooks/pre-push'), `#!/bin/sh
: > .git/push-ready
while [ ! -f '${release}' ]; do sleep 0.01; done
`, {mode: 0o755});
  }
  const first = await readLedger(one);
  const second = await readLedger(two);
  const pending = Promise.allSettled([
    persistLedger(one, first, reserveRelease(first.ledger, request)),
    persistLedger(two, second, reserveRelease(second.ledger, {...request, source: {...request.source, commit: 'e'.repeat(40)}})),
  ]);
  let barrierError;
  try {
    const deadline = Date.now() + 10000;
    for (const path of [one, two]) {
      while (true) {
        try { await access(join(path, '.git/push-ready')); break; }
        catch { assert(Date.now() < deadline, 'both writers must reach the push hook'); }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  } catch (error) {
    barrierError = error;
  } finally {
    await writeFile(release, 'go');
  }
  const results = await pending;
  if (barrierError) throw barrierError;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const winner = results.find(result => result.status === 'fulfilled').value;
  assert.equal(git(remote, 'rev-parse', 'refs/heads/ui-release-ledger'), winner.head);
  assert.equal(JSON.parse(git(remote, 'show', winner.head + ':releases.json')).events.length, 1);
  assert.equal(git(remote, 'rev-list', '--count', 'refs/heads/ui-release-ledger'), '2');
});

test('ambient Git metadata cannot redirect ledger reads into another checkout', async t => {
  const {one, two} = await fixture(t);
  const head = git(one, 'rev-parse', 'HEAD');
  git(two, 'commit', '--allow-empty', '-s', '-m', 'Different local head');
  const inherited = process.env.GIT_DIR;
  try {
    process.env.GIT_DIR = join(two, '.git');
    assert.equal((await readLedger(one)).head, head);
  } finally {
    if (inherited === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = inherited;
  }
});

test('an exact lease refuses a remote rollback between preflight and push advertisement', async t => {
  const {one, remote} = await fixture(t);
  const initial = await readLedger(one);
  await persistLedger(one, initial, reserveRelease(initial.ledger, request));
  const snapshot = await readLedger(one);
  const next = appendReleaseEvent(snapshot.ledger, {type: 'prepared', sourceCommit: 'a'.repeat(40),
    version: '0.2.0', at: '2026-11-05T20:01:00.000Z', artifact: {sha512: 'e'.repeat(128),
      manifestSha512: 'f'.repeat(128), notices: {LICENSE: '1'.repeat(128), 'LICENSE-GRANTS.md': '2'.repeat(128)}}});
  await writeFile(join(one, '.git/hooks/pre-commit'), `#!/bin/sh
git --git-dir='${remote}' update-ref refs/heads/ui-release-ledger ${initial.head} ${snapshot.head}
`, {mode: 0o755});
  await assert.rejects(() => persistLedger(one, snapshot, next), /stale|rejected/);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/ui-release-ledger'), initial.head);
  assert.notEqual(git(one, 'rev-parse', 'HEAD'), snapshot.head, 'retain the signed local attempt');
  await assert.rejects(() => access(join(one, '.git/ui-release-ledger.lock')), /ENOENT/);
});

test('HOME Git configuration cannot redirect a ledger push or its remote readback', async t => {
  const {root, one, remote} = await fixture(t);
  const decoy = join(root, 'decoy.git');
  git(root, 'clone', '--bare', remote, decoy);
  const home = join(root, 'home');
  await mkdir(home);
  await writeFile(join(home, '.gitconfig'), `[url "${decoy}"]\n  insteadOf = ${remote}\n`);
  const snapshot = await readLedger(one);
  const priorHome = process.env.HOME;
  try {
    process.env.HOME = home;
    await persistLedger(one, snapshot, reserveRelease(snapshot.ledger, request));
  } finally { process.env.HOME = priorHome; }
  assert.notEqual(git(remote, 'rev-parse', 'refs/heads/ui-release-ledger'), snapshot.head);
  assert.equal(git(decoy, 'rev-parse', 'refs/heads/ui-release-ledger'), snapshot.head);
});

test('hidden index flags, ignored files, executable ledger mode and nested roots refuse reads', async t => {
  const {one} = await fixture(t);
  for (const flag of ['assume-unchanged', 'skip-worktree']) {
    git(one, 'update-index', '--' + flag, 'releases.json');
    await assert.rejects(() => readLedger(one), /hidden index flags/);
    git(one, 'update-index', '--no-' + flag, 'releases.json');
  }
  await writeFile(join(one, '.git/info/exclude'), 'ignored-file\n');
  await writeFile(join(one, 'ignored-file'), 'stray');
  await assert.rejects(() => readLedger(one), /clean/);
  await rm(join(one, 'ignored-file'));
  const nested = join(one, 'nested');
  await mkdir(nested);
  await assert.rejects(() => readLedger(nested), /root/);
  await rm(nested, {recursive: true});
  await chmod(join(one, 'releases.json'), 0o755);
  git(one, 'add', 'releases.json');
  git(one, 'commit', '-s', '-m', 'Make ledger executable');
  await assert.rejects(() => readLedger(one), /regular file/);
});

test('a hook changing valid ledger bytes cannot publish a different preparation', async t => {
  const {one, remote} = await fixture(t);
  const snapshot = await readLedger(one);
  await writeFile(join(one, '.git/hooks/pre-commit'), `#!/bin/sh
node -e 'const fs=require("node:fs");const p="releases.json";const d=JSON.parse(fs.readFileSync(p));d.events[0].inputsSha512="3".repeat(128);fs.writeFileSync(p,JSON.stringify(d)+"\\n");'
git add releases.json
`, {mode: 0o755});
  await assert.rejects(() => persistLedger(one, snapshot, reserveRelease(snapshot.ledger, request)), /hooks changed/);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/ui-release-ledger'), snapshot.head);
});

test('a hook changing the commit parent cannot rewrite the durable ledger history', async t => {
  const {one, remote} = await fixture(t);
  const initial = await readLedger(one);
  await persistLedger(one, initial, reserveRelease(initial.ledger, request));
  const snapshot = await readLedger(one);
  const next = appendReleaseEvent(snapshot.ledger, {type: 'prepared', sourceCommit: 'a'.repeat(40),
    version: '0.2.0', at: '2026-11-05T20:01:00.000Z', artifact: {sha512: 'e'.repeat(128),
      manifestSha512: 'f'.repeat(128), notices: {LICENSE: '1'.repeat(128), 'LICENSE-GRANTS.md': '2'.repeat(128)}}});
  git(one, 'switch', '-c', 'alternate-parent', initial.head);
  await writeFile(join(one, 'releases.json'), JSON.stringify(next, null, 2) + '\n');
  git(one, 'add', 'releases.json');
  git(one, 'commit', '-s', '-m', 'Prepare alternate parent test tree');
  const alternate = git(one, 'rev-parse', 'HEAD');
  git(one, 'switch', 'ui-release-ledger');
  await writeFile(join(one, '.git/hooks/post-commit'), `#!/bin/sh\ngit update-ref refs/heads/ui-release-ledger ${alternate}\n`, {mode: 0o755});
  await assert.rejects(() => persistLedger(one, snapshot, next), /parent changed/);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/ui-release-ledger'), snapshot.head);
});

test('a remote changed by its receive hook cannot be reported as a durable successful push', async t => {
  const {one, remote} = await fixture(t);
  const snapshot = await readLedger(one);
  await writeFile(join(remote, 'hooks/post-receive'), `#!/bin/sh\ngit update-ref refs/heads/ui-release-ledger ${snapshot.head}\n`, {mode: 0o755});
  await assert.rejects(() => persistLedger(one, snapshot, reserveRelease(snapshot.ledger, request)), /remote ledger readback differs/);
});

test('a hook stripping the sign-off refuses before pushing', async t => {
  const {one, remote} = await fixture(t);
  const snapshot = await readLedger(one);
  await writeFile(join(one, '.git/hooks/commit-msg'), `#!/bin/sh
node -e 'const fs=require("node:fs");const p=process.argv[1];fs.writeFileSync(p,fs.readFileSync(p,"utf8").split("\\n").filter(l=>!l.startsWith("Signed-off-by:")).join("\\n"));' "$1"
`, {mode: 0o755});
  await assert.rejects(() => persistLedger(one, snapshot, reserveRelease(snapshot.ledger, request)), /sign-off/);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/ui-release-ledger'), snapshot.head);
});

test('a timed-out hook loses its whole process group before releasing the local lock', async t => {
  const {one, remote, root} = await fixture(t);
  const snapshot = await readLedger(one);
  const marker = join(root, 'late-hook-write');
  await writeFile(join(one, '.git/hooks/pre-commit'), `#!/bin/sh
trap '' TERM
: > .git/hook-started
sleep 2
: > '${marker}'
`, {mode: 0o755});
  await assert.rejects(() => persistLedger(one, snapshot, reserveRelease(snapshot.ledger, request),
    {commandTimeoutMs: 1000}), /timed out/);
  await access(join(one, '.git/hook-started'));
  await assert.rejects(() => access(join(one, '.git/ui-release-ledger.lock')), /ENOENT/);
  await new Promise(resolve => setTimeout(resolve, 2200));
  await assert.rejects(() => access(marker), /ENOENT/);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/ui-release-ledger'), snapshot.head);
});

test('a hook dirtying the lock preserves both the command error and cleanup error', async t => {
  const {one} = await fixture(t);
  const snapshot = await readLedger(one);
  await writeFile(join(one, '.git/hooks/pre-commit'), '#!/bin/sh\n: > .git/ui-release-ledger.lock/debris\nexit 7\n', {mode: 0o755});
  await assert.rejects(() => persistLedger(one, snapshot, reserveRelease(snapshot.ledger, request)), error => {
    assert(error instanceof AggregateError);
    assert.match(error.errors[0].message, /commit/);
    assert.equal(error.errors[1].code, 'ENOTEMPTY');
    return true;
  });
  await access(join(one, '.git/ui-release-ledger.lock/debris'));
});

test('a failed process signal keeps the local lock instead of admitting another writer', async t => {
  const {one, remote} = await fixture(t);
  const snapshot = await readLedger(one);
  await writeFile(join(one, '.git/hooks/pre-commit'), '#!/bin/sh\nsleep 2\n', {mode: 0o755});
  const originalKill = process.kill;
  try {
    process.kill = () => { throw Object.assign(new Error('controlled process signal refusal'), {code: 'EPERM'}); };
    await assert.rejects(() => persistLedger(one, snapshot, reserveRelease(snapshot.ledger, request),
      {commandTimeoutMs: 1000}), /process cleanup failed/);
  } finally { process.kill = originalKill; }
  await access(join(one, '.git/ui-release-ledger.lock'));
  assert.equal(git(remote, 'rev-parse', 'refs/heads/ui-release-ledger'), snapshot.head);
});

test('excessive hook output stops its process group without publishing', async t => {
  const {one, remote} = await fixture(t);
  const snapshot = await readLedger(one);
  await writeFile(join(one, '.git/hooks/pre-commit'), `#!/bin/sh
node -e 'process.stdout.write("x".repeat(17*1024*1024))'
sleep 2
`, {mode: 0o755});
  await assert.rejects(() => persistLedger(one, snapshot, reserveRelease(snapshot.ledger, request)), /16 MiB/);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/ui-release-ledger'), snapshot.head);
  await assert.rejects(() => access(join(one, '.git/ui-release-ledger.lock')), /ENOENT/);
});

test('each transition must be durable separately and a same-checkout writer cannot ignore its lock', async t => {
  const {one} = await fixture(t);
  const snapshot = await readLedger(one);
  const reserved = reserveRelease(snapshot.ledger, request);
  const prepared = appendReleaseEvent(reserved, {type: 'prepared', sourceCommit: 'a'.repeat(40),
    version: '0.2.0', at: '2026-11-05T20:01:00.000Z', artifact: {sha512: 'e'.repeat(128),
      manifestSha512: 'f'.repeat(128), notices: {LICENSE: '1'.repeat(128), 'LICENSE-GRANTS.md': '2'.repeat(128)}}});
  await assert.rejects(() => persistLedger(one, snapshot, prepared), /one transition/);
  await mkdir(join(one, '.git/ui-release-ledger.lock'));
  await assert.rejects(() => persistLedger(one, snapshot, reserved), /EEXIST/);
  await access(join(one, '.git/ui-release-ledger.lock'));
  assert.equal(git(one, 'rev-parse', 'HEAD'), snapshot.head);
});
