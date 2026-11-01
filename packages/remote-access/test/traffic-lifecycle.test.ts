import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';

// Wrong audiences, altered boundaries and noncanonical bytes must not authenticate a process.
async function api(){
 const value=await import(new URL('../src/traffic-lifecycle.ts',import.meta.url).href).catch(()=>({}));
 assert.equal(typeof value.signTrafficLifecycle,'function','signed traffic lifecycle must exist');
 return value;
}
const record=()=>({version:1,audience:'waitron-cloud-remote-traffic-lifecycle',kind:'start',cellId:randomUUID(),gatewayId:randomUUID(),generation:1,
 processId:randomUUID(),manifestDigest:'a'.repeat(64),startedAt:'2026-11-01T00:00:00.000Z',predecessorId:null,endedAt:null,finalSequence:null});

test('traffic lifecycle authenticates exact start and final boundaries under a separate audience',async()=>{
 const a=await api(),keys=generateKeyPairSync('ed25519'),start=record();
 for(const value of [start,{...start,kind:'end',endedAt:'2026-11-01T00:00:02.000Z',finalSequence:2}]){
  const envelope=a.signTrafficLifecycle(value,keys.privateKey);
  assert.deepEqual(a.verifyTrafficLifecycle(envelope,keys.publicKey),value);
  assert.deepEqual(a.trafficEnvelopeLifecycle(envelope),value);
  assert.throws(()=>a.verifyTrafficLifecycle(envelope,generateKeyPairSync('ed25519').publicKey),/invalid_traffic_lifecycle/);
  assert.throws(()=>a.verifyTrafficLifecycle({...envelope,signature:'A'.repeat(86)},keys.publicKey),/invalid_traffic_lifecycle/);
 }
});

test('traffic lifecycle refuses malformed identities times final sequences and cross-audience records',async()=>{
 const a=await api(),keys=generateKeyPairSync('ed25519'),start=record();
 for(const change of [{version:2},{audience:'waitron-cloud-remote-traffic'},{kind:'reload'},{cellId:'bad'},{gatewayId:'bad'},{processId:'bad'},
  {generation:0},{generation:1.5},{manifestDigest:'bad'},{startedAt:'2026-11-31T00:00:00.000Z'},{startedAt:'2026-11-01T00:00:00Z'},
  {predecessorId:start.processId},{predecessorId:'bad'},{endedAt:start.startedAt},{finalSequence:0},
  {kind:'end'},{kind:'end',endedAt:'2026-10-31T23:59:59.000Z',finalSequence:0},
  {kind:'end',endedAt:start.startedAt,finalSequence:-1},{kind:'end',endedAt:start.startedAt,finalSequence:0.5},
  {kind:'end',endedAt:start.startedAt,finalSequence:Number.MAX_SAFE_INTEGER+1},{extra:true}]){
  assert.throws(()=>a.signTrafficLifecycle({...start,...change},keys.privateKey),/invalid_traffic_lifecycle/,JSON.stringify(change));
  const bytes=Buffer.from(JSON.stringify({...start,...change}));
  assert.throws(()=>a.verifyTrafficLifecycle({payload:bytes.toString('base64url'),signature:sign(null,bytes,keys.privateKey).toString('base64url')},keys.publicKey),/invalid_traffic_lifecycle/);
 }
 assert.throws(()=>a.signTrafficLifecycle(start,keys.publicKey),/invalid_traffic_lifecycle/);
});

test('traffic lifecycle refuses noncanonical signed JSON extra envelope fields and oversized inputs',async()=>{
 const a=await api(),keys=generateKeyPairSync('ed25519'),start=record(),envelope=a.signTrafficLifecycle(start,keys.privateKey);
 for(const bytes of [Buffer.from(JSON.stringify(start,null,2)),Buffer.from(' '+Buffer.from(envelope.payload,'base64url').toString()),Buffer.from([255])]){
  assert.throws(()=>a.verifyTrafficLifecycle({payload:bytes.toString('base64url'),signature:sign(null,bytes,keys.privateKey).toString('base64url')},keys.publicKey),/invalid_traffic_lifecycle/);
 }
 for(const bad of [{...envelope,extra:true},{...envelope,payload:envelope.payload+'='},{...envelope,payload:'a'.repeat(8193)},null])
  assert.throws(()=>a.trafficEnvelopeLifecycle(bad),/invalid_traffic_lifecycle/);
});

test('a positive final sequence requires time for its nonempty reporting intervals',async()=>{
 const a=await api(),keys=generateKeyPairSync('ed25519'),start=record();
 assert.throws(()=>a.signTrafficLifecycle({...start,kind:'end',endedAt:start.startedAt,finalSequence:1},keys.privateKey),/invalid_traffic_lifecycle/);
 assert.deepEqual(a.verifyTrafficLifecycle(a.signTrafficLifecycle({...start,kind:'end',endedAt:start.startedAt,finalSequence:0},keys.privateKey),keys.publicKey),
  {...start,kind:'end',endedAt:start.startedAt,finalSequence:0});
});
