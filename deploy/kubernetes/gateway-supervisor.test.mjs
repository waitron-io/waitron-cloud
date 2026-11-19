import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

test('a renewal arriving after the local deadline cannot extend gateway authority', async () => {
  const {runGatewayElection} = await import('./gateway-supervisor.mjs');
  let tick = 0, version = 1;
  let current = {metadata: {resourceVersion: '1'}};
  const deadlines = [];
  await runGatewayElection({
    holder: 'first',
    now: () => tick,
    wait: async ms => {tick += ms;},
    lease: {
      get: async () => version === 3 ? {...current, spec: {holderIdentity: 'standby'}} : current,
      replace: async value => {
        assert.equal(value.metadata.resourceVersion, String(version));
        current = {...value, metadata: {resourceVersion: String(++version)}};
        if (version === 3) tick = 5001;
        return current;
      },
    },
    grant: deadline => deadlines.push(deadline),
  });
  assert.deepEqual(deadlines, [5000]);
});

test('the watchdog withdraws the gateway process group and interface without a renewal', {timeout: 10000}, async t => {
  const state = await mkdtemp(join(tmpdir(), 'gateway-watchdog-'));
  const watchdog = spawn(process.execPath, ['--input-type=module', '-e', `
    import {spawn} from 'node:child_process';
    import {writeFileSync, rmSync} from 'node:fs';
    import {join} from 'node:path';
    import {watchGateway} from ${JSON.stringify(new URL('./gateway-supervisor.mjs', import.meta.url))};
    const iface = join(process.argv[1], 'interface');
    await watchGateway({
      launch() {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {detached: true});
        writeFileSync(iface, String(child.pid));
        process.send(child.pid);
        return child;
      },
      withdraw() {rmSync(iface);}
    });
  `, state], {stdio: ['ignore', 'ignore', 'inherit', 'ipc']});
  const closed = once(watchdog, 'exit');
  let pid;
  t.after(async () => {
    if (pid) {try {process.kill(-pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}}
    if (watchdog.exitCode === null && watchdog.signalCode === null) watchdog.kill('SIGKILL');
    await closed;
    await rm(state, {recursive: true, force: true});
  });
  const launched = once(watchdog, 'message');
  watchdog.once('spawn', () => watchdog.send(Number(process.hrtime.bigint() / 1000000n) + 1500));
  [pid] = await Promise.race([launched, closed.then(() => assert.fail('watchdog exited before opening the gateway'))]);
  assert.equal(await readFile(join(state, 'interface'), 'utf8'), String(pid));
  assert.deepEqual(await closed, [0, null]);
  await assert.rejects(readFile(join(state, 'interface')), {code: 'ENOENT'});
  assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'});
});
