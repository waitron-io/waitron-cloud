import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkProtectedContainers} from '../../scripts/test-cloud-integration.mjs';
const load = () => import('./test-fixtures/integration-inventory.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-inventory.mjs')) return {};
  throw error;
});
const protectedId = 'a'.repeat(64), transient = 'b'.repeat(64), owned = 'c'.repeat(64);
const row = protectedId + ' true 2026-10-16T11:58:13Z';
test('a disappearing unprotected container cannot break the protected snapshot or hide an owned ID', async () => {
  const {readIntegrationInventory} = await load(); assert.equal(typeof readIntegrationInventory, 'function', 'Race-safe protected inventory is missing');
  const rows = await readIntegrationInventory({protectedIds: [protectedId], docker: async args => {
    if (args[0] === 'ps') return [protectedId, transient, owned].join('\n');
    assert.deepEqual(args, ['inspect', '--format', '{{.Id}} {{.State.Running}} {{.State.StartedAt}}', protectedId]);
    return row;
  }});
  assert.equal(checkProtectedContainers([row], rows, [protectedId]), true);
  assert.equal(rows.some(value => value.startsWith(transient + ' ')), true);
  assert.throws(() => {for (const id of [owned]) assert.ok(!rows.some(value => value.startsWith(id + ' ')));});
});
test('without protected IDs the inventory still retains every running or stopped ID for cleanup', async () => {
  const {readIntegrationInventory} = await load(); assert.equal(typeof readIntegrationInventory, 'function');
  const rows = await readIntegrationInventory({protectedIds: [], docker: async args => {
    assert.deepEqual(args, ['ps', '-aq', '--no-trunc']); return owned;
  }});
  assert.deepEqual(rows, [owned + ' ']);
});
for (const failure of [Error('No such object'), Error('Docker unavailable')]) test('a failed protected inspection remains a failure: ' + failure.message, async () => {
  const {readIntegrationInventory} = await load(); assert.equal(typeof readIntegrationInventory, 'function');
  await assert.rejects(readIntegrationInventory({protectedIds: [protectedId], docker: async args => {
    if (args[0] === 'ps') return protectedId;
    throw failure;
  }}), error => error === failure);
});
test('a protected restart still fails the unchanged identity check', async () => {
  const {readIntegrationInventory} = await load(); assert.equal(typeof readIntegrationInventory, 'function');
  const rows = await readIntegrationInventory({protectedIds: [protectedId], docker: async args => args[0] === 'ps' ? protectedId : protectedId + ' true 2026-11-02T00:00:00Z'});
  assert.throws(() => checkProtectedContainers([row], rows, [protectedId]));
});
for (const inspected of ['', owned + ' true 2026-10-16T11:58:13Z', protectedId + ' ', row + '\n' + row,
  row + '\n' + owned + ' true 2026-10-16T11:58:13Z']) {
  test('missing, substituted or malformed protected rows cannot become an empty baseline: ' + inspected, async () => {
    const {readIntegrationInventory} = await load(); assert.equal(typeof readIntegrationInventory, 'function');
    await assert.rejects(readIntegrationInventory({protectedIds: [protectedId], docker: async args => args[0] === 'ps' ? protectedId : inspected}));
  });
}
test('a protected container missing from the full ID list still refuses the reading', async () => {
  const {readIntegrationInventory} = await load(); assert.equal(typeof readIntegrationInventory, 'function');
  await assert.rejects(readIntegrationInventory({protectedIds: [protectedId], docker: async args => args[0] === 'ps' ? owned : row}));
});
