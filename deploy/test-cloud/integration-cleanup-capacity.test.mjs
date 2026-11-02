import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as capacity from './test-fixtures/integration-capacity.mjs';
import {createResourceObservationCollector} from './test-fixtures/integration-resource-observations.mjs';

const reading = () => ({availableMiB: 5000, freeGiB: 24, cloudMiB: 100, verifierMiB: 0,
  verifierCount: 0, scratchMiB: 0, fixtureBytes: 1024, oom: false, protectedUnchanged: true, verifierIds: []});

// Omitting command checkpoints leaves the real cleanup interval unmeasured.
test('cleanup records changing resources between commands on the existing observation clock', async () => {
  assert.equal(typeof capacity.measureCleanupCapacity, 'function', 'Cleanup sampling is missing');
  let time = 0, remaining = 8;
  const collector = createResourceObservationCollector({now: () => time,
    readHost: async () => ({availableMiB: 5000, freeGiB: 24}), readProtected: async () => []});
  await collector.start();
  const result = await capacity.measureCleanupCapacity({now: () => time, wait: async ms => {time += ms;},
    observe: () => collector.observe('integration', async () => ({...reading(), cloudMiB: remaining * 10})),
    run: async checkpoint => {
      for (; remaining > 0;) {time += 1000; remaining--; await checkpoint();}
      return 'removed';
    },
  });
  assert.equal(result.value, 'removed');
  assert.deepEqual(result.samples.map(value => value.cloudMiB), [80, 70, 60, 50, 40, 30, 20, 10, 0, 0]);
  const observations = await collector.finish();
  assert.equal(observations.samples.length, 10);
  assert.equal(observations.samples[0].startedMs, 0);
  assert.ok(observations.after.startedMs >= 8000);
  let previous = observations.baseline.finishedMs;
  for (const sample of observations.samples) {
    assert.ok(sample.finishedMs - previous <= 5000, 'Cleanup cannot hide a five-second gap');
    previous = sample.finishedMs;
  }
});

// The observer uses the same Docker command boundary; it must neither recurse nor overlap removal.
test('resource reads do not recursively measure their own Docker commands', async () => {
  assert.equal(typeof capacity.measureCleanupCapacity, 'function');
  let time = 0, checkpoint, reads = 0, removing = false;
  const result = await capacity.measureCleanupCapacity({now: () => time, wait: async ms => {time += ms;},
    observe: async () => {
      assert.equal(removing, false);
      reads++;
      if (checkpoint) await checkpoint();
      return reading();
    },
    run: async check => {
      checkpoint = check;
      for (let i = 0; i < 3; i++) {removing = true; time += 1500; removing = false; await check();}
    },
  });
  assert.equal(reads, 5);
  assert.equal(result.samples.length, 5);
});

for (const fault of ['initial', 'during', 'budget', 'gap']) test('cleanup finishes every command after ' + fault + ' observation refusal', async () => {
  assert.equal(typeof capacity.measureCleanupCapacity, 'function');
  let time = 0, reads = 0;
  const removed = [];
  await assert.rejects(capacity.measureCleanupCapacity({now: () => time, wait: async ms => {time += ms;},
    observe: async () => {
      reads++;
      if (fault === 'initial' || fault === 'during' && removed.length > 0) throw Error('cleanup measurement refused');
      return {...reading(), cloudMiB: fault === 'budget' && removed.length > 0 ? 2049 : 100};
    },
    run: async checkpoint => {
      for (let i = 0; i < 4; i++) {time += fault === 'gap' ? 6000 : 1000; removed.push(i); await checkpoint();}
    },
  }), fault === 'gap' ? /integration.capacity_sample_gap/ : fault === 'budget' ? /integration.capacity_cloudMiB/ : /cleanup measurement refused/);
  assert.deepEqual(removed, [0, 1, 2, 3]);
  assert.equal(reads, fault === 'initial' ? 1 : 2, 'A refused observer stays terminal while cleanup drains');
});

test('cleanup errors stay authoritative when resource observation also refuses', async () => {
  assert.equal(typeof capacity.measureCleanupCapacity, 'function');
  let ran = false;
  await assert.rejects(capacity.measureCleanupCapacity({observe: async () => {throw Error('measurement refused');},
    run: async () => {ran = true; throw Error('owned cleanup refused');},
  }), /owned cleanup refused/);
  assert.equal(ran, true);
});

// Removing containers must not make retained, still-owned volume data disappear from the measurement.
test('cleanup measures detached project volumes until their actual removal', async () => {
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'cloud-cleanup-capacity-'));
  try {
    const meminfo = join(root, 'meminfo');
    await writeFile(meminfo, 'MemAvailable: 5120000 kB\n');
    let present = true;
    const options = {project: 'owned-project', runId: 'owned-run', startup: true, cleanup: true, meminfo, diskPath: root,
      protectedUnchanged: async () => true,
      docker: async args => {
        if (args[0] === 'ps') return '';
        if (args[0] === 'volume' && args[1] === 'ls') {assert.deepEqual(args.slice(2), ['-q', '--filter', 'label=com.docker.compose.project=owned-project']); return present ? 'owned-data' : '';}
        if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify([{Name: 'owned-data', Labels: {'com.docker.compose.project': 'owned-project'}}]);
        assert.fail('Unexpected capacity command: ' + JSON.stringify(args));
      },
      measureVolumes: async names => {assert.deepEqual(names, ['owned-data']); return [{name: 'owned-data', bytes: 16384}];},
    };
    assert.equal((await capacity.observeCapacity(options)).fixtureBytes, 16384);
    present = false;
    assert.equal((await capacity.observeCapacity(options)).fixtureBytes, 0);
    present = true;
    await assert.rejects(capacity.observeCapacity({...options, measureVolumes: undefined}));
    await assert.rejects(capacity.observeCapacity({...options, docker: async args => args[0] === 'volume' && args[1] === 'inspect'
      ? JSON.stringify([{Name: 'owned-data', Labels: {'com.docker.compose.project': 'foreign-project'}}]) : options.docker(args)}));
  } finally {await rm(root, {recursive: true, force: true});}
});
