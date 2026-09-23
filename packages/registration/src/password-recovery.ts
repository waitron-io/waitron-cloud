import type { Pool } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { hashSecret } from '@waitron-cloud/identity';
import type { EmailDeliveryContext, EmailDeliveryReceipt } from './email-delivery.ts';
import type { EmailOutbox } from './email-outbox.ts';
import { transaction } from './transaction.ts';
import { normaliseEmail, validNewPassword, validLocale, type AccountLocale, type AccountEmail, type AccountNotification } from './account-input.ts';
export interface PasswordRecoveryMailer {
  sendPasswordReset(message: AccountEmail, context?: EmailDeliveryContext): Promise<void | EmailDeliveryReceipt>;
  sendPasswordChanged(message: AccountNotification, context?: EmailDeliveryContext): Promise<void | EmailDeliveryReceipt>;
}
export class PasswordRecoveryError extends Error {
  readonly code: 'recovery_invalid' | 'reset_unavailable';
  constructor(code: PasswordRecoveryError['code']) { super(code); this.name = 'PasswordRecoveryError'; this.code = code; }
}
export class PasswordRecoveryStore {
  readonly #pool: Pool;
  readonly #outbox: EmailOutbox;
  constructor(pool: Pool, outbox: EmailOutbox) { this.#pool = pool; this.#outbox = outbox; }

  async request(input: string, locale: AccountLocale = 'en'): Promise<{status: 'accepted'}> {
    const email = normaliseEmail(input);
    if (!email || !validLocale(locale)) throw new PasswordRecoveryError('recovery_invalid');
    await transaction(this.#pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':password-reset'), hashtext($1))", [email]);
      const recent = await client.query("SELECT 1 FROM password_reset_requests WHERE email = $1 AND created_at > clock_timestamp() - interval '1 minute' LIMIT 1", [email]);
      if (recent.rowCount) return undefined;
      const lookup = await client.query('SELECT account_id FROM cloud_credentials WHERE email = $1', [email]);
      let accountId: string | null = null;
      let fingerprint: string | null = null;
      if (lookup.rowCount) {
        // Account before credentials, matching login and reset completion's lock order.
        const account = await client.query('SELECT id FROM cloud_accounts WHERE id = $1 AND disabled_at IS NULL FOR SHARE', [lookup.rows[0].account_id]);
        if (account.rowCount) {
          const credential = (await client.query(`SELECT password_hash FROM cloud_credentials
            WHERE account_id = $1 AND email = $2 AND email_verified_at IS NOT NULL AND password_hash IS NOT NULL FOR SHARE`, [account.rows[0].id, email])).rows[0];
          if (credential) { accountId = account.rows[0].id; fingerprint = digest(credential.password_hash); }
        }
      }
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
      // Ineligible addresses also get cooldown records, but never usable account bindings.
      await client.query(`INSERT INTO password_reset_requests (token_hash, email, account_id, password_fingerprint, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)`, [digest(token), email, accountId, fingerprint, now, expiresAt]);
      if (accountId) await this.#outbox.enqueue(client, 'password_reset', { email, token, expiresAt, locale });
    });
    return { status: 'accepted' };
  }

  async complete(token: string, password: string, locale: AccountLocale = 'en'): Promise<{status: 'completed'}> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PasswordRecoveryError('reset_unavailable');
    if (!validNewPassword(password) || !validLocale(locale)) throw new PasswordRecoveryError('recovery_invalid');
    const tokenHash = digest(token);
    await transaction(this.#pool, async client => {
      const candidate = (await client.query(`SELECT account_id FROM password_reset_requests
        WHERE token_hash = $1 AND account_id IS NOT NULL AND consumed_at IS NULL AND expires_at > clock_timestamp()`, [tokenHash])).rows[0];
      if (!candidate) throw new PasswordRecoveryError('reset_unavailable');
      const passwordHash = await hashSecret(password);
      // The exclusive account lock serialises resets and waits for in-flight logins/resolvers.
      const account = await client.query('SELECT id FROM cloud_accounts WHERE id = $1 AND disabled_at IS NULL FOR UPDATE', [candidate.account_id]);
      if (!account.rowCount) throw new PasswordRecoveryError('reset_unavailable');
      const credential = (await client.query('SELECT email, password_hash, email_verified_at FROM cloud_credentials WHERE account_id = $1 FOR UPDATE', [candidate.account_id])).rows[0];
      const request = (await client.query('SELECT * FROM password_reset_requests WHERE token_hash = $1 FOR UPDATE', [tokenHash])).rows[0];
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if (!request || request.consumed_at || request.expires_at <= now || request.account_id !== candidate.account_id
        || !credential?.email_verified_at || !credential.password_hash || credential.email !== request.email
        || digest(credential.password_hash) !== request.password_fingerprint) throw new PasswordRecoveryError('reset_unavailable');
      // A fresh salted hash invalidates all earlier links, including when reusing the old password.
      await client.query('UPDATE cloud_credentials SET password_hash = $2 WHERE account_id = $1', [candidate.account_id, passwordHash]);
      await client.query('UPDATE cloud_sessions SET ended_at = clock_timestamp() WHERE account_id = $1 AND ended_at IS NULL', [candidate.account_id]);
      await this.#outbox.enqueue(client, 'password_changed', { email: credential.email, locale });
      const consumed = await client.query(`UPDATE password_reset_requests SET consumed_at = clock_timestamp()
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()`, [tokenHash]);
      if (!consumed.rowCount) throw new PasswordRecoveryError('reset_unavailable');
    });
    return { status: 'completed' };
  }
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
