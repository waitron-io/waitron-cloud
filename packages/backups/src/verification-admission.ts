import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {point,type BackupPoint} from './catalogue.ts';
import {backupVerificationRequestDigest,readBackupVerificationRequest,readBackupVerificationResult,validateBackupVerificationTarget,type BackupVerificationRequest,type BackupVerificationResult,type BackupVerificationTarget,type BackupVerificationReason} from './verification-protocol.ts';
import type {VerifiedChildOutput} from './container-verifier.ts';

export interface VerificationAttempt {
 readonly id:string;
 readonly request:BackupVerificationRequest;
 readonly policyRevision:number;
 readonly point:BackupPoint;
}
export interface VerificationClaim {id:string;venueId:string;pointId:string;claimId:string;number:number;controllerScope:string;}
type Verdict='verified'|'failed'|'unavailable'|'stale';
function metadata(p:BackupPoint){
 return {objectKey:p.objectKey,retention:p.retention,venueId:p.venueId,installationId:p.installationId,keyVersion:p.keyVersion,digest:p.digest,size:p.size,capturedAt:p.capturedAt,sourceNodeId:p.sourceNodeId,modules:p.modules};
}
export async function lockVerificationPolicy(client:PoolClient){
 return (await client.query('SELECT * FROM backup_verification_policy WHERE id=1 FOR SHARE')).rows[0];
}
/** Caller owns the transaction. Policy precedes venue, job and point locks. */
export async function setVerificationPolicy(client:PoolClient,target:BackupVerificationTarget,image:string,releaseReady:boolean):Promise<number>{
 const validated=validateBackupVerificationTarget(target);
 if(typeof image!=='string'||image.length>256||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(image)||typeof releaseReady!=='boolean')throw Error('backup.verifier_configuration');
 const row=(await client.query('UPDATE backup_verification_policy SET revision=revision+1,target=$1,verifier_image=$2,release_ready=$3 WHERE id=1 RETURNING revision',[validated,image,releaseReady])).rows[0];
 if(!row||!Number.isSafeInteger(Number(row.revision)))throw Error('backup.verifier_configuration');
 await client.query(`UPDATE backup_jobs SET status='pending',attempts=0,claim_id=NULL,lease_until=NULL,available_at=clock_timestamp()
  WHERE kind='verify' AND EXISTS(SELECT 1 FROM backup_points p WHERE p.id=target_id AND p.kind='snapshot' AND NOT p.deleting AND p.deleted_at IS NULL)`);
 return Number(row.revision);
}
async function lockedPoint(client:PoolClient,claim:VerificationClaim){
 const venue=(await client.query('SELECT l.venue_id,v.environment FROM backup_locations l JOIN venues v ON v.id=l.venue_id WHERE l.venue_id=$1 FOR UPDATE OF l',[claim.venueId])).rows[0];
 if(!venue||venue.environment!=='test')return;
 await client.query('SELECT id FROM backup_jobs WHERE id=$1 FOR UPDATE',[claim.id]);
 await client.query('SELECT id FROM backup_points WHERE id=$1 FOR UPDATE',[claim.pointId]);
 const job=(await client.query(`SELECT *,lease_until>clock_timestamp() AS live FROM backup_jobs WHERE id=$1`,[claim.id])).rows[0];
 const p=await point(client,claim.pointId);
 if(!job||job.kind!=='verify'||job.venue_id!==claim.venueId||job.target_id!==claim.pointId||job.status!=='running'||job.claim_id!==claim.claimId||job.attempts!==claim.number||!job.live||!p||p.kind!=='snapshot'||p.venueId!==claim.venueId||p.deleting||p.deletedAt)return;
 const capture=(await client.query('SELECT venue_id,installation_id,key_version FROM backup_captures WHERE id=$1 FOR SHARE',[p.id])).rows[0];
 if(!capture||capture.venue_id!==p.venueId||capture.installation_id!==p.installationId||capture.key_version!==p.keyVersion)return;
 const key=await client.query('SELECT version FROM backup_key_versions WHERE venue_id=$1 AND version=$2 FOR SHARE',[p.venueId,p.keyVersion]);
 if(!key.rowCount)return;
 return {job,point:p};
}
export async function prepareVerification(client:PoolClient,claim:VerificationClaim):Promise<VerificationAttempt|undefined>{
 const policy=await lockVerificationPolicy(client);
 if(!policy?.target)return;
 const locked=await lockedPoint(client,claim);if(!locked)return;
 // Re-read PostgreSQL time after every blocking lock, including capture/key locks.
 const live=(await client.query("SELECT lease_until>clock_timestamp() AS live,LEAST(lease_until,clock_timestamp()+interval '30 seconds') AS deadline FROM backup_jobs WHERE id=$1",[claim.id])).rows[0];
 if(!live.live)return;
 const p=locked.point;
 const request=readBackupVerificationRequest(JSON.stringify({protocol:'backup-data-restore/v1',captureId:p.id,pointId:p.id,venueId:p.venueId,sourceInstallationId:p.installationId,sourceNodeId:p.sourceNodeId,capturedAt:p.capturedAt,
 archive:{sha256:p.digest,bytes:p.size,manifestVersion:1,environment:'preproduction',modules:p.modules},backupKey:{version:p.keyVersion,reference:`cloud-backup:${p.venueId}:${p.keyVersion}`},target:policy.target,verifierImage:policy.verifier_image,
 attempt:{jobId:claim.id,number:claim.number,claimId:claim.claimId,controllerScope:claim.controllerScope,childToken:randomUUID(),deadline:live.deadline.toISOString()}}));
 const id=randomUUID(),revision=Number(policy.revision);
 if(!Number.isSafeInteger(revision)||revision<1)throw Error('backup.verifier_configuration');
 const inserted=await client.query(`INSERT INTO backup_verification_attempts(id,point_id,job_id,protocol,request,request_digest,point_metadata,target_digest,policy_revision,verifier_image,claim_id,attempt_number,controller_scope,child_token,deadline)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(job_id,claim_id) DO NOTHING`,[id,p.id,claim.id,request.protocol,request,backupVerificationRequestDigest(request),metadata(p),request.target.digest,revision,request.verifierImage,claim.claimId,claim.number,claim.controllerScope,request.attempt.childToken,request.attempt.deadline]);
 if(!inserted.rowCount)return;
 const snapshot=structuredClone(p);Object.freeze(snapshot.modules);Object.freeze(snapshot);
 return Object.freeze({id,request,policyRevision:revision,point:snapshot});
}
async function fence(client:PoolClient,attempt:VerificationAttempt){
 let request:BackupVerificationRequest;
 try{request=readBackupVerificationRequest(JSON.stringify(attempt.request));}catch{return;}
 const policy=await lockVerificationPolicy(client);
 if(!policy||Number(policy.revision)!==attempt.policyRevision||policy.verifier_image!==request.verifierImage||!isDeepStrictEqual(policy.target,request.target))return;
 const a=request.attempt;
 const locked=await lockedPoint(client,{id:a.jobId,venueId:request.venueId,pointId:request.pointId,claimId:a.claimId,number:a.number,controllerScope:a.controllerScope});
 if(!locked||attempt.point.id!==request.pointId||!isDeepStrictEqual(metadata(locked.point),metadata(attempt.point)))return;
 const row=(await client.query('SELECT * FROM backup_verification_attempts WHERE id=$1 FOR UPDATE',[attempt.id])).rows[0];
 if(!row||row.state!=='running'||row.point_id!==request.pointId||row.job_id!==a.jobId||row.claim_id!==a.claimId||Number(row.attempt_number)!==a.number||row.controller_scope!==a.controllerScope||row.child_token!==a.childToken||row.deadline.toISOString()!==a.deadline||row.protocol!==request.protocol||row.request_digest!==backupVerificationRequestDigest(request)||Number(row.policy_revision)!==attempt.policyRevision||row.verifier_image!==request.verifierImage||row.target_digest!==request.target.digest||!isDeepStrictEqual(row.request,request)||!isDeepStrictEqual(row.point_metadata,metadata(locked.point)))return;
 const p=locked.point;
 if(request.captureId!==p.id||request.sourceInstallationId!==p.installationId||request.sourceNodeId!==p.sourceNodeId||request.capturedAt!==p.capturedAt||request.archive.sha256!==p.digest||request.archive.bytes!==p.size||request.archive.manifestVersion!==1||request.archive.environment!=='preproduction'||!isDeepStrictEqual(request.archive.modules,p.modules)||request.backupKey.version!==p.keyVersion||request.backupKey.reference!==`cloud-backup:${p.venueId}:${p.keyVersion}`)return;
 const live=(await client.query('SELECT lease_until>clock_timestamp() AND $2::timestamptz>clock_timestamp() AS live FROM backup_jobs WHERE id=$1',[a.jobId,a.deadline])).rows[0];
 if(!live?.live)return;
 return {request,point:p};
}
async function finish(client:PoolClient,attempt:VerificationAttempt,status:BackupVerificationResult['status'],reason:BackupVerificationReason,result:BackupVerificationResult|null,child:string|null):Promise<Verdict>{
 const lease=(await client.query('SELECT lease_until FROM backup_jobs WHERE id=$1',[attempt.request.attempt.jobId])).rows[0].lease_until;
 await client.query('SAVEPOINT backup_verification_admission');
 const verdict=status==='passed'?'verified':status==='invalid'?'failed':'unavailable';
 await client.query(`UPDATE backup_verification_attempts SET state='finished',status=$2,reason=$3,result=$4,child_id=$5,cleanup_confirmed=$6,finished_at=clock_timestamp(),admitted_at=clock_timestamp() WHERE id=$1`,[attempt.id,status,reason,result,child,child!==null]);
 if(verdict!=='unavailable')await client.query('INSERT INTO backup_verifications(id,point_id,digest,verifier,outcome) VALUES($1,$2,$3,$4,$5)',[randomUUID(),attempt.point.id,attempt.point.digest,attempt.request.verifierImage,verdict]);
 // Inconclusive work removes success; deterministic invalid evidence remains a failure.
 await client.query(`UPDATE backup_points p SET last_attempt_id=$2,current_evidence_id=CASE WHEN $3<>'unavailable' THEN $2::uuid
  WHEN EXISTS(SELECT 1 FROM backup_verification_attempts a WHERE a.id=p.current_evidence_id AND a.status='invalid') THEN p.current_evidence_id ELSE NULL END,
  verification=CASE WHEN $3<>'unavailable' THEN $3 WHEN EXISTS(SELECT 1 FROM backup_verification_attempts a WHERE a.id=p.current_evidence_id AND a.status='invalid') THEN 'failed' ELSE 'pending' END WHERE id=$1`,[attempt.point.id,attempt.id,verdict]);
 if(verdict==='verified')await client.query(`UPDATE backup_jobs SET status='pending',attempts=0,last_error=NULL,claim_id=NULL,lease_until=NULL,last_success_at=clock_timestamp(),available_at=clock_timestamp()+interval '7 days' WHERE id=$1`,[attempt.request.attempt.jobId]);
 else if(reason==='cancelled')await client.query(`UPDATE backup_jobs SET status='pending',attempts=GREATEST(0,attempts-1),claim_id=NULL,lease_until=NULL,available_at=clock_timestamp() WHERE id=$1`,[attempt.request.attempt.jobId]);
 else await client.query(`UPDATE backup_jobs SET failures=failures+1,last_error=$2,status=CASE WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,
  available_at=clock_timestamp()+LEAST(900,30*power(2,attempts-1))*interval '1 second',claim_id=NULL,lease_until=NULL WHERE id=$1`,[attempt.request.attempt.jobId,verdict==='failed'?'verification_failed':'verification_unavailable']);
 // Inserts can wait on database locks too. Expiry must undo the whole outcome.
 const live=(await client.query('SELECT clock_timestamp()<$1::timestamptz AND clock_timestamp()<$2::timestamptz AS live',[lease,attempt.request.attempt.deadline])).rows[0].live;
 if(!live)await client.query('ROLLBACK TO SAVEPOINT backup_verification_admission');
 await client.query('RELEASE SAVEPOINT backup_verification_admission');
 return live?verdict:'stale';
}
export async function admitVerification(client:PoolClient,attempt:VerificationAttempt,output:VerifiedChildOutput):Promise<Verdict>{
 if(!await fence(client,attempt))return 'stale';
 let result:BackupVerificationResult,child:string;
 try{
  const r=output.receipt,q=attempt.request;
  if(!r||!/^[a-f0-9]{64}$/.test(r.childId)||r.imageId!==q.verifierImage.slice(q.verifierImage.lastIndexOf('@')+1)||r.requestDigest!==backupVerificationRequestDigest(q)||r.controllerScope!==q.attempt.controllerScope||r.childToken!==q.attempt.childToken||r.terminated!==true||r.cleanupConfirmed!==true)throw Error();
  result=readBackupVerificationResult(JSON.stringify(output.result),q);child=r.childId;
 }catch{return finish(client,attempt,'unavailable','cleanup_uncertain',null,null);}
 return finish(client,attempt,result.status,result.reason,result,child);
}
export async function recordVerificationUnavailable(client:PoolClient,attempt:VerificationAttempt,reason:BackupVerificationReason):Promise<Verdict>{
 if(!['request_invalid','secret_unavailable','decryption_unavailable','cancelled','deadline','resource_limit','cleanup_uncertain','unexpected'].includes(reason))throw Error('backup.verification_reason');
 if(!await fence(client,attempt))return 'stale';
 return finish(client,attempt,'unavailable',reason,null,null);
}
