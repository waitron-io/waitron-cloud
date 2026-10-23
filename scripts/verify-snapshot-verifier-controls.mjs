import assert from 'node:assert/strict';
import {backupVerificationRequestDigest,readBackupVerificationRequest,readBackupVerificationResult} from '../packages/backups/src/verification-protocol.ts';
const names=['wrong-key','archive-integrity','malformed-output','timeout','scratch','cancel','crash','uncertain-cleanup','oom','unsupported-format','later-valid'];
const errors={oom:'backup.verifier_resource','malformed-output':'backup.verifier_output',timeout:'backup.verifier_timeout',scratch:'backup.verifier_resource',cancel:'backup.verifier_cancelled',crash:'backup.verifier_container','uncertain-cleanup':'backup.verifier_cleanup'};
function exact(value,fields){assert(value&&typeof value==='object'&&!Array.isArray(value),'control evidence required');assert.deepEqual(Object.keys(value).sort(),fields.split(',').sort(),'unexpected or missing control fields');}
// A negative result belongs to its own child, but must retain the joint run's exact source and target.
export function verifySnapshotVerifierControls(value,joint){
 exact(value,'runId,sourceRequestDigest,archiveSha256,archiveBytes,candidateImage,cases');
 assert(joint.verification&&joint.admission,'controls require admitted source evidence');
 assert.equal(value.runId,joint.runId,'controls cannot borrow another run');assert.equal(value.sourceRequestDigest,joint.admission.requestDigest,'controls require the source request');
 assert.equal(value.archiveSha256,joint.archive.sha256,'control archive mismatch');assert.equal(value.archiveBytes,joint.archive.bytes,'control archive size mismatch');assert.equal(value.candidateImage,joint.candidateImage,'control candidate mismatch');
 assert(Array.isArray(value.cases),'individual control outcomes required');assert.deepEqual(value.cases.map(c=>c.name),names,'every control needs one result');
 const ids=new Set([joint.verification.receipt.childId]),tokens=new Set([joint.verification.request.attempt.childToken]),claims=new Set([joint.verification.request.attempt.claimId]);
 for(const item of value.cases){
  exact(item,'name,request,result,receipt,error,childId,terminated,cleanupConfirmed,faultObserved'+(item.name==='oom'?',runtime':''));
  if(item.name==='oom')assert.deepEqual(item.runtime,{oomKilled:true,memoryBytes:1073741824,memorySwapBytes:1073741824,exitCode:137},'OOM requires the exact bounded runtime event');
  const request=readBackupVerificationRequest(JSON.stringify(item.request)),{attempt,...identity}=request,{attempt:sourceAttempt,...sourceIdentity}=joint.verification.request;
  if(item.name==='unsupported-format'){
   assert.equal(identity.archive.manifestVersion,2,'the unsupported control declares format 2');
   identity.archive={...identity.archive,manifestVersion:sourceIdentity.archive.manifestVersion};
  }
  assert.deepEqual(identity,sourceIdentity,'control source or target changed');
  const {claimId,controllerScope,childToken,deadline,...rest}=attempt,{claimId:_claim,controllerScope:_scope,childToken:_token,deadline:_deadline,...sourceRest}=sourceAttempt;
  assert.deepEqual(rest,sourceRest,'control attempt binding changed');
  assert(/^[a-f0-9]{64}$/.test(item.childId)&&!ids.has(item.childId),'unique exact control child required');ids.add(item.childId);
  assert(!tokens.has(childToken),'unique control child token required');tokens.add(childToken);assert(!claims.has(claimId),'unique control claim required');claims.add(claimId);
  for(const flag of ['terminated','cleanupConfirmed','faultObserved'])assert.equal(item[flag],true,'unconfirmed control '+flag);
  if(item.name in errors){
   assert.equal(item.error,errors[item.name],'control error mismatch');assert.equal(item.result,null,'refused child cannot publish a result');assert.equal(item.receipt,null,'refused child cannot publish a success receipt');
  }else{
   assert.equal(item.error,null,'verdict control cannot carry a process error');
   const result=readBackupVerificationResult(JSON.stringify(item.result),request),digest=backupVerificationRequestDigest(request);
   const [status,reason]=item.name==='unsupported-format'?['unsupported','archive_format_unsupported']:item.name==='wrong-key'?['unavailable','decryption_unavailable']:item.name==='archive-integrity'?['invalid','archive_digest_mismatch']:['passed','none'];
   assert.equal(result.status,status,'control status mismatch');assert.equal(result.reason,reason,'control reason mismatch');
   exact(item.receipt,'childId,imageId,requestDigest,controllerScope,childToken,terminated,cleanupConfirmed');
   assert.deepEqual(item.receipt,{childId:item.childId,imageId:value.candidateImage,requestDigest:digest,controllerScope,childToken,terminated:true,cleanupConfirmed:true},'control child receipt mismatch');
  }
 }
 return value;
}
