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
