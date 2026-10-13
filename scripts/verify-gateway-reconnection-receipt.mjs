import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function verifyGatewayReconnectionReceipt(receipt){
 assert.equal(receipt.version,1);assert.match(receipt.cloudHead,/^[a-f0-9]{40}$/);
 assert.equal(receipt.cloudDirty,false);assert.equal(receipt.liveResources,false);
 assert.match(receipt.environment.imageId,/^sha256:[a-f0-9]{64}$/);
 assert.ok(receipt.environment.kernel);assert.ok(receipt.environment.docker);
 assert.equal(receipt.trials.length,4);
 for(const [pair,candidate] of [['traffic','peer-traffic'],['reset','peer-reset']]){
  const trials=receipt.trials.filter(t=>t.pair===pair);
  assert.deepEqual(trials.map(t=>t.strategy).sort(),['control',candidate].sort());
  assert.ok(Math.abs(trials[0].handshakeAgeSeconds-trials[1].handshakeAgeSeconds)<=2);
  for(const t of trials){
   assert.ok(Number.isInteger(t.handshakeAgeSeconds)&&t.handshakeAgeSeconds>=30&&t.handshakeAgeSeconds<=32);
   for(const field of ['gatewayReadyMs','recoveryMs','probeIntervalMs'])assert.ok(Number.isFinite(t[field])&&t[field]>0);
   assert.ok(t.recoveryMs>=t.gatewayReadyMs);assert.ok(Number.isInteger(t.failedRequests)&&t.failedRequests>0);
   for(const field of ['gatewayReplaced','keyPreserved','endpointPreserved','bodyMatched'])assert.equal(t[field],true);
   assert.equal(t.peerUnchanged,t.strategy!=='peer-reset');assert.equal(t.status,200);
   assert.match(t.tlsFingerprintBefore,/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
   assert.equal(t.tlsFingerprintAfter,t.tlsFingerprintBefore);
   assert.ok(Number.isInteger(t.peerHandshakeBefore)&&t.peerHandshakeBefore>0);
   assert.ok(Number.isInteger(t.peerHandshakeAfter)&&t.peerHandshakeAfter>t.peerHandshakeBefore);
   assert.ok(Number.isInteger(t.gatewayHandshakeAfter)&&t.gatewayHandshakeAfter>t.peerHandshakeBefore);
  }
 }
 assert.equal(receipt.cleanup.containersRemaining,0);
 for(const field of ['networkRemoved','imageRemoved','temporaryFilesRemoved'])assert.equal(receipt.cleanup[field],true);
 return receipt;
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const file=process.argv[2];if(!file)throw Error('Usage: verify-gateway-reconnection-receipt.mjs RECEIPT.json');
 verifyGatewayReconnectionReceipt(JSON.parse(await readFile(file,'utf8')));console.log('gateway reconnection receipt verified');
}
