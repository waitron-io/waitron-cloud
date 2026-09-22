import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { SignupMailer } from './signup.ts';
import type { PasswordRecoveryMailer } from './password-recovery.ts';
import { normaliseEmail, type AccountEmail } from './account-input.ts';
import { transaction } from './transaction.ts';

export type EmailKind = 'verification' | 'password_reset' | 'password_changed';
type Status = 'pending' | 'processing' | 'sent' | 'expired' | 'cancelled' | 'failed';
type Failure = 'delivery_failed' | 'payload_unavailable' | 'attempts_exhausted';
interface MessageRow {
  id: string; kind: EmailKind; token_hash: string | null; key_id: string; payload: Buffer;
  expires_at: Date; attempts: number; claim_id: string;
}
export interface EmailDeliveryStatus {
  counts: Record<Status, number>;
  attempts: number;
  failures: number;
  oldestPendingAt: string | null;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const aad = (id: string, kind: EmailKind, keyId: string) => Buffer.from(JSON.stringify([id, kind, keyId]));

/** Keys belong in separately managed application secrets, never alongside database backups. */
export class EmailOutbox {
  readonly #active: string;
  readonly #keys = new Map<string, Buffer>();
  constructor(config: {activeKeyId: string; keys: Record<string, string>}) {
    if (!config || !config.keys || typeof config.keys !== 'object') throw new Error('Invalid email key configuration');
    for (const [id, value] of Object.entries(config.keys)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('Invalid email key configuration');
      this.#keys.set(id, Buffer.from(value, 'hex'));
    }
    if (!this.#keys.has(config.activeKeyId)) throw new Error('Invalid email key configuration');
    this.#active = config.activeKeyId;
  }

  async enqueue(client: PoolClient, kind: EmailKind, message: AccountEmail | {email: string}): Promise<void> {
    if (!['verification', 'password_reset', 'password_changed'].includes(kind) || normaliseEmail(message.email) !== message.email) throw new Error('Invalid queued email');
    let tokenHash: string | null = null;
    let expiresAt: Date;
    let content: AccountEmail | {email: string} = {email: message.email};
    if (kind === 'password_changed') {
      expiresAt = (await client.query("SELECT clock_timestamp() + interval '7 days' AS expiry")).rows[0].expiry;
    } else {
      if (!('token' in message) || !/^[A-Za-z0-9_-]{43}$/.test(message.token) || !Number.isFinite(Date.parse(message.expiresAt))) throw new Error('Invalid queued email');
      expiresAt = new Date(message.expiresAt);
      content = {email: message.email, token: message.token, expiresAt: expiresAt.toISOString()};
      tokenHash = digest(message.token);
    }
    const id = randomUUID();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#keys.get(this.#active)!, nonce);
    cipher.setAAD(aad(id, kind, this.#active));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(content), 'utf8'), cipher.final()]);
    const payload = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    await client.query(`INSERT INTO email_outbox (id, kind, token_hash, key_id, payload, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6)`, [id, kind, tokenHash, this.#active, payload, expiresAt]);
  }

  /** Only the delivery worker should recover plaintext; it must never log this return value. */
  open(row: MessageRow): AccountEmail | {email: string} {
    try {
      const key = this.#keys.get(row.key_id);
      if (!key || row.payload.length < 29) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, row.payload.subarray(0, 12));
      decipher.setAAD(aad(row.id, row.kind, row.key_id));
      decipher.setAuthTag(row.payload.subarray(12, 28));
      const message = JSON.parse(Buffer.concat([decipher.update(row.payload.subarray(28)), decipher.final()]).toString('utf8'));
      if (!message || typeof message.email !== 'string' || normaliseEmail(message.email) !== message.email) throw new Error();
      if (row.kind !== 'password_changed' && (typeof message.token !== 'string' || digest(message.token) !== row.token_hash
        || Date.parse(message.expiresAt) !== row.expires_at.getTime())) throw new Error();
      return message;
    } catch { throw new Error('Queued email payload unavailable'); }
  }
}

export class EmailWorker {
  readonly #pool: Pool;
  readonly #outbox: EmailOutbox;
  readonly #mailer: SignupMailer & PasswordRecoveryMailer;
  readonly #timeout: number;
  constructor(pool: Pool, outbox: EmailOutbox, mailer: SignupMailer & PasswordRecoveryMailer, options: {sendTimeoutMs?: number} = {}) {
    this.#pool = pool; this.#outbox = outbox; this.#mailer = mailer;
    this.#timeout = options.sendTimeoutMs ?? 20_000;
    if (!Number.isInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 30_000) throw new Error('Invalid email worker timeout');
  }

  /** True means one row was handled; false means no claimable work exists right now. */
  async runOnce(): Promise<boolean> {
    const claim = await transaction(this.#pool, async client => {
      const row: MessageRow | undefined = (await client.query(`SELECT * FROM email_outbox
        WHERE (status = 'pending' AND (available_at <= clock_timestamp() OR expires_at <= clock_timestamp()))
          OR (status = 'processing' AND lease_until <= clock_timestamp())
        ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
      if (!row) return undefined;
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if (row.expires_at <= now || row.attempts >= 8) {
        await client.query(`UPDATE email_outbox SET status = $2, payload = NULL, key_id = NULL,
          claim_id = NULL, lease_until = NULL, finished_at = clock_timestamp(), last_error = $3 WHERE id = $1`,
        [row.id, row.expires_at <= now ? 'expired' : 'failed', row.expires_at <= now ? null : 'attempts_exhausted']);
        return null;
      }
      const claimed = await client.query(`UPDATE email_outbox SET status = 'processing', attempts = attempts + 1,
        claim_id = $2, lease_until = clock_timestamp() + interval '60 seconds' WHERE id = $1 RETURNING *`, [row.id, randomUUID()]);
      return claimed.rows[0] as MessageRow;
    });
    if (claim === undefined) return false;
    if (claim === null) return true;
    let message: AccountEmail | {email: string};
    try { message = this.#outbox.open(claim); }
    catch { await this.#fail(claim, 'payload_unavailable'); return true; }
    // Recheck after decrypting and any database wait, before handing a link to the transport.
    const live = await this.#live(claim, message);
    if (!live) { await this.#finish(claim, 'cancelled'); return true; }
    const ready = await this.#pool.query(`SELECT expires_at > clock_timestamp() AS live FROM email_outbox
      WHERE id = $1 AND claim_id = $2 AND status = 'processing' AND lease_until > clock_timestamp()`, [claim.id, claim.claim_id]);
    if (!ready.rowCount) return true;
    if (!ready.rows[0].live) { await this.#finish(claim, 'expired'); return true; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const send = () => claim.kind === 'verification' ? this.#mailer.sendVerification(message as AccountEmail)
        : claim.kind === 'password_reset' ? this.#mailer.sendPasswordReset(message as AccountEmail)
        : this.#mailer.sendPasswordChanged(message);
      // A timeout cannot retract a message already accepted by a provider. Retried sends may duplicate it.
      await Promise.race([Promise.resolve().then(send), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Email delivery timed out')), this.#timeout);
      })]);
    } catch { await this.#fail(claim, 'delivery_failed'); return true; }
    finally { clearTimeout(timer); }
    await this.#finish(claim, 'sent');
    return true;
  }

  async #live(row: MessageRow, message: AccountEmail | {email: string}): Promise<boolean> {
    if (row.kind === 'password_changed') return true;
    if (row.kind === 'verification') {
      return !!(await this.#pool.query(`SELECT 1 FROM signup_requests WHERE token_hash = $1 AND email = $2
        AND consumed_at IS NULL AND expires_at > clock_timestamp()`, [row.token_hash, message.email])).rowCount;
    }
    const credential = (await this.#pool.query(`SELECT c.password_hash, r.password_fingerprint FROM password_reset_requests r
      JOIN cloud_accounts a ON a.id = r.account_id JOIN cloud_credentials c ON c.account_id = a.id
      WHERE r.token_hash = $1 AND r.email = $2 AND c.email = r.email AND a.disabled_at IS NULL
        AND c.email_verified_at IS NOT NULL AND c.password_hash IS NOT NULL
        AND r.consumed_at IS NULL AND r.expires_at > clock_timestamp()`, [row.token_hash, message.email])).rows[0];
    return !!credential && digest(credential.password_hash) === credential.password_fingerprint;
  }

  async #finish(row: MessageRow, status: 'sent' | 'expired' | 'cancelled') {
    await this.#pool.query(`UPDATE email_outbox SET status = $3, payload = NULL, key_id = NULL,
      claim_id = NULL, lease_until = NULL, finished_at = clock_timestamp()
      WHERE id = $1 AND claim_id = $2 AND status = 'processing'`, [row.id, row.claim_id, status]);
  }

  async #fail(row: MessageRow, failure: Failure) {
    const seconds = Math.min(900, 30 * 2 ** (row.attempts - 1));
    await this.#pool.query(`UPDATE email_outbox SET failures = failures + 1, last_error = $3,
      status = CASE WHEN expires_at <= clock_timestamp() THEN 'expired' WHEN attempts >= 8 THEN 'failed' ELSE 'pending' END,
      payload = CASE WHEN expires_at <= clock_timestamp() OR attempts >= 8 THEN NULL ELSE payload END,
      key_id = CASE WHEN expires_at <= clock_timestamp() OR attempts >= 8 THEN NULL ELSE key_id END,
      finished_at = CASE WHEN expires_at <= clock_timestamp() OR attempts >= 8 THEN clock_timestamp() ELSE NULL END,
      claim_id = NULL, lease_until = NULL, available_at = clock_timestamp() + $4 * interval '1 second'
      WHERE id = $1 AND claim_id = $2 AND status = 'processing'`, [row.id, row.claim_id, failure, seconds]);
  }

  async status(): Promise<EmailDeliveryStatus> {
    const rows = (await this.#pool.query(`SELECT status, count(*)::integer AS count, sum(attempts)::integer AS attempts,
      sum(failures)::integer AS failures, min(created_at) AS oldest FROM email_outbox GROUP BY status`)).rows;
    const result: EmailDeliveryStatus = { counts: {pending: 0, processing: 0, sent: 0, expired: 0, cancelled: 0, failed: 0}, attempts: 0, failures: 0, oldestPendingAt: null };
    for (const row of rows) {
      result.counts[row.status as Status] = row.count;
      result.attempts += row.attempts; result.failures += row.failures;
      if (['pending', 'processing'].includes(row.status) && (!result.oldestPendingAt || row.oldest.toISOString() < result.oldestPendingAt)) result.oldestPendingAt = row.oldest.toISOString();
    }
    return result;
  }
}
