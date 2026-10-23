import assert from 'node:assert/strict';
import test from 'node:test';
import {jointReceipt} from './verify-backup-verifier-proof.test.mjs';
import {verifyBackupVerifierProof} from './verify-backup-verifier-proof.mjs';

function authorisedReceipt(){
 const r=jointReceipt();
 // Preserve the genuine no-authority refusal; a separate operation must not erase it.
 const phase=r.phases.find(p=>p.name==='recovery');phase.state='unavailable';phase.checks=['no-activation','no-route-movement'];phase.reason='FISCAL_RESTORE';r.recovery.ordinaryRestore='FISCAL_RESTORE';
 r.authorisedRecovery={runId:r.runId,archiveSha256:r.archive.sha256,archiveBytes:r.archive.bytes,pointId:r.archive.pointId,attemptId:r.admission.attemptId,client:'pinned-compiled-waitron',ordinaryActivation:'executed-with-separate-authority',routeMoved:false,cloudReportedRestored:false,
  delivery:{sha256:r.archive.sha256,bytes:r.archive.bytes,source:'private-delivery',matchedCapture:true},
  ordinaryRestore:{exit:0,preparationBoundToRecapture:true,retiredCounters:[123,123,123],activeCounters:[1,1,1],allocations:2},
  refusals:{wrongNodeKey:{exit:1,code:'promotion.break_glass_invalid',destinationPreserved:true},missingPreparation:{code:'sif.allocation_invalid',reason:'outside_confirmation_missing',destinationPreserved:true}},
 };
 return r;
}
function completeAuthorisedReceipt(){
 const r=authorisedReceipt();
 r.recovery.placement='not-run';
 const phase=r.phases.find(p=>p.name==='recovery');
 phase.state='executed';phase.checks=['ordinary-restore','separate-authority','no-activation','no-route-movement'];phase.reason=null;
 return r;
}
test('certifies separately authorised delivery and restore while retaining the primary fiscal refusal',()=>{
 const r=completeAuthorisedReceipt();
 assert.equal(verifyBackupVerifierProof(r),r);
 assert.equal(r.recovery.ordinaryRestore,'FISCAL_RESTORE');
 assert.equal(r.recovery.placement,'not-run');
 assert.equal(r.recovery.activation,'not_attempted');
 assert.equal(r.authorisedRecovery.ordinaryActivation,'executed-with-separate-authority');
});
for(const [name,change] of [
 ['missing separate authority',r=>delete r.authorisedRecovery],
 ['unperformed primary restore',r=>r.recovery.ordinaryRestore='not-run'],
 ['primary placement despite fiscal refusal',r=>r.recovery.placement='executed'],
 ['missing primary no-activation check',r=>r.phases.find(p=>p.name==='recovery').checks.splice(2,1)],
 ['unbound delivered archive',r=>r.authorisedRecovery.delivery.matchedCapture=false],
 ['failed authorised restore',r=>r.authorisedRecovery.ordinaryRestore.exit=1],
 ['missing authorised key denial',r=>delete r.authorisedRecovery.refusals.wrongNodeKey],
])test('cannot certify separate recovery with '+name,()=>{
 const r=completeAuthorisedReceipt();change(r);assert.throws(()=>verifyBackupVerifierProof(r,{requireComplete:false}));
});
test('retains same-run separately authorised recovery without replacing the no-authority refusal',()=>{
 const r=authorisedReceipt();assert.equal(verifyBackupVerifierProof(r,{requireComplete:false}),r);assert.throws(()=>verifyBackupVerifierProof(r),/incomplete/);
});
for(const [name,change] of [
 ['borrowed run',r=>r.authorisedRecovery.runId='older-run'],
 ['substituted archive',r=>r.authorisedRecovery.archiveSha256='9'.repeat(64)],
 ['substituted size',r=>r.authorisedRecovery.archiveBytes--],
 ['substituted point',r=>r.authorisedRecovery.pointId='other-point'],
 ['substituted attempt',r=>r.authorisedRecovery.attemptId='other-attempt'],
 ['invented client',r=>r.authorisedRecovery.client='invented-client'],
 ['unbound preparation',r=>r.authorisedRecovery.ordinaryRestore.preparationBoundToRecapture=false],
 ['changed retained counter',r=>r.authorisedRecovery.ordinaryRestore.retiredCounters[0]=1],
 ['missing new allocation',r=>r.authorisedRecovery.ordinaryRestore.allocations=1],
 ['capture used instead of delivery',r=>r.authorisedRecovery.delivery.source='local-original'],
 ['unmatched delivery',r=>r.authorisedRecovery.delivery.matchedCapture=false],
 ['different delivery digest',r=>r.authorisedRecovery.delivery.sha256='9'.repeat(64)],
 ['different delivery size',r=>r.authorisedRecovery.delivery.bytes--],
 ['missing wrong-key refusal',r=>delete r.authorisedRecovery.refusals.wrongNodeKey],
 ['changed destination',r=>r.authorisedRecovery.refusals.missingPreparation.destinationPreserved=false],
 ['unacknowledged activation',r=>r.authorisedRecovery.ordinaryActivation='not_attempted'],
 ['route movement',r=>r.authorisedRecovery.routeMoved=true],
 ['restored report',r=>r.authorisedRecovery.cloudReportedRestored=true],
 ['secret field',r=>r.authorisedRecovery.recoveryKey='private'],
])test('refuses authorised recovery evidence with '+name,()=>{
 const r=authorisedReceipt();change(r);assert.throws(()=>verifyBackupVerifierProof(r,{requireComplete:false}));
});
