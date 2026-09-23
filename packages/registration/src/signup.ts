import type { Pool } from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashSecret } from '@waitron-cloud/identity';
import type { EmailDeliveryContext, EmailDeliveryReceipt } from './email-delivery.ts';
import type { EmailOutbox } from './email-outbox.ts';
import { transaction } from './transaction.ts';
import { normaliseEmail, validNewPassword, validLocale, type AccountLocale, type AccountEmail } from './account-input.ts';

export type SignupEmail = AccountEmail;
export interface SignupMailer { sendVerification(message: SignupEmail, context?: EmailDeliveryContext): Promise<void | EmailDeliveryReceipt>; }
export interface SignupDetails { password: string; organisationName: string; legalBusinessName: string; countryCode: string; }
export interface SignupResult { accountId: string; organisationId: string; legalBusinessId: string; }
export class SignupError extends Error {
  readonly code: 'signup_invalid' | 'verification_unavailable';
  constructor(code: SignupError['code']) { super(code); this.name = 'SignupError'; this.code = code; }
}
export class SignupStore {
  readonly #pool: Pool;
  readonly #outbox: EmailOutbox;
  constructor(pool: Pool, outbox: EmailOutbox) { this.#pool = pool; this.#outbox = outbox; }

  async request(input: string, locale: AccountLocale = 'en'): Promise<{status: 'accepted'}> {
    const email = normaliseEmail(input);
    if (!email || !validLocale(locale)) throw new SignupError('signup_invalid');
    await transaction(this.#pool, async client => {
      // Serialise requests for an address across workers; hash collisions only share a cooldown lock.
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':signup'), hashtext($1))", [email]);
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      const recent = await client.query('SELECT 1 FROM signup_requests WHERE email = $1 AND created_at > $2 LIMIT 1',
        [email, new Date(now.getTime() - 60_000)]);
      if (recent.rowCount) return undefined;
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
      await client.query('INSERT INTO signup_requests (token_hash, email, created_at, expires_at) VALUES ($1, $2, $3, $4)',
        [digest(token), email, now, expiresAt]);
      await this.#outbox.enqueue(client, 'verification', { email, token, expiresAt, locale });
    });
    return { status: 'accepted' };
  }

  async complete(token: string, input: SignupDetails): Promise<SignupResult> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new SignupError('verification_unavailable');
    if (!input || !validNewPassword(input.password)) throw new SignupError('signup_invalid');
    const organisationName = name(input.organisationName);
    const legalBusinessName = name(input.legalBusinessName);
    if (typeof input.countryCode !== 'string' || !/^[A-Za-z]{2}$/.test(input.countryCode)) throw new SignupError('signup_invalid');
    const countryCode = input.countryCode.toUpperCase();
    const tokenHash = digest(token);
    return transaction(this.#pool, async client => {
      const candidate = await client.query(`SELECT 1 FROM signup_requests
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()`, [tokenHash]);
      if (!candidate.rowCount) throw new SignupError('verification_unavailable');
      const passwordHash = await hashSecret(input.password);
      const request = (await client.query('SELECT email, expires_at, consumed_at FROM signup_requests WHERE token_hash = $1 FOR UPDATE', [tokenHash])).rows[0];
      // Exit early after a request-lock wait; the final consume check also covers later write waits.
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if (!request || request.consumed_at || request.expires_at <= now) throw new SignupError('verification_unavailable');
      const accountId = randomUUID();
      const organisationId = randomUUID();
      const legalBusinessId = randomUUID();
      await client.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [accountId]);
      // Email uniqueness arbitrates different links racing to create the same account.
      const credentials = await client.query(`INSERT INTO cloud_credentials (account_id, email, password_hash, email_verified_at)
        VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`, [accountId, request.email, passwordHash, now]);
      if (!credentials.rowCount) throw new SignupError('verification_unavailable');
      await client.query('INSERT INTO organisations (id, name) VALUES ($1, $2)', [organisationId, organisationName]);
      await client.query('INSERT INTO legal_businesses (id, organisation_id, name, country_code) VALUES ($1, $2, $3, $4)',
        [legalBusinessId, organisationId, legalBusinessName, countryCode]);
      await client.query(`INSERT INTO organisation_memberships (account_id, organisation_id, can_register_venues, is_owner)
        VALUES ($1, $2, true, true)`, [accountId, organisationId]);
      // Expiry after a contended write rolls back the account, business and membership together.
      const consumed = await client.query(`UPDATE signup_requests SET consumed_at = clock_timestamp()
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()`, [tokenHash]);
      if (!consumed.rowCount) throw new SignupError('verification_unavailable');
      return { accountId, organisationId, legalBusinessId };
    });
  }
}

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
function name(value: string): string {
  if (typeof value !== 'string' || value.length > 200 || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new SignupError('signup_invalid');
  return value.trim();
}
