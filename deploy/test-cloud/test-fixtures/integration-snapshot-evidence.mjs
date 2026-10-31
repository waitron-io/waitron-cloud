import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Metadata alone cannot prove the uploaded bytes survived publication unchanged.
export function inspectIntegrationSnapshot(point, stored, expected) {
  assert.equal(point.id, expected.pointId);
  assert.equal(point.installation_id, expected.installationId);
  assert.equal(point.venue_id, expected.venueId);
  assert.equal(point.source_node_id, expected.sourceNodeId);
  assert.equal(point.digest, expected.sha256);
  assert.equal(Number(point.size), expected.bytes);
  assert.equal(point.verification, 'pending');
  assert.equal(createHash('sha256').update(stored).digest('hex'), expected.sha256);
  assert.equal(stored.length, expected.bytes);
  return {independentStoredDigest: true};
}
