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
        assert.match(value.spec.renewTime, /\.\d{6}Z$/);
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

test('an aborted API request permits renewal before the current deadline', async () => {
  const {runGatewayElection} = await import('./gateway-supervisor.mjs');
  const stop = new AbortController();
  let tick = 0, reads = 0, current = {metadata: {resourceVersion: '1'}, spec: {}};
  const deadlines = [];
  await runGatewayElection({holder: 'first', signal: stop.signal, now: () => tick,
    wait: async ms => {tick += ms;},
    lease: {
      get: async () => {
        if (++reads === 2) {
          tick += 500;
          throw Object.assign(Error('request aborted'), {name: 'AbortError', code: 'ABORT_ERR'});
        }
        return current;
      },
      replace: async value => {current = value; return current;},
    },
    grant(deadline) {
      deadlines.push(deadline);
      if (deadlines.length === 2) stop.abort();
    },
  });
  assert.deepEqual(deadlines, [5000, 9500]);
});

test('a standby waits a full lease after observing a renewal', async () => {
  const {runGatewayElection} = await import('./gateway-supervisor.mjs');
  const stop = new AbortController();
  let tick = 0, acquired;
  await runGatewayElection({holder: 'standby', signal: stop.signal, now: () => tick,
    wait: async ms => {tick += ms;},
    lease: {
      get: async () => ({metadata: {resourceVersion: tick < 8000 ? '1' : '2'}, spec: {holderIdentity: 'original'}}),
      replace: async value => {
        assert.equal(value.metadata.resourceVersion, '2');
        acquired = tick;
        return value;
      },
    },
    grant: () => stop.abort(),
  });
  assert.equal(acquired, 24000);
});

test('readiness failure withdraws the gateway and its election process', {timeout: 10000}, async t => {
  const {superviseGatewayElection} = await import('./gateway-supervisor.mjs');
  const election = spawn(process.execPath, ['-e', `
    process.send(Number(process.hrtime.bigint() / 1000000n) + 5000);
    setInterval(() => {}, 1000);
  `], {stdio: ['ignore', 'ignore', 'inherit', 'ipc']});
  let gateway, withdrawn = false;
  t.after(async () => {
    for (const child of [election, gateway].filter(Boolean)) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        if (child === gateway) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
        await exited;
      }
    }
  });
  await assert.rejects(superviseGatewayElection(election, {
    launch() {
      gateway = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {detached: true});
      return gateway;
    },
    ready() {throw Error('full state volume');},
    withdraw() {withdrawn = true;},
  }), /full state volume/);
  assert.equal(election.signalCode, 'SIGKILL');
  assert.equal(gateway.signalCode, 'SIGKILL');
  assert.equal(withdrawn, true);
});

test('an expired gateway stops the election even if it is still running', {timeout: 10000}, async t => {
  const {superviseGatewayElection} = await import('./gateway-supervisor.mjs');
  const election = spawn(process.execPath, ['-e', `
    process.send(Number(process.hrtime.bigint() / 1000000n) + 600);
    setInterval(() => {}, 1000);
  `], {stdio: ['ignore', 'ignore', 'inherit', 'ipc']});
  let gateway;
  t.after(async () => {
    if (election.exitCode === null && election.signalCode === null) {
      const exited = once(election, 'exit'); election.kill('SIGKILL'); await exited;
    }
    if (gateway && gateway.exitCode === null && gateway.signalCode === null) {
      const exited = once(gateway, 'exit'); process.kill(-gateway.pid, 'SIGKILL'); await exited;
    }
  });
  await superviseGatewayElection(election, {
    launch() {
      gateway = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {detached: true});
      return gateway;
    },
    withdraw() {},
  });
  assert.equal(election.signalCode, 'SIGKILL');
  assert.equal(gateway.signalCode, 'SIGKILL');
});
