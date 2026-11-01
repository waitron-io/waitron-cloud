import assert from 'node:assert/strict';
import {test} from 'node:test';

const load = () => import('./test-fixtures/integration-verifier-drain.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-verifier-drain.mjs')) return {};
  throw error;
});

// Taking another job after selected admission recreates the observed second-child race.
test('the fixture stops acquiring work after selected admission and waits for shutdown', async () => {
  const {runUntilSelectedVerification} = await load();
  assert.equal(typeof runUntilSelectedVerification, 'function', 'Selected verification drain is not implemented');
  const stop = new AbortController(), events = [];
  let runs = 0, idleWaits = 0;
  await runUntilSelectedVerification({signal: stop.signal,
    runOnce: async () => {runs++; assert.ok(runs <= 2, 'No work after selected admission'); events.push('job-' + runs);},
    admitted: async () => runs === 2,
    wait: async milliseconds => {events.push('wait-' + milliseconds); if (runs === 2 && ++idleWaits === 3) stop.abort();}});
  assert.equal(runs, 2);
  assert.deepEqual(events, ['job-1', 'wait-250', 'job-2', 'wait-1000', 'wait-1000', 'wait-1000']);
});

test('shutdown during a job does not inspect admission or acquire another job', async () => {
  const {runUntilSelectedVerification} = await load();
  assert.equal(typeof runUntilSelectedVerification, 'function', 'Selected verification drain is not implemented');
  const stop = new AbortController(); let runs = 0;
  await runUntilSelectedVerification({signal: stop.signal,
    runOnce: async () => {runs++; stop.abort();},
    admitted: async () => assert.fail('No inspection after shutdown'),
    wait: async () => assert.fail('No wait after shutdown')});
  assert.equal(runs, 1);
});

test('admission is inspected only after the claimed job has drained', async () => {
  const {runUntilSelectedVerification} = await load();
  assert.equal(typeof runUntilSelectedVerification, 'function', 'Selected verification drain is not implemented');
  const stop = new AbortController(); let drained = false;
  await runUntilSelectedVerification({signal: stop.signal,
    runOnce: async () => {await new Promise(resolve => setImmediate(resolve)); drained = true;},
    admitted: async () => {assert.equal(drained, true); return true;},
    wait: async () => stop.abort()});
});

test('an already stopped fixture claims no work and worker failures remain failures', async () => {
  const {runUntilSelectedVerification} = await load();
  assert.equal(typeof runUntilSelectedVerification, 'function', 'Selected verification drain is not implemented');
  const stop = new AbortController(); stop.abort();
  await runUntilSelectedVerification({signal: stop.signal, runOnce: async () => assert.fail('No work after shutdown')});
  await assert.rejects(runUntilSelectedVerification({signal: new AbortController().signal,
    runOnce: async () => {throw Error('fixture.worker_failed');}}), {message: 'fixture.worker_failed'});
});
