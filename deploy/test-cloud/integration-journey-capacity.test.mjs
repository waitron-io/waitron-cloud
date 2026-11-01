import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as capacity from './test-fixtures/integration-capacity.mjs';

const row = () => ({availableMiB: 4096, freeGiB: 20, cloudMiB: 100,
  verifierMiB: 0, verifierCount: 0, scratchMiB: 0, fixtureBytes: 1024,
  oom: false, protectedUnchanged: true});

// Dropping the first, intermediate or final reading hides resource use during recovery/rollback.
test('integration sampling spans the operation and observes resources after it finishes', async () => {
  assert.equal(typeof capacity.measureIntegrationCapacity, 'function', 'Integration sampling is missing');
  let time = 0, running = false, finished = false, complete;
  const observations = [];
  const result = await capacity.measureIntegrationCapacity({now: () => time,
    wait: async ms => {time += ms; if (time >= 3000) complete(); await new Promise(resolve => setImmediate(resolve));},
    observe: async () => {observations.push({running, finished}); return {...row(), cloudMiB: finished ? 200 : 100};},
    run: async () => {running = true; await new Promise(resolve => {complete = resolve;}); finished = true; return 'rollback-ready';},
    stop: async () => assert.fail('Healthy integration must not be stopped'),
  });
  assert.equal(result.value, 'rollback-ready');
  assert.deepEqual(observations, [{running: false, finished: false}, {running: true, finished: false},
    {running: true, finished: false}, {running: true, finished: true}, {running: true, finished: true}]);
  assert.deepEqual(result.samples.map(value => [value.elapsedMs, value.phase, value.cloudMiB]),
    [[0, 'integration', 100], [1000, 'integration', 100], [2000, 'integration', 100],
      [3000, 'integration', 200], [3001, 'integration', 200]]);
});

test('integration refuses resource and observation failures then stops and drains its own work', async () => {
  assert.equal(typeof capacity.measureIntegrationCapacity, 'function', 'Integration sampling is missing');
  for (const fault of ['observation', 'budget', 'gap', 'clock', 'oom', 'protected']) {
    let time = 0, turns = 0, running = false, stopped = false, drained = false, finish;
    await assert.rejects(capacity.measureIntegrationCapacity({now: () => time,
      wait: async ms => {time += fault === 'gap' ? 5001 : fault === 'clock' ? -1 : ms;
        if (++turns >= 6) finish(); await new Promise(resolve => setImmediate(resolve));},
      observe: async () => {
        if (running && fault === 'observation') throw Error('observation refused');
        return {...row(), ...(running ? {cloudMiB: fault === 'budget' ? 2049 : 100,
          oom: fault === 'oom', protectedUnchanged: fault !== 'protected'} : {})};
      },
      run: async () => {running = true; await new Promise(resolve => {finish = resolve;});
        await new Promise(resolve => setImmediate(resolve)); drained = true;},
      stop: async () => {stopped = true; finish();},
    }));
    assert.equal(stopped, true, fault); assert.equal(drained, true, fault);
  }
});

test('integration preserves operation failures and refuses a failed initial observation before starting', async () => {
  assert.equal(typeof capacity.measureIntegrationCapacity, 'function', 'Integration sampling is missing');
  await assert.rejects(capacity.measureIntegrationCapacity({observe: async () => {throw Error('baseline refused');},
    run: async () => assert.fail('No work after a refused baseline'), stop: async () => assert.fail('No work to stop')}), /baseline refused/);
  let time = 0;
  await assert.rejects(capacity.measureIntegrationCapacity({now: () => time, wait: async ms => {time += ms;},
    observe: async () => row(), run: async () => {throw Error('recovery refused');},
    stop: async () => assert.fail('Operation already finished')}), /recovery refused/);
});

test('integration takes a fresh final reading when the operation finishes during an observation', async () => {
  assert.equal(typeof capacity.measureIntegrationCapacity, 'function', 'Integration sampling is missing');
  let time = 0, calls = 0, finish, done = false;
  const result = await capacity.measureIntegrationCapacity({now: () => time, wait: async ms => {time += ms;},
    run: () => new Promise(resolve => {finish = resolve;}), stop: async () => assert.fail('Healthy operation'),
    observe: async () => {
      const memory = done ? 200 : 100;
      if (++calls === 2) {done = true; finish(); await new Promise(resolve => setImmediate(resolve));}
      return {...row(), cloudMiB: memory};
    }});
  assert.equal(result.samples.at(-1).cloudMiB, 200);
});
