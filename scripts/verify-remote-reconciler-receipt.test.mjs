import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyRemoteReconcilerReceipt} from './verify-remote-reconciler-receipt.mjs';

const certificate=serial=>({initialSerial:serial,renewedSerial:(Number.parseInt(serial,16)+1).toString(16),initialFingerprint:'AA:BB',renewedFingerprint:'CC:DD'});
const receipt=()=>({version:1,cloudHead:'a'.repeat(40),waitronHead:'b'.repeat(40),cloudDirty:false,waitronDirty:false,liveResources:false,
 routes:{signed:true,sequences:[1,2],duplicatePublications:0,otherVenueIsolated:true,restartRecovered:true},
 certificates:{staff:{...certificate('01'),installedWithWaitronInterface:true,privateKeyStayedInWaitron:true},public:certificate('03'),failedRenewalRetained:true,hostnameChangeFenced:true,expiredLeaseFenced:true,duplicateIssuances:0},
 worker:{restartRecoveredExpiredLease:true,failedTargetAttempts:1},checks:Array.from({length:8},(_,n)=>`check ${n}`)});

test('receipt requires route, restart, isolation and certificate fencing evidence',()=>{
 assert.doesNotThrow(()=>verifyRemoteReconcilerReceipt(receipt()));
 for(const mutate of [value=>value.routes.sequences=[2,1],value=>value.routes.otherVenueIsolated=false,value=>value.certificates.failedRenewalRetained=false,value=>value.certificates.hostnameChangeFenced=false,value=>value.certificates.expiredLeaseFenced=false,value=>value.certificates.staff.privateKeyStayedInWaitron=false,value=>value.worker.restartRecoveredExpiredLease=false]){
  const value=receipt();mutate(value);assert.throws(()=>verifyRemoteReconcilerReceipt(value));
 }
});
