import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {resolveSession,IdentityError,type FactorKeys} from '@waitron-cloud/identity';
import {transaction} from './transaction.ts';
import {issueSignInCheck,signInCodeHash} from './sign-in-check.ts';
import type {EmailOutbox} from './email-outbox.ts';
import type {AccountLocale} from './account-input.ts';
import {consumeFactorProof,factorNow,type FactorProof} from './password-login.ts';
import {consumeAccountRecoveryCode} from './account-recovery-codes.ts';

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export class AccountActionProofError extends Error {
  readonly code='proof_required' as const;
  constructor(){super('proof_required');this.name='AccountActionProofError';}
}
export async function accountActionSession(client:PoolClient,token:string,csrfToken:string){
  const candidate=(await client.query('SELECT account_id FROM cloud_sessions WHERE token_hash=$1',[digest(token)])).rows[0];
  if(!candidate)throw new AccountActionProofError();
  await client.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[candidate.account_id]);
  const session=await resolveSession(client,token,{csrfToken,touch:false});
  const row=(await client.query('SELECT action_security_revision FROM cloud_sessions WHERE token_hash=$1',[digest(token)])).rows[0];
  return {...session,securityRevision:row.action_security_revision as number};
}
export async function requireAccountActionProof(client:PoolClient,token:string,csrfToken:string,fresh=true){
  const session=await accountActionSession(client,token,csrfToken);
  const row=(await client.query(`SELECT action_proved_at>clock_timestamp()-interval '10 minutes'
    AND action_proved_at<=clock_timestamp() AS fresh,action_credential_fingerprint,c.password_hash FROM cloud_sessions s JOIN cloud_credentials c ON c.account_id=s.account_id WHERE token_hash=$1`,[digest(token)])).rows[0];
  if(!row?.action_credential_fingerprint||fresh&&!row.fresh)throw new AccountActionProofError();
  if(!row.password_hash||row.action_credential_fingerprint!==digest(row.password_hash))throw new IdentityError('credentials_invalid');
  return session;
}
export async function markAccountActionProof(client:PoolClient,token:string,csrfToken:string,method:'email'|'app'|'passkey'|'recovery'){
  await accountActionSession(client,token,csrfToken);
  const credential=(await client.query('SELECT c.password_hash FROM cloud_credentials c JOIN cloud_sessions s ON s.account_id=c.account_id WHERE s.token_hash=$1',[digest(token)])).rows[0];
  await client.query('UPDATE cloud_sessions SET action_proved_at=clock_timestamp(),action_proof_method=$2,action_credential_fingerprint=$3 WHERE token_hash=$1',[digest(token),method,digest(credential.password_hash)]);
}
export async function invalidateAccountActionProof(client:PoolClient,accountId:string){
  await client.query('UPDATE cloud_sessions SET action_proved_at=NULL,action_proof_method=NULL,action_credential_fingerprint=NULL,action_security_revision=action_security_revision+1 WHERE account_id=$1',[accountId]);
  await client.query(`UPDATE cloud_webauthn_ceremonies SET consumed_at=clock_timestamp() WHERE consumed_at IS NULL
    AND (account_id=$1 OR action_session_token_hash IN(SELECT token_hash FROM cloud_sessions WHERE account_id=$1))`,[accountId]);
  await client.query('UPDATE cloud_sign_in_checks SET consumed_at=clock_timestamp() WHERE account_id=$1 AND action_session_token_hash IS NOT NULL AND consumed_at IS NULL',[accountId]);
  await client.query('UPDATE cloud_factor_enrolments SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[accountId]);
}
export class AccountActionProofStore {
  readonly #pool:Pool;readonly #keys:FactorKeys|null;readonly #policy:{challengeAttempts:number}|null;readonly #outbox:EmailOutbox|undefined;
  constructor(pool:Pool,keys:FactorKeys|null,policy:{challengeAttempts:number}|null,outbox?:EmailOutbox){this.#pool=pool;this.#keys=keys;this.#policy=policy;this.#outbox=outbox;}
  async status(token:string){
    return transaction(this.#pool,async client=>{
      const session=await resolveSession(client,token,{touch:false});
      const row=(await client.query(`SELECT EXISTS(SELECT 1 FROM cloud_passkeys WHERE account_id=$1) AS passkey,
        EXISTS(SELECT 1 FROM cloud_authenticator_factors WHERE account_id=$1 AND secret_envelope IS NOT NULL) AS app,
        CASE WHEN action_proved_at>clock_timestamp()-interval '10 minutes' THEN action_proved_at+interval '10 minutes' END AS fresh_until
        FROM cloud_sessions WHERE token_hash=$2`,[session.accountId,digest(token)])).rows[0];
      return {methods:row.passkey||row.app?[...(row.passkey?['passkey']:[]),...(row.app?['app']:[]),'recovery']:['email'],freshUntil:row.fresh_until?.toISOString()??null};
    });
  }
  async factor(token:string,csrfToken:string,proof:FactorProof){
    await transaction(this.#pool,async client=>{
      const session=await accountActionSession(client,token,csrfToken);
      const factor=(await client.query('SELECT * FROM cloud_authenticator_factors WHERE account_id=$1 FOR UPDATE',[session.accountId])).rows[0];
      const deadline=new Date(session.expiresAt);
      const valid=proof?.kind==='recovery'
        ?await consumeAccountRecoveryCode(client,session.accountId,proof.code,deadline)
        :factor?.secret_envelope&&await consumeFactorProof(client,factor,this.#keys,proof,deadline);
      if(!valid)throw new AccountActionProofError();
      await markAccountActionProof(client,token,csrfToken,proof.kind==='recovery'?'recovery':'app');
      if(await factorNow(client)>=(valid instanceof Date?valid:deadline))throw new AccountActionProofError();
    });
  }
  async email(token:string,csrfToken:string,locale?:AccountLocale){
    return transaction(this.#pool,async client=>{
      const session=await accountActionSession(client,token,csrfToken);
      const credential=(await client.query('SELECT email,password_hash FROM cloud_credentials WHERE account_id=$1',[session.accountId])).rows[0];
      const enrolled=(await client.query(`SELECT EXISTS(SELECT 1 FROM cloud_passkeys WHERE account_id=$1)
        OR EXISTS(SELECT 1 FROM cloud_authenticator_factors WHERE account_id=$1 AND secret_envelope IS NOT NULL) AS yes`,[session.accountId])).rows[0].yes;
      if(enrolled)throw new AccountActionProofError();
      const challenge=await issueSignInCheck(client,this.#outbox,this.#policy,{accountId:session.accountId,email:credential.email,passwordFingerprint:digest(credential.password_hash),locale});
      await client.query('UPDATE cloud_sign_in_checks SET action_session_token_hash=$2 WHERE token_hash=$1',[digest(challenge.challengeToken),digest(token)]);
      await resolveSession(client,token,{csrfToken,touch:false});return challenge;
    });
  }
  async completeEmail(token:string,csrfToken:string,challengeToken:string,code:string){
    const result=await transaction(this.#pool,async client=>{
      const session=await accountActionSession(client,token,csrfToken);
      const row=(await client.query('SELECT * FROM cloud_sign_in_checks WHERE token_hash=$1 FOR UPDATE',[digest(challengeToken)])).rows[0];
      const credential=(await client.query('SELECT email,password_hash FROM cloud_credentials WHERE account_id=$1',[session.accountId])).rows[0];
      const enrolled=(await client.query(`SELECT EXISTS(SELECT 1 FROM cloud_passkeys WHERE account_id=$1)
        OR EXISTS(SELECT 1 FROM cloud_authenticator_factors WHERE account_id=$1 AND secret_envelope IS NOT NULL) AS yes`,[session.accountId])).rows[0].yes;
      const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if(enrolled||!row||row.account_id!==session.accountId||row.action_session_token_hash!==digest(token)||row.consumed_at||row.expires_at<=now||row.attempts>=row.attempt_limit
        ||row.password_fingerprint!==digest(credential.password_hash)||row.email_hash!==digest(credential.email))return false;
      await client.query('UPDATE cloud_sign_in_checks SET attempts=attempts+1 WHERE token_hash=$1',[digest(challengeToken)]);
      if(typeof code!=='string'||!/^\d{6}$/.test(code)||signInCodeHash(challengeToken,code)!==row.code_hash)return false;
      await client.query('SAVEPOINT action_proof_effects');
      try{
        await markAccountActionProof(client,token,csrfToken,'email');
        await client.query('UPDATE cloud_sign_in_checks SET consumed_at=clock_timestamp() WHERE token_hash=$1',[digest(challengeToken)]);
        if(await factorNow(client)>=row.expires_at)throw new AccountActionProofError();
        return true;
      }catch(error){
        if(!(error instanceof IdentityError)&&!(error instanceof AccountActionProofError))throw error;
        await client.query('ROLLBACK TO SAVEPOINT action_proof_effects');return false;
      }
    });
    if(!result)throw new AccountActionProofError();
  }
}
