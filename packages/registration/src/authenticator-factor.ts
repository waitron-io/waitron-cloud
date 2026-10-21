import {randomBytes, randomUUID} from 'node:crypto';
import type {Pool, PoolClient} from 'pg';
import {decryptFactorSecret, encryptFactorSecret, IdentityError, requirePasswordAuthority, resolveSession,
  type FactorKeys} from '@waitron-cloud/identity';
import {consumeFactorProof, factorDigest, factorNow, FactorError, recoveryCodeHash,
  type ActiveFactor, type FactorProof} from './password-login.ts';
import {transaction} from './transaction.ts';

export interface FactorAuthority {token: string; csrfToken: string; password: string; proof?: FactorProof}
export interface FactorManagementPolicy {pendingLifetimeMs: number; enrolmentAttempts: number}
export class FactorManagementError extends Error {
  readonly code: 'permission_denied' | 'invalid_input' | 'temporarily_unavailable';
  constructor(code: FactorManagementError['code'] = 'permission_denied') {super(code); this.name='FactorManagementError'; this.code=code;}
}
interface Context {
  client: PoolClient; accountId: string; sessionId: string; email: string; fingerprint: string;
  deadline: Date; factor: ActiveFactor | {account_id: string; version: number; secret_envelope: null};
}
interface Pending {
  id: string; account_id: string; session_id: string; password_fingerprint: string; base_version: number;
  secret_envelope: string; expires_at: Date; consumed_at: Date | null; attempts: number; attempt_limit: number;
}
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
function expected(error: unknown): FactorManagementError | null {
  if (error instanceof FactorManagementError) return error;
  if (error instanceof FactorError) return new FactorManagementError(error.code==='temporarily_unavailable' ? error.code : 'permission_denied');
  if (error instanceof IdentityError) return new FactorManagementError();
  return null;
}
function freshSecret(): string {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return [...randomBytes(20)].map(byte=>byte.toString(2).padStart(8,'0')).join('').match(/.{5}/g)!
    .map(bits=>alphabet[parseInt(bits,2)]).join('');
}
export class AuthenticatorFactorStore {
  readonly #pool: Pool;
  readonly #keys: FactorKeys | null;
  readonly #policy: FactorManagementPolicy | null;
  constructor(pool: Pool, keys: FactorKeys | null, policy: FactorManagementPolicy | null) {
    this.#pool=pool;this.#keys=keys;this.#policy=policy;
  }
  #policyReady(): FactorManagementPolicy {
    const p=this.#policy;
    if (!p || !Number.isSafeInteger(p.pendingLifetimeMs) || p.pendingLifetimeMs<1 || p.pendingLifetimeMs>300_000
      || !Number.isSafeInteger(p.enrolmentAttempts) || p.enrolmentAttempts<1 || p.enrolmentAttempts>2147483647)
      throw new FactorManagementError('temporarily_unavailable');
    return p;
  }
  #encrypt(secret: string, accountId: string, version: number, pendingId?: string): string {
    try {return encryptFactorSecret(secret,this.#keys!,pendingId
      ? {accountId,version,purpose:'pending',pendingId} : {accountId,version,purpose:'active'});}
    catch {throw new FactorManagementError('temporarily_unavailable');}
  }
  async status(token: string): Promise<{active:boolean;version:number;recoveryCodesRemaining:number;available:boolean}> {
    return transaction(this.#pool,async client=>{
      const session=await resolveSession(client,token,{touch:false});
      const row=(await client.query('SELECT * FROM cloud_authenticator_factors WHERE account_id=$1',[session.accountId])).rows[0];
      const count=(await client.query(`SELECT count(*)::integer AS count FROM cloud_factor_recovery_codes
        WHERE account_id=$1 AND factor_version=$2 AND secret_generation=$3 AND consumed_at IS NULL`,
        [session.accountId,row?.version??0,row?.secret_generation??null])).rows[0].count;
      let available=true;
      try {
        this.#policyReady();
        this.#encrypt(freshSecret(),session.accountId,Math.max(1,row?.version??0));
        if(row?.secret_envelope && !decryptFactorSecret(row.secret_envelope,this.#keys!,
          {accountId:session.accountId,version:row.version,purpose:'active'})) available=false;
      } catch {available=false;}
      await resolveSession(client,token,{touch:false});
      return {active:!!row?.secret_envelope,version:row?.version??0,recoveryCodesRemaining:count,available};
    });
  }
  async #session(client: PoolClient, token: string, csrfToken: string): Promise<{accountId:string;sessionId:string;deadline:Date}> {
    if(typeof token!=='string' || !TOKEN.test(token)) throw new FactorManagementError();
    const row=(await client.query('SELECT account_id FROM cloud_sessions WHERE token_hash=$1',[factorDigest(token)])).rows[0];
    if(!row) throw new FactorManagementError();
    const account=await client.query('SELECT id FROM cloud_accounts WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',[row.account_id]);
    if(!account.rowCount) throw new FactorManagementError();
    const session=await resolveSession(client,token,{csrfToken,touch:false});
    const id=(await client.query('SELECT id FROM cloud_sessions WHERE token_hash=$1 AND account_id=$2',[factorDigest(token),session.accountId])).rows[0].id;
    return {accountId:session.accountId,sessionId:id,deadline:new Date(session.expiresAt)};
  }
  async #authority(client: PoolClient, a: FactorAuthority): Promise<Context> {
    if(typeof a.token!=='string' || !TOKEN.test(a.token)) throw new FactorManagementError();
    const candidate=(await client.query('SELECT account_id FROM cloud_sessions WHERE token_hash=$1',[factorDigest(a.token)])).rows[0];
    if(!candidate) throw new FactorManagementError();
    // Derive before locks, then take account UPDATE before credentials, actor session and factor children.
    const password=await requirePasswordAuthority(client,{accountId:candidate.account_id},a.password,'update');
    const session=await this.#session(client,a.token,a.csrfToken);
    if(session.accountId!==password.accountId) throw new FactorManagementError();
    const email=(await client.query('SELECT email FROM cloud_credentials WHERE account_id=$1',[session.accountId])).rows[0].email;
    await client.query('INSERT INTO cloud_authenticator_factors(account_id) VALUES($1) ON CONFLICT DO NOTHING',[session.accountId]);
    const factor=(await client.query('SELECT * FROM cloud_authenticator_factors WHERE account_id=$1 FOR UPDATE',[session.accountId])).rows[0];
    await resolveSession(client,a.token,{csrfToken:a.csrfToken,touch:false});
    return {client,...session,email,fingerprint:password.passwordFingerprint,factor};
  }
  async #run<T>(a: FactorAuthority, action:(context:Context)=>Promise<T>, pendingToken?:string):Promise<T> {
    const result=await transaction(this.#pool,async client=>{
      let context:Context;
      try {context=await this.#authority(client,a);this.#policyReady();}
      catch(error) {const refusal=expected(error);if(refusal) return refusal;throw error;}
      let pending:Pending|undefined;
      if(pendingToken!==undefined) {
        if(typeof pendingToken!=='string' || !TOKEN.test(pendingToken)) return new FactorManagementError('invalid_input');
        pending=(await client.query('SELECT * FROM cloud_factor_enrolments WHERE token_hash=$1 FOR UPDATE',[factorDigest(pendingToken)])).rows[0];
        if(!pending || pending.account_id!==context.accountId || pending.session_id!==context.sessionId
          || pending.password_fingerprint!==context.fingerprint || pending.base_version!==context.factor.version
          || pending.consumed_at || pending.expires_at<=await factorNow(client) || pending.attempts>=pending.attempt_limit)
          return new FactorManagementError('invalid_input');
        context.deadline=new Date(Math.min(context.deadline.getTime(),pending.expires_at.getTime()));
        await client.query('UPDATE cloud_factor_enrolments SET attempts=attempts+1 WHERE token_hash=$1',[factorDigest(pendingToken)]);
      }
      // Keep failed confirmation attempts durable; undo every proof and change on an expected refusal.
      await client.query('SAVEPOINT management_effects');
      try {
        await resolveSession(client,a.token,{csrfToken:a.csrfToken,touch:false});
        if(context.factor.secret_envelope) {
          const deadline=await consumeFactorProof(client,context.factor,this.#keys,a.proof!,context.deadline);
          if(!deadline) throw new FactorManagementError();
          context.deadline=deadline;
        }
        const value=await action(context);
        if(await factorNow(client)>=context.deadline) throw new FactorManagementError();
        return value;
      } catch(error) {
        const refusal=expected(error);if(!refusal) throw error;
        await client.query('ROLLBACK TO SAVEPOINT management_effects');return refusal;
      }
    });
    if(result instanceof FactorManagementError) throw result;
    return result;
  }
  async begin(a:FactorAuthority):Promise<{pendingToken:string;secret:string;uri:string;expiresAt:string}> {
    return this.#run(a,async c=>{
      const p=this.#policyReady(),secret=freshSecret(),id=randomUUID(),pendingToken=randomBytes(32).toString('base64url');
      const envelope=this.#encrypt(secret,c.accountId,c.factor.version+1,id),now=await factorNow(c.client);
      const expiresAt=new Date(now.getTime()+p.pendingLifetimeMs);
      await c.client.query('UPDATE cloud_factor_enrolments SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[c.accountId]);
      await c.client.query(`INSERT INTO cloud_factor_enrolments
        (id,token_hash,account_id,session_id,password_fingerprint,base_version,secret_envelope,created_at,expires_at,attempt_limit)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,factorDigest(pendingToken),c.accountId,c.sessionId,c.fingerprint,c.factor.version,envelope,now,expiresAt,p.enrolmentAttempts]);
      c.deadline=new Date(Math.min(c.deadline.getTime(),expiresAt.getTime()));
      await resolveSession(c.client,a.token,{csrfToken:a.csrfToken,touch:false});
      const params=new URLSearchParams({secret,issuer:'Waitron Cloud',algorithm:'SHA1',digits:'6',period:'30'});
      return {pendingToken,secret,uri:`otpauth://totp/${encodeURIComponent(`Waitron Cloud:${c.email}`)}?${params}`,expiresAt:expiresAt.toISOString()};
    });
  }
  async #lockSessions(c:Context,a:FactorAuthority):Promise<void> {
    await c.client.query('SELECT id FROM cloud_sessions WHERE account_id=$1 ORDER BY id FOR UPDATE',[c.accountId]);
    await resolveSession(c.client,a.token,{csrfToken:a.csrfToken,touch:false});
  }
  async #changed(c:Context):Promise<void> {
    await c.client.query('UPDATE cloud_factor_enrolments SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[c.accountId]);
    await c.client.query('UPDATE cloud_factor_login_challenges SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[c.accountId]);
    await c.client.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1 AND ended_at IS NULL',[c.accountId]);
  }
  async #codes(c:Context,generation:string,version:number):Promise<string[]> {
    const codes=Array.from({length:10},()=>randomBytes(16).toString('hex').toUpperCase());
    // Superseded codes become unusable, but their hashes remain until a retention policy permits deletion.
    await c.client.query('UPDATE cloud_factor_recovery_codes SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[c.accountId]);
    for(const code of codes) await c.client.query(`INSERT INTO cloud_factor_recovery_codes(account_id,secret_generation,factor_version,code_hash)
      VALUES($1,$2,$3,$4)`,[c.accountId,generation,version,recoveryCodeHash(c.accountId,version,code)]);
    return codes;
  }
  async activate(a:FactorAuthority,pendingToken:string,code:string):Promise<{status:'changed';active:true;recoveryCodes:string[]}> {
    return this.#run(a,async c=>{
      const pending:Pending=(await c.client.query('SELECT * FROM cloud_factor_enrolments WHERE token_hash=$1',[factorDigest(pendingToken)])).rows[0];
      const version=c.factor.version+1;
      const secret=decryptFactorSecret(pending.secret_envelope,this.#keys!,{accountId:c.accountId,version,purpose:'pending',pendingId:pending.id});
      if(!secret) throw new FactorManagementError('temporarily_unavailable');
      const envelope=this.#encrypt(secret,c.accountId,version);
      const deadline=await consumeFactorProof(c.client,{account_id:c.accountId,version,secret_generation:pending.id,secret_envelope:envelope},
        this.#keys,{kind:'totp',code},c.deadline);
      if(!deadline) throw new FactorManagementError();c.deadline=deadline;
      await this.#lockSessions(c,a);
      await c.client.query('UPDATE cloud_authenticator_factors SET version=$2,secret_generation=$3,secret_envelope=$4 WHERE account_id=$1',[c.accountId,version,pending.id,envelope]);
      const recoveryCodes=await this.#codes(c,pending.id,version);
      await this.#changed(c);return {status:'changed',active:true,recoveryCodes};
    },pendingToken);
  }
  async regenerate(a:FactorAuthority):Promise<{status:'changed';active:true;recoveryCodes:string[]}> {
    return this.#run(a,async c=>{
      if(!c.factor.secret_envelope) throw new FactorManagementError('invalid_input');
      const secret=decryptFactorSecret(c.factor.secret_envelope,this.#keys!,{accountId:c.accountId,version:c.factor.version,purpose:'active'});
      if(!secret) throw new FactorManagementError('temporarily_unavailable');
      const version=c.factor.version+1,envelope=this.#encrypt(secret,c.accountId,version);
      await this.#lockSessions(c,a);
      await c.client.query('UPDATE cloud_authenticator_factors SET version=$2,secret_envelope=$3 WHERE account_id=$1',[c.accountId,version,envelope]);
      const recoveryCodes=await this.#codes(c,c.factor.secret_generation,version);
      await this.#changed(c);return {status:'changed',active:true,recoveryCodes};
    });
  }
  async remove(a:FactorAuthority):Promise<{status:'changed';active:false}> {
    return this.#run(a,async c=>{
      if(!c.factor.secret_envelope) throw new FactorManagementError('invalid_input');
      await this.#lockSessions(c,a);
      await c.client.query('UPDATE cloud_authenticator_factors SET version=version+1,secret_envelope=NULL,secret_generation=NULL WHERE account_id=$1',[c.accountId]);
      await c.client.query('UPDATE cloud_factor_recovery_codes SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[c.accountId]);
      await this.#changed(c);return {status:'changed',active:false};
    });
  }
  async cancel(token:string,csrfToken:string,pendingToken:string):Promise<void> {
    try {
      await transaction(this.#pool,async client=>{
        const session=await this.#session(client,token,csrfToken);
        if(typeof pendingToken!=='string' || !TOKEN.test(pendingToken)) throw new FactorManagementError('invalid_input');
        const pending:Pending=(await client.query('SELECT * FROM cloud_factor_enrolments WHERE token_hash=$1 FOR UPDATE',[factorDigest(pendingToken)])).rows[0];
        if(!pending || pending.account_id!==session.accountId || pending.session_id!==session.sessionId || pending.consumed_at
          || pending.expires_at<=await factorNow(client)) throw new FactorManagementError('invalid_input');
        await client.query('UPDATE cloud_factor_enrolments SET consumed_at=clock_timestamp() WHERE token_hash=$1',[factorDigest(pendingToken)]);
        await resolveSession(client,token,{csrfToken,touch:false});
        if(await factorNow(client)>=pending.expires_at) throw new FactorManagementError('invalid_input');
      });
    } catch(error) {throw expected(error)??error;}
  }
}
