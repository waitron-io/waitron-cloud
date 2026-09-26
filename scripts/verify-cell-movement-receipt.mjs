import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=process.argv[2]?await readFile(process.argv[2],'utf8'):await new Promise((resolve,reject)=>{
 let value='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>value+=chunk);process.stdin.on('end',()=>resolve(value));process.stdin.on('error',reject);
});
const receipt=JSON.parse(source),movement=receipt.movement;
assert.match(receipt.cloudHead,/^[0-9a-f]{40}$/,'invalid Cloud head');
assert.equal(receipt.cloudDirty,false,'Cloud checkout was dirty');
assert.ok(movement&&typeof movement==='object','missing cell movement receipt');
assert.equal(movement.version,1);
assert.deepEqual(movement.failedApply,{cancelled:true,sourceStayedHealthy:true,destinationRemoved:true});
assert.equal(movement.hostnamesPreserved,true);
assert.equal(movement.certificatesPreserved,true);
assert.equal(movement.otherVenueIsolated,true);
assert.equal(movement.oldRouteRevoked,true);
assert.equal(movement.completedReplayMatched,true);
assert.ok(Number.isInteger(movement.reconnectionMs)&&movement.reconnectionMs>=0,'invalid movement reconnectionMs');
const sequences=movement.sequences;
for(const name of ['initialSource','failedTarget','cancelledTarget','stagedTarget','committedSource','committedTarget'])assert.ok(Number.isSafeInteger(sequences?.[name])&&sequences[name]>0,`invalid ${name} sequence`);
assert.ok(sequences.cancelledTarget>sequences.failedTarget,'cancel did not publish a newer destination manifest');
assert.ok(sequences.stagedTarget>sequences.cancelledTarget,'committed attempt did not use a fresh destination manifest');
assert.ok(sequences.committedSource>sequences.initialSource,'source revocation manifest did not advance');
assert.ok(sequences.committedTarget>sequences.stagedTarget,'destination commit manifest did not advance');
console.log(`Verified local cell movement in ${movement.reconnectionMs} ms.`);
