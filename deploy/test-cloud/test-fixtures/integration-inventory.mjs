import assert from 'node:assert/strict';

export async function readIntegrationInventory({docker, protectedIds}) {
  const ids = (await docker(['ps', '-aq', '--no-trunc'])).split(/\s+/).filter(Boolean);
  for (const id of protectedIds) assert.ok(ids.includes(id), 'integration.protected_container_missing');
  const protectedRows = protectedIds.length ? (await docker(['inspect', '--format',
    '{{.Id}} {{.State.Running}} {{.State.StartedAt}}', ...protectedIds], '', 'protected-inventory-inspect')).split('\n') : [];
  assert.equal(protectedRows.length, protectedIds.length);
  for (const id of protectedIds) {
    const rows = protectedRows.filter(row => row.startsWith(id + ' '));
    assert.match(rows[0], /^[a-f0-9]{64} (true|false) \S+$/);
  }
  // Only protected IDs need stable process state; every listed ID remains visible to cleanup checks.
  return ids.map(id => protectedRows.find(row => row.startsWith(id + ' ')) ?? id + ' ').sort();
}
