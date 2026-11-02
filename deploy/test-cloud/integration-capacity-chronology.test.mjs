import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as capacity from './test-fixtures/integration-capacity.mjs';

const reading = () => ({availableMiB: 4096, freeGiB: 20, cloudMiB: 100,
  verifierMiB: 0, verifierCount: 0, scratchMiB: 0, fixtureBytes: 1024,
  oom: false, protectedUnchanged: true, verifierIds: []});
const create = options => {
  assert.equal(typeof capacity.createCapacityChronology, 'function', 'The shared observation clock is missing');
  return capacity.createCapacityChronology(options);
};

// Resetting the clock for each sampler makes separately valid windows look contiguous.
test('one chronology retains real read intervals across all four sampler phases', async () => {
  let time = 1000;
  const clock = create({now: () => time});
  for (const [phase, start, end] of [['startup', 1000, 1100], ['integration', 5000, 5100],
    ['settled', 8000, 8200], ['verification', 70000, 70300]]) {
    time = start;
    const row = reading();
    assert.deepEqual(await clock.observe(phase, async () => {time = end; return row;}), row);
  }
  assert.deepEqual(clock.snapshot(), {clock: 'shared-monotonic', samples: [
    {startedMs: 0, finishedMs: 100, phase: 'startup', reading: reading()},
    {startedMs: 4000, finishedMs: 4100, phase: 'integration', reading: reading()},
    {startedMs: 7000, finishedMs: 7200, phase: 'settled', reading: reading()},
    {startedMs: 69000, finishedMs: 69300, phase: 'verification', reading: reading()},
  ]});
});

test('concurrent samplers wait for the owned reading and timestamp when their read actually starts', async () => {
  let time = 0, release, secondStarted = false;
  const clock = create({now: () => time});
  const first = clock.observe('integration', async () => {
    await new Promise(resolve => {release = resolve;}); time = 30; return reading();
  });
  const second = clock.observe('verification', async () => {secondStarted = true; time = 40; return reading();});
  await new Promise(setImmediate);
  assert.equal(secondStarted, false);
  assert.throws(() => clock.snapshot(), /integration.chronology_pending/);
  release(); await Promise.all([first, second]);
  assert.deepEqual(clock.snapshot().samples.map(v => [v.startedMs, v.finishedMs]), [[0, 30], [30, 40]]);
});

test('a failed reading poisons the chronology and drains queued observers without starting them', async () => {
  const clock = create({now: () => 0});
  const refusal = Error('measurement refused');
  const first = clock.observe('startup', async () => {throw refusal;});
  const second = clock.observe('integration', async () => assert.fail('No observation after refusal'));
  const results = await Promise.allSettled([first, second]);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason === refusal));
  assert.throws(() => clock.snapshot(), error => error === refusal);
  await assert.rejects(clock.observe('verification', async () => assert.fail('Refusal stays terminal')), error => error === refusal);
});

test('captured readings and exported snapshots cannot be rewritten by later callers', async () => {
  let time = 0;
  const clock = create({now: () => time});
  const row = reading();
  await clock.observe('startup', async () => {time = 1; return row;});
  row.verifierIds.push('a'.repeat(64)); row.cloudMiB = 999;
  const exported = clock.snapshot();
  exported.samples[0].reading.verifierIds.push('b'.repeat(64)); exported.samples[0].startedMs = 99;
  assert.deepEqual(clock.snapshot(), {clock: 'shared-monotonic', samples: [
    {startedMs: 0, finishedMs: 1, phase: 'startup', reading: reading()},
  ]});
});

for (const [name, change] of Object.entries({
  'nonfinite disk': {freeGiB: NaN}, 'negative disk': {freeGiB: -1},
  'cloud budget': {cloudMiB: 2049}, 'OOM': {oom: true}, 'protected state': {protectedUnchanged: false},
  'private extension': {token: 'private-fixture'}, 'unmeasured verifier': {verifierCount: 1, verifierMiB: 10},
  'foreign verifier id': {verifierCount: 1, verifierMiB: 10, verifierIds: ['foreign']},
})) test('shared chronology refuses ' + name, async () => {
  let time = 0;
  const clock = create({now: () => time});
  await assert.rejects(clock.observe('startup', async () => {time = 1; return {...reading(), ...change};}));
  assert.throws(() => clock.snapshot());
});

test('shared chronology refuses unknown phases and clock reversal instead of repairing observations', async () => {
  for (const value of [NaN, Infinity]) assert.throws(() => create({now: () => value}), /integration.chronology_clock/);
  let time = 0;
  const unknown = create({now: () => time});
  await assert.rejects(unknown.observe('invented', async () => reading()), /integration.chronology_phase/);
  for (const value of [-1, NaN, Infinity]) {
    time = 0;
    const clock = create({now: () => time});
    await assert.rejects(clock.observe('startup', async () => {time = value; return reading();}), /integration.chronology_clock/);
  }
  time = 0;
  const clock = create({now: () => time});
  await clock.observe('startup', async () => {time = 10; return reading();});
  time = 5;
  await assert.rejects(clock.observe('integration', async () => {time = 11; return reading();}), /integration.chronology_clock/);
});

test('real monotonic time measures an awaited read without borrowing a sampler clock', async () => {
  const clock = create();
  await clock.observe('startup', async () => {await new Promise(resolve => setTimeout(resolve, 20)); return reading();});
  const {startedMs, finishedMs} = clock.snapshot().samples[0];
  assert.ok(startedMs >= 0 && finishedMs - startedMs >= 10);
});

test('startup and settled verification samplers retain their own clocks alongside the shared clock', {timeout: 2000}, async () => {
  let time = 1000, done, verifying = false;
  const clock = create({now: () => time});
  const observe = phase => clock.observe(phase, async () => {
    time += 10;
    return {...reading(), ...(verifying ? {verifierCount: 1, verifierMiB: 10, verifierIds: ['a'.repeat(64)]} : {})};
  });
  const startup = await capacity.measureStartupCapacity({now: () => time,
    wait: async ms => {await new Promise(setImmediate); time += ms; done(); await new Promise(setImmediate);}, observe: () => observe('startup'),
    start: () => new Promise(resolve => {done = resolve;}), stop: async () => assert.fail('Healthy startup')});
  const windowBegan = time;
  const window = await capacity.measureCapacityWindow({now: () => time,
    wait: async ms => {time += ms; if (verifying) done(); await new Promise(setImmediate);},
    observe, verify: () => {verifying = true; return new Promise(resolve => {done = resolve;});},
    stop: async () => assert.fail('Healthy verification')});
  const history = clock.snapshot().samples;
  assert.equal(startup.samples[0].elapsedMs, 0);
  assert.equal(window.samples[0].elapsedMs, 0);
  assert.equal(history[0].startedMs, 0);
  assert.equal(history.find(value => value.phase === 'settled').startedMs, windowBegan - 1000);
  assert.ok(history.find(value => value.phase === 'verification').startedMs > 60000);
  assert.equal(history.length, startup.samples.length + window.samples.length);
  for (const [i, value] of [...startup.samples, ...window.samples].entries()) {
    const {phase, elapsedMs, ...observed} = value;
    assert.equal(history[i].phase, phase); assert.deepEqual(history[i].reading, observed);
  }
});
