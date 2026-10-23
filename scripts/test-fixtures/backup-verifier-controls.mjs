import {createHash,randomUUID} from 'node:crypto';
import {backupVerificationRequestDigest} from '../../packages/backups/src/verification-protocol.ts';
export function verifierControlsFixture(r){
 const names=['wrong-key','archive-integrity','malformed-output','timeout','scratch','cancel','crash','uncertain-cleanup','later-valid'];
 const errors={'malformed-output':'backup.verifier_output',timeout:'backup.verifier_timeout',scratch:'backup.verifier_resource',cancel:'backup.verifier_cancelled',crash:'backup.verifier_container','uncertain-cleanup':'backup.verifier_cleanup'};
 return{runId:r.runId,sourceRequestDigest:r.admission.requestDigest,archiveSha256:r.archive.sha256,archiveBytes:r.archive.bytes,candidateImage:r.candidateImage,cases:names.map((name,index)=>{
  const request={...structuredClone(r.verification.request),attempt:{...r.verification.request.attempt,controllerScope:'control-scope',claimId:'control-claim-'+index,childToken:randomUUID()}};
  const requestDigest=backupVerificationRequestDigest(request),result=structuredClone(r.verification.result);
  result.requestDigest=requestDigest;result.attemptToken=request.attempt.childToken;
  if(name==='wrong-key'){result.status='unavailable';result.reason='decryption_unavailable';result.modules=[];}
  if(name==='archive-integrity'){result.status='invalid';result.reason='archive_digest_mismatch';result.modules=[];result.measuredArchive.sha256='f'.repeat(64);}
  const childId=createHash('sha256').update('control-'+index).digest('hex'),receipt={...r.verification.receipt,childId,requestDigest,controllerScope:request.attempt.controllerScope,childToken:request.attempt.childToken};
  return{name,request,result:errors[name]?null:result,receipt:errors[name]?null:receipt,error:errors[name]??null,childId,terminated:true,cleanupConfirmed:true,faultObserved:true};
 })};
}
