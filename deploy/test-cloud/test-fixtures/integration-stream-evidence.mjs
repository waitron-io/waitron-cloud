import assert from 'node:assert/strict';

export function inspectIntegrationStream(value, selected) {
  const keys=['venueId','installationId','sourceNodeId','localVenueId','generation','recoverableAt'];
  const flags=['nativeStreaming','signedPointerVerified','retainedSnapshotUnchanged','noSupersession','noActivation'];
  assert.deepEqual(Object.keys(value).sort(),[...keys,'checkedAt',...flags].sort(),'integration.stream_shape');
  for(const key of keys) assert.equal(value[key],selected[key],'integration.stream_'+key);
  for(const key of ['venueId','installationId','sourceNodeId','localVenueId']) assert.match(value[key],/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,'integration.stream_identity');
  assert.match(value.generation,/^[A-Za-z0-9][A-Za-z0-9_-]+$/,'integration.stream_generation');
  for(const key of flags) assert.equal(value[key],true,'integration.stream_'+key);
  assert.ok(typeof value.checkedAt==='string' && Number.isFinite(Date.parse(value.checkedAt)) &&
    Number.isFinite(Date.parse(value.recoverableAt)) && Date.parse(value.checkedAt)>=Date.parse(value.recoverableAt),'integration.stream_observation');
  return {status:'observed',...value,independentObservation:true};
}
