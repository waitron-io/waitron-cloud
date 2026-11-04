import {createHmac,randomBytes} from 'node:crypto';
import type {PoolClient} from 'pg';
import {isValidatedSesFeedbackConfig,type SesFeedbackConfig} from './ses-feedback-config.ts';
import type {RelayKeyConfig} from './relay-payload.ts';
import {normaliseEmail} from './account-input.ts';
import {lockMailScope,recipientIsSuppressed,type RecipientRef} from './recipient-suppression.ts';
export type QueueClaim={purpose:'cloud-account-email';outboxId:string;claimId:string;attempt:number}
 |{purpose:'venue-email';installationId:string;messageId:string;claimId:string;attempt:number};
export interface AttemptInput {config:SesFeedbackConfig;recipientKeys:RelayKeyConfig;claim:QueueClaim;recipient:string}
export interface HandoffAdmission {attemptTag:string;configurationSet:string}
const accountInstallation='00000000-0000-0000-0000-000000000000';
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail=(reason:string):never=>{throw Error(reason);};

async function recipientRefs(client:PoolClient,input:AttemptInput):Promise<RecipientRef[]> {
 const {country,providerAccountId,region}=input.config.scope;
 const config=input.recipientKeys,recipient=normaliseEmail(input.recipient);
 if(!recipient)return fail('mail_recipient_unavailable');
 if(!config||!config.keys||typeof config.keys!=='object'||Array.isArray(config.keys)
  ||!Object.hasOwn(config.keys,config.activeKeyId))return fail('mail_keys_unavailable');
 const entries=Object.entries(config.keys).sort(([a],[b])=>a.localeCompare(b));
 if(entries.length===0)return fail('mail_keys_unavailable');
 const material=new Map<string,Buffer>();
 for(const [id,key] of entries){
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)||typeof key!=='string'||!/^[a-fA-F0-9]{64}$/.test(key))return fail('mail_keys_unavailable');
  material.set(id,Buffer.from(key,'hex'));
 }
 const commitment=(key:Buffer)=>createHmac('sha256',key).update('waitron-mail-recipient-key-v1').digest('hex');
 const persisted=(await client.query('SELECT key_id,commitment,revoked FROM mail_recipient_key_versions WHERE country=$1 AND provider_account_id=$2 AND region=$3 ORDER BY key_id FOR SHARE',[country,providerAccountId,region])).rows;
 for(const row of persisted){
  const key=material.get(row.key_id);
  if(!key||row.revoked||commitment(key)!==row.commitment)return fail('mail_keys_unavailable');
 }
 const refs:RecipientRef[]=[];
 for(const [id,key] of material){
  await client.query(`INSERT INTO mail_recipient_key_versions(country,provider_account_id,region,key_id,commitment)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[country,providerAccountId,region,id,commitment(key)]);
  refs.push({keyId:id,digest:createHmac('sha256',key).update(JSON.stringify(['waitron-mail-recipient-v1',recipient])).digest('hex')});
 }
 return refs;
}

/** Commit admission before SMTP; caller-owned authority locks must precede this scope lock. */
export async function admitMailAttempt(client:PoolClient,input:AttemptInput):Promise<HandoffAdmission> {
 if(!input?.config||!isValidatedSesFeedbackConfig(input.config)||input.config.policyRevision>2147483647)return fail('mail_configuration_unavailable');
 const {config,claim}=input;
 if(!claim||!config.purposes.includes(claim.purpose))return fail('mail_configuration_unavailable');
 if(!uuid(claim.claimId)||!Number.isInteger(claim.attempt)||claim.attempt<1||claim.attempt>8)return fail('mail_claim_unavailable');
 const queueId=claim.purpose==='cloud-account-email'?claim.outboxId:claim.messageId;
 const installation=claim.purpose==='cloud-account-email'?accountInstallation:claim.installationId;
 if(!uuid(queueId)||!uuid(installation)||(claim.purpose==='venue-email'&&installation===accountInstallation))return fail('mail_claim_unavailable');
 const scope=config.scope,{country,providerAccountId,region}=scope;
 await lockMailScope(client,scope);
 const current=claim.purpose==='cloud-account-email'
  ?await client.query(`SELECT id FROM email_outbox WHERE id=$1 AND claim_id=$2 AND attempts=$3 AND status='processing'
    FOR UPDATE`,[queueId,claim.claimId,claim.attempt])
  :await client.query(`SELECT message_id FROM relay_messages WHERE installation_id=$1 AND message_id=$2 AND claim_id=$3 AND attempts=$4 AND state='sending'
    FOR UPDATE`,[installation,queueId,claim.claimId,claim.attempt]);
 if(!current.rowCount)return fail('mail_claim_unavailable');
 await client.query(`INSERT INTO mail_queue_scopes(purpose,installation_id,queue_id,country,provider_account_id,region)
  VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[claim.purpose,installation,queueId,country,providerAccountId,region]);
 const pinned=(await client.query('SELECT country,provider_account_id,region FROM mail_queue_scopes WHERE purpose=$1 AND installation_id=$2 AND queue_id=$3',[claim.purpose,installation,queueId])).rows[0];
 if(pinned.country!==country||pinned.provider_account_id!==providerAccountId||pinned.region!==region)return fail('mail_scope_conflict');
 const refs=await recipientRefs(client,input);
 if(await recipientIsSuppressed(client,scope,refs))return fail('mail_recipient_suppressed');
 // A SELECT predicate can run before its row-lock wait; sample deadlines after that wait.
 const deadline=claim.purpose==='cloud-account-email'
  ?await client.query('SELECT lease_until>clock_timestamp() AND expires_at>clock_timestamp() AS live FROM email_outbox WHERE id=$1',[queueId])
  :await client.query('SELECT lease_until>clock_timestamp() AND expires_at>clock_timestamp() AS live FROM relay_messages WHERE installation_id=$1 AND message_id=$2',[installation,queueId]);
 if(deadline.rows[0]?.live!==true)return fail('mail_claim_unavailable');
 const attemptTag=randomBytes(32).toString('base64url');
 const inserted=await client.query(`INSERT INTO mail_attempts(attempt_tag,purpose,installation_id,queue_id,country,provider_account_id,region,
  policy_revision,configuration_revision,configuration_set,claim_id,attempt)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
  [attemptTag,claim.purpose,installation,queueId,country,providerAccountId,region,config.policyRevision,config.revision,config.configurationSet,claim.claimId,claim.attempt]);
 if(inserted.rowCount!==1)return fail('mail_attempt_conflict');
 for(const ref of refs)await client.query(`INSERT INTO mail_attempt_recipients(attempt_tag,country,provider_account_id,region,key_id,digest)
  VALUES($1,$2,$3,$4,$5,$6)`,[attemptTag,country,providerAccountId,region,ref.keyId,ref.digest]);
 await client.query('UPDATE mail_attempts SET recipient_refs_sealed=true WHERE attempt_tag=$1',[attemptTag]);
 return {attemptTag,configurationSet:config.configurationSet};
}

/** Both trusted receipts and feedback use the same first-observation binding. */
export async function bindProviderId(client:PoolClient,attemptTag:string,providerMessageId:string):Promise<void> {
 if(typeof attemptTag!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(attemptTag)||Buffer.from(attemptTag,'base64url').toString('base64url')!==attemptTag
  ||typeof providerMessageId!=='string'||!/^[!-~]{1,256}$/.test(providerMessageId))return fail('mail_provider_conflict');
 const found=(await client.query('SELECT country,provider_account_id,region FROM mail_attempts WHERE attempt_tag=$1',[attemptTag])).rows[0];
 if(!found)return fail('mail_provider_conflict');
 await lockMailScope(client,{country:found.country,providerAccountId:found.provider_account_id,region:found.region});
 const row=(await client.query('SELECT provider_message_id FROM mail_attempts WHERE attempt_tag=$1 FOR UPDATE',[attemptTag])).rows[0];
 if(row.provider_message_id!==null&&row.provider_message_id!==providerMessageId)return fail('mail_provider_conflict');
 await client.query('SAVEPOINT mail_provider_binding');
 try{await client.query('UPDATE mail_attempts SET provider_message_id=$2 WHERE attempt_tag=$1',[attemptTag,providerMessageId]);}
 catch(error){
  if((error as {code?:string}).code!=='23505')throw error;
  await client.query('ROLLBACK TO SAVEPOINT mail_provider_binding');
  await client.query('RELEASE SAVEPOINT mail_provider_binding');
  return fail('mail_provider_conflict');
 }
 await client.query('RELEASE SAVEPOINT mail_provider_binding');
}
