import assert from 'node:assert/strict';
import {test} from 'node:test';

const load = () => import('./test-fixtures/integration-capacity.mjs');
const sample = () => ({availableMiB: 4096, freeGiB: 20, cloudMiB: 100,
  verifierMiB: 0, verifierCount: 0, scratchMiB: 0, fixtureBytes: 1024,
  oom: false, protectedUnchanged: true});

// Missing the pre-allocation observation or dropping a late failure must refuse startup.
test('startup capacity is observed before allocation, while starting and after readiness', async () => {
  const {measureStartupCapacity} = await load();
  assert.equal(typeof measureStartupCapacity, 'function', 'Startup sampling is missing');
  let time = 0, allocated = false, ready = false, finish;
  const observations = [];
  const result = await measureStartupCapacity({
    now: () => time,
    wait: async ms => {time += ms; if (time >= 3000) {ready = true; finish('ready');} await Promise.resolve();},
    observe: async () => {observations.push({allocated, ready}); return {...sample(), cloudMiB: allocated ? 100 : 0};},
    start: async () => {assert.equal(observations.length, 1); allocated = true; return new Promise(resolve => {finish = resolve;});},
    stop: async () => assert.fail('Healthy startup must not be stopped'),
  });
  assert.equal(result.value, 'ready');
  assert.deepEqual(observations, [{allocated: false, ready: false}, {allocated: true, ready: false},
    {allocated: true, ready: false}, {allocated: true, ready: true}]);
  assert.deepEqual(result.samples.map(v => [v.elapsedMs, v.phase, v.cloudMiB]),
    [[0, 'startup', 0], [1000, 'startup', 100], [2000, 'startup', 100], [3000, 'startup', 100]]);
});

test('startup measurement failure stops and drains the owned operation', async () => {
  const {measureStartupCapacity} = await load();
  assert.equal(typeof measureStartupCapacity, 'function', 'Startup sampling is missing');
  for (const fault of ['observation', 'budget', 'gap', 'reversed-clock']) {
    let time = 0, allocated = false, stopped = false, drained = false, finish;
    await assert.rejects(measureStartupCapacity({
      now: () => time,
      wait: async ms => {time += fault === 'gap' ? 5001 : fault === 'reversed-clock' ? -1 : ms;},
      observe: async () => {
        if (allocated && fault === 'observation') throw Error('observation refused');
        return {...sample(), cloudMiB: allocated && fault === 'budget' ? 2049 : 100};
      },
      start: async () => {allocated = true; await new Promise(resolve => {finish = resolve;}); drained = true;},
      stop: async () => {stopped = true; finish();},
    }));
    assert.equal(stopped, true, fault); assert.equal(drained, true, fault);
  }
});

test('startup refuses an initial measurement without allocating and preserves startup errors', async () => {
  const {measureStartupCapacity} = await load();
  assert.equal(typeof measureStartupCapacity, 'function', 'Startup sampling is missing');
  let time = 0, stopped = false;
  await assert.rejects(measureStartupCapacity({observe: async () => {throw Error('baseline refused');},
    start: async () => assert.fail('No allocation after a refused baseline'), stop: async () => {stopped = true;}}), /baseline refused/);
  assert.equal(stopped, false);
  await assert.rejects(measureStartupCapacity({now: () => time, wait: async ms => {time += ms;},
    observe: async () => sample(), start: async () => {throw Error('compose refused');},
    stop: async () => {stopped = true;}}), /compose refused/);
});

test('only a startup observation permits an empty project before allocation', async () => {
  const {observeCapacity} = await load();
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'cloud-startup-capacity-'));
  try {
    await writeFile(join(root, 'meminfo'), 'MemAvailable: 4194304 kB\n');
    const options = {docker: async args => {assert.equal(args[0], 'ps'); return '';},
      project: 'owned-project', runId: 'owned-run', protectedUnchanged: async () => true,
      diskPath: root, meminfo: join(root, 'meminfo')};
    await assert.rejects(observeCapacity(options));
    const observed = await observeCapacity({...options, startup: true});
    assert.equal(observed.cloudMiB, 0); assert.equal(observed.verifierMiB, 0);
    assert.equal(observed.fixtureBytes, 0); assert.equal(observed.availableMiB, 4096);
    assert.ok(observed.freeGiB > 0); assert.equal(observed.protectedUnchanged, true);
  } finally {await rm(root, {recursive: true, force: true});}
});
