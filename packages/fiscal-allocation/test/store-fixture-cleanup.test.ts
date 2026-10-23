import assert from 'node:assert/strict';
import childProcess, { type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { probe } from './setup-cleanup-probe.ts';

const databasePath = new URL('../../registration/test/fixtures/relay-worker.ts', import.meta.url).href;
const replacement = new URL('./setup-cleanup-probe.ts', import.meta.url).href;
const hook = registerHooks({
  load(url, context, next) {
    if (url === databasePath) return {
      format: 'module', shortCircuit: true,
      source: `export { database as fixture } from ${JSON.stringify(replacement)};`,
    };
    return next(url, context);
  },
});
const { storeFixture } = await import('./store-fixture.ts');
hook.deregister();

for (const stage of ['authority', 'table', 'success']) {
  test(`store fixture releases its resources after ${stage}`, async t => {
    let directory: string | undefined;
    const children: ChildProcess[] = [];
    const spawn = childProcess.spawn;
    t.mock.method(childProcess, 'spawn', (...args: Parameters<typeof spawn>) => {
      directory = String(args[1]![1]);
      if (stage === 'authority') {
        throw probe.error;
      }
      const child = spawn(...args);
      children.push(child);
      return child;
    });
    syncBuiltinESMExports();
    probe.fail = stage;
    probe.pools.length = 0;
    try {
      if (stage === 'success') {
        const f = await storeFixture();
        assert.equal(probe.pools[0]!.ended, false);
        assert.equal(children[0]!.exitCode, null);
        await f.close();
      } else await assert.rejects(storeFixture(), error => error === probe.error);
      assert.equal(probe.pools.length, 1);
      assert.equal(probe.pools[0]!.ended, true, 'database pool remains open');
      assert.equal(children.length, stage === 'authority' ? 0 : 1);
      for (const child of children)
        assert.notEqual(child.exitCode ?? child.signalCode, null, 'authority child remains running');
    } finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
      }
      for (const pool of probe.pools) if (!pool.ended) await pool.end();
      if (directory) await rm(directory, { recursive: true, force: true });
      t.mock.restoreAll(); syncBuiltinESMExports();
    }
  });
}
