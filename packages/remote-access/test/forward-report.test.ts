import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {test} from 'node:test';
import {routeBinding,signForwardReport,verifyForwardReport,type ForwardReport} from '../src/forward-report.ts';

const now=1800000000000;
const cellId='11111111-1111-4111-8111-111111111111',gatewayId='22222222-2222-4222-8222-222222222222';
const installationId='33333333-3333-4333-8333-333333333333',venueId='44444444-4444-4444-8444-444444444444';
const keys=generateKeyPairSync('ed25519'),foreign=generateKeyPairSync('ed25519');
const observation={cellId,gatewayId,generation:1,installationId,venueId,revision:0,routeId:'public_availability' as const,
 routeBinding:'a'.repeat(64),manifestSequence:5,manifestExpiresAt:now+600000,observationSequence:1,
 category:'upstream_non_200' as const,observedAt:now,expiresAt:now+300000};
const report:ForwardReport={version:1,audience:'waitron-cloud-public-forward-report',cellId,gatewayId,generation:1,
 sequence:1,issuedAt:now,observations:[observation]};
function envelope(value:unknown){const bytes=Buffer.from(JSON.stringify(value));return {payload:bytes.toString('base64url'),signature:sign(null,bytes,keys.privateKey).toString('base64url')};}

test('route binding hashes only the ordered full route tuple',()=>{
 const route={installationId,venueId,staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:'A'.repeat(43)+'='};
 const tuple='["33333333-3333-4333-8333-333333333333","44444444-4444-4444-8444-444444444444","staff.sol.example.test","sol.example.test","10.77.0.2",443,"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="]';
 assert.equal(routeBinding(route),createHash('sha256').update(tuple).digest('hex'));
 for(const [key,value] of Object.entries(route))assert.notEqual(routeBinding({...route,[key]:typeof value==='number'?444:value+'x'}),routeBinding(route));
});

test('signed forward reports round-trip all five causes and success with canonical bytes',()=>{
 for(const category of ['upstream_non_200','upstream_timeout','upstream_response_limit','upstream_transport','forward_internal',null] as const){
  const value={...report,observations:[{...observation,category}]};
  const signed=signForwardReport(value,keys.privateKey);
  assert.deepEqual(verifyForwardReport(signed,keys.publicKey,now),value);
  const reordered=Object.fromEntries(Object.entries(value).reverse()) as unknown as ForwardReport;
  assert.deepEqual(signForwardReport(reordered,keys.privateKey),signed,'object insertion order cannot change signed bytes');
  assert.doesNotMatch(Buffer.from(signed.payload,'base64url').toString(),/staff\.sol|10\.77|password|private body/);
 }
});

test('report signature, envelope shape, encoding and Ed25519 authority are mandatory',()=>{
 const signed=signForwardReport(report,keys.privateKey),rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 for(const value of [{...signed,extra:true},{...signed,payload:signed.payload+'='},{...signed,signature:signed.signature+'='},
  {...signed,payload:Buffer.from(JSON.stringify({...report,sequence:2})).toString('base64url')},
  {payload:'x'.repeat(262144),signature:signed.signature},null])assert.throws(()=>verifyForwardReport(value,keys.publicKey,now),/invalid_forward_report/);
 assert.throws(()=>verifyForwardReport(signed,foreign.publicKey,now),/invalid_forward_report/);
 assert.throws(()=>verifyForwardReport(signed,rsa.publicKey,now),/invalid_forward_report/);
 assert.throws(()=>signForwardReport(report,rsa.privateKey),/invalid_forward_report/);
 assert.throws(()=>verifyForwardReport(envelope(report),keys.publicKey,now),/invalid_forward_report/,'noncanonical signed JSON is refused');
});

test('report keys, fixed categories, stream identity and safe counters are closed',()=>{
 const reportPatches:Record<string,unknown>[]=[{version:2},{audience:'waitron-cloud-gateway'},{cellId:'bad'},
  {gatewayId:'bad'},{generation:0},{sequence:0},{sequence:1.5},{sequence:Number.MAX_SAFE_INTEGER+1},
  {issuedAt:-1},{observations:null},{extra:'private body'}];
 const observationPatches:Record<string,unknown>[]=[{cellId:venueId},{gatewayId:venueId},{generation:2},
  {installationId:'bad'},{venueId:'bad'},{revision:-1},{revision:0.5},{routeId:'staff'},
  {routeBinding:'A'.repeat(64)},{routeBinding:'a'.repeat(63)},{manifestSequence:0},
  {observationSequence:0},{observationSequence:2},{category:'socket private error'},
  {category:['upstream_timeout']},{category:true},{path:'/secret'},{address:'10.77.0.2'},{body:'private body'},{observedAt:1.5}];
 for(const patch of reportPatches)assert.throws(()=>signForwardReport({...report,...patch} as ForwardReport,keys.privateKey),/invalid_forward_report/,JSON.stringify(patch));
 for(const patch of observationPatches)assert.throws(()=>signForwardReport({...report,observations:[{...observation,...patch}]} as ForwardReport,keys.privateKey),/invalid_forward_report/,JSON.stringify(patch));
 for(const patch of [{cellId:'bad'},{gatewayId:'bad'},{generation:0}])assert.throws(()=>signForwardReport({...report,...patch,observations:[{...observation,...patch}]},keys.privateKey),/invalid_forward_report/,'matching identities still need valid UUIDs and a positive generation');
});

