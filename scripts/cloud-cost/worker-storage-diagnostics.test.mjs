import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { workerFailureTrace } from './worker-diagnostic.mjs';

// Omitting a refusal report hides the exact cleanup boundary behind the generic worker error.
for (const stage of ['bucket-inventory', 'bucket-present', 'multipart-list', 'object-list', 'delete-bucket',
  'accounting', 'proxy-close', 'finish-input', 'retained-inventory']) {
  test(`worker storage retains a bounded refusal for ${stage}`, () => {
    const result = spawnSync(process.execPath, [new URL('./fixtures/worker-storage-diagnostic-probe.mjs', import.meta.url).pathname, stage],
      { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.message, 'Invalid cloud cost worker storage');
    assert.ok(output.records.some(event => event.kind === 'storage-refusal' && event.stage === stage), 'retain the refused operation');
    assert.deepEqual(workerFailureTrace(output.records), output.records, 'the private-worker boundary must admit the diagnostic');
    assert.equal(output.collected, true, 'a diagnostic cannot prevent process collection');
    assert.equal((result.stdout + result.stderr).includes('PRIVATE'), false);
  });
}

for (const mode of ['success', 'reporter', 'two-failures']) test(`storage cleanup preserves its outcome with ${mode}`, () => {
  const result = spawnSync(process.execPath, [new URL('./fixtures/worker-storage-diagnostic-probe.mjs', import.meta.url).pathname, mode],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.message, mode === 'success' ? null : 'Invalid cloud cost worker storage');
  assert.equal(output.collected, true);
  assert.equal(output.rootRetained, mode !== 'success');
  assert.deepEqual(output.records, mode === 'two-failures' ? [{ kind: 'storage-refusal', stage: 'object-list' }] : []);
});

for (const event of [
  { kind: 'storage-refusal', stage: 'PRIVATE_STAGE' },
  { kind: 'storage-refusal', stage: 'object-list', message: 'PRIVATE_ERROR' },
  { kind: 'storage-refusal', get stage() { throw Error('PRIVATE_GETTER'); } },
]) test('worker boundary refuses unlisted storage diagnostic details', () => {
  assert.throws(() => workerFailureTrace([event]), { message: 'Invalid cloud cost worker diagnostic' });
});

test('the replay worker persists the storage refusal through its closed trace boundary', () => {
  const result = spawnSync(process.execPath, [new URL('./fixtures/replay-worker-storage-probe.mjs', import.meta.url).pathname],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.failure, { schemaVersion: 1, stage: 'storage-cleanup' });
  assert.deepEqual(output.trace, [{ kind: 'storage-refusal', stage: 'object-list' }]);
  assert.equal((result.stdout + result.stderr).includes('PRIVATE'), false);
});
