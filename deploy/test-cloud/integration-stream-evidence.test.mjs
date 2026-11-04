import assert from 'node:assert/strict';
import {test} from 'node:test';
const load = () => import('./test-fixtures/integration-stream-evidence.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-stream-evidence.mjs')) return {};
  throw error;
});
const selected = {venueId:'11111111-1111-4111-8111-111111111111',installationId:'22222222-2222-4222-8222-222222222222',
  sourceNodeId:'33333333-3333-4333-8333-333333333333',localVenueId:'44444444-4444-4444-8444-444444444444',
  generation:'20261101T050000Z-abcdef',recoverableAt:'2026-11-01T05:00:00.000Z'};
const fixture = () => ({...selected,checkedAt:'2026-11-01T05:00:01.000Z',nativeStreaming:true,
  signedPointerVerified:true,retainedSnapshotUnchanged:true,noSupersession:true,noActivation:true});

test('stream evidence retains an independently observed source binding without private fields', async () => {
  const {inspectIntegrationStream}=await load();assert.equal(typeof inspectIntegrationStream,'function','Stream evidence validation is missing');
  const value=inspectIntegrationStream(fixture(),selected);
  assert.equal(value.status,'observed');assert.equal(value.independentObservation,true);
  assert.equal(value.generation,'20261101T050000Z-abcdef');
  assert.deepEqual(value,{status:'observed',...fixture(),independentObservation:true});
});
for(const key of ['venueId','installationId','sourceNodeId','localVenueId','generation','recoverableAt']) {
  test('stream evidence rejects another '+key, async()=>{
    const {inspectIntegrationStream}=await load();assert.equal(typeof inspectIntegrationStream,'function');
    assert.throws(()=>inspectIntegrationStream({...fixture(),[key]:key==='recoverableAt'?'2026-11-01T04:00:00.000Z':key==='generation'?'another-generation':'55555555-5555-4555-8555-555555555555'},selected));
  });
}
for(const key of ['nativeStreaming','signedPointerVerified','retainedSnapshotUnchanged','noSupersession','noActivation']) {
  test('stream evidence rejects missing '+key,async()=>{
    const {inspectIntegrationStream}=await load();assert.equal(typeof inspectIntegrationStream,'function');
    assert.throws(()=>inspectIntegrationStream({...fixture(),[key]:false},selected));
  });
}
for(const checkedAt of [null,'bad','2026-11-01T04:59:59.000Z']) {
  test('stream evidence rejects an invalid or older observation '+checkedAt,async()=>{
    const {inspectIntegrationStream}=await load();assert.equal(typeof inspectIntegrationStream,'function');
    assert.throws(()=>inspectIntegrationStream({...fixture(),checkedAt},selected));
  });
}
test('stream evidence refuses private extra fields before emitting a receipt',async()=>{
  const {inspectIntegrationStream}=await load();assert.equal(typeof inspectIntegrationStream,'function');
  assert.throws(()=>inspectIntegrationStream({...fixture(),recoveryKey:'PRIVATE_CANARY'},selected),error=>{
    assert.equal(String(error).includes('PRIVATE_CANARY'),false);return true;
  });
});
for(const [key,value] of [['sourceNodeId','invalid'],['generation',''],['recoverableAt','bad']]) {
  test('stream evidence rejects a shared malformed '+key,async()=>{
    const {inspectIntegrationStream}=await load();
    assert.throws(()=>inspectIntegrationStream({...fixture(),[key]:value},{...selected,[key]:value}));
  });
}
