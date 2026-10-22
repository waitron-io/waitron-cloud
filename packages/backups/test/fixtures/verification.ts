import {readFile} from 'node:fs/promises';
import type {Pool} from 'pg';
import {transaction} from '@waitron-cloud/registration';
import {setVerificationPolicy} from '../../src/verification-admission.ts';
import {backupVerificationRequestDigest,type BackupVerificationRequest,type BackupVerificationResult} from '../../src/verification-protocol.ts';
import type {VerifiedChildOutput} from '../../src/container-verifier.ts';
export const fixtureTarget=JSON.parse(await readFile(new URL('../../../../deploy/backup-verifier/target.json',import.meta.url),'utf8'));
export const fixtureImage='local.waitron-verifier@sha256:'+'2'.repeat(64);
export async function configureVerification(pool:Pool,image=fixtureImage){await transaction(pool,c=>setVerificationPolicy(c,fixtureTarget,image,false));}
// Synthetic child evidence exercises admission only; it cannot qualify an image or archive release.
export function verificationOutput(r:BackupVerificationRequest,status:BackupVerificationResult['status']='passed',reason:BackupVerificationResult['reason']='none'):VerifiedChildOutput{
 return {result:{protocol:r.protocol,requestDigest:backupVerificationRequestDigest(r),attemptToken:r.attempt.childToken,
 measuredArchive:{sha256:r.archive.sha256,bytes:r.archive.bytes},targetDigest:r.target.digest,policyDigest:r.target.policyDigest,
 modules:status==='passed'?r.target.modules.map(m=>({name:m.name,semanticsVersion:m.semanticsVersion,status:'passed',checks:[{code:'data',status:'passed'}]})):[],status,reason,activation:'not_attempted'},
 receipt:{childId:'3'.repeat(64),imageId:r.verifierImage.slice(r.verifierImage.lastIndexOf('@')+1),requestDigest:backupVerificationRequestDigest(r),controllerScope:r.attempt.controllerScope,childToken:r.attempt.childToken,terminated:true,cleanupConfirmed:true}};
}

export async function verifyPointFixture(pool:Pool,catalogue:import('../../src/catalogue.ts').BackupCatalogue,pointId:string,verify:import('../../src/container-verifier.ts').DataRestoreVerifier=async(_s,_k,r)=>verificationOutput(r),signal?:AbortSignal){
 const {randomUUID}=await import('node:crypto');
 const p=(await pool.query('SELECT venue_id FROM backup_points WHERE id=$1',[pointId])).rows[0];
 if(!(await pool.query('SELECT target FROM backup_verification_policy WHERE id=1')).rows[0]?.target)await configureVerification(pool);
 const claimId=randomUUID();
 const job=(await pool.query(`INSERT INTO backup_jobs(kind,venue_id,target_id,status,claim_id,lease_until,attempts,runs)
 VALUES('verify',$1,$2,'running',$3,clock_timestamp()+interval '120 seconds',1,1)
 ON CONFLICT(kind,target_id) DO UPDATE SET status='running',claim_id=$3,lease_until=clock_timestamp()+interval '120 seconds',attempts=1,runs=backup_jobs.runs+1 RETURNING id`,[p.venue_id,pointId,claimId])).rows[0];
 return catalogue.verifyClaim({id:job.id,venueId:p.venue_id,pointId,claimId,number:1,controllerScope:'verification-fixture'},verify,signal);
}

// Explicit opt-in for synthetic recovery fixtures only; deployed policy remains release-disabled.
export async function configureRecoveryVerification(pool:Pool){
 const policy=(await pool.query('SELECT target,verifier_image,release_ready FROM backup_verification_policy WHERE id=1')).rows[0];
 if(policy?.target?.digest===fixtureTarget.digest&&policy.verifier_image===fixtureImage&&policy.release_ready)return;
 await transaction(pool,c=>setVerificationPolicy(c,fixtureTarget,fixtureImage,true));
}
