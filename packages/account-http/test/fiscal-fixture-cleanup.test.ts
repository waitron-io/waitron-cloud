import assert from 'node:assert/strict';
import childProcess, { type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { Server } from 'node:http';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { probe } from '../../fiscal-allocation/test/setup-cleanup-probe.ts';

const databasePath = new URL('../../registration/test/fixtures/relay-worker.ts', import.meta.url).href;
const replacement = new URL('../../fiscal-allocation/test/setup-cleanup-probe.ts', import.meta.url).href;
const hook = registerHooks({
  load(url, context, next) {
    if (url === databasePath) return {
      format: 'module', shortCircuit: true,
      source: `export { database as fixture } from ${JSON.stringify(replacement)};`,
    };
    return next(url, context);
  },
});
const { fiscalHttpFixture } = await import('./fiscal-http-fixture.ts');
hook.deregister();

for (const stage of ['venue', 'listen', 'machine', 'success']) {
  test(`fiscal HTTP fixture releases its resources after ${stage}`, async t => {
    const children: ChildProcess[] = [], servers: Server[] = [], directories: string[] = [];
    const spawn = childProcess.spawn, listen = Server.prototype.listen;
    t.mock.method(childProcess, 'spawn', (...args: Parameters<typeof spawn>) => {
      directories.push(String(args[1]![1]));
      const child = spawn(...args); children.push(child); return child;
    });
    t.mock.method(Server.prototype, 'listen', function(this: Server, ...args: Parameters<typeof listen>) {
      if (stage === 'listen') throw probe.error;
      servers.push(this);
      return listen.apply(this, args);
    });
    syncBuiltinESMExports();
    probe.fail = stage;
    probe.pools.length = 0;
    try {
      if (stage === 'success') {
        const f = await fiscalHttpFixture();
        assert.equal(servers.length, 1);
        assert.equal(servers[0]!.listening, true);
        assert.equal((await f.request('', undefined, { method: 'GET', path: '/api/health/live', noOrigin: true })).status, 200);
        await f.server();
        assert.equal(servers.length, 2);
        await f.close();
      } else {
        await assert.rejects(fiscalHttpFixture(), error => error === probe.error);
      }
      assert.equal(children.length, 1);
      assert.equal(probe.pools.length, 1);
      assert.deepEqual({
        pools: probe.pools.map(pool => pool.ended),
        children: children.map(child => child.exitCode !== null || child.signalCode !== null),
        listeners: servers.map(server => server.listening),
      }, { pools: [true], children: [true], listeners: stage === 'success' ? [false, false] : stage === 'machine' ? [false] : [] });
    } finally {
      for (const server of servers) if (server.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
      for (const child of children) if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
      }
      for (const pool of probe.pools) if (!pool.ended) await pool.end();
      for (const directory of directories) await rm(directory, { recursive: true, force: true });
      t.mock.restoreAll(); syncBuiltinESMExports();
    }
  });
}
