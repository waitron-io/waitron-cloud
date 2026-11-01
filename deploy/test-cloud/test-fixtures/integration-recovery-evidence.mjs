import assert from 'node:assert/strict';

// An approved read remains pending until a completed ordinary restore is explicitly acknowledged.
export function inspectIntegrationRecovery(row, expected, status) {
  assert.equal(row.id, expected.requestId);
  assert.equal(row.request_id, expected.requestId);
  assert.equal(row.operation_id, expected.requestId);
  assert.equal(row.source_kind, 'snapshot');
  assert.equal(row.venue_id, expected.venueId);
  assert.equal(row.organisation_id, expected.organisationId);
  assert.equal(row.point_id, expected.pointId);
  assert.equal(row.verification_attempt_id, expected.attemptId);
  assert.equal(row.current_evidence_id, expected.attemptId);
  assert.equal(row.digest, expected.sha256);
  assert.equal(Number(row.size), expected.bytes);
  assert.equal(row.verification_target.digest, expected.targetDigest);
  assert.equal(row.request_target.digest, expected.targetDigest);
  assert.equal(row.protocol_version, 2);
  assert.equal(row.status, status);
  assert.equal(row.superseded_by, null);
  assert.equal(row.revoked_at, null);
  return {requestId: row.id, protocolVersion: row.protocol_version, pointId: row.point_id,
    attemptId: row.verification_attempt_id, targetDigest: row.verification_target.digest,
    sha256: row.digest, bytes: Number(row.size), cloudStatus: row.status, noSupersession: true};
}
