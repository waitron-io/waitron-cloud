import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifySnapshotVerifierControls} from './verify-snapshot-verifier-controls.mjs';
import {pathToFileURL} from 'node:url';
import {readVerificationTarget} from '../packages/backups/src/verification-target.ts';
import {readBackupVerificationRequest,readBackupVerificationResult,backupVerificationRequestDigest} from '../packages/backups/src/verification-protocol.ts';
const pinned=readVerificationTarget(await readFile(new URL('../deploy/backup-verifier/target.json',import.meta.url),'utf8'));
const requirements={
 capture:['encrypted-archive','network-denied'],
 publication:['signed-publication','immutable-storage'],
 verification:['bound-sandbox','complete-module-checks','child-removed'],
 admission:['transaction-committed','current-qualification'],
 catalogue:['api-verified','api-default-point'],
 approval:['owner-v2','selected-attempt'],
 read:['pinned-compiled-waitron-client','target-before-placement','independent-digest'],
 placement:['genuine-data-placed','integrity-checked'],
 recovery:['ordinary-restore','separate-authority','no-activation','no-route-movement'],
 refusals:['alternate-target-before-placement','archive-integrity','wrong-key','authority-no-activation','malformed-output','timeout','oom','scratch','cancel','crash','uncertain-cleanup'],
};
const hash=/^[a-f0-9]{64}$/,commit=/^[a-f0-9]{40}$/,image=/^sha256:[a-f0-9]{64}$/;
function exact(value,fields){assert(value&&typeof value==='object'&&!Array.isArray(value),'joint proof object required');assert.deepEqual(Object.keys(value).sort(),fields.split(',').sort(),'unexpected or missing joint proof fields');}
function identifier(value){assert(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value),'joint proof identifier required');}
function equal(value,expected,label){assert.deepEqual(value,expected,label);}

