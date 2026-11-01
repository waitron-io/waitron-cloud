import assert from 'node:assert/strict';
import {test} from 'node:test';
const load = () => import('./test-fixtures/integration-recovery-evidence.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-recovery-evidence.mjs')) return {};
  throw error;
});
const expected = {requestId: 'recovery-a', venueId: 'venue-a', organisationId: 'organisation-a', pointId: 'point-a', attemptId: 'attempt-a', targetDigest: 'a'.repeat(64), sha256: 'b'.repeat(64), bytes: 123};
const row = {id: 'recovery-a', request_id: 'recovery-a', operation_id: 'recovery-a', source_kind: 'snapshot', venue_id: 'venue-a', organisation_id: 'organisation-a', point_id: 'point-a', verification_attempt_id: 'attempt-a', current_evidence_id: 'attempt-a', digest: 'b'.repeat(64), size: '123', verification_target: {digest: 'a'.repeat(64)}, request_target: {digest: 'a'.repeat(64)}, protocol_version: 2, status: 'pending', superseded_by: null, revoked_at: null};
// Borrowing an older recovery or treating a successful read as restored must fail evidence checking.
test('recovery evidence binds the owner-approved v2 request to the current same archive', async () => {
  const {inspectIntegrationRecovery: inspect} = await load();
  assert.equal(typeof inspect, 'function', 'Independent paired recovery evidence checking is missing');
  assert.deepEqual(inspect(row, expected, 'pending'), {requestId: 'recovery-a', protocolVersion: 2, pointId: 'point-a', attemptId: 'attempt-a', targetDigest: 'a'.repeat(64), sha256: 'b'.repeat(64), bytes: 123, cloudStatus: 'pending', noSupersession: true});
  assert.equal(inspect({...row, status: 'closed'}, expected, 'closed').cloudStatus, 'closed');
});
for (const [name, column, value] of [
  ['operation', 'id', 'recovery-b'], ['request', 'request_id', 'recovery-b'], ['request operation', 'operation_id', 'recovery-b'],
  ['stream instead of snapshot', 'source_kind', 'continuous'], ['venue', 'venue_id', 'venue-b'], ['organisation', 'organisation_id', 'organisation-b'],
  ['point', 'point_id', 'point-b'], ['selected admission', 'verification_attempt_id', 'attempt-b'], ['current admission', 'current_evidence_id', 'attempt-b'],
  ['digest', 'digest', 'c'.repeat(64)], ['size', 'size', '124'], ['target', 'verification_target', {digest: 'c'.repeat(64)}],
  ['requested target', 'request_target', {digest: 'c'.repeat(64)}], ['old protocol', 'protocol_version', null], ['restored too early', 'status', 'restored'],
  ['source replacement', 'superseded_by', 'installation-b'], ['source revocation', 'revoked_at', new Date().toISOString()],
]) test('recovery evidence refuses ' + name, async () => {
  const {inspectIntegrationRecovery: inspect} = await load();
  assert.equal(typeof inspect, 'function', 'Independent paired recovery evidence checking is missing');
  assert.throws(() => inspect({...structuredClone(row), [column]: value}, expected, 'pending'));
});
