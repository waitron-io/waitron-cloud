import assert from 'node:assert/strict';
import test from 'node:test';
import {jointReceipt} from './verify-backup-verifier-proof.test.mjs';
import {verifyBackupVerifierProof} from './verify-backup-verifier-proof.mjs';
import {backupVerificationRequestDigest,backupVerificationTargetDigests} from '../packages/backups/src/verification-protocol.ts';
import {verifierControlsFixture} from './test-fixtures/backup-verifier-controls.mjs';
function rebind(item){
 const digest=backupVerificationRequestDigest(item.request);
 if(item.result){item.result.requestDigest=digest;item.result.attemptToken=item.request.attempt.childToken;item.result.targetDigest=item.request.target.digest;item.result.policyDigest=item.request.target.policyDigest;}
 if(item.receipt){item.receipt.requestDigest=digest;item.receipt.childToken=item.request.attempt.childToken;item.receipt.controllerScope=item.request.attempt.controllerScope;item.receipt.childId=item.childId;}
}
function controlledReceipt(){const r=jointReceipt();r.verifierControls=verifierControlsFixture(r);return r;}
test('accepts same-run control outcomes without calling the remaining proof complete',()=>{
 const r=controlledReceipt(),phase=r.phases.find(p=>p.name==='refusals');phase.state='unavailable';phase.checks=phase.checks.filter(c=>c!=='oom');phase.reason='remaining-oom-control';
 assert.equal(verifyBackupVerifierProof(r,{requireComplete:false}),r);assert.throws(()=>verifyBackupVerifierProof(r),/incomplete/);
});
for(const [name,change] of [
 ['another run',r=>r.verifierControls.runId='older-run'],
 ['another archive',r=>r.verifierControls.archiveSha256='8'.repeat(64)],
 ['another archive size',r=>r.verifierControls.archiveBytes--],
 ['another image',r=>r.verifierControls.candidateImage='sha256:'+'8'.repeat(64)],
 ['another source request',r=>r.verifierControls.sourceRequestDigest='8'.repeat(64)],
 ['missing control',r=>r.verifierControls.cases.pop()],
 ['duplicate control',r=>r.verifierControls.cases[1]=r.verifierControls.cases[0]],
 ['borrowed capture',r=>{const c=r.verifierControls.cases[0];c.request.captureId='other-capture';rebind(c);}],
 ['borrowed target',r=>{const c=r.verifierControls.cases[0];c.request.target.runtime.fingerprint='8'.repeat(64);Object.assign(c.request.target,backupVerificationTargetDigests(c.request.target));rebind(c);}],
 ['borrowed child',r=>{r.verifierControls.cases[1].childId=r.verifierControls.cases[0].childId;rebind(r.verifierControls.cases[1]);}],
 ['borrowed child token',r=>{r.verifierControls.cases[1].request.attempt.childToken=r.verifierControls.cases[0].request.attempt.childToken;rebind(r.verifierControls.cases[1]);}],
 ['borrowed claim',r=>{r.verifierControls.cases[1].request.attempt.claimId=r.verifierControls.cases[0].request.attempt.claimId;rebind(r.verifierControls.cases[1]);}],
 ['primary attempt reused',r=>{r.verifierControls.cases[0].request.attempt.childToken=r.verification.request.attempt.childToken;rebind(r.verifierControls.cases[0]);}],
 ['primary child reused',r=>{r.verifierControls.cases[0].childId=r.verification.receipt.childId;rebind(r.verifierControls.cases[0]);}],
 ['primary claim reused',r=>{r.verifierControls.cases[0].request.attempt.claimId=r.verification.request.attempt.claimId;rebind(r.verifierControls.cases[0]);}],
 ['changed attempt number',r=>{r.verifierControls.cases[0].request.attempt.number++;rebind(r.verifierControls.cases[0]);}],
 ['no actual fault',r=>r.verifierControls.cases[2].faultObserved=false],
 ['uncertain termination',r=>r.verifierControls.cases[4].terminated=false],
 ['uncertain cleanup',r=>r.verifierControls.cases[7].cleanupConfirmed=false],
 ['wrong key passed',r=>{const c=r.verifierControls.cases[0];c.result=structuredClone(r.verifierControls.cases.at(-1).result);rebind(c);}],
 ['damaged archive passed',r=>{const c=r.verifierControls.cases[1];c.result=structuredClone(r.verifierControls.cases.at(-1).result);rebind(c);}],
 ['wrong refusal reason',r=>r.verifierControls.cases[0].result.reason='unexpected'],
 ['unbound output',r=>r.verifierControls.cases[0].result.requestDigest='8'.repeat(64)],
 ['unbound receipt',r=>r.verifierControls.cases[0].receipt.childId='8'.repeat(64)],
 ['unbound scope',r=>r.verifierControls.cases[0].receipt.controllerScope='other-scope'],
 ['invented timeout',r=>r.verifierControls.cases[3].error='backup.verifier_failed'],
 ['refused child published output',r=>r.verifierControls.cases[3].result=r.verifierControls.cases.at(-1).result],
 ['refused child published receipt',r=>r.verifierControls.cases[3].receipt=r.verifierControls.cases.at(-1).receipt],
 ['original archive not rechecked',r=>r.verifierControls.cases.at(-1).result.status='unavailable'],
 ['module coverage lost',r=>r.verifierControls.cases.at(-1).result.modules.pop()],
 ['activation',r=>r.verifierControls.cases.at(-1).result.activation='attempted'],
 ['secret field',r=>r.verifierControls.cases[0].recoveryKey='private'],
 ['secret in control record',r=>r.verifierControls.recoveryKey='private'],
 ['secret in child receipt',r=>r.verifierControls.cases[0].receipt.recoveryKey='private'],
])test('rejects same-run verifier controls with '+name,()=>{
 const r=controlledReceipt();change(r);assert.throws(()=>verifyBackupVerifierProof(r,{requireComplete:false}));
});
test('claimed verifier refusals require their same-run evidence',()=>{
 const r=controlledReceipt();delete r.verifierControls;
 assert.throws(()=>verifyBackupVerifierProof(r,{requireComplete:false}),/verifier refusals require same-run evidence/);
});