// Incomplete evidence is inspectable, but the default release check never accepts it.
export function verifyBackupVerifierProof(value,{requireComplete=true}={}){
 exact(value,'version,runId,cloudHead,cloudTree,cloudDirty,waitronTarget,candidateImage,publication,archive,continuous,phases,verification,admission,recovery,cleanup'+(Object.hasOwn(value,'authorisedRecovery')?',authorisedRecovery':'')+(Object.hasOwn(value,'verifierControls')?',verifierControls':''));
 equal(value.version,2,'legacy proof cannot certify bound verification');identifier(value.runId);
 assert(commit.test(value.cloudHead)&&commit.test(value.cloudTree)&&typeof value.cloudDirty==='boolean','Cloud source identity required');
 equal(readVerificationTarget(JSON.stringify(value.waitronTarget)),pinned,'complete pinned Waitron target required');
 assert(image.test(value.candidateImage),'immutable candidate image required');
 equal(value.publication,'unqualified','local candidate is not published-image qualification');
 const archive=value.archive;exact(archive,'kind,captureId,pointId,sourceNodeId,sha256,bytes,modules');
 equal(archive.kind,'genuine-waitron','genuine capture required');for(const name of ['captureId','pointId','sourceNodeId'])identifier(archive[name]);
 assert(hash.test(archive.sha256)&&Number.isSafeInteger(archive.bytes)&&archive.bytes>0,'measured archive required');
 exact(value.continuous,'streamObjects,pointerRows,observations');
 equal(value.continuous.streamObjects,0,'continuous source must be absent');equal(value.continuous.pointerRows,0,'continuous pointer must be absent');
 equal(value.continuous.observations,['capture','publication','verification','admission','catalogue','approval','read','placement','recovery'],'continuous absence must be observed throughout');
 assert(Array.isArray(value.phases),'individual phase evidence required');
 equal(value.phases.map(p=>p.name),Object.keys(requirements),'every phase must have one disposition');
 let complete=true;
 for(const phase of value.phases){
  exact(phase,'name,state,runId,checks,reason');equal(phase.runId,value.runId,'phases from different runs cannot be combined');
  assert(['executed','unavailable','not-run'].includes(phase.state),'phase must distinguish execution, unavailability and no run');
  assert(Array.isArray(phase.checks)&&new Set(phase.checks).size===phase.checks.length,'unique executed assertions required');
  assert(phase.checks.every(check=>requirements[phase.name].includes(check)),'unknown phase assertion');
  if(phase.state==='executed'){
   equal([...phase.checks].sort(),[...requirements[phase.name]].sort(),'executed phase lacks required assertions');equal(phase.reason,null,'executed phase cannot carry a refusal');
  }else{
   complete=false;identifier(phase.reason);
   if(phase.state==='not-run')equal(phase.checks,[],'not-run phase cannot claim assertions');
  }
 }
 const states=Object.fromEntries(value.phases.map(p=>[p.name,p.state]));
 const verification=value.verification;
 if(verification!==null){
  exact(verification,'request,result,receipt');
  const request=readBackupVerificationRequest(JSON.stringify(verification.request));equal(request.target,pinned,'verifier target mismatch');
  equal(request.verifierImage,'local.waitron-verifier@'+value.candidateImage,'verifier image mismatch');
  equal(request.archive.environment,'preproduction','local proof cannot use production data');
  for(const name of ['captureId','pointId','sourceNodeId'])equal(request[name],archive[name],'archive identity mismatch');
  equal(request.archive.sha256,archive.sha256,'archive digest mismatch');equal(request.archive.bytes,archive.bytes,'archive size mismatch');equal(request.archive.modules,archive.modules,'archive module map mismatch');
  const result=readBackupVerificationResult(JSON.stringify(verification.result),request),receipt=verification.receipt,digest=backupVerificationRequestDigest(request);
  exact(receipt,'childId,imageId,requestDigest,controllerScope,childToken,terminated,cleanupConfirmed');assert(hash.test(receipt.childId),'exact child ID required');
  equal(receipt.imageId,value.candidateImage,'child image mismatch');equal(receipt.requestDigest,digest,'child request mismatch');
  equal(receipt.controllerScope,request.attempt.controllerScope,'controller scope mismatch');equal(receipt.childToken,request.attempt.childToken,'child token mismatch');
  equal(receipt.terminated,true,'child termination required');equal(receipt.cleanupConfirmed,true,'child cleanup required');
  if(states.verification==='executed')equal(result.status,'passed','completed genuine verification required');
 }else assert(states.verification!=='executed','executed verification needs actual bound output');
 const admission=value.admission;
 if(admission!==null){
  exact(admission,'attemptId,requestDigest,pointId,targetDigest,verification');identifier(admission.attemptId);
  assert(verification&&verification.result.status==='passed','admission requires passed bound output');
  equal(admission.requestDigest,backupVerificationRequestDigest(verification.request),'admission request mismatch');equal(admission.pointId,archive.pointId,'admission point mismatch');equal(admission.targetDigest,pinned.digest,'admission target mismatch');equal(admission.verification,'verified','current qualification required');
 }else assert(states.admission!=='executed','executed admission needs a committed attempt');
 const recovery=value.recovery;
 if(recovery!==null){
  exact(recovery,'protocolVersion,pointId,attemptId,targetDigest,readDigest,readBytes,client,placement,ordinaryRestore,activation,routeMoved');
  assert(admission,'recovery must use admitted evidence');equal(recovery.protocolVersion,2,'v2 recovery required');
  equal(recovery.pointId,archive.pointId,'recovery point mismatch');equal(recovery.attemptId,admission.attemptId,'selected attempt mismatch');equal(recovery.targetDigest,pinned.digest,'recovery target mismatch');
  equal(recovery.readDigest,archive.sha256,'independent read digest mismatch');equal(recovery.readBytes,archive.bytes,'independent read size mismatch');equal(recovery.client,'pinned-compiled-waitron','actual pinned client required');
  equal(recovery.activation,'not_attempted','verification grants no activation');equal(recovery.routeMoved,false,'verification grants no route movement');
  equal(recovery.placement,states.placement==='executed'?'executed':'not-run','placement disposition mismatch');
  assert(['executed','FISCAL_RESTORE','not-run'].includes(recovery.ordinaryRestore),'ordinary restore disposition required');
  equal(recovery.ordinaryRestore==='executed',states.recovery==='executed','ordinary restore phase mismatch');
  if(recovery.ordinaryRestore==='FISCAL_RESTORE')equal(value.phases.find(p=>p.name==='recovery').reason,'FISCAL_RESTORE','fiscal refusal must be explicit');
 }else assert(!['approval','read','placement','recovery'].some(name=>states[name]==='executed'),'executed recovery phases need bound recovery evidence');
 if(Object.hasOwn(value,'authorisedRecovery')){
  const authorised=value.authorisedRecovery;
  exact(authorised,'runId,archiveSha256,archiveBytes,pointId,attemptId,client,ordinaryActivation,routeMoved,cloudReportedRestored,delivery,ordinaryRestore,refusals');
  assert(admission&&recovery,'authorised recovery requires the same admitted delivery');
  equal(authorised.runId,value.runId,'authorised recovery cannot borrow another run');
  equal(authorised.archiveSha256,archive.sha256,'authorised archive mismatch');equal(authorised.archiveBytes,archive.bytes,'authorised archive size mismatch');
  equal(authorised.pointId,archive.pointId,'authorised point mismatch');equal(authorised.attemptId,admission.attemptId,'authorised attempt mismatch');
  equal(authorised.client,'pinned-compiled-waitron','authorised recovery requires the real client');
  equal(authorised.ordinaryActivation,'executed-with-separate-authority','ordinary activation must be distinguished from verification');
  equal(authorised.routeMoved,false,'authorised fixture grants no route movement');equal(authorised.cloudReportedRestored,false,'authorised fixture cannot report Cloud activation');
  equal(authorised.delivery,{sha256:archive.sha256,bytes:archive.bytes,source:'private-delivery',matchedCapture:true},'authorised recovery requires exact delivered bytes');
  equal(authorised.ordinaryRestore,{exit:0,preparationBoundToRecapture:true,retiredCounters:[123,123,123],activeCounters:[1,1,1],allocations:2},'authorised fixture restore invariant failed');
  equal(authorised.refusals,{wrongNodeKey:{exit:1,code:'promotion.break_glass_invalid',destinationPreserved:true},missingPreparation:{code:'sif.allocation_invalid',reason:'outside_confirmation_missing',destinationPreserved:true}},'separate authority refusals required');
 }
 if(value.phases.find(p=>p.name==='refusals').checks.some(check=>['wrong-key','malformed-output','timeout','scratch','cancel','crash','uncertain-cleanup'].includes(check)))assert(Object.hasOwn(value,'verifierControls'),'verifier refusals require same-run evidence');
 if(Object.hasOwn(value,'verifierControls'))verifySnapshotVerifierControls(value.verifierControls,value);
 exact(value.cleanup,'confirmed,containers,volumes,networks,directories');equal(value.cleanup.confirmed,true,'owned cleanup must be confirmed');
 for(const name of ['containers','volumes','networks','directories'])equal(value.cleanup[name],0,'owned resources remain');
 if(requireComplete)assert(complete,'joint backup verification and recovery proof is incomplete');
 return value;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3)throw Error('Usage: node scripts/verify-backup-verifier-proof.mjs RECEIPT.json');
 verifyBackupVerifierProof(JSON.parse(await readFile(process.argv[2],'utf8')));console.log('Verified complete joint backup proof');
}
