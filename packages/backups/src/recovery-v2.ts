import type {Proof} from './recovery.ts';
import {parseBackupVerificationJson,validateBackupVerificationTarget,type BackupVerificationTarget} from './verification-protocol.ts';
export type RecoveryMachineEnvelope=Proof&({version?:1;target?:never}|{version:2;target:BackupVerificationTarget});
export interface SnapshotRecoveryVerification {
 protocol:'backup-data-restore/v1';target:BackupVerificationTarget;policyDigest:string;requestDigest:string;archiveSha256:string;archiveBytes:number;pointId:string;
}
export function snapshotRecoveryTarget(value:unknown):BackupVerificationTarget{
 const target=validateBackupVerificationTarget(value);
 if(Buffer.byteLength(JSON.stringify(target))>30000)throw Error('backup.invalid_proof');
 return target;
}
export function recoveryNegotiation(proof:RecoveryMachineEnvelope){
 if(proof.version===undefined||proof.version===1){if(Object.hasOwn(proof,'target'))throw Error('backup.invalid_proof');return {version:1 as const,target:null};}
 if(proof.version!==2)throw Error('backup.invalid_proof');
 return {version:2 as const,target:snapshotRecoveryTarget(proof.target)};
}
export function requestPayloadV2(origin:string,id:string,action:'start'|'status',key:string,code:string,targetDigest:string,issuedAt:number){
 return Buffer.from(JSON.stringify(['waitron-cloud-recovery-request-v2',origin,id,action,key,code,targetDigest,issuedAt]));
}
export function recoveryPayloadV2(origin:string,id:string,action:'info'|'read'|'restored',digest:string,targetDigest:string,issuedAt:number){
 return Buffer.from(JSON.stringify(['waitron-cloud-recovery-v2',origin,id,action,digest,targetDigest,issuedAt]));
}
export function readRecoveryMachineEnvelope(raw:string,withId:boolean):RecoveryMachineEnvelope&{id?:string}{
 const value=parseBackupVerificationJson(raw,65536);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('backup.invalid_proof');
 const v=value as Record<string,unknown>,fields=['payload','signature',...(withId?['id']:[])],optional=['version','target'];
 if(fields.some(k=>typeof v[k]!=='string')||Object.keys(v).some(k=>!fields.includes(k)&&!optional.includes(k))
  ||(v.payload as string).length>2048||(v.signature as string).length>86)throw Error('backup.invalid_proof');
 const proof=v as unknown as RecoveryMachineEnvelope&{id?:string};
 const negotiation=recoveryNegotiation(proof);
 if(negotiation.version===2)return {payload:proof.payload,signature:proof.signature,...(withId?{id:proof.id}:{}),version:2,target:negotiation.target};
 return proof;
}
