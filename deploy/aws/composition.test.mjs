import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSuite } from './check.mjs';

// Omitting either root or its composed filter must leave a missing result.
test('both independent roots plan the real management database, regional keys and retained secret references', async () => {
  const result = await runSuite('integration');
  for (const name of ['data_topology_binds_database_and_cold_keys', 'data_topology_retains_every_secret_copy', 'storage_and_scope_permissions_bind_cold_copies', 'two_cells_share_scope_permissions']) {
    assert.equal(result.split(`run "${name}"... pass`).length - 1, 2, `${name} must run in both roots`);
  }
  assert.equal(result.split('run "rejects_store_references_that_differ_from_permission_targets"... pass').length - 1, 1);
  assert.equal(result.split('run "one_cell_has_its_own_workload_roles"... pass').length - 1, 1);
  for (const name of ['two_cells_keep_distinct_workload_roles', 'one_cell_keep_exact_ingress_and_scope_dns', 'two_cells_keep_exact_ingress_and_scope_dns', 'one_cell_keep_exact_regional_evidence', 'two_cells_keep_exact_regional_evidence']) {
    assert.equal(result.split(`run "${name}"... pass`).length - 1, 2, `${name} must run in both roots`);
  }
});
