import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chmod, open, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {computeUiBuildEvidence, readUiGitTree} from './ui-build-inputs.mjs';
import {createBuildFixture, gitExecutable, repository} from './ui-build-fixtures.mjs';

async function stopPid(pid, group = false) {
  try {
    process.kill(group ? -pid : pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
async function gone(pid) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
    await delay(10);
  }
  return false;
}
const script = (body) => '#!' + process.execPath + '\n' + body;

test('successful Git reads stop helpers left in their owned process group', async (t) => {
  const f = await repository(t),
    marker = join(f.root, 'child.pid'),
    helper = join(f.root, 'git-helper');
  await writeFile(
    helper,
    '#!/bin/sh\n/bin/sleep 45 </dev/null >/dev/null 2>&1 &\nprintf "%s" "$!" > "' +
      marker +
      '"\nexec "' +
      gitExecutable +
      '" "$@"\n',
    {mode: 0o755}
  );
  let pid;
  try {
    const result = await readUiGitTree({repo: f.repo, commit: f.commit, git: helper});
    pid = Number(await readFile(marker, 'utf8'));
    assert.equal(result.files.get('context.txt').bytes.toString(), 'original\n');
    assert(await gone(pid), 'Git helper survived the completed read');
  } finally {
    pid ??= Number(await readFile(marker, 'utf8'));
    await stopPid(pid);
  }
});

for (const kind of ['git', 'tool'])
  test(
    kind + ' deadline is independent of an escaped stdout holder',
    {timeout: 60000},
    async (t) => {
      const f = kind === 'git' ? await repository(t) : await createBuildFixture(t);
      const marker = join(f.root, 'escaped.pid'),
        executable = kind === 'git' ? join(f.root, 'git-helper') : f.tools.node.executable;
      await writeFile(
        executable,
        script(`import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const child=spawn(process.execPath,['-e','setTimeout(()=>{},45000)'],{detached:true,stdio:['ignore',1,2]});
writeFileSync(${JSON.stringify(marker)},String(child.pid));
${kind === 'tool' ? 'process.stdout.write("node fixture-v1\\n");' : ''}
process.exit(0);
`),
        {mode: 0o755}
      );
      const start = Date.now();
      try {
        await assert.rejects(
          kind === 'git'
            ? readUiGitTree({repo: f.repo, commit: f.commit, git: executable})
            : computeUiBuildEvidence(f),
          /timed out|truncated Git object|Git command failed/
        );
        assert(
          Date.now() - start < 33000,
          'escaped pipe postponed the fixed deadline: ' + (Date.now() - start)
        );
      } finally {
        const pid = Number(await readFile(marker, 'utf8'));
        await stopPid(pid, true);
        assert(await gone(pid), 'owned escaped test process did not stop');
      }
    }
  );

test('Git operation and real filesystem-cleanup failures retain both causes', async (t) => {
  const f = await repository(t),
    marker = join(f.root, 'owned-path'),
    helper = join(f.root, 'git-helper');
  await writeFile(
    helper,
    script(`import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
writeFileSync(${JSON.stringify(marker)},process.cwd());
mkdirSync('blocked');writeFileSync('blocked/file','owned');chmodSync('blocked',0o555);
process.stdout.write('malformed Git header\\n');process.exit(0);
`),
    {mode: 0o755}
  );
  let neutral;
  try {
    await assert.rejects(readUiGitTree({repo: f.repo, commit: f.commit, git: helper}), (error) => {
      assert(error instanceof AggregateError, 'operation error was overwritten by cleanup');
      assert(error.errors.some((cause) => /object type|object header/.test(cause.message)));
      assert(error.errors.some((cause) => ['EACCES', 'EPERM'].includes(cause.code)));
      return true;
    });
  } finally {
    neutral = await readFile(marker, 'utf8');
    await chmod(join(neutral, 'blocked'), 0o755).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await rm(neutral, {recursive: true, force: true});
  }
});

test('a FIFO Git metadata pointer refuses without waiting for a writer', async (t) => {
  const f = await repository(t),
    fifo = join(f.repo, '.git', 'commondir');
  execFileSync('mkfifo', [fifo]);
  let wakeup, timer;
  const start = Date.now();
  try {
    timer = setTimeout(() => {
      wakeup = open(fifo, constants.O_WRONLY | constants.O_NONBLOCK).then((file) => file.close());
    }, 750);
    await assert.rejects(
      readUiGitTree({repo: f.repo, commit: f.commit, git: gitExecutable}),
      /nonregular or oversized input file/
    );
    assert(Date.now() - start < 500, 'metadata read waited for the fallback writer');
  } finally {
    clearTimeout(timer);
    if (wakeup) await wakeup;
  }
});

test('a linked Git metadata pointer cannot supply regular pointer bytes', async (t) => {
  const f = await repository(t),
    pointer = join(f.root, 'pointer');
  await writeFile(pointer, '.\n');
  await symlink(pointer, join(f.repo, '.git', 'commondir'));
  await assert.rejects(
    readUiGitTree({repo: f.repo, commit: f.commit, git: gitExecutable}),
    /ELOOP|symbolic link/
  );
});
