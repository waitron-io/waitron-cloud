import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyGatewayReconnectionReceipt} from './verify-gateway-reconnection-receipt.mjs';

const trial=(pair,strategy)=>({pair,strategy,handshakeAgeSeconds:30,gatewayReadyMs:500,
 recoveryMs:strategy==='peer-reset'?800:95000,failedRequests:2,probeIntervalMs:500,
 gatewayReplaced:true,keyPreserved:true,endpointPreserved:true,peerUnchanged:strategy!=='peer-reset',
 tlsFingerprintBefore:'AA:'.repeat(31)+'AA',tlsFingerprintAfter:'AA:'.repeat(31)+'AA',
 bodyMatched:true,status:200,peerHandshakeBefore:1000,peerHandshakeAfter:1125,gatewayHandshakeAfter:1125});
const receipt=()=>({version:1,cloudHead:'a'.repeat(40),cloudDirty:false,liveResources:false,
 environment:{imageId:'sha256:'+'b'.repeat(64),kernel:'Linux fixture',docker:'fixture'},
 trials:[trial('traffic','control'),trial('traffic','peer-traffic'),trial('reset','control'),trial('reset','peer-reset')],
 cleanup:{containersRemaining:0,networkRemoved:true,imageRemoved:true,temporaryFilesRemoved:true}});

test('accepts paired real HTTPS recovery evidence without choosing a recovery target',()=>{
 assert.equal(verifyGatewayReconnectionReceipt(receipt()).trials.length,4);
 const value=receipt();value.trials[3].recoveryMs=150000;
 assert.doesNotThrow(()=>verifyGatewayReconnectionReceipt(value));
});

for(const [name,mutate] of [
 ['missing matching control',v=>v.trials.splice(2,1)],
 ['duplicate trial',v=>v.trials.push({...v.trials[0]})],
 ['mismatched handshake age',v=>v.trials[1].handshakeAgeSeconds=60],
 ['fresh peer presented as mature',v=>v.trials[0].handshakeAgeSeconds=0],
 ['gateway never replaced',v=>v.trials[0].gatewayReplaced=false],
 ['gateway identity changed',v=>v.trials[0].keyPreserved=false],
 ['endpoint changed',v=>v.trials[0].endpointPreserved=false],
 ['peer mutated during control',v=>v.trials[0].peerUnchanged=false],
 ['reset never applied',v=>v.trials[3].peerUnchanged=true],
 ['no observed outage',v=>v.trials[0].failedRequests=0],
 ['gateway readiness mistaken for recovery',v=>v.trials[0].recoveryMs=100],
 ['non-finite duration',v=>v.trials[0].recoveryMs=NaN],
 ['TLS certificate changed',v=>v.trials[0].tlsFingerprintAfter='BB:'.repeat(31)+'BB'],
 ['wrong upstream reached',v=>v.trials[0].bodyMatched=false],
 ['HTTP failure presented as recovery',v=>v.trials[0].status=503],
 ['old peer handshake',v=>v.trials[0].peerHandshakeAfter=v.trials[0].peerHandshakeBefore],
 ['missing gateway handshake',v=>v.trials[0].gatewayHandshakeAfter=0],
 ['leftover container',v=>v.cleanup.containersRemaining=1],
 ['leftover network',v=>v.cleanup.networkRemoved=false],
 ['leftover image',v=>v.cleanup.imageRemoved=false],
 ['leftover key files',v=>v.cleanup.temporaryFilesRemoved=false],
 ['live resources',v=>v.liveResources=true],
 ['dirty measurement source',v=>v.cloudDirty=true],
 ['missing source revision',v=>v.cloudHead='unknown'],
])test('refuses '+name,()=>{const value=receipt();mutate(value);assert.throws(()=>verifyGatewayReconnectionReceipt(value));});