test('report and observation expiry cannot be refreshed by validation or replay',()=>{
 const signed=signForwardReport(report,keys.privateKey);
 assert.deepEqual(verifyForwardReport(signed,keys.publicKey,now+299999),report);
 assert.throws(()=>verifyForwardReport(signed,keys.publicKey,now+300000),/invalid_forward_report/);
 assert.throws(()=>verifyForwardReport(signed,keys.publicKey,now-5001),/invalid_forward_report/);
 for(const patch of [{observedAt:now+5001,expiresAt:now+305001},{manifestExpiresAt:now},
  {manifestExpiresAt:now+600001},{expiresAt:now+300001},{expiresAt:now+299999},
  {observedAt:now+1000,manifestExpiresAt:now+500,expiresAt:now+500},
  {manifestExpiresAt:now+10000,expiresAt:now+300000}])assert.throws(()=>signForwardReport({...report,observations:[{...observation,...patch}]},keys.privateKey),/invalid_forward_report/);
 const short={...report,observations:[{...observation,manifestExpiresAt:now+10000,expiresAt:now+10000}]};
 assert.deepEqual(verifyForwardReport(signForwardReport(short,keys.privateKey),keys.publicKey,now),short);
 const empty={...report,observations:[]};
 assert.throws(()=>verifyForwardReport(signForwardReport(empty,keys.privateKey),keys.publicKey,now+300001),/invalid_forward_report/);
 assert.throws(()=>verifyForwardReport(signForwardReport(empty,keys.privateKey),keys.publicKey,now-5001),/invalid_forward_report/);
});

test('reports bound entries to 64 unique installations and venues',()=>{
 const observations=Array.from({length:64},(_,i)=>({...observation,installationId:`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`,venueId:`44444444-4444-4444-8444-${String(i).padStart(12,'0')}`}));
 const value={...report,observations};
 assert.equal(verifyForwardReport(signForwardReport(value,keys.privateKey),keys.publicKey,now).observations.length,64);
 for(const entries of [[observation,observation],[...observations,{...observation}],
  [observation,{...observation,installationId:cellId}],[observation,{...observation,venueId:cellId}]])assert.throws(()=>signForwardReport({...report,observations:entries},keys.privateKey),/invalid_forward_report/);
});

test('a valid signature cannot admit malformed report contents',()=>{
 const payload=Buffer.from(signForwardReport(report,keys.privateKey).payload,'base64url').toString();
 for(const [before,after] of [
  ['"category":"upstream_non_200"','"category":["upstream_non_200"]'],
  ['"revision":0','"revision":-1'],['"generation":1','"generation":0'],
  ['"routeId":"public_availability"','"routeId":"staff"'],
  ['"observationSequence":1','"observationSequence":2'],
  ['"routeBinding":"'+'a'.repeat(64)+'"','"routeBinding":"private-address"'],
  ['"expiresAt":1800000300000','"expiresAt":1800000300001'],
  ['"installationId":"'+installationId+'"','"installationId":"bad"'],
  ['"venueId":"'+venueId+'"','"venueId":"bad"'],
  ['"cellId":"'+cellId+'"','"cellId":"bad"'],
  ['"gatewayId":"'+gatewayId+'"','"gatewayId":"bad"'],
  ['"manifestSequence":5','"manifestSequence":0'],
  ['"manifestExpiresAt":1800000600000','"manifestExpiresAt":1800000600001'],
  ['"observedAt":1800000000000','"observedAt":1800000005001'],
  ['"sequence":1','"sequence":0'],['"issuedAt":1800000000000','"issuedAt":-1'],
  ['"version":1','"version":2'],['"audience":"waitron-cloud-public-forward-report"','"audience":"other"'],
 ] as const){
  assert.ok(payload.includes(before));const bytes=Buffer.from(payload.replace(before,after));
  assert.throws(()=>verifyForwardReport({payload:bytes.toString('base64url'),signature:sign(null,bytes,keys.privateKey).toString('base64url')},keys.publicKey,now),/invalid_forward_report/,before);
 }
});
