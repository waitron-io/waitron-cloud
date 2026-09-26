import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function verifyRemoteReconcilerReceipt(receipt){
 assert.equal(receipt.version,1);assert.match(receipt.cloudHead,/^[a-f0-9]{40}$/);assert.match(receipt.waitronHead,/^[a-f0-9]{40}$/);assert.equal(receipt.cloudDirty,false);assert.equal(receipt.waitronDirty,false);assert.equal(receipt.liveResources,false);
 assert.equal(receipt.routes.signed,true);assert.ok(receipt.routes.sequences.length>=2);for(let n=1;n<receipt.routes.sequences.length;n++)assert.ok(receipt.routes.sequences[n]>receipt.routes.sequences[n-1]);
 assert.equal(receipt.routes.duplicatePublications,0);assert.equal(receipt.routes.otherVenueIsolated,true);assert.equal(receipt.routes.duplicateWorkerSuppressed,true);
 for(const kind of ['staff','public']){const value=receipt.certificates[kind];assert.match(value.initialSerial,/^[A-Fa-f0-9]+$/);assert.match(value.renewedSerial,/^[A-Fa-f0-9]+$/);assert.notEqual(value.initialSerial,value.renewedSerial);assert.match(value.initialFingerprint,/^(?:[0-9A-F]{2}:)+[0-9A-F]{2}$/);assert.match(value.renewedFingerprint,/^(?:[0-9A-F]{2}:)+[0-9A-F]{2}$/);assert.notEqual(value.initialFingerprint,value.renewedFingerprint);}
 assert.equal(receipt.certificates.staff.installedWithWaitronInterface,true);assert.equal(receipt.certificates.staff.privateKeyStayedInWaitron,true);assert.equal(receipt.certificates.failedRenewalRetained,true);assert.equal(receipt.certificates.hostnameChangeFenced,true);assert.equal(receipt.certificates.expiredLeaseFenced,true);assert.equal(receipt.certificates.reconciledFlowDuplicateIssuances,0);
 assert.equal(receipt.worker.expiredLeaseRecovered,true);assert.equal(receipt.worker.boundedFailureParked,true);assert.equal(receipt.worker.parkedAfterAttempts,8);assert.ok(receipt.checks.length>=10);return receipt;
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){const file=process.argv[2];if(!file)throw new Error('Usage: verify-remote-reconciler-receipt.mjs RECEIPT.json');verifyRemoteReconcilerReceipt(JSON.parse(await readFile(file,'utf8')));console.log('remote reconciler receipt verified');}
