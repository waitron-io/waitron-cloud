import assert from 'node:assert/strict';
import {test} from 'node:test';

const load = () => import('./test-fixtures/integration-resource-observations.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-resource-observations.mjs')) return {};
  throw error;
});
const id = 'a'.repeat(64), startedAt = '2026-10-31T10:00:00.000000000Z';
const container = () => ({name: 'waitron-app-1', id, state: 'running', health: 'healthy', startedAt});
const host = () => ({availableMiB: 5000, freeGiB: 24});
const capacity = () => ({...host(), cloudMiB: 200, verifierMiB: 0, verifierCount: 0,
  scratchMiB: 0, fixtureBytes: 500, oom: false, protectedUnchanged: true, verifierIds: []});

// These controls catch invented health, substituted IDs and private Docker metadata escaping a report.
test('protected observations inspect only the named IDs and emit measured public state', async () => {
  const {readProtectedContainerStates} = await load();
  assert.equal(typeof readProtectedContainerStates, 'function', 'Protected state reader is missing');
  const value = await readProtectedContainerStates({ids: [id], docker: async args => {
    assert.deepEqual(args, ['inspect', id]);
    return JSON.stringify([{Id: id, Name: '/waitron-app-1', State: {Status: 'running', Running: true,
      Health: {Status: 'healthy'}, StartedAt: startedAt}, Config: {Env: ['PRIVATE=never-emit']}}]);
  }});
  assert.deepEqual(value, [container()]);
});

for (const [name, alter] of [
  ['substituted ID', row => {row.Id = 'b'.repeat(64);}],
  ['missing health', row => {delete row.State.Health;}],
  ['stopped process', row => {row.State.Running = false;}],
  ['unhealthy process', row => {row.State.Health.Status = 'unhealthy';}],
  ['missing start time', row => {delete row.State.StartedAt;}],
  ['missing name', row => {row.Name = ''; }],
]) test('protected reader refuses ' + name, async () => {
  const {readProtectedContainerStates} = await load();
  assert.equal(typeof readProtectedContainerStates, 'function');
  const row = {Id: id, Name: '/waitron-app-1', State: {Status: 'running', Running: true,
    Health: {Status: 'healthy'}, StartedAt: startedAt}};
  alter(row);
  await assert.rejects(readProtectedContainerStates({ids: [id], docker: async () => JSON.stringify([row])}));
});

test('an empty protected set performs no inspection and duplicate IDs refuse', async () => {
  const {readProtectedContainerStates} = await load();
  assert.equal(typeof readProtectedContainerStates, 'function');
  const docker = async () => {throw Error('No inspection expected');};
  assert.deepEqual(await readProtectedContainerStates({ids: [], docker}), []);
  await assert.rejects(readProtectedContainerStates({ids: [id, id], docker}));
});

async function fixture() {
  const {createResourceObservationCollector} = await load();
  assert.equal(typeof createResourceObservationCollector, 'function', 'Resource observation collector is missing');
  let time = 0, state = container();
  const collector = createResourceObservationCollector({now: () => time,
    readHost: async () => {time += 2; return host();},
    readProtected: async () => {time += 3; return [state];}});
  return {collector, advance: ms => {time += ms;}, set: value => {state = value;}};
}

// Omitting the boundary reads, clock binding or restart comparison must fail these cases.
test('baseline, real read intervals and cleanup share one origin and retain real gaps', async () => {
  const {collector, advance} = await fixture();
  await collector.start();
  advance(10000);
  assert.deepEqual(await collector.observe('startup', async () => {advance(7); return capacity();}), capacity());
  const raw = collector.snapshot();
  assert.deepEqual(raw.samples.map(({startedMs, finishedMs, phase}) => ({startedMs, finishedMs, phase})),
    [{startedMs: 10005, finishedMs: 10015, phase: 'startup'}]);
  advance(20);
  const result = await collector.finish();
  const {startedAt: ignored, ...publicState} = container();
  assert.deepEqual(result, {clock: 'shared-monotonic',
    baseline: {startedMs: 0, finishedMs: 5, reading: {...host(), quarantined: [publicState]}},
    samples: [{startedMs: 10005, finishedMs: 10015, phase: 'startup', reading: {...capacity(), quarantined: [publicState]}}],
    after: {startedMs: 10035, finishedMs: 10040, reading: {...host(), quarantined: [publicState]}}});
  assert.deepEqual(raw.samples[0].reading, capacity());
});

for (const [name, patch] of [
  ['restart', {startedAt: '2026-11-02T05:00:00Z'}],
  ['replacement', {id: 'b'.repeat(64)}],
  ['health loss', {health: 'unhealthy'}],
  ['rename', {name: 'foreign-app-1'}],
]) test('every resource read refuses protected ' + name + ' and cannot finish afterwards', async () => {
  const {collector, set} = await fixture();
  await collector.start();
  set({...container(), ...patch});
  await assert.rejects(collector.observe('integration', async () => capacity()));
  await assert.rejects(collector.finish());
});

test('after-cleanup state is actually read and a late restart refuses', async () => {
  const {collector, set} = await fixture();
  await collector.start();
  await collector.observe('integration', async () => capacity());
  set({...container(), startedAt: '2026-11-02T05:00:00Z'});
  await assert.rejects(collector.finish());
});

test('unfinished observations cannot be sealed or hidden by after-cleanup reads', async () => {
  const {collector} = await fixture();
  await collector.start();
  let release;
  const pending = collector.observe('integration', () => new Promise(resolve => {release = () => resolve(capacity());}));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(collector.finish(), /chronology_pending/);
  release(); await pending;
  await assert.rejects(collector.finish());
});

test('observations require the baseline and cannot restart or extend a sealed collector', async () => {
  const {collector} = await fixture();
  await assert.rejects(collector.observe('startup', async () => capacity()));
  await assert.rejects(collector.finish());
  await collector.start();
  await assert.rejects(collector.start());
  await collector.observe('startup', async () => capacity());
  await collector.finish();
  await assert.rejects(collector.observe('integration', async () => capacity()));
  await assert.rejects(collector.finish());
});

test('captured protected states and returned reports cannot be edited through callers', async () => {
  const {collector, set} = await fixture();
  const state = container(); set(state);
  await collector.start();
  state.startedAt = '2026-11-02T05:00:00Z';
  await assert.rejects(collector.observe('integration', async () => capacity()));
});

test('backwards boundary time and non-finite host readings refuse', async () => {
  const {createResourceObservationCollector} = await load();
  assert.equal(typeof createResourceObservationCollector, 'function');
  let time = 10;
  const backwards = createResourceObservationCollector({now: () => time,
    readHost: async () => {time = 9; return host();}, readProtected: async () => [container()]});
  await assert.rejects(backwards.start());
  const invalid = createResourceObservationCollector({readHost: async () => ({...host(), freeGiB: NaN}), readProtected: async () => [container()]});
  await assert.rejects(invalid.start());
});

test('a resource reading cannot precede the completed baseline', async () => {
  const {collector, advance} = await fixture();
  await collector.start();
  advance(-1);
  await assert.rejects(collector.observe('startup', async () => capacity()));
});
