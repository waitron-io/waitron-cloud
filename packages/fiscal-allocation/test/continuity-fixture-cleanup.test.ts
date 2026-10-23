import assert from 'node:assert/strict';
import childProcess, { type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { access, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { authorityFixture } from './continuity-fixture.ts';

for (const failure of ['throw', 'spawn-error', 'early-exit', 'bad-ready', 'restart']) {
  test(`authority fixture cleans up after ${failure}`, async t => {
    const startupError = Error('forced authority startup refusal');
    const children: ChildProcess[] = [];
    let directory: string | undefined;
    let fixture: Awaited<ReturnType<typeof authorityFixture>> | undefined;
    const spawn = childProcess.spawn;
    t.mock.method(childProcess, 'spawn', (...args: Parameters<typeof spawn>) => {
      directory = String(args[1]![1]);
      if (failure === 'throw') throw startupError;
      const child = failure === 'restart' && children.length === 0
        ? spawn(...args)
        : failure === 'spawn-error'
          ? spawn(process.execPath + '-does-not-exist', [], { stdio: ['ignore', 'pipe', 'inherit'] })
          : spawn(process.execPath, ['-e', failure === 'early-exit'
            ? 'process.exit(7)'
            : "process.stdout.write('invalid ready JSON\\n'); setInterval(() => {}, 1000)"],
          { stdio: ['ignore', 'pipe', 'inherit'] });
      children.push(child);
      return child;
    });
    syncBuiltinESMExports();
    try {
      if (failure === 'restart') fixture = await authorityFixture();
      await assert.rejects(fixture ? fixture.restart() : authorityFixture(), error => {
        if (failure === 'throw') return error === startupError;
        if (failure === 'spawn-error') return (error as NodeJS.ErrnoException).code === 'ENOENT';
        if (failure === 'early-exit') return (error as Error).message === 'authority exited before ready';
        return error instanceof SyntaxError;
      });
      for (const child of children) if (child.pid !== undefined) {
        assert.notEqual(child.exitCode ?? child.signalCode, null, 'authority child remains running');
      }
      assert.ok(directory, 'startup did not acquire a directory');
      await assert.rejects(access(directory), { code: 'ENOENT' }, 'authority directory remains');
    } finally {
      for (const child of children) if (
        child.pid !== undefined && child.exitCode === null && child.signalCode === null
      ) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
      if (directory) await rm(directory, { recursive: true, force: true });
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}
