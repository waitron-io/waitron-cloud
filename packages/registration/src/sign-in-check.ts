import {createSession, IdentityError} from '@waitron-cloud/identity';
import {transaction} from './transaction.ts';
import {consumeAccountRecoveryCode} from './account-recovery-codes.ts';
import {createHash, randomBytes, randomInt} from 'node:crypto';
import type {Pool, PoolClient} from 'pg';
import type {AccountLocale, AccountSignInCheck} from './account-input.ts';
import type {EmailDeliveryContext, EmailDeliveryReceipt} from './email-delivery.ts';
import type {EmailOutbox} from './email-outbox.ts';

export interface SignInCheckMailer {
  sendSignInCheck(message: AccountSignInCheck, context?: EmailDeliveryContext): Promise<void | EmailDeliveryReceipt>;
}
export class SignInCheckError extends Error {
  readonly code: 'credentials_invalid' | 'temporarily_unavailable';
  constructor(code: SignInCheckError['code'] = 'credentials_invalid') {super(code); this.name = 'SignInCheckError'; this.code = code;}
}
export type EmailSignInChallenge = {kind: 'email'; challengeToken: string; expiresAt: string; rememberBrowserAllowed?: true};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
// Bind the code digest to the opaque browser challenge, rather than a six-digit value alone.
export const signInCodeHash = (token: string, code: string) => digest(JSON.stringify(['cloud-email-sign-in-v1',token,code]));

export type RememberedCredentials = import('@waitron-cloud/identity').SessionCredentials & {browserToken?: string};
export async function rememberBrowser(client: PoolClient, accountId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await client.query('DELETE FROM cloud_recognised_browsers WHERE account_id=$1 AND expires_at<=clock_timestamp()',[accountId]);
  await client.query(`INSERT INTO cloud_recognised_browsers(token_hash,account_id,created_at,expires_at)
    VALUES($1,$2,statement_timestamp(),statement_timestamp()+interval '30 days')`,[digest(token),accountId]);
  return token;
}
export async function recognisedBrowser(client: PoolClient, accountId: string, token?: string): Promise<boolean> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return !!(await client.query(`SELECT 1 FROM cloud_recognised_browsers
    WHERE token_hash=$1 AND account_id=$2 AND expires_at>clock_timestamp()`,[digest(token),accountId])).rowCount;
}

export async function issueSignInCheck(client: PoolClient, outbox: EmailOutbox | undefined,
  policy: {challengeAttempts: number} | null, input: {accountId: string; email: string; passwordFingerprint: string; locale?: AccountLocale; rememberBrowserAllowed?: boolean}): Promise<EmailSignInChallenge> {
  if (!outbox || !policy || !Number.isSafeInteger(policy.challengeAttempts) || policy.challengeAttempts < 1 || policy.challengeAttempts > 2147483647)
    throw new SignInCheckError('temporarily_unavailable');
  const token = randomBytes(32).toString('base64url'), code = randomInt(1_000_000).toString().padStart(6,'0');
  const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
  const expiresAt = new Date(now.getTime() + 300_000).toISOString();
  await client.query(`INSERT INTO cloud_sign_in_checks(token_hash,account_id,email_hash,password_fingerprint,code_hash,created_at,expires_at,attempt_limit)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [digest(token),input.accountId,digest(input.email),input.passwordFingerprint,signInCodeHash(token,code),now,expiresAt,policy.challengeAttempts]);
  await outbox.enqueue(client,'sign_in_check',{email:input.email,token,code,expiresAt,locale:input.locale});
  if ((await client.query('SELECT clock_timestamp() >= $1::timestamptz AS expired',[expiresAt])).rows[0].expired) throw new SignInCheckError();
  return {kind:'email',challengeToken:token,expiresAt,...(input.rememberBrowserAllowed?{rememberBrowserAllowed:true as const}:{})};
}

export async function completeSignInCheck(pool: Pool, token: string, code: string, remember = false, method:'email'|'recovery' = 'email'): Promise<RememberedCredentials> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new SignInCheckError();
  const result = await transaction(pool,async client => {
    const tokenHash = digest(token);
    const candidate = (await client.query('SELECT account_id FROM cloud_sign_in_checks WHERE token_hash=$1',[tokenHash])).rows[0];
    if (!candidate) return new SignInCheckError();
    // Match password/reset authority before locking its challenge row.
    const account = await client.query('SELECT id FROM cloud_accounts WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',[candidate.account_id]);
    if (!account.rowCount) return new SignInCheckError();
    const credential = (await client.query('SELECT email,password_hash FROM cloud_credentials WHERE account_id=$1 FOR UPDATE',[candidate.account_id])).rows[0];
    const factor = (await client.query('SELECT secret_envelope FROM cloud_authenticator_factors WHERE account_id=$1 FOR UPDATE',[candidate.account_id])).rows[0];
    const check = (await client.query('SELECT * FROM cloud_sign_in_checks WHERE token_hash=$1 FOR UPDATE',[tokenHash])).rows[0];
    const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    if (factor?.secret_envelope || !check || check.action_session_token_hash || check.consumed_at || check.expires_at <= now || check.attempts >= check.attempt_limit
      || !credential?.password_hash || digest(credential.email) !== check.email_hash || digest(credential.password_hash) !== check.password_fingerprint) return new SignInCheckError();
    await client.query('UPDATE cloud_sign_in_checks SET attempts=attempts+1 WHERE token_hash=$1',[tokenHash]);
    if (method==='email'&&(typeof code !== 'string' || !/^[0-9]{6}$/.test(code) || signInCodeHash(token,code) !== check.code_hash)) return new SignInCheckError();
    // Refused late effects roll back while the spent proof attempt remains committed.
    await client.query('SAVEPOINT email_sign_in_effects');
    try {
      if(method==='recovery'&&!await consumeAccountRecoveryCode(client,candidate.account_id,code,check.expires_at))throw new SignInCheckError();
      await client.query('UPDATE cloud_sign_in_checks SET consumed_at=clock_timestamp() WHERE token_hash=$1',[tokenHash]);
      const credentials = await createSession(client,candidate.account_id);
      const passkeys=remember?await client.query('SELECT 1 FROM cloud_passkeys WHERE account_id=$1 LIMIT 1',[candidate.account_id]):undefined;
      const browserToken=method==='email'&&remember&&!passkeys?.rowCount?await rememberBrowser(client,candidate.account_id):undefined;
      if ((await client.query('SELECT clock_timestamp() >= $1::timestamptz AS expired',[check.expires_at])).rows[0].expired) throw new SignInCheckError();
      return {...credentials,...(browserToken ? {browserToken} : {})};
    } catch (error) {
      if (!(error instanceof SignInCheckError) && !(error instanceof IdentityError)) throw error;
      await client.query('ROLLBACK TO SAVEPOINT email_sign_in_effects');
      return new SignInCheckError();
    }
  });
  if (result instanceof SignInCheckError) throw result;
  return result;
}
