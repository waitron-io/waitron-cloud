import {createHmac,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {requirePlatformPermission} from '@waitron-cloud/identity';
import type {Pool,PoolClient} from 'pg';
import {normaliseEmail} from './account-input.ts';
import {mailRecipientRefs,type SesHandoffConfig} from './mail-attempts.ts';
import {lockMailScope,mailSuppressionRevision,advanceMailSuppressionRevision,type RecipientRef} from './recipient-suppression.ts';
import {RelayKeys,type RelayKeyConfig} from './relay-payload.ts';
import {isValidatedSesFeedbackConfig,type MailScope} from './ses-feedback-config.ts';
import {transaction} from './transaction.ts';
import {createSesSuppressionReconciler,type ProviderSuppressionPort,type ProviderSuppressionObservation,type ReconciliationBinding} from './ses-suppression-reconcile.ts';

export interface OperatorCredentials {sessionToken:string;csrfToken:string}
interface LegacyBlock {block_id:string;key_id:string;digest:string;mappings:Record<string,string>[]}
interface Evidence {shared:Record<string,string>[];legacy:LegacyBlock[];legacyRefs:RecipientRef[];legacyCommitments:RecipientRef[]}
interface AdminConfig {ses:SesHandoffConfig;legacyKeys:RelayKeyConfig;provider:ProviderSuppressionPort;observationTtlMs?:number;providerTimeoutMs?:number}
interface UnblockRequest {id:string;country:string;provider_account_id:string;region:MailScope['region'];revision:number;operator_id:string;recipient_refs:RecipientRef[];prior_evidence:Evidence}
const localLock="SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':relay-suppression',0))";

/** Trusted construction supplies one qualified scope and both retained digest rings. */
export class MailSuppressionAdmin {
 readonly #pool:Pool;
 readonly #ses:SesHandoffConfig;
 readonly #legacy:Map<string,Buffer>;
 readonly #reconciler:ReturnType<typeof createSesSuppressionReconciler>;
 constructor(pool:Pool,config:AdminConfig){
  if(!isValidatedSesFeedbackConfig(config.ses.config))throw Error('mail_configuration_unavailable');
  new RelayKeys(config.legacyKeys);
  this.#pool=pool;this.#ses={config:config.ses.config,recipientKeys:{activeKeyId:config.ses.recipientKeys.activeKeyId,keys:{...config.ses.recipientKeys.keys}}};
  this.#legacy=new Map(Object.entries(config.legacyKeys.keys).map(([id,key])=>[id,Buffer.from(key,'hex')]));
  this.#reconciler=createSesSuppressionReconciler(config.provider,config.observationTtlMs,config.providerTimeoutMs);
 }
 #scope(scope:MailScope){
  const expected=this.#ses.config.scope;
  if(!scope||scope.country!==expected.country||scope.providerAccountId!==expected.providerAccountId||scope.region!==expected.region)throw Error('mail_scope_unavailable');
 }
 #authorize(client:PoolClient,operator:OperatorCredentials){
  return requirePlatformPermission(client,operator?.sessionToken,'mail.suppression.unblock',{csrfToken:operator?.csrfToken});
 }
 #legacyCommitments(){return [...this.#legacy].map(([keyId,key])=>({keyId,digest:createHmac('sha256',key).update('waitron-mail-legacy-admin-v1').digest('hex')})).sort((a,b)=>a.keyId.localeCompare(b.keyId));}
 #legacyRefs(recipient:string){return [...this.#legacy].map(([keyId,key])=>({keyId,digest:createHmac('sha256',key).update(JSON.stringify(['relay-suppression-v1',recipient])).digest('hex')})).sort((a,b)=>a.keyId.localeCompare(b.keyId));}
 async #snapshot(client:PoolClient,scope:MailScope,refs:readonly RecipientRef[],legacyRefs:RecipientRef[]):Promise<Evidence>{
  const ids=(await client.query('SELECT DISTINCT key_id FROM relay_suppressions')).rows;
  if(ids.some(row=>!this.#legacy.has(row.key_id)))throw Error('mail_keys_unavailable');
  const legacy:LegacyBlock[]=(await client.query(`SELECT b.block_id,b.key_id,b.digest FROM relay_suppressions b
   JOIN unnest($1::text[],$2::text[]) r(key_id,digest) ON b.key_id=r.key_id AND b.digest=r.digest ORDER BY b.block_id`,
   [legacyRefs.map(r=>r.keyId),legacyRefs.map(r=>r.digest)])).rows.map(row=>({...row,mappings:[]}));
  for(const row of legacy)row.mappings=(await client.query(`SELECT country,provider_account_id,region,key_id,digest
   FROM mail_legacy_suppression_lifetimes WHERE block_id=$1 ORDER BY country,provider_account_id,region,key_id,digest`,[row.block_id])).rows;
  const shared=(await client.query(`SELECT s.key_id,s.digest,s.reason,s.event_id FROM mail_suppressions s
   JOIN unnest($4::text[],$5::text[]) r(key_id,digest) ON s.key_id=r.key_id AND s.digest=r.digest
   WHERE s.country=$1 AND s.provider_account_id=$2 AND s.region=$3 ORDER BY s.key_id,s.digest,s.reason,s.event_id`,
   [scope.country,scope.providerAccountId,scope.region,refs.map(r=>r.keyId),refs.map(r=>r.digest)])).rows;
  const mapped=(await client.query(`SELECT DISTINCT s.block_id FROM mail_legacy_suppression_lifetimes s
   JOIN relay_suppressions b ON b.block_id=s.block_id
   JOIN unnest($4::text[],$5::text[]) r(key_id,digest) ON s.key_id=r.key_id AND s.digest=r.digest
   WHERE s.country=$1 AND s.provider_account_id=$2 AND s.region=$3`,[scope.country,scope.providerAccountId,scope.region,refs.map(r=>r.keyId),refs.map(r=>r.digest)])).rows;
  if(mapped.some(row=>!legacy.some(block=>block.block_id===row.block_id)))throw Error('mail_keys_unavailable');
  return {shared,legacy,legacyRefs,legacyCommitments:this.#legacyCommitments()};
 }
 async #locked<T>(operator:OperatorCredentials,scope:MailScope,recipient:string,action:(client:PoolClient,actor:string,refs:RecipientRef[],evidence:Evidence)=>Promise<T>){
  this.#scope(scope);const address=normaliseEmail(recipient);if(!address)throw Error('mail_recipient_unavailable');
  return transaction(this.#pool,async client=>{
   const actor=await this.#authorize(client,operator);
   // Legacy writers take this lock before the shared scope lock, for both stores.
   await client.query(localLock);await lockMailScope(client,scope);
   const refs=await mailRecipientRefs(client,{...this.#ses,recipient:address});
   const result=await action(client,actor.accountId,refs,await this.#snapshot(client,scope,refs,this.#legacyRefs(address)));
   await this.#authorize(client,operator);
   return result;
  });
 }
 async inspect(operator:OperatorCredentials,scope:MailScope,recipient:string){
  return this.#locked(operator,scope,recipient,async(client,_actor,_refs,evidence)=>({revision:await mailSuppressionRevision(client,scope),blocked:evidence.shared.length>0||evidence.legacy.length>0}));
 }
 async request(operator:OperatorCredentials,scope:MailScope,recipient:string,expectedRevision:number,reason:string):Promise<{operationId:string}>{
  if(typeof reason!=='string'||!/^[a-z][a-z0-9_-]{2,63}$/.test(reason))throw Error('mail_reason_invalid');
  return this.#locked(operator,scope,recipient,async(client,actor,refs,evidence)=>{
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision!==await mailSuppressionRevision(client,scope))throw Error('mail_revision_conflict');
   if(evidence.shared.length===0&&evidence.legacy.length===0)throw Error('mail_not_suppressed');
   const operationId=randomUUID();
   await client.query(`INSERT INTO mail_unblock_requests(id,country,provider_account_id,region,revision,operator_id,reason,recipient_refs,prior_evidence)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[operationId,scope.country,scope.providerAccountId,scope.region,expectedRevision,actor,reason,JSON.stringify(refs),JSON.stringify(evidence)]);
   for(const ref of refs)await client.query(`INSERT INTO mail_suppression_actions(id,country,provider_account_id,region,key_id,digest,operator_id,action,reconciliation,operation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,'remove','pending',$8)`,[randomUUID(),scope.country,scope.providerAccountId,scope.region,ref.keyId,ref.digest,actor,operationId]);
   return {operationId};
  });
 }
 async #operation(client:PoolClient,id:string,actor:string):Promise<UnblockRequest>{
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('mail_operation_unavailable');
  const op=(await client.query<UnblockRequest>('SELECT * FROM mail_unblock_requests WHERE id=$1',[id])).rows[0];
  if(!op)throw Error('mail_operation_unavailable');
  this.#scope({country:op.country,providerAccountId:op.provider_account_id,region:op.region});
  if(op.operator_id!==actor)throw Error('permission_denied');return op;
 }
 #binding(op:UnblockRequest):ReconciliationBinding{return {operationId:op.id,scope:{country:op.country,providerAccountId:op.provider_account_id,region:op.region},revision:op.revision};}
 async reconcile(operator:OperatorCredentials,operationId:string,recipient:string,signal:AbortSignal):Promise<ProviderSuppressionObservation>{
  const binding=await this.#locked(operator,this.#ses.config.scope,recipient,async(client,actor,refs,evidence)=>{
   const op=await this.#operation(client,operationId,actor);
   if(op.recipient_refs.some(ref=>!refs.some(r=>r.keyId===ref.keyId&&r.digest===ref.digest)))throw Error('mail_recipient_unavailable');
   if(op.revision!==await mailSuppressionRevision(client,this.#ses.config.scope)||!isDeepStrictEqual(op.prior_evidence,evidence))throw Error('mail_revision_conflict');
   return this.#binding(op);
  });
  // Provider calls run after the database transaction releases every lock.
  return this.#reconciler.reconcile(binding,normaliseEmail(recipient)!,signal);
 }
 async #verifySharedKeys(client:PoolClient,scope:MailScope){
  const retained=(await client.query('SELECT key_id,commitment,revoked FROM mail_recipient_key_versions WHERE country=$1 AND provider_account_id=$2 AND region=$3 ORDER BY key_id FOR SHARE',[scope.country,scope.providerAccountId,scope.region])).rows;
  for(const row of retained){
   const key=this.#ses.recipientKeys.keys[row.key_id];
   if(!key||row.revoked||createHmac('sha256',Buffer.from(key,'hex')).update('waitron-mail-recipient-key-v1').digest('hex')!==row.commitment)throw Error('mail_keys_unavailable');
  }
 }
 async finish(operator:OperatorCredentials,operationId:string,observation:unknown):Promise<'cleared'|'blocked'>{
  return transaction(this.#pool,async client=>{
   const actor=await this.#authorize(client,operator);
   await client.query(localLock);await lockMailScope(client,this.#ses.config.scope);
   const op=await this.#operation(client,operationId,actor.accountId),binding=this.#binding(op),scope=binding.scope;
   const previous=(await client.query('SELECT result FROM mail_unblock_outcomes WHERE operation_id=$1',[operationId])).rows[0];
   if(previous){await this.#authorize(client,operator);return previous.result;}
   await this.#verifySharedKeys(client,scope);
   const evidence=await this.#snapshot(client,scope,op.recipient_refs,op.prior_evidence.legacyRefs);
   const provider=this.#reconciler.evidence(observation,binding);
   let diagnostic='cleared';
   if(!provider||provider.status!=='confirmed'||provider.after.length!==0)diagnostic='provider_unconfirmed';
   else if(op.revision!==await mailSuppressionRevision(client,scope)||!isDeepStrictEqual(op.prior_evidence,evidence))diagnostic='evidence_changed';
   else if(evidence.legacy.some(block=>block.mappings.length===0||block.mappings.some(m=>m.country!==scope.country||m.provider_account_id!==scope.providerAccountId||m.region!==scope.region
    ||!op.recipient_refs.some(r=>r.keyId===m.key_id&&r.digest===m.digest))))diagnostic='legacy_unreconciled';
   // Recheck time after every database wait, before either suppression store changes.
   await this.#authorize(client,operator);
   if(!this.#reconciler.evidence(observation,binding))diagnostic='provider_unconfirmed';
   const result=diagnostic==='cleared'?'cleared':'blocked';
   if(result==='cleared'){
    for(const ref of op.recipient_refs)await client.query(`DELETE FROM mail_suppressions WHERE country=$1 AND provider_account_id=$2 AND region=$3 AND key_id=$4 AND digest=$5`,[scope.country,scope.providerAccountId,scope.region,ref.keyId,ref.digest]);
    for(const block of evidence.legacy)await client.query('DELETE FROM relay_suppressions WHERE block_id=$1 AND key_id=$2 AND digest=$3',[block.block_id,block.key_id,block.digest]);
    await advanceMailSuppressionRevision(client,scope);
   }
   await client.query(`INSERT INTO mail_unblock_outcomes(operation_id,operator_id,result,diagnostic,provider_evidence) VALUES($1,$2,$3,$4,$5)`,[operationId,actor.accountId,result,diagnostic,JSON.stringify(provider??{status:'untrusted'})]);
   for(const ref of op.recipient_refs)await client.query(`INSERT INTO mail_suppression_actions(id,country,provider_account_id,region,key_id,digest,operator_id,action,reconciliation,operation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,'reconcile',$8,$9)`,[randomUUID(),scope.country,scope.providerAccountId,scope.region,ref.keyId,ref.digest,actor.accountId,result==='cleared'?'confirmed':'failed',operationId]);
   await this.#authorize(client,operator);
   if(result==='cleared'&&!this.#reconciler.evidence(observation,binding))throw Error('mail_provider_observation_expired');
   return result;
  });
 }
}
