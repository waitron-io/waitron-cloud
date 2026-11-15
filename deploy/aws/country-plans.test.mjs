import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSuite } from './check.mjs';

// A missing filter or crossed root must fail its own complete plan receipt.
test('country plans every binding refusal and complete composition', async () => {
  const result = await runSuite('integration-country');
  assert.deepEqual([...result.matchAll(/Isolated suite aggregate: Success! ([0-9]+) passed, 0 failed\./g)].map(match => Number(match[1])), [29]);
  for (const name of ['primary_cells_use_their_exact_network_entries', 'rejects_foreign_operator_account_before_cell_reads']) {
    assert.equal(result.split(`run "${name}"... pass`).length - 1, 1, name);
  }
  for (const alias of ['country', 'country_backup', 'country_keys', 'country_backup_keys']) {
    for (const field of ['account', 'region']) {
      assert.equal(result.split(`run "rejects_actual_${alias}_${field}"... pass`).length - 1, 1, `${alias} ${field}`);
    }
  }
  for (const name of ['data_topology_binds_database_and_cold_keys', 'data_topology_retains_every_secret_copy', 'storage_and_scope_permissions_bind_cold_copies', 'two_cells_share_scope_permissions', 'two_cells_keep_distinct_workload_roles', 'one_cell_keep_exact_ingress_and_scope_dns', 'two_cells_keep_exact_ingress_and_scope_dns', 'one_cell_keep_exact_regional_evidence', 'two_cells_keep_exact_regional_evidence']) {
    assert.equal(result.split(`run "${name}"... pass`).length - 1, 1, name);
  }
  assert.equal(result.split('run "rejects_store_references_that_differ_from_permission_targets"... pass').length - 1, 1);
  assert.equal(result.split('run "one_cell_has_its_own_workload_roles"... pass').length - 1, 0);
});
