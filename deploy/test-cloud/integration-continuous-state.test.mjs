import assert from 'node:assert/strict';
import {test} from 'node:test';
const load = () => import('./test-fixtures/integration-continuous-recovery-evidence.mjs');
const selected = {requestId: 'request', venueId: 'venue', organisationId: 'organisation', sourceNodeId: 'node',
  generation: 'gen-0-node-20261101T050000Z', recoverableAt: '2026-11-01T05:00:00.000Z'};
const row = () => ({id: 'request', request_id: 'request', operation_id: 'request', source_kind: 'continuous',
  venue_id: 'venue', organisation_id: 'organisation', point_id: null, protocol_version: null, request_target: null,
  verification_target: null, stream_generation: selected.generation, stream_source_node_id: 'node',
  stream_recoverable_at: new Date(selected.recoverableAt), status: 'pending', superseded_by: null, revoked_at: null});
// A different operation, source or completed replacement must not pass an independent database read.
test('continuous recovery database evidence keeps the approved operation pending until its explicit close', async () => {
  const {inspectIntegrationContinuousState: inspect} = await load();
  assert.equal(typeof inspect, 'function');
  assert.deepEqual(inspect(row(), selected, 'pending'), {requestId: 'request', cloudStatus: 'pending', noSupersession: true});
  assert.deepEqual(inspect({...row(), status: 'closed'}, selected, 'closed'), {requestId: 'request', cloudStatus: 'closed', noSupersession: true});
});
for (const [key, value] of Object.entries({id: 'other', request_id: 'other', operation_id: 'other',
  source_kind: 'snapshot', venue_id: 'other', organisation_id: 'other', point_id: 'point', protocol_version: 2,
  request_target: {digest: 'other'}, verification_target: {digest: 'other'}, stream_generation: 'other',
  stream_source_node_id: 'other', stream_recoverable_at: new Date('2026-01-01T00:00:00Z'), status: 'restored',
  superseded_by: 'replacement', revoked_at: new Date()})) {
  test('continuous recovery database evidence refuses incorrect ' + key, async () => {
    const {inspectIntegrationContinuousState: inspect} = await load();
    assert.equal(typeof inspect, 'function');
    assert.throws(() => inspect({...row(), [key]: value}, selected, 'pending'));
  });
}
