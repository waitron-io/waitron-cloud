import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {signManifest,verifyManifest,type GatewayManifest} from '../src/manifest.ts';
const keys=generateKeyPairSync('ed25519'),foreign=generateKeyPairSync('ed25519');
const now=Date.now(),cellId=randomUUID();
const value:GatewayManifest={version:1,audience:'waitron-cloud-gateway',cellId,sequence:1,issuedAt:now,expiresAt:now+600000,routes:[{installationId:randomUUID(),venueId:randomUUID(),staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')}]};
test('signed gateway authority binds exact cell, purpose, contents, sequence and expiry',()=>{
 const envelope=signManifest(value,keys.privateKey);
 assert.deepEqual(verifyManifest(envelope,keys.publicKey,cellId,now,0),value);
 for(const [key,cell,time,sequence] of [[foreign.publicKey,cellId,now,0],[keys.publicKey,randomUUID(),now,0],[keys.publicKey,cellId,value.expiresAt,0],[keys.publicKey,cellId,now,1]] as const)
  assert.throws(()=>verifyManifest(envelope,key,cell,time,sequence),/invalid_manifest/);
 const changed={...envelope,payload:Buffer.from(JSON.stringify({...value,expiresAt:now+700000})).toString('base64url')};
 assert.throws(()=>verifyManifest(changed,keys.publicKey,cellId,now,0),/invalid_manifest/);
 for(const patch of [{audience:'control'},{expiresAt:now+600001},{issuedAt:now+61000,expiresAt:now+120000},{extra:true},{routes:[value.routes[0],value.routes[0]]}])
  assert.throws(()=>signManifest({...value,...patch} as GatewayManifest,keys.privateKey),/invalid_manifest/);
});
test('routes reject command injection, public/private name overlap and invalid WireGuard keys',()=>{
 for(const patch of [{staffHostname:'staff.example.test\nbackend steal'},{publicHostname:value.routes[0]!.staffHostname},{address:'127.0.0.1'},{port:0},{peerPublicKey:'a'.repeat(44)}])
  assert.throws(()=>signManifest({...value,routes:[{...value.routes[0]!,...patch}]},keys.privateKey),/invalid_manifest/);
});

test('v2_requires_revision_and_reporter while preserving strict v1 shape',()=>{
 const v2={...value,version:2,reporter:{gatewayId:randomUUID(),generation:1},routes:[{...value.routes[0]!,revision:0}]};
 const envelope=signManifest(v2 as unknown as GatewayManifest,keys.privateKey,now);
 assert.deepEqual(verifyManifest(envelope,keys.publicKey,cellId,now),v2);
 const bad=[{...v2,reporter:undefined},{...v2,reporter:{...v2.reporter,generation:0}},
  {...v2,reporter:{...v2.reporter,extra:true}},{...v2,reporter:{...v2.reporter,gatewayId:'invalid'}},
  ...[undefined,-1,0.1,Number.MAX_SAFE_INTEGER+1].map(revision=>({...v2,routes:[{...v2.routes[0]!,revision}]})),
  {...v2,routes:[{...v2.routes[0]!,extra:true}]},{...value,reporter:v2.reporter},{...value,routes:v2.routes}];
 for(const input of bad)assert.throws(()=>signManifest(input as unknown as GatewayManifest,keys.privateKey,now),/invalid_manifest/);
 for(const [time,sequence] of [[value.expiresAt,0],[now,1]])assert.throws(()=>verifyManifest(envelope,keys.publicKey,cellId,time,sequence),/invalid_manifest/);
});
