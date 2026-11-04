import assert from 'node:assert/strict';
import {test} from 'node:test';
import {measureStartupCapacity} from './test-fixtures/integration-capacity.mjs';
import {createResourceObservationCollector} from './test-fixtures/integration-resource-observations.mjs';

const sample = () => ({availableMiB: 5000, freeGiB: 24, cloudMiB: 0, verifierMiB: 0,
  verifierCount: 0, scratchMiB: 0, fixtureBytes: 0, oom: false, protectedUnchanged: true, verifierIds: []});
const turn = () => new Promise(resolve => setImmediate(resolve));

// Skipping preparation, moving it before sampling or allocating after refusal breaks these controls.
test('source preparation and readiness have measured intervals on the baseline clock', async () => {
  let time = 0, phase = 'before', prepared = false, finishPreparation, finishStartup;
  const collector = createResourceObservationCollector({now: () => time,
    readHost: async () => ({availableMiB: 5000, freeGiB: 24}), readProtected: async () => []});
  await collector.start();
  const seen = [];
  const result = await measureStartupCapacity({now: () => time,
    wait: async ms => {
      time += ms;
      if (phase === 'preparation' && time >= 6000) finishPreparation();
      if (phase === 'startup' && time >= 9000) finishStartup('ready');
      await turn();
    },
    observe: () => collector.observe('startup', async () => {seen.push(phase); return sample();}),
    prepare: async () => {phase = 'preparation'; await new Promise(resolve => {finishPreparation = resolve;}); prepared = true;},
    start: async () => {assert.equal(prepared, true, 'Preparation must complete before startup'); phase = 'startup'; return new Promise(resolve => {finishStartup = resolve;});},
    stop: async () => assert.fail('Healthy preparation must not stop'),
  });
  assert.equal(result.value, 'ready');
  assert.equal(seen[0], 'before');
  assert.ok(seen.filter(value => value === 'preparation').length >= 5);
  assert.ok(seen.filter(value => value === 'startup').length >= 3);
  const observations = await collector.finish();
  let previous = observations.baseline.finishedMs;
  for (const reading of observations.samples) {
    assert.ok(reading.startedMs >= previous);
    assert.ok(reading.finishedMs - previous <= 5000, 'Preparation must not leave a five-second gap');
    previous = reading.finishedMs;
  }
  assert.equal(observations.samples.length, result.samples.length);
});

test('a preparation error is preserved and never allocates the Cloud project', async () => {
  let time = 0, started = false;
  await assert.rejects(measureStartupCapacity({now: () => time, wait: async ms => {time += ms; await turn();},
    observe: async () => sample(), prepare: async () => {throw Error('source comparison refused');},
    start: async () => {started = true;}, stop: async () => assert.fail('Preparation already settled'),
  }), /source comparison refused/);
  assert.equal(started, false);
});

test('an initial observation failure performs neither preparation nor startup', async () => {
  await assert.rejects(measureStartupCapacity({observe: async () => {throw Error('initial observation refused');},
    prepare: async () => assert.fail('No preparation after refusal'), start: async () => assert.fail('No startup after refusal'),
    stop: async () => assert.fail('Nothing started'),
  }), /initial observation refused/);
});

test('sampling failure drains in-flight preparation and prevents later project allocation', async () => {
  let time = 0, preparing = false, stopped = false, drained = false, started = false, release;
  await assert.rejects(measureStartupCapacity({now: () => time, wait: async ms => {time += ms; await turn();},
    observe: async () => {if (preparing) throw Error('preparation measurement refused'); return sample();},
    prepare: async () => {preparing = true; await new Promise(resolve => {release = resolve;}); await turn(); drained = true;},
    start: async () => {started = true; assert.equal(preparing, true, 'Preparation must run');},
    stop: async () => {stopped = true; release();},
  }), /preparation measurement refused/);
  assert.equal(stopped, true); assert.equal(drained, true); assert.equal(started, false);
});
