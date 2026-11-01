import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Publication expects pending; a later retained copy must still name its admitted verification.
export function inspectIntegrationRetainedSnapshot(point,stored,expected) {
  assert.equal(point.id,expected.pointId);
  assert.equal(point.installation_id,expected.installationId);
  assert.equal(point.venue_id,expected.venueId);
  assert.equal(point.source_node_id,expected.sourceNodeId);
  assert.equal(point.digest,expected.sha256);
  assert.equal(Number(point.size),expected.bytes);
  assert.equal(point.verification,'verified');
  assert.match(expected.attemptId??'',/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.equal(point.current_evidence_id,expected.attemptId);
  assert.equal(createHash('sha256').update(stored).digest('hex'),expected.sha256);
  assert.equal(stored.length,expected.bytes);
  return {independentStoredDigest:true};
}
