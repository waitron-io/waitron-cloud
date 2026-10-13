import {createHash, randomBytes} from 'node:crypto';
import type {Pool, PoolClient} from 'pg';
import {createSession, decryptFactorSecret, IdentityError, matchedTotpSteps, requirePasswordAuthority,
  type FactorKeys, type SessionCredentials} from '@waitron-cloud/identity';
import {transaction} from './transaction.ts';

export type FactorProof = {kind: 'totp' | 'recovery'; code: string};
export interface PasswordLoginPolicy {loginLifetimeMs: number; challengeAttempts: number}
export type PasswordLoginResult = {kind: 'session'; credentials: SessionCredentials}
  | {kind: 'factor'; challengeToken: string; expiresAt: string};
export class FactorError extends Error {
  readonly code: 'credentials_invalid' | 'temporarily_unavailable';
  constructor(code: FactorError['code'] = 'credentials_invalid') {super(code); this.name = 'FactorError'; this.code = code;}
}
export interface ActiveFactor {
  account_id: string;
  version: number;
  secret_generation: string;
  secret_envelope: string;
}
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const factorDigest = (value: string) => createHash('sha256').update(value).digest('hex');
export function recoveryCodeHash(accountId: string, version: number, code: string): string {
  return factorDigest(JSON.stringify(['cloud-factor-recovery-v1', accountId, version, code]));
}
export async function factorNow(client: PoolClient): Promise<Date> {
  return (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
}
function secretFor(factor: ActiveFactor, keys: FactorKeys | null): string {
  const secret = decryptFactorSecret(factor.secret_envelope, keys!,
    {accountId: factor.account_id, version: factor.version, purpose: 'active'});
  if (!secret) throw new FactorError('temporarily_unavailable');
  return secret;
}
/** Caller holds the account and factor locks; proof effects must share the action's savepoint. */
export async function consumeFactorProof(client: PoolClient, factor: ActiveFactor, keys: FactorKeys | null,
  proof: FactorProof, deadline: Date): Promise<Date | null> {
  const secret = secretFor(factor, keys);
  if (!proof || typeof proof !== 'object' || Object.keys(proof).sort().join(',') !== 'code,kind'
    || typeof proof.code !== 'string') return null;
  if (proof.kind === 'recovery') {
    if (!/^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{8}){3})$/.test(proof.code)) return null;
    const codeHash = recoveryCodeHash(factor.account_id, factor.version, proof.code.replaceAll('-', '').toUpperCase());
    const row = (await client.query(`SELECT consumed_at FROM cloud_factor_recovery_codes
      WHERE account_id=$1 AND secret_generation=$2 AND factor_version=$3 AND code_hash=$4 FOR UPDATE`,
      [factor.account_id, factor.secret_generation, factor.version, codeHash])).rows[0];
    const now = await factorNow(client);
    if (!row || row.consumed_at || now >= deadline) return null;
    await client.query(`UPDATE cloud_factor_recovery_codes SET consumed_at=$5
      WHERE account_id=$1 AND secret_generation=$2 AND factor_version=$3 AND code_hash=$4`,
      [factor.account_id, factor.secret_generation, factor.version, codeHash, now]);
    return deadline;
  }
  if (proof.kind !== 'totp') return null;
  const now = await factorNow(client);
  if (now >= deadline) return null;
  const steps = matchedTotpSteps(secret, proof.code, now.getTime());
  if (!steps.length) return null;
  const codeHash = factorDigest(JSON.stringify(['cloud-factor-proof-v1', factor.account_id, factor.secret_generation, proof.code]));
  const used = await client.query(`SELECT 1 FROM cloud_factor_replays
    WHERE account_id=$1 AND secret_generation=$2
      AND (time_step=ANY($3::bigint[]) OR (code_hash=$4 AND valid_until>$5))`,
    [factor.account_id, factor.secret_generation, steps, codeHash, now]);
  if (used.rowCount) return null;
  // Keep every matching step and the code digest until the latest match leaves the tolerated window.
  const validUntil = new Date((Math.max(...steps) + 2) * 30_000);
  for (const step of steps) {
    await client.query(`INSERT INTO cloud_factor_replays(account_id,secret_generation,time_step,code_hash,valid_until)
      VALUES($1,$2,$3,$4,$5)`, [factor.account_id, factor.secret_generation, step, codeHash, validUntil]);
  }
  return new Date(Math.min(deadline.getTime(), validUntil.getTime()));
}
function requirePolicy(policy: PasswordLoginPolicy | null): PasswordLoginPolicy {
  if (!policy || !Number.isSafeInteger(policy.loginLifetimeMs) || policy.loginLifetimeMs < 1
    || policy.loginLifetimeMs > 300_000 || !Number.isSafeInteger(policy.challengeAttempts)
    || policy.challengeAttempts < 1 || policy.challengeAttempts > 2147483647) throw new FactorError('temporarily_unavailable');
  return policy;
}
export class PasswordLoginStore {
  readonly #pool: Pool;
  readonly #keys: FactorKeys | null;
  readonly #policy: PasswordLoginPolicy | null;
  constructor(pool: Pool, keys: FactorKeys | null, policy: PasswordLoginPolicy | null) {
    this.#pool = pool; this.#keys = keys; this.#policy = policy;
  }
  async start(input: {email: string; password: string},
    verified?: (accountId:string, client:PoolClient)=>Promise<Error|void>): Promise<PasswordLoginResult> {
    const result = await transaction<PasswordLoginResult | Error>(this.#pool, async client => {
      const authority = await requirePasswordAuthority(client, {email: input.email}, input.password, 'update');
      // Commit a refused issuance budget without borrowing a second connection or creating authority.
      const refused=await verified?.(authority.accountId,client);
      if(refused)return refused;
      await client.query('SAVEPOINT login_issuance_effects');
      try {
        const factor = (await client.query(`SELECT * FROM cloud_authenticator_factors WHERE account_id=$1 FOR UPDATE`,
          [authority.accountId])).rows[0];
        if (!factor?.secret_envelope) return {kind: 'session', credentials: await createSession(client, authority.accountId)};
        const policy = requirePolicy(this.#policy);
        secretFor(factor, this.#keys);
        const token = randomBytes(32).toString('base64url');
        const now = await factorNow(client);
        const expiresAt = new Date(now.getTime() + policy.loginLifetimeMs);
        await client.query(`INSERT INTO cloud_factor_login_challenges
          (token_hash,account_id,password_fingerprint,factor_version,created_at,expires_at,attempt_limit)
          VALUES($1,$2,$3,$4,$5,$6,$7)`, [factorDigest(token), authority.accountId,
          authority.passwordFingerprint, factor.version, now, expiresAt, policy.challengeAttempts]);
        if (await factorNow(client) >= expiresAt) throw new FactorError();
        return {kind: 'factor', challengeToken: token, expiresAt: expiresAt.toISOString()};
      } catch(error) {
        if(!(error instanceof FactorError))throw error;
        await client.query('ROLLBACK TO SAVEPOINT login_issuance_effects');
        return error;
      }
    });
    if(result instanceof Error)throw result;
    return result;
  }
  async complete(token: string, proof: FactorProof): Promise<SessionCredentials> {
    if (typeof token !== 'string' || !TOKEN.test(token)) throw new FactorError();
    requirePolicy(this.#policy);
    const result = await transaction(this.#pool, async client => {
      const hash = factorDigest(token);
      const candidate = (await client.query('SELECT account_id FROM cloud_factor_login_challenges WHERE token_hash=$1', [hash])).rows[0];
      if (!candidate) return new FactorError();
      // Serialize absent-factor enrolment and all proof/change flows on the account before child rows.
      const account = await client.query('SELECT id FROM cloud_accounts WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [candidate.account_id]);
      if (!account.rowCount) return new FactorError();
      const credential = (await client.query('SELECT password_hash FROM cloud_credentials WHERE account_id=$1 FOR UPDATE', [candidate.account_id])).rows[0];
      const factor = (await client.query('SELECT * FROM cloud_authenticator_factors WHERE account_id=$1 FOR UPDATE', [candidate.account_id])).rows[0];
      const challenge = (await client.query('SELECT * FROM cloud_factor_login_challenges WHERE token_hash=$1 FOR UPDATE', [hash])).rows[0];
      const now = await factorNow(client);
      if (!challenge || challenge.account_id !== candidate.account_id || challenge.consumed_at
        || challenge.expires_at <= now || challenge.attempts >= challenge.attempt_limit
        || !credential?.password_hash || challenge.password_fingerprint !== factorDigest(credential.password_hash)
        || !factor?.secret_envelope || challenge.factor_version !== factor.version) return new FactorError();
      await client.query('UPDATE cloud_factor_login_challenges SET attempts=attempts+1 WHERE token_hash=$1', [hash]);
      // Expected late refusals undo proof/session effects while keeping the spent challenge attempt.
      await client.query('SAVEPOINT factor_effects');
      try {
        const proofDeadline = await consumeFactorProof(client, factor, this.#keys, proof, challenge.expires_at);
        if (!proofDeadline) throw new FactorError();
        await client.query('UPDATE cloud_factor_login_challenges SET consumed_at=clock_timestamp() WHERE token_hash=$1', [hash]);
        const credentials = await createSession(client, candidate.account_id);
        if (await factorNow(client) >= proofDeadline) throw new FactorError();
        return credentials;
      } catch (error) {
        if (!(error instanceof FactorError) && !(error instanceof IdentityError)) throw error;
        await client.query('ROLLBACK TO SAVEPOINT factor_effects');
        return error instanceof FactorError ? error : new FactorError();
      }
    });
    // Throw outside the transaction: rolling back a refusal would restore its attempt budget.
    if (result instanceof FactorError) throw result;
    return result;
  }
}
