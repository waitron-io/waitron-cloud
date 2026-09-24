import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {GatewayAuthority} from '../src/authority.ts';
import {signManifest,type GatewayManifest} from '../src/manifest.ts';
test('cached authority survives restart without extending expiry or accepting replay',async()=>{
 const key=generateKeyPairSync('ed25519'),now=Date.now(),cellId=randomUUID();let time=now,closed=0,applied=0,saved:unknown;
 const value:GatewayManifest={version:1,audience:'waitron-cloud-gateway',cellId,sequence:3,issuedAt:now,expiresAt:now+1000,routes:[{installationId:randomUUID(),venueId:randomUUID(),staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')}]};
 const hooks={persist:async(v:unknown)=>{saved=v;},apply:async()=>{applied++;},close:async()=>{closed++;}};
 const authority=new GatewayAuthority(key.publicKey,cellId,hooks,()=>time),envelope=signManifest(value,key.privateKey);
 await authority.accept(envelope);assert.equal(authority.routes.length,1);assert.equal(applied,1);
 await assert.rejects(authority.accept(envelope),/invalid_manifest/);
 const restarted=new GatewayAuthority(key.publicKey,cellId,hooks,()=>time);await restarted.restore(saved);assert.equal(restarted.routes.length,1);
 time=now+1000;await restarted.tick();assert.equal(restarted.routes.length,0);assert.equal(closed,1);
 const expiredRestart=new GatewayAuthority(key.publicKey,cellId,hooks,()=>time);await expiredRestart.restore(saved);assert.equal(expiredRestart.routes.length,0);
 await assert.rejects(expiredRestart.accept(signManifest({...value,sequence:2,expiresAt:now+2000},key.privateKey,time)),/invalid_manifest/);
 const revoked=signManifest({...value,sequence:4,issuedAt:time,expiresAt:time+1000,routes:[]},key.privateKey,time);await authority.accept(revoked);assert.equal(authority.routes.length,0);
});
test('a persistence or apply failure removes authority instead of leaving stale routes active',async()=>{
 const key=generateKeyPairSync('ed25519'),now=Date.now(),cellId=randomUUID();let close=0;
 const authority=new GatewayAuthority(key.publicKey,cellId,{persist:async()=>{throw Error('disk full');},apply:async()=>{throw Error('must not apply');},close:async()=>{close++;}});
 await assert.rejects(authority.accept(signManifest({version:1,audience:'waitron-cloud-gateway',cellId,sequence:1,issuedAt:now,expiresAt:now+1000,routes:[]},key.privateKey)),/disk full/);assert.equal(close,1);assert.equal(authority.routes.length,0);
});
