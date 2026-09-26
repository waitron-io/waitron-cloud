import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyControlPlaneOutageReceipt} from './verify-control-plane-outage-receipt.mjs';

function valid(){return {
  schemaVersion:1,cloudHead:'a'.repeat(40),cloudDirty:false,measuredAt:'2026-09-26T10:00:00.000Z',
  environment:{accountServerProcess:true,gatewaySocket:true,storageTls:true,storageProvider:'SeaweedFS 4.47'},
  controlPlane:{connectionRefusedDuringOutage:true,recoveredAfterRestart:true,outageMs:1250},
  route:{availableBeforeOutage:true,availableDuringOutage:true,cachedRestartAvailable:true,refusedAtSignedExpiry:true,availableAfterControlRecovery:true,revokedAfterRefresh:true},
  storage:{availableDuringOutage:true,refusedAfterCredentialExpiry:true,credentialExpiresAt:'2026-09-26T10:00:12.000Z'},
  rotation:{oldKeyId:'b'.repeat(43),newKeyId:'c'.repeat(43),oldLeaseAcceptedDuringOverlap:true,newLeaseSignedByNewKey:true,oldLeaseExpiredBeforeRemoval:true,oldLeaseRefusedAfterRemoval:true,revokedLeaseRefused:true},
};}

test('accepts a complete control-plane outage receipt',()=>assert.deepEqual(verifyControlPlaneOutageReceipt(valid()),valid()));
for(const [name,mutate] of [
  ['dirty tree',r=>{r.cloudDirty=true;}],
  ['live control plane',r=>{r.controlPlane.connectionRefusedDuringOutage=false;}],
  ['extended cached route',r=>{r.route.refusedAtSignedExpiry=false;}],
  ['lost storage transfer',r=>{r.storage.availableDuringOutage=false;}],
  ['unexpired retired issuer',r=>{r.rotation.oldLeaseExpiredBeforeRemoval=false;}],
  ['same issuer key',r=>{r.rotation.newKeyId=r.rotation.oldKeyId;}],
  ['accepted revoked lease',r=>{r.rotation.revokedLeaseRefused=false;}],
])test(`rejects ${name}`,()=>{const receipt=valid();mutate(receipt);assert.throws(()=>verifyControlPlaneOutageReceipt(receipt),/control-plane outage receipt is invalid/);});
