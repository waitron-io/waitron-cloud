import assert from 'node:assert/strict';
import {test} from 'node:test';

const load = () => import('./test-fixtures/integration-snapshot-evidence.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-snapshot-evidence.mjs')) return {};
  throw error;
});
// These bytes exercise evidence consistency only; the separate paired journey captures the archive.
const expected = {pointId: 'point-a', installationId: 'installation-a', venueId: 'venue-a', sourceNodeId: 'node-a',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', bytes: 3};
const point = {id: 'point-a', installation_id: 'installation-a', venue_id: 'venue-a', source_node_id: 'node-a',
  digest: expected.sha256, size: '3', verification: 'pending'};

test('stored snapshot evidence requires both catalogue metadata and independently read bytes', async () => {
  const {inspectIntegrationSnapshot: inspect} = await load();
  assert.equal(typeof inspect, 'function', 'Independent snapshot evidence checking is missing');
  assert.deepEqual(inspect(point, Buffer.from('abc'), expected), {independentStoredDigest: true});
  assert.throws(() => inspect(point, Buffer.from('abd'), expected));
  assert.throws(() => inspect(point, Buffer.from('abc\n'), expected));
  assert.throws(() => inspect({...point, size: '4'}, Buffer.from('abc'), {...expected, bytes: 4}));
});

for (const [name, changes] of [
  ['point', {id: 'point-b'}], ['installation', {installation_id: 'installation-b'}],
  ['venue', {venue_id: 'venue-b'}], ['source node', {source_node_id: 'node-b'}],
  ['catalogue digest', {digest: '0'.repeat(64)}], ['catalogue length', {size: '4'}],
  ['verification state', {verification: 'verified'}],
]) test('stored snapshot evidence refuses a different ' + name, async () => {
  const {inspectIntegrationSnapshot: inspect} = await load();
  assert.equal(typeof inspect, 'function', 'Independent snapshot evidence checking is missing');
  assert.throws(() => inspect({...point, ...changes}, Buffer.from('abc'), expected));
});
