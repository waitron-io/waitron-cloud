import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Removing independent cleanup attempts must leave the owned bucket or child uncollected.
for (const fault of ['first-client-close', 'cleanup-client-open', 'cleanup-client-construction']) {
  for (const action of ['finish', 'close', 'concurrent']) test(`${action} collects independent resources after ${fault}`, () => {
    const result = spawnSync(process.execPath, [new URL('./fixtures/worker-storage-diagnostic-probe.mjs', import.meta.url).pathname, fault, action],
      { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.message, 'Invalid cloud cost worker storage', 'failed disposal never returns measurement success or a raw SDK error');
    assert.deepEqual(output.records, [{ kind: 'storage-refusal', stage: 'cleanup-client-open' }]);
    assert.equal(output.collected, true, 'collect the owned child even when a client fails');
    assert.equal(output.proxyClosed, 1, 'close the listener once despite repeated disposal');
    assert.equal(output.clientCount, 2, 'try one independent cleanup client');
    assert.equal(output.rootRetained, true, 'retain private evidence after any cleanup failure');
    assert.equal(output.bucketRemoved, fault !== 'cleanup-client-construction', 'only a successfully opened cleanup client may collect the owned bucket');
    if (fault === 'cleanup-client-construction') {
      assert.equal(output.cleanupRequests, 0, 'never reuse the setup client after cleanup client construction failed');
      assert.equal(output.destroyed, 1, 'do not destroy the stale setup client again');
    } else assert.equal(output.destroyed, 2, 'attempt to close each client once');
    assert.equal((result.stdout + result.stderr).includes('PRIVATE'), false);
  });
}
