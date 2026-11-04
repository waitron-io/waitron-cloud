import assert from 'node:assert/strict';
import {test} from 'node:test';
const load = () => import('./test-fixtures/integration-continuous-recovery-evidence.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-continuous-recovery-evidence.mjs')) return {};
  throw error;
});
const selected = {sourceNodeId: 'node', localVenueId: 'venue', generation: 'gen-0-node-20261101T050000Z'};
const report = () => ({...selected, exit: 0, nativeRestore: true, ownerApprovedKit: true, sourceStoppedDuringRead: true,
  sourceAuthorityVerified: true, preparationBoundToStream: true, sourceRecordsPreserved: true,
  wrongAuthorityRefused: true, missingPreparationRefused: true, noServerStarted: true,
  noSupersession: true, requestClosed: true, integrity: 'ok', cloudReportedRestored: false});
// Substituted generations and incomplete preparation must never certify continuous recovery.
test('continuous recovery evidence binds the native restore to its approved source and generation', async () => {
  const {inspectIntegrationContinuousRecovery: inspect} = await load();
  assert.equal(typeof inspect, 'function');
  assert.deepEqual(inspect(report(), selected), report());
});
for (const [key, value] of Object.entries(report())) {
  test('continuous recovery evidence rejects incorrect ' + key, async () => {
    const {inspectIntegrationContinuousRecovery: inspect} = await load();
    assert.equal(typeof inspect, 'function');
    assert.throws(() => inspect({...report(), [key]: typeof value === 'boolean' ? !value : typeof value === 'number' ? 1 : 'other'}, selected));
  });
}
test('continuous recovery evidence excludes private kit and preparation data', async () => {
  const {inspectIntegrationContinuousRecovery: inspect} = await load();
  assert.equal(typeof inspect, 'function');
  assert.deepEqual(inspect({...report(), recoveryKit: 'private', operation: 'private'}, selected), report());
});
