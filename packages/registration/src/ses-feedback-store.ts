import {createHash,createHmac,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {isValidatedSesFeedbackConfig,type SesFeedbackConfig} from './ses-feedback-config.ts';
import type {ParsedFeedback} from './ses-feedback-event.ts';
import type {RelayKeyConfig} from './relay-payload.ts';
import {transaction} from './transaction.ts';
import {lockMailScope} from './recipient-suppression.ts';
import {bindProviderId} from './mail-attempts.ts';
import {normaliseEmail} from './account-input.ts';

/** Only the trusted queue consumer supplies parsed events; this function does not authenticate AWS. */
export async function applySesFeedback(pool:Pool,config:SesFeedbackConfig,recipientKeys:RelayKeyConfig,event:ParsedFeedback):Promise<'applied'|'duplicate'|'ignored'|'conflict'> {
 if(!isValidatedSesFeedbackConfig(config)||config.policyRevision>2147483647)throw Error('mail_configuration_unavailable');
 return transaction(pool,async client=>{
  const {country,providerAccountId,region}=config.scope;
  await lockMailScope(client,config.scope);
  const existing=await client.query('SELECT content_digest FROM mail_feedback_receipts WHERE country=$1 AND topic_arn=$2 AND sns_id=$3',[country,config.topicArn,event.snsId]);
  if(existing.rowCount)return existing.rows[0].content_digest===event.contentDigest?'duplicate':'conflict';
  const receipt=async(result:'applied'|'ignored'|'conflict',diagnostic:'applied'|'unresolved'|'binding_conflict'|'non_blocking')=>{
   await client.query(`INSERT INTO mail_feedback_receipts(country,topic_arn,sns_id,content_digest,result,diagnostic)
    VALUES($1,$2,$3,$4,$5,$6)`,[country,config.topicArn,event.snsId,event.contentDigest,result,diagnostic]);
   return result;
  };
  // Filter scope before taking a row lock; another country's tag must not acquire its locks.
  const attempt=(await client.query(`SELECT * FROM mail_attempts WHERE attempt_tag=$1 AND country=$2 AND provider_account_id=$3 AND region=$4 FOR UPDATE`,
   [event.attemptTag,country,providerAccountId,region])).rows[0];
  if(!attempt||!config.purposes.includes(attempt.purpose)||attempt.policy_revision!==config.policyRevision
   ||attempt.configuration_revision!==config.revision||attempt.configuration_set!==config.configurationSet)
   return receipt('ignored','unresolved');
  const refs=(await client.query('SELECT key_id,digest FROM mail_attempt_recipients WHERE attempt_tag=$1 ORDER BY key_id',[event.attemptTag])).rows;
  const failKeys=():never=>{throw Error('mail_keys_unavailable');};
  if(!recipientKeys?.keys||typeof recipientKeys.keys!=='object'||Array.isArray(recipientKeys.keys)
   ||!Object.hasOwn(recipientKeys.keys,recipientKeys.activeKeyId))return failKeys();
  const material=new Map<string,Buffer>();
  for(const [id,key] of Object.entries(recipientKeys.keys)){
   if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)||typeof key!=='string'||!/^[a-fA-F0-9]{64}$/.test(key))return failKeys();
   material.set(id,Buffer.from(key,'hex'));
  }
  const retained=(await client.query(`SELECT key_id,commitment,revoked FROM mail_recipient_key_versions
   WHERE country=$1 AND provider_account_id=$2 AND region=$3 ORDER BY key_id FOR SHARE`,[country,providerAccountId,region])).rows;
  for(const key of retained){
   const bytes=material.get(key.key_id);
   if(!bytes||key.revoked||createHmac('sha256',bytes).update('waitron-mail-recipient-key-v1').digest('hex')!==key.commitment)return failKeys();
  }
  if(event.recipient!==null){
   const recipient=normaliseEmail(event.recipient);
   if(!recipient||refs.some(ref=>createHmac('sha256',material.get(ref.key_id)!).update(JSON.stringify(['waitron-mail-recipient-v1',recipient])).digest('hex')!==ref.digest))
    return receipt('conflict','binding_conflict');
  }
  try{await bindProviderId(client,event.attemptTag,event.providerMessageId);}
  catch(error){if(error instanceof Error&&error.message==='mail_provider_conflict')return receipt('conflict','binding_conflict');throw error;}
  const recipientIdentity=createHash('sha256').update(JSON.stringify(refs)).digest('hex');
  const eventIdentity=JSON.stringify(event.eventId!==null?[event.kind,'feedback',event.eventId]:[event.kind,'time',event.eventTime,event.providerMessageId]);
  const semantic=await client.query('SELECT 1 FROM mail_feedback_events WHERE attempt_tag=$1 AND recipient_identity=$2 AND event_identity=$3',[event.attemptTag,recipientIdentity,eventIdentity]);
  if(semantic.rowCount){
   await receipt('ignored','non_blocking');return 'duplicate';
  }
  const id=randomUUID();
  await client.query(`INSERT INTO mail_feedback_events(id,attempt_tag,country,provider_account_id,region,recipient_identity,event_identity,kind,event_time)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,event.attemptTag,country,providerAccountId,region,recipientIdentity,eventIdentity,event.kind,event.eventTime]);
  const blocking=['hard_bounce','complaint','provider_suppressed'].includes(event.kind);
  if(blocking)for(const ref of refs)await client.query(`INSERT INTO mail_suppressions(country,provider_account_id,region,key_id,digest,reason,event_id)
   VALUES($1,$2,$3,$4,$5,$6,$7)`,[country,providerAccountId,region,ref.key_id,ref.digest,event.kind,id]);
  return blocking?receipt('applied','applied'):receipt('ignored','non_blocking');
 });
}