for(const [name,change] of [
 ['missing OOM control',r=>r.verifierControls.cases=r.verifierControls.cases.filter(c=>c.name!=='oom')],
 ['missing OOM runtime',r=>delete r.verifierControls.cases.find(c=>c.name==='oom').runtime],
 ['no OOM event',r=>r.verifierControls.cases.find(c=>c.name==='oom').runtime.oomKilled=false],
 ['increased memory limit',r=>r.verifierControls.cases.find(c=>c.name==='oom').runtime.memoryBytes=2147483648],
 ['increased swap limit',r=>r.verifierControls.cases.find(c=>c.name==='oom').runtime.memorySwapBytes=2147483648],
 ['normal child exit',r=>r.verifierControls.cases.find(c=>c.name==='oom').runtime.exitCode=0],
 ['secret in runtime',r=>r.verifierControls.cases.find(c=>c.name==='oom').runtime.recoveryKey='private'],
])test('rejects unproved memory refusal: '+name,()=>{
 const r=controlledReceipt();change(r);assert.throws(()=>verifyBackupVerifierProof(r,{requireComplete:false}));
});
test('an OOM refusal alone requires same-run child evidence',()=>{
 const r=controlledReceipt();delete r.verifierControls;
 const phase=r.phases.find(p=>p.name==='refusals');phase.state='unavailable';phase.checks=['oom'];phase.reason='other-controls-incomplete';
 assert.throws(()=>verifyBackupVerifierProof(r,{requireComplete:false}),/verifier refusals require same-run evidence/);
});

for(const [name,change] of [
 ['false unsupported format',r=>r.verifierControls.cases.find(c=>c.name==='unsupported-format').request.archive.manifestVersion=1],
 ['unsupported archive digest changed',r=>{const c=r.verifierControls.cases.find(c=>c.name==='unsupported-format');c.request.archive.sha256='8'.repeat(64);rebind(c);}],
 ['unsupported key reference changed',r=>{const c=r.verifierControls.cases.find(c=>c.name==='unsupported-format');c.request.backupKey.reference='other-key';rebind(c);}],
 ['unsupported archive version other than control',r=>{const c=r.verifierControls.cases.find(c=>c.name==='unsupported-format');c.request.archive.manifestVersion=3;rebind(c);}],
])test('rejects unbound unsupported outcome: '+name,()=>{
 const r=controlledReceipt();change(r);assert.throws(()=>verifyBackupVerifierProof(r,{requireComplete:false}));
});
