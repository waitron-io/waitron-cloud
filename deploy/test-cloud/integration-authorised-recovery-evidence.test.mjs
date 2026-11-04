import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as evidence from './test-fixtures/integration-recovery-evidence.mjs';

const expected = {sha256: 'a'.repeat(64), bytes: 4115029, sourceNodeId: 'source-node', localVenueId: 'source-venue'};
const report = () => ({...expected, exit: 0, preparationBoundToDeliveredArchive: true,
  sourceAuthorityVerified: true, wrongAuthorityRefused: true, missingPreparationRefused: true,
  integrity: 'ok', sourceRecordsPreserved: true, noServerStarted: true,
  noCloudCredentials: true, cloudReportedRestored: false});

// A substituted archive/source or a claimed success without its normal preparation must refuse.
test('authorised recovery evidence binds the delivered archive and genuine source', () => {
  assert.equal(typeof evidence.inspectIntegrationAuthorisedRecovery, 'function');
  assert.deepEqual(evidence.inspectIntegrationAuthorisedRecovery(report(), expected), report());
});
for (const [name, value] of Object.entries({sha256: 'b'.repeat(64), bytes: 1,
  sourceNodeId: 'another-node', localVenueId: 'another-venue', exit: 1,
  preparationBoundToDeliveredArchive: false, sourceAuthorityVerified: false,
  wrongAuthorityRefused: false, missingPreparationRefused: false, integrity: 'broken',
  sourceRecordsPreserved: false, noServerStarted: false, noCloudCredentials: false,
  cloudReportedRestored: true})) {
  test('authorised recovery refuses incorrect ' + name, () => {
    assert.equal(typeof evidence.inspectIntegrationAuthorisedRecovery, 'function');
    assert.throws(() => evidence.inspectIntegrationAuthorisedRecovery({...report(), [name]: value}, expected));
  });
}
test('authorised recovery evidence excludes private delivery material', () => {
  assert.equal(typeof evidence.inspectIntegrationAuthorisedRecovery, 'function');
  assert.deepEqual(evidence.inspectIntegrationAuthorisedRecovery({...report(), privateDelivery: 'private'}, expected), report());
});
