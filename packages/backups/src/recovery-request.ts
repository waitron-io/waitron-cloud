import {RecoveryCodes,recoveryCodeKeysFromEnv,type RecoveryCodeKeys} from './recovery-codes.ts';
import {verify} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {recordSecurityAuditEvent,transaction} from '@waitron-cloud/registration';
import {BackupRecovery,decode,publicKey,type Proof,type RecoveryApprovalInput} from './recovery.ts';
import {backupFail,uuid,uniqueViolation} from './catalogue.ts';
import type {BackupKeyVault} from './keys.ts';
type Action='start'|'status';
interface Claims {id:string;publicKey:string;code:string;issuedAt:number;}
interface Row {id:string;public_key:string;code_hash:string;expires_at:Date;failed_codes:number;account_id:string|null;operation_id:string|null;}
export function requestPayload(origin:string,id:string,action:Action,key:string,code:string,issuedAt:number){return Buffer.from(JSON.stringify(['waitron-cloud-recovery-request-v1',origin,id,action,key,code,issuedAt]));}
export function verifyRecoveryRequest(origin:string,action:Action,proof:Proof):Claims {
 try{
  const bytes=decode(proof.payload,2048),v:unknown=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
  if(!Array.isArray(v)||v.length!==7||!uuid(v[2])||typeof v[4]!=='string'||typeof v[5]!=='string'||!/^\d{8}$/.test(v[5])||!Number.isSafeInteger(v[6])||Math.abs(Date.now()-v[6])>60000||!requestPayload(origin,v[2],action,v[4],v[5],v[6]).equals(bytes)||!verify(null,bytes,publicKey(v[4]),decode(proof.signature,86)))throw Error();
  return {id:v[2],publicKey:v[4],code:v[5],issuedAt:v[6]};
 }catch{return backupFail('invalid_proof');}
}
async function lock(client:PoolClient,id:string):Promise<Row>{
 if(!uuid(id))backupFail('unavailable');const row=(await client.query<Row>('SELECT * FROM backup_recovery_requests WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)backupFail('unavailable');return row;
}
async function available(client:PoolClient,row:Row){if(!row.operation_id&&(row.failed_codes>=5||!(await client.query('SELECT expires_at>clock_timestamp() AS valid FROM backup_recovery_requests WHERE id=$1',[row.id])).rows[0]?.valid))backupFail('unavailable');}
function view(row:Row){return {requestId:row.id,state:row.operation_id?'approved' as const:'awaiting_owner' as const,expiresAt:row.expires_at.toISOString(),operationId:row.operation_id};}
/** Request locks precede account, membership and venue locks; no recovery operation locks a request. */
export class RecoveryRequests {
 readonly pool:Pool;readonly vault:BackupKeyVault;readonly origin:string;readonly #codes:RecoveryCodes;
 constructor(pool:Pool,vault:BackupKeyVault,origin:string,keys:RecoveryCodeKeys|null|undefined=recoveryCodeKeysFromEnv(process.env)){this.pool=pool;this.vault=vault;this.origin=origin;this.#codes=new RecoveryCodes(keys??undefined);}
 async machine(action:Action,proof:Proof){
  const c=verifyRecoveryRequest(this.origin,action,proof);
  return transaction(this.pool,async client=>{
   if(action==='start'){
    if((await client.query('SELECT 1 FROM installations WHERE public_key=$1 UNION ALL SELECT 1 FROM backup_recoveries WHERE target_public_key=$1 AND id<>$2',[c.publicKey,c.id])).rowCount)backupFail('target_not_fresh');
    await client.query('INSERT INTO backup_recovery_requests(id,public_key,code_hash) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[c.id,c.publicKey,this.#codes.protect({id:c.id,public_key:c.publicKey},c.code)]);
   }
   const row=await lock(client,c.id);if(row.public_key!==c.publicKey||!this.#codes.matches(row,row.code_hash,c.code))backupFail('conflict');await available(client,row);verifyRecoveryRequest(this.origin,action,proof);return view(row);
  }).catch(error=>{if(uniqueViolation(error,'backup_recovery_requests_public_key_key'))backupFail('target_not_fresh');throw error;});
 }
 async #browser(id:string,code:string,token:string,csrf:string,input?:RecoveryApprovalInput){
  const result=await transaction(this.pool,async client=>{
   const row=await lock(client,id),session=await resolveSession(client,token,{csrfToken:csrf,touch:false});await available(client,row);
   if(row.account_id&&row.account_id!==session.accountId)backupFail('permission_denied');
   const matches=this.#codes.matches(row,row.code_hash,typeof code==='string'?code:'');
   if(typeof code!=='string'||!/^\d{8}$/.test(code)||!matches){if(!row.operation_id)await client.query('UPDATE backup_recovery_requests SET failed_codes=LEAST(5,failed_codes+1) WHERE id=$1',[id]);return null;}
   const recovery=new BackupRecovery(this.pool,this.vault,this.origin,client);
   if(input){
    const operation=await recovery.start(token,csrf,{...input,id,mode:'failure',targetPublicKey:row.public_key});
    await available(client,row);
    await client.query('UPDATE backup_recovery_requests SET account_id=$2,operation_id=id WHERE id=$1',[id,session.accountId]);row.account_id=session.accountId;row.operation_id=id;
    const venue=(await client.query<{organisation_id:string}>('SELECT organisation_id FROM venues WHERE id=$1',[operation.venueId])).rows[0];
    if(!venue)backupFail('unavailable');
    await recordSecurityAuditEvent(client,{organisationId:venue.organisation_id,venueId:operation.venueId,type:'recovery.approved',actorKind:'account',actorId:session.accountId,subjectKind:'recovery',subjectId:id,sourceId:id});
   }
   const operation=row.operation_id?await recovery.status(token,row.operation_id):null;
   await resolveSession(client,token,{csrfToken:csrf,touch:false});await available(client,row);return {...view(row),operation};
  });
  // A rejected code must commit its attempt counter without committing an approval.
  if(!result)backupFail('unavailable');return result;
 }
 inspect(id:string,code:string,token:string,csrf:string){return this.#browser(id,code,token,csrf);}
 approve(id:string,code:string,token:string,csrf:string,input:RecoveryApprovalInput){return this.#browser(id,code,token,csrf,input);}
}
