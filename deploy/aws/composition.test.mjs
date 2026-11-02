import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSuite } from './check.mjs';

// Omitting either root or its composed filter must leave a missing result.
test('both independent roots plan the real management database, regional keys and retained secret references', async () => {
  const result = await runSuite('integration');
  for (const name of ['data_topology_binds_database_and_cold_keys', 'data_topology_retains_every_secret_copy']) {
    assert.equal(result.split(`run "${name}"... pass`).length - 1, 2, `${name} must run in both roots`);
  }
});
