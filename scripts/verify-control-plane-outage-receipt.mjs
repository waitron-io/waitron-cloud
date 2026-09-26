import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const requiredTrue=[
  ['environment','accountServerProcess'],['environment','gatewaySocket'],['environment','storageTls'],
  ['controlPlane','connectionRefusedDuringOutage'],['controlPlane','recoveredAfterRestart'],
  ['route','availableBeforeOutage'],['route','availableDuringOutage'],['route','cachedRestartAvailable'],
  ['route','refusedAtSignedExpiry'],['route','availableAfterControlRecovery'],['route','revokedAfterRefresh'],
  ['storage','availableDuringOutage'],['storage','refusedAfterCredentialExpiry'],
  ['rotation','oldLeaseAcceptedDuringOverlap'],['rotation','newLeaseSignedByNewKey'],
  ['rotation','oldLeaseExpiredBeforeRemoval'],['rotation','expiredOldLeaseRefusedAfterRemoval'],
  ['rotation','liveOldIssuerNegativeControlRefusedAfterRemoval'],['rotation','revokedLeaseRefused'],
];
function invalid(){throw new Error('control-plane outage receipt is invalid');}
export function verifyControlPlaneOutageReceipt(receipt){
  try{
    assert(receipt&&typeof receipt==='object');assert.equal(receipt.schemaVersion,1);
    assert.match(receipt.cloudHead,/^[0-9a-f]{40}$/);assert.equal(receipt.cloudDirty,false);
    assert.equal(new Date(receipt.measuredAt).toISOString(),receipt.measuredAt);
    assert.equal(receipt.environment.storageProvider,'SeaweedFS 4.47');
    for(const [group,field] of requiredTrue)assert.equal(receipt[group]?.[field],true);
    assert(Number.isFinite(receipt.controlPlane.outageMs)&&receipt.controlPlane.outageMs>=0);
    assert.equal(new Date(receipt.storage.credentialExpiresAt).toISOString(),receipt.storage.credentialExpiresAt);
    assert.match(receipt.rotation.oldKeyId,/^[A-Za-z0-9_-]{43}$/);assert.match(receipt.rotation.newKeyId,/^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(receipt.rotation.oldKeyId,receipt.rotation.newKeyId);
    return receipt;
  }catch{return invalid();}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  if(process.argv.length!==3)throw new Error('usage: verify-control-plane-outage-receipt.mjs RECEIPT.json');
  const receipt=verifyControlPlaneOutageReceipt(JSON.parse(await readFile(process.argv[2],'utf8')));
  console.log(`verified control-plane outage receipt from ${receipt.measuredAt}`);
}
