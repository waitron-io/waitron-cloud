import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerFailureTrace } from './worker-diagnostic.mjs';

// Refusing a known boundary at the worker would erase the whole admitted failure trace.
for (const stage of ['quiesce-idle', 'quiesce-stop', 'quiesce-stop-result', 'quiesce-health', 'quiesce-checkpoint'])
  test('quiesceBoundarySurvivesWorkerAdmission_' + stage, () => {
    const trace = [{ kind: 'stream', stage }, { kind: 'stream-refusal', stage }];
    assert.deepEqual(workerFailureTrace(trace), trace);
  });
