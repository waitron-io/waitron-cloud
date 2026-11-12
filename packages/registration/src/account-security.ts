import {createHash,randomBytes} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {hashSecret} from '@waitron-cloud/identity';
import {transaction} from './transaction.ts';
import {requireAccountActionProof,invalidateAccountActionProof,AccountActionProofError} from './account-action-proof.ts';
import {PasswordRecoveryError} from './password-recovery.ts';
import {normaliseEmail,validNewPassword,validLocale,type AccountLocale,type AccountEmail,type AccountNotification} from './account-input.ts';
import {screenPassword,type PasswordScreeningProvider} from './compromised-passwords.ts';
import type {EmailOutbox} from './email-outbox.ts';
import type {EmailDeliveryContext,EmailDeliveryReceipt} from './email-delivery.ts';

export interface EmailChangeMailer {
  sendEmailChange(message:AccountEmail,context?:EmailDeliveryContext):Promise<void|EmailDeliveryReceipt>;
  sendEmailChanged(message:AccountNotification,context?:EmailDeliveryContext):Promise<void|EmailDeliveryReceipt>;
}
export class AccountSecurityError extends Error {
  readonly code='change_unavailable' as const;
  constructor(){super('change_unavailable');this.name='AccountSecurityError';}
}

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export class AccountSecurityStore {
  readonly #pool:Pool;readonly #outbox:EmailOutbox;readonly #screening:PasswordScreeningProvider|undefined;
  constructor(pool:Pool,outbox:EmailOutbox,screening?:PasswordScreeningProvider){this.#pool=pool;this.#outbox=outbox;this.#screening=screening;}
  async password(token:string,csrfToken:string,password:string,locale:AccountLocale='en'){
    if(!validNewPassword(password)||!validLocale(locale))throw new PasswordRecoveryError('recovery_invalid');
    const admitted=await transaction(this.#pool,c=>requireAccountActionProof(c,token,csrfToken));
    const screened=await screenPassword(this.#screening,password);
    if(screened!=='acceptable')throw new PasswordRecoveryError(screened==='compromised'?'password_compromised':'password_screening_unavailable');
    const passwordHash=await hashSecret(password);
    await transaction(this.#pool,async client=>{
      const current=await requireAccountActionProof(client,token,csrfToken,false);
      if(current.securityRevision!==admitted.securityRevision)throw new AccountActionProofError();
      const credential=(await client.query('SELECT email FROM cloud_credentials WHERE account_id=$1',[current.accountId])).rows[0];
      await client.query('UPDATE cloud_credentials SET password_hash=$2 WHERE account_id=$1',[current.accountId,passwordHash]);
      await this.#endAuthority(client,current.accountId);
      await this.#outbox.enqueue(client,'password_changed',{email:credential.email,locale});
    });
  }
  async email(token:string,csrfToken:string,input:string,locale:AccountLocale='en'){
    const email=normaliseEmail(input);
    if(!email||!validLocale(locale))throw new PasswordRecoveryError('recovery_invalid');
    await transaction(this.#pool,async client=>{
      const session=await requireAccountActionProof(client,token,csrfToken);
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':email-change'),hashtext($1))",[email]);
      const recent=await client.query("SELECT 1 FROM cloud_email_changes WHERE email=$1 AND created_at>clock_timestamp()-interval '1 minute' LIMIT 1",[email]);
      if(recent.rowCount)return;
      const credential=(await client.query('SELECT email,password_hash FROM cloud_credentials WHERE account_id=$1',[session.accountId])).rows[0];
      await client.query('UPDATE cloud_email_changes SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[session.accountId]);
      if((await client.query('SELECT 1 FROM cloud_credentials WHERE email=$1',[email])).rowCount)return;
      const verification=randomBytes(32).toString('base64url');
      const expiresAt:Date=(await client.query("SELECT clock_timestamp()+interval '30 minutes' AS expiry")).rows[0].expiry;
      await client.query(`INSERT INTO cloud_email_changes(token_hash,account_id,session_token_hash,email,previous_email,password_fingerprint,security_revision,locale,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[digest(verification),session.accountId,digest(token),email,credential.email,digest(credential.password_hash),session.securityRevision,locale,expiresAt]);
      await this.#outbox.enqueue(client,'email_change',{email,token:verification,expiresAt:expiresAt.toISOString(),locale});
    });
    return {status:'accepted' as const};
  }
  async completeEmail(token:string,csrfToken:string,verification:string){
    if(typeof verification!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(verification))throw new AccountSecurityError();
    try{await transaction(this.#pool,async client=>{
      const session=await requireAccountActionProof(client,token,csrfToken,false);
      const pending=(await client.query('SELECT * FROM cloud_email_changes WHERE token_hash=$1 FOR UPDATE',[digest(verification)])).rows[0];
      const credential=(await client.query('SELECT email,password_hash FROM cloud_credentials WHERE account_id=$1',[session.accountId])).rows[0];
      const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if(!pending||pending.consumed_at||pending.expires_at<=now||pending.account_id!==session.accountId||pending.session_token_hash!==digest(token)
        ||pending.security_revision!==session.securityRevision||pending.previous_email!==credential.email||pending.password_fingerprint!==digest(credential.password_hash)
        ||(await client.query('SELECT 1 FROM cloud_credentials WHERE email=$1',[pending.email])).rowCount)throw new AccountSecurityError();
      await client.query('UPDATE cloud_credentials SET email=$2,email_verified_at=clock_timestamp() WHERE account_id=$1',[session.accountId,pending.email]);
      await this.#endAuthority(client,session.accountId);
      for(const email of [pending.previous_email,pending.email])await this.#outbox.enqueue(client,'email_changed',{email,locale:pending.locale});
      if(!(await client.query('UPDATE cloud_email_changes SET consumed_at=clock_timestamp() WHERE token_hash=$1 AND expires_at>clock_timestamp() RETURNING token_hash',[digest(verification)])).rowCount)throw new AccountSecurityError();
    });}catch(error){
      if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')throw new AccountSecurityError();
      throw error;
    }
  }
  async #endAuthority(client:PoolClient,accountId:string){
    await invalidateAccountActionProof(client,accountId);
    await client.query('UPDATE cloud_factor_login_challenges SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[accountId]);
    await client.query('UPDATE cloud_sign_in_checks SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[accountId]);
    await client.query('DELETE FROM cloud_recognised_browsers WHERE account_id=$1',[accountId]);
    await client.query('UPDATE cloud_email_changes SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[accountId]);
    await client.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1 AND ended_at IS NULL',[accountId]);
  }
}
