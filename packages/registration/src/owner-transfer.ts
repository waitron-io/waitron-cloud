import {organisationScopeSql,requireOrganisationScope} from '@waitron-cloud/identity';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction} from './transaction.ts';
import {requireAccountActionProof} from './account-action-proof.ts';
import {requireConnectionProof} from './connection-proof.ts';
import {normaliseEmail,validLocale,type OwnerTransferMail,type AccountLocale} from './account-input.ts';
import type {EmailOutbox} from './email-outbox.ts';

export class OwnerTransferError extends Error {
 readonly code:'transfer_unavailable'|'transfer_pending'|'recovery_in_progress'|'invalid_input';
 constructor(code:OwnerTransferError['code']='transfer_unavailable'){super(code);this.name='OwnerTransferError';this.code=code;}
}
interface Offer {id:string;organisation_id:string;sender_id:string;recipient_id:string|null;sender_email:string;recipient_email:string;recipient_needs_enrolment:boolean;locale:AccountLocale;expires_at:Date;state:'pending'|'accepted'|'cancelled'|'expired'}
export interface OwnerTransferView {id:string;organisationId:string;organisationName:string;businessNames:string[];senderEmail:string;recipientEmail:string;expiresAt:string;state:Offer['state'];incoming:boolean}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const enrolled=`EXISTS(SELECT 1 FROM cloud_passkeys WHERE account_id=a.id) OR EXISTS(SELECT 1 FROM cloud_authenticator_factors WHERE account_id=a.id AND secret_envelope IS NOT NULL)`;
async function lockAccounts(client:PoolClient,ids:(string|null)[]){await client.query('SELECT id FROM cloud_accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids.filter(Boolean)]);}
async function view(client:PoolClient,row:Offer,accountId:string):Promise<OwnerTransferView>{
 const org=(await client.query<{name:string|null;now:Date;owned:boolean}>(`SELECT name,clock_timestamp() AS now,
  EXISTS (SELECT 1 FROM organisation_memberships WHERE organisation_id=$1 AND account_id=$2 AND is_owner) AS owned
  FROM organisations WHERE id=$1`,[row.organisation_id,accountId])).rows[0]!;
 const state=row.state==='pending'&&row.expires_at<=org.now?'expired':row.state;
 // Historical offers remain visible to former owners. Only current authority discloses a live name.
 const organisationName=state==='pending'||org.owned?org.name??'':'';
 const businessNames=state==='pending'
  ?(await client.query<{name:string}>('SELECT name FROM legal_businesses WHERE organisation_id=$1 AND name IS NOT NULL ORDER BY name,id',[row.organisation_id])).rows.map(b=>b.name)
  :[];
 return {id:row.id,organisationId:row.organisation_id,organisationName,businessNames,senderEmail:row.sender_email,recipientEmail:row.recipient_email,expiresAt:row.expires_at.toISOString(),state,incoming:row.recipient_id===accountId};
}
export class OwnerTransferStore {
 readonly #pool:Pool;readonly #outbox:EmailOutbox;
 constructor(pool:Pool,outbox:EmailOutbox){this.#pool=pool;this.#outbox=outbox;}
 async create(token:string,csrf:string,organisationId:string,input:string,locale:AccountLocale='en'){
  const email=normaliseEmail(input);if(!email||!uuid.test(organisationId)||!validLocale(locale))throw new OwnerTransferError('invalid_input');
  return transaction(this.#pool,async client=>{
   const candidate=(await client.query('SELECT account_id AS "accountId" FROM cloud_sessions WHERE token_hash=$1',[createHash('sha256').update(token).digest('hex')])).rows[0];
   if(!candidate)throw new OwnerTransferError();
   const lookup=(await client.query('SELECT account_id FROM cloud_credentials WHERE email=$1',[email])).rows[0];
   // Discover both accounts before taking either lock; all handovers use their sorted order.
   await lockAccounts(client,[candidate.accountId,lookup?.account_id]);
   const sender=await requireAccountActionProof(client,token,csrf);
   await requireOrganisationScope(client,sender.accountId,organisationId);
   const recipient=(await client.query(`SELECT a.id,(${enrolled}) AS enrolled FROM cloud_accounts a JOIN cloud_credentials c ON c.account_id=a.id
    WHERE c.email=$1 AND a.id=$3 AND c.email_verified_at IS NOT NULL AND a.disabled_at IS NULL AND a.id<>$2`,[email,sender.accountId,lookup?.account_id??null])).rows[0];
   await client.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE',[organisationId]);
   if(!(await client.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 AND account_id=$2 AND is_owner FOR UPDATE',[organisationId,sender.accountId])).rowCount)throw new OwnerTransferError();
   await client.query("UPDATE owner_transfers SET state='expired' WHERE organisation_id=$1 AND state='pending' AND expires_at<=clock_timestamp()",[organisationId]);
   if((await client.query("SELECT 1 FROM owner_transfers WHERE organisation_id=$1 AND state='pending'",[organisationId])).rowCount)throw new OwnerTransferError('transfer_pending');
   const senderEmail=(await client.query('SELECT email FROM cloud_credentials WHERE account_id=$1',[sender.accountId])).rows[0].email;
   const row=(await client.query(`INSERT INTO owner_transfers(id,organisation_id,sender_id,recipient_id,sender_email,recipient_email,recipient_needs_enrolment,locale)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[randomUUID(),organisationId,sender.accountId,recipient?.id??null,senderEmail,email,!recipient?.enrolled,locale])).rows[0];
   await this.#outbox.enqueue(client,'owner_transfer',{email,locale,offerId:row.id,event:'invitation'});
   await requireAccountActionProof(client,token,csrf);
   return view(client,row,sender.accountId);
  });
 }
 async list(token:string){return transaction(this.#pool,async client=>{
  const session=await resolveSession(client,token,{touch:false});
  const rows=(await client.query(`SELECT * FROM owner_transfers WHERE (sender_id=$1 OR recipient_id=$1) AND ${organisationScopeSql('$1','organisation_id')} ORDER BY created_at DESC LIMIT 100`,[session.accountId])).rows;
  return Promise.all(rows.map(row=>view(client,row,session.accountId)));
 });}
 async decide(token:string,csrf:string,id:string,action:'accept'|'cancel'){
  if(!uuid.test(id))throw new OwnerTransferError();
  return transaction(this.#pool,async client=>{
   const candidate:Offer=(await client.query('SELECT * FROM owner_transfers WHERE id=$1',[id])).rows[0];if(!candidate)throw new OwnerTransferError();
   await lockAccounts(client,[candidate.sender_id,candidate.recipient_id]);
   const session=await requireAccountActionProof(client,token,csrf);
   if(session.accountId!==candidate.recipient_id&&!(action==='cancel'&&session.accountId===candidate.sender_id))throw new OwnerTransferError();
   await client.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE',[candidate.organisation_id]);
   const offer:Offer=(await client.query('SELECT * FROM owner_transfers WHERE id=$1 FOR UPDATE',[id])).rows[0];
   await requireOrganisationScope(client,session.accountId,offer.organisation_id);
   if(offer.state!=='pending')return view(client,offer,session.accountId);
   if(offer.expires_at<=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now)throw new OwnerTransferError();
   if(action==='cancel'){
    const done=(await client.query("UPDATE owner_transfers SET state='cancelled' WHERE id=$1 RETURNING *",[id])).rows[0];await notices(client,this.#outbox,done);await finalAuthority(client,token,csrf,offer);return view(client,done,session.accountId);
   }
   const sender=(await client.query('SELECT c.email,c.email_verified_at,a.disabled_at FROM cloud_accounts a JOIN cloud_credentials c ON c.account_id=a.id WHERE a.id=$1',[offer.sender_id])).rows[0];
   if(!sender||sender.disabled_at||!sender.email_verified_at||sender.email!==offer.sender_email)throw new OwnerTransferError();
   const credential=(await client.query('SELECT email,email_verified_at FROM cloud_credentials WHERE account_id=$1',[session.accountId])).rows[0];
   if(credential.email!==offer.recipient_email||!credential.email_verified_at)throw new OwnerTransferError();
   await requireConnectionProof(client,token,csrf);
   const owner=await client.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 AND account_id=$2 AND is_owner FOR UPDATE',[offer.organisation_id,offer.sender_id]);
   if(!owner.rowCount)throw new OwnerTransferError();
   // Recovery holds owner membership while opening; do not take recovery-row locks in reverse order.
   if((await client.query(`SELECT 1 FROM backup_recoveries r JOIN venues v ON v.id=r.venue_id
    LEFT JOIN installation_replacements replacement ON replacement.id=r.id
    WHERE v.organisation_id=$1 AND (r.status IN ('pending','restored') OR replacement.id IS NOT NULL AND replacement.completed_at IS NULL) LIMIT 1`,[offer.organisation_id])).rowCount)throw new OwnerTransferError('recovery_in_progress');
   // Take venue locks before relay grant locks, matching mail handoff.
   await client.query(`UPDATE venues SET waitron_mail_reply_to=NULL,waitron_mail_from=NULL,waitron_mail_dns_token=NULL
    WHERE organisation_id=$1 AND (waitron_mail_reply_to IS NOT NULL OR waitron_mail_from IS NOT NULL)`,[offer.organisation_id]);
   await client.query('UPDATE support_grants SET revoked_at=clock_timestamp(),revoked_by_account_id=$2 WHERE organisation_id=$1 AND approved_by_account_id=$2 AND revoked_at IS NULL',[offer.organisation_id,offer.sender_id]);
   await client.query('UPDATE relay_grants SET revoked_at=clock_timestamp(),enabled=false WHERE organisation_id=$1 AND account_id=$2 AND revoked_at IS NULL',[offer.organisation_id,offer.sender_id]);
   await client.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE organisation_id=$1 AND account_id=$2 AND withdrawn_at IS NULL',[offer.organisation_id,offer.sender_id]);
   await client.query(`UPDATE translation_jobs j SET state='failed',reason='consent_required',finished_at=clock_timestamp(),lease_id=NULL,lease_until=NULL,failed=total-done
    FROM venues v WHERE j.venue_id=v.id AND v.organisation_id=$1 AND j.state IN ('queued','running')`,[offer.organisation_id]);
   await client.query('DELETE FROM organisation_memberships WHERE organisation_id=$1 AND account_id=$2',[offer.organisation_id,offer.sender_id]);
   await client.query(`INSERT INTO organisation_memberships(account_id,organisation_id,is_owner,can_register_venues,owner_since) VALUES($1,$2,true,true,clock_timestamp())
    ON CONFLICT(account_id,organisation_id) DO UPDATE SET is_owner=true,can_register_venues=true,owner_since=EXCLUDED.owner_since`,[session.accountId,offer.organisation_id]);
   const done=(await client.query("UPDATE owner_transfers SET state='accepted' WHERE id=$1 RETURNING *",[id])).rows[0];
   await notices(client,this.#outbox,done);await finalAuthority(client,token,csrf,offer);return view(client,done,session.accountId);
  });
 }
}

async function notices(client:PoolClient,outbox:EmailOutbox,offer:Offer){
 for(const email of new Set([offer.sender_email,offer.recipient_email]))await outbox.enqueue(client,'owner_transfer',{email,locale:offer.locale,offerId:offer.id,event:offer.state as 'accepted'|'cancelled'});
}
// Sign-up holds only its new account. Lock organisations before offers, matching cancellation.
export async function attachOwnerTransferRecipients(client:PoolClient,accountId:string,email:string):Promise<number>{
 const orgs=(await client.query("SELECT DISTINCT organisation_id FROM owner_transfers WHERE recipient_email=$1 AND recipient_id IS NULL AND state='pending' AND expires_at>clock_timestamp() ORDER BY organisation_id",[email])).rows;
 let attached=0;
 for(const row of orgs){
  await client.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE',[row.organisation_id]);
  const result=await client.query("UPDATE owner_transfers SET recipient_id=$1,recipient_needs_enrolment=true WHERE organisation_id=$2 AND recipient_email=$3 AND recipient_id IS NULL AND state='pending' AND expires_at>clock_timestamp()",[accountId,row.organisation_id,email]);
  attached+=result.rowCount??0;
 }
 return attached;
}
// Security writers already hold this account; never take the other participant’s account here.
export async function cancelOwnerTransfers(client:PoolClient,accountId:string,outbox?:EmailOutbox,initialEnrolment=false){
 let preserved=false;
 const orgs=(await client.query("SELECT DISTINCT organisation_id FROM owner_transfers WHERE state='pending' AND expires_at>clock_timestamp() AND (sender_id=$1 OR recipient_id=$1) ORDER BY organisation_id",[accountId])).rows;
 for(const row of orgs){
  await client.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE',[row.organisation_id]);
  const offers:Offer[]=(await client.query("SELECT * FROM owner_transfers WHERE organisation_id=$1 AND state='pending' AND expires_at>clock_timestamp() AND (sender_id=$2 OR recipient_id=$2) FOR UPDATE",[row.organisation_id,accountId])).rows;
  for(const offer of offers){
   if(initialEnrolment&&offer.recipient_id===accountId&&offer.recipient_needs_enrolment){preserved=true;await client.query('UPDATE owner_transfers SET recipient_needs_enrolment=false WHERE id=$1',[offer.id]);continue;}
   await client.query("UPDATE owner_transfers SET state='cancelled' WHERE id=$1",[offer.id]);
   if(outbox)await notices(client,outbox,{...offer,state:'cancelled'});
  }
 }
 return preserved;
}
export async function ownerTransferMailLive(client:PoolClient,message:OwnerTransferMail,lock=false){
 const offer:Offer=(await client.query('SELECT * FROM owner_transfers WHERE id=$1',[message.offerId])).rows[0];if(!offer)return false;
 if(lock){
  await lockAccounts(client,[offer.sender_id,offer.recipient_id]);
  await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE',[offer.organisation_id]);
  await client.query('SELECT id FROM owner_transfers WHERE id=$1 FOR SHARE',[offer.id]);
 }
 const current:Offer=(await client.query('SELECT * FROM owner_transfers WHERE id=$1',[offer.id])).rows[0];
 if(message.event==='invitation'){
  if(current.state!=='pending'||current.expires_at<=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now||message.email!==current.recipient_email)return false;
  return !!(await client.query(`SELECT 1 FROM cloud_accounts a JOIN cloud_credentials c ON c.account_id=a.id JOIN organisation_memberships m ON m.account_id=a.id
   WHERE a.id=$1 AND a.disabled_at IS NULL AND c.email=$2 AND c.email_verified_at IS NOT NULL AND m.organisation_id=$3 AND m.is_owner`,[current.sender_id,current.sender_email,current.organisation_id])).rowCount;
 }
 if(current.state!==message.event)return false;
 const accountId=message.email===current.sender_email?current.sender_id:message.email===current.recipient_email?current.recipient_id:null;
 return !!accountId&&!!(await client.query('SELECT 1 FROM cloud_accounts a JOIN cloud_credentials c ON c.account_id=a.id WHERE a.id=$1 AND a.disabled_at IS NULL AND c.email=$2 AND c.email_verified_at IS NOT NULL',[accountId,message.email])).rowCount;
}

async function finalAuthority(client:PoolClient,token:string,csrf:string,offer:Offer){
 await requireAccountActionProof(client,token,csrf);
 if(offer.expires_at<=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now)throw new OwnerTransferError();
}
