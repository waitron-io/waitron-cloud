import assert from 'node:assert/strict';

const owners = ['adjustments','bookings','catalogue','core','credentials','fiscal-none','fiscal-verifactu','identity','media','payments','scheduler','staffing','venue-service','workforce','workforce-es'];

// A passed child alone is insufficient: the current catalogue must admit that same capture.
export function inspectIntegrationVerification(point, attempt, expected, targetDigest, image, expectedOwners = owners) {
  for (const [column, key] of [['id','pointId'], ['venue_id','venueId'], ['installation_id','installationId'], ['source_node_id','sourceNodeId'], ['digest','sha256']]) assert.equal(point[column], expected[key]);
  assert.equal(Number(point.size), expected.bytes);
  assert.equal(point.verification, 'verified');
  assert.equal(point.current_evidence_id, attempt.id);
  assert.equal(attempt.point_id, expected.pointId);
  assert.equal(attempt.state, 'finished');
  assert.equal(attempt.status, 'passed');
  assert.equal(attempt.reason, 'none');
  assert.equal(attempt.current_verification, 'verified');
  assert.equal(attempt.cleanup_confirmed, true);
  assert.match(attempt.child_id ?? '', /^[a-f0-9]{64}$/);
  assert.equal(attempt.target_digest, targetDigest);
  assert.equal(attempt.verifier_image, 'local.waitron-verifier@' + image);
  const {request, result} = attempt;
  for (const [key, expectedKey] of [['pointId','pointId'], ['venueId','venueId'], ['sourceInstallationId','installationId'], ['sourceNodeId','sourceNodeId']]) assert.equal(request[key], expected[expectedKey]);
  assert.deepEqual(request.archive && {sha256: request.archive.sha256, bytes: request.archive.bytes}, {sha256: expected.sha256, bytes: expected.bytes});
  assert.equal(request.target.digest, targetDigest);
  assert.equal(result.status, 'passed');
  assert.equal(result.reason, 'none');
  assert.equal(result.activation, 'not_attempted');
  assert.equal(result.requestDigest, attempt.request_digest);
  assert.equal(result.targetDigest, targetDigest);
  assert.deepEqual(result.measuredArchive, {sha256: expected.sha256, bytes: expected.bytes});
  assert.deepEqual(result.modules.map(value => value.name).sort(), [...expectedOwners].sort());
  for (const module of result.modules) {
    assert.equal(module.status, 'passed');
    assert.ok(module.checks.length > 0);
    assert.ok(module.checks.every(value => value.status === 'passed'));
  }
  return {pointId: point.id, sha256: point.digest, bytes: Number(point.size), attemptId: attempt.id,
    childId: attempt.child_id, controllerScope: attempt.controller_scope, targetDigest, status: result.status,
    activation: result.activation, modules: result.modules.length, cleanupConfirmed: true};
}
