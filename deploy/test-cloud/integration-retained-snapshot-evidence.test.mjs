import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {inspectIntegrationSnapshot} from './test-fixtures/integration-snapshot-evidence.mjs';
const load=()=>import('./test-fixtures/integration-retained-snapshot-evidence.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith('/integration-retained-snapshot-evidence.mjs'))return {};
  throw error;
});
const stored=Buffer.from('paired archive bytes');
const expected={pointId:'11111111-1111-4111-8111-111111111111',installationId:'22222222-2222-4222-8222-222222222222',
  venueId:'33333333-3333-4333-8333-333333333333',sourceNodeId:'44444444-4444-4444-8444-444444444444',
  attemptId:'55555555-5555-4555-8555-555555555555',sha256:createHash('sha256').update(stored).digest('hex'),bytes:20};
const point=()=>({id:expected.pointId,installation_id:expected.installationId,venue_id:expected.venueId,source_node_id:expected.sourceNodeId,
  digest:expected.sha256,size:'20',verification:'verified',current_evidence_id:expected.attemptId});

test('the original publication check continues to refuse an already verified point',()=>{
  assert.throws(()=>inspectIntegrationSnapshot(point(),stored,expected),{actual:'verified',expected:'pending'});
});
test('a retained snapshot must preserve the verified point and independently read bytes',async()=>{
  const {inspectIntegrationRetainedSnapshot}=await load();assert.equal(typeof inspectIntegrationRetainedSnapshot,'function','Verified retained-snapshot evidence is missing');
  assert.deepEqual(inspectIntegrationRetainedSnapshot(point(),stored,expected),{independentStoredDigest:true});
});
for(const column of ['id','installation_id','venue_id','source_node_id','digest','size','verification','current_evidence_id']) {
  test('retained snapshot refuses changed '+column,async()=>{
    const {inspectIntegrationRetainedSnapshot}=await load();assert.equal(typeof inspectIntegrationRetainedSnapshot,'function');
    assert.throws(()=>inspectIntegrationRetainedSnapshot({...point(),[column]:column==='size'?'19':column==='verification'?'pending':'changed'},stored,expected));
  });
}
test('retained snapshot refuses corrupted stored bytes independently of catalogue metadata',async()=>{
  const {inspectIntegrationRetainedSnapshot}=await load();assert.equal(typeof inspectIntegrationRetainedSnapshot,'function');
  const corrupted=Buffer.from(stored);corrupted[0]^=1;
  assert.throws(()=>inspectIntegrationRetainedSnapshot(point(),corrupted,expected));
});
test('a missing current attempt cannot pass through two missing bindings',async()=>{
  const {inspectIntegrationRetainedSnapshot}=await load();assert.equal(typeof inspectIntegrationRetainedSnapshot,'function');
  assert.throws(()=>inspectIntegrationRetainedSnapshot({...point(),current_evidence_id:undefined},stored,{...expected,attemptId:undefined}));
});
test('matching catalogue and expected size cannot hide a different stored length',async()=>{
  const {inspectIntegrationRetainedSnapshot}=await load();assert.equal(typeof inspectIntegrationRetainedSnapshot,'function');
  assert.throws(()=>inspectIntegrationRetainedSnapshot({...point(),size:'21'},stored,{...expected,bytes:21}));
});
