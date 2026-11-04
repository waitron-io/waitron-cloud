import assert from 'node:assert/strict';

export function inspectIntegrationContinuousState(row, selected, status) {
  for (const key of ['id', 'request_id', 'operation_id']) assert.equal(row[key], selected.requestId);
  assert.equal(row.source_kind, 'continuous');
  assert.equal(row.venue_id, selected.venueId);
  assert.equal(row.organisation_id, selected.organisationId);
  for (const key of ['point_id', 'protocol_version', 'request_target', 'verification_target', 'superseded_by', 'revoked_at']) assert.equal(row[key], null);
  assert.equal(row.stream_generation, selected.generation);
  assert.equal(row.stream_source_node_id, selected.sourceNodeId);
  assert.equal(row.stream_recoverable_at.toISOString(), selected.recoverableAt);
  assert.equal(row.status, status);
  return {requestId: row.id, cloudStatus: row.status, noSupersession: true};
}

export function inspectIntegrationContinuousRecovery(value, selected) {
  const result = {};
  for (const key of ['sourceNodeId', 'localVenueId', 'generation']) {
    assert.equal(value[key], selected[key], 'integration.continuous_' + key);
    result[key] = value[key];
  }
  assert.equal(value.exit, 0, 'integration.continuous_exit'); result.exit = 0;
  for (const key of ['nativeRestore', 'ownerApprovedKit', 'sourceStoppedDuringRead', 'sourceAuthorityVerified',
    'preparationBoundToStream', 'sourceRecordsPreserved', 'wrongAuthorityRefused', 'missingPreparationRefused',
    'noServerStarted', 'noSupersession', 'requestClosed']) {
    assert.equal(value[key], true, 'integration.continuous_' + key); result[key] = true;
  }
  assert.equal(value.integrity, 'ok', 'integration.continuous_integrity'); result.integrity = 'ok';
  assert.equal(value.cloudReportedRestored, false, 'integration.continuous_cloudReportedRestored');
  result.cloudReportedRestored = false;
  return result;
}
