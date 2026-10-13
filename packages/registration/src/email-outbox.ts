import {validServiceAlert,type ServiceAlert,type ServiceAlertMailer} from './service-alert.ts';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { SignupMailer } from './signup.ts';
import type { PasswordRecoveryMailer } from './password-recovery.ts';
import { normaliseEmail, validLocale, type AccountEmail, type AccountNotification } from './account-input.ts';
import { EmailDeliveryError, type EmailDeliveryFailure, type EmailDeliveryReceipt } from './email-delivery.ts';
import { transaction } from './transaction.ts';

export type EmailKind = 'verification' | 'password_reset' | 'password_changed' | 'service_alert';
type Status = 'pending' | 'processing' | 'sent' | 'expired' | 'cancelled' | 'failed';
type Failure = EmailDeliveryFailure | 'payload_unavailable' | 'attempts_exhausted';
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

  async enqueueServiceAlerts(client:PoolClient,messages:readonly ServiceAlert[]):Promise<string[]>{
    if(!Array.isArray(messages)||messages.length<1||messages.length>100)throw new Error('Invalid queued email');
    const expiresAt:Date=(await client.query("SELECT clock_timestamp()+interval '1 day' AS expiry")).rows[0].expiry;
    const rows=messages.map(message=>{
      if(normaliseEmail(message?.email)!==message?.email||(message.locale!==undefined&&!validLocale(message.locale))||!validServiceAlert(message))throw new Error('Invalid queued email');
      const id=randomUUID(),nonce=randomBytes(12),content:ServiceAlert={email:message.email,locale:message.locale,incidentId:message.incidentId,revision:message.revision,venueId:message.venueId,issue:message.issue,state:message.state,...(message.checkedAt?{checkedAt:message.checkedAt}:{}),...(message.certificateNotAfter?{certificateNotAfter:message.certificateNotAfter}:{}),...(message.notification?{notification:message.notification}:{})};
      if(content.locale===undefined)delete content.locale;
      const cipher=createCipheriv('aes-256-gcm',this.#keys.get(this.#active)!,nonce);cipher.setAAD(aad(id,'service_alert',this.#active));
      const encrypted=Buffer.concat([cipher.update(JSON.stringify(content),'utf8'),cipher.final()]);
      return{id,payload:Buffer.concat([nonce,cipher.getAuthTag(),encrypted])};
    });
    const parameters:unknown[]=[];
    const values=rows.map((row,index)=>{
      const offset=index*4;parameters.push(row.id,this.#active,row.payload,expiresAt);
      return`($${offset+1},'service_alert',NULL,$${offset+2},$${offset+3},$${offset+4})`;
    });
    await client.query(`INSERT INTO email_outbox(id,kind,token_hash,key_id,payload,expires_at) VALUES ${values.join(',')}`,parameters);
    return rows.map(row=>row.id);
  }

  async enqueue(client: PoolClient, kind: EmailKind, message: AccountEmail | AccountNotification | ServiceAlert): Promise<string> {
    if (!['verification', 'password_reset', 'password_changed', 'service_alert'].includes(kind) || normaliseEmail(message.email) !== message.email || (message.locale !== undefined && !validLocale(message.locale))) throw new Error('Invalid queued email');
    if(kind==='service_alert')return (await this.enqueueServiceAlerts(client,[message as ServiceAlert]))[0]!;
    let tokenHash: string | null = null;
    let expiresAt: Date;
    let content: AccountEmail | AccountNotification | ServiceAlert = {email: message.email};
    if (kind === 'password_changed') {
      expiresAt = (await client.query("SELECT clock_timestamp() + interval '7 days' AS expiry")).rows[0].expiry;
    } else {
      if (!('token' in message) || !/^[A-Za-z0-9_-]{43}$/.test(message.token) || !Number.isFinite(Date.parse(message.expiresAt))) throw new Error('Invalid queued email');
      expiresAt = new Date(message.expiresAt);
      content = {email: message.email, token: message.token, expiresAt: expiresAt.toISOString()};
      tokenHash = digest(message.token);
    }
    if (message.locale !== undefined) content.locale = message.locale;
    const id = randomUUID();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#keys.get(this.#active)!, nonce);
    cipher.setAAD(aad(id, kind, this.#active));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(content), 'utf8'), cipher.final()]);
    const payload = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    await client.query(`INSERT INTO email_outbox (id, kind, token_hash, key_id, payload, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6)`, [id, kind, tokenHash, this.#active, payload, expiresAt]);
    return id;
  }

  /** Only the delivery worker should recover plaintext; it must never log this return value. */
  open(row: MessageRow): AccountEmail | AccountNotification | ServiceAlert {
    try {
      const key = this.#keys.get(row.key_id);
      if (!key || row.payload.length < 29) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, row.payload.subarray(0, 12));
      decipher.setAAD(aad(row.id, row.kind, row.key_id));
      decipher.setAuthTag(row.payload.subarray(12, 28));
      const message = JSON.parse(Buffer.concat([decipher.update(row.payload.subarray(28)), decipher.final()]).toString('utf8'));
      if (!message || typeof message.email !== 'string' || normaliseEmail(message.email) !== message.email || (message.locale !== undefined && !validLocale(message.locale))) throw new Error();
      if (row.kind === 'service_alert' && !validServiceAlert(message))throw new Error();
      if (row.kind !== 'password_changed' && row.kind !== 'service_alert' && (typeof message.token !== 'string' || digest(message.token) !== row.token_hash
        || Date.parse(message.expiresAt) !== row.expires_at.getTime())) throw new Error();
      return message;
    } catch { throw new Error('Queued email payload unavailable'); }
  }
}

export class EmailWorker {
  readonly #pool: Pool;
  readonly #outbox: EmailOutbox;
  readonly #mailer: SignupMailer & PasswordRecoveryMailer & ServiceAlertMailer;
  readonly #timeout: number;
  constructor(pool: Pool, outbox: EmailOutbox, mailer: SignupMailer & PasswordRecoveryMailer & ServiceAlertMailer, options: {sendTimeoutMs?: number} = {}) {
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
    let message: AccountEmail | AccountNotification | ServiceAlert;
    try { message = this.#outbox.open(claim); }
    catch { await this.#fail(claim, 'payload_unavailable'); return true; }
    // Recheck after decrypting and any database wait, before handing a link to the transport.
    const live = await this.#live(claim, message);
    if (!live) { await this.#finish(claim, 'cancelled'); return true; }
    const ready = await this.#pool.query(`SELECT expires_at > clock_timestamp() AS live FROM email_outbox
      WHERE id = $1 AND claim_id = $2 AND status = 'processing' AND lease_until > clock_timestamp()`, [claim.id, claim.claim_id]);
    if (!ready.rowCount) return true;
    if (!ready.rows[0].live) { await this.#finish(claim, 'expired'); return true; }
    // A queue wait can outlast an ownership change; recheck alert authority and claim together at handoff.
    if(claim.kind==='service_alert'&&!await this.#live(claim,message)){await this.#finish(claim,'cancelled');return true;}
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const context = {deliveryId: claim.id, signal: controller.signal};
    let receipt: void | EmailDeliveryReceipt;
    try {
      const send = () => claim.kind === 'service_alert' ? this.#sendAlert(message as ServiceAlert,context) : claim.kind === 'verification' ? this.#mailer.sendVerification(message as AccountEmail, context)
        : claim.kind === 'password_reset' ? this.#mailer.sendPasswordReset(message as AccountEmail, context)
        : this.#mailer.sendPasswordChanged(message, context);
      // A timeout cannot retract a message already accepted by a provider. Retried sends may duplicate it.
      receipt = await Promise.race([Promise.resolve().then(send), new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new EmailDeliveryError('delivery_timeout'));
          controller.abort();
        }, this.#timeout);
      })]);
      // Delivery succeeded; discard invalid optional metadata without sending the message again.
      if (receipt && (receipt.transport !== 'smtp' || typeof receipt.messageId !== 'string' || !/^<[A-Za-z0-9._-]+@[A-Za-z0-9.-]+>$/.test(receipt.messageId) || receipt.messageId.length > 512)) receipt = undefined;
    } catch (error) {
      await this.#fail(claim, error instanceof EmailDeliveryError ? error.code : 'delivery_failed',
        !(error instanceof EmailDeliveryError) || error.retryable);
      return true;
    }
    finally { clearTimeout(timer); }
    await this.#finish(claim, 'sent', receipt);
    return true;
  }

  async #sendAlert(message:ServiceAlert,context:{deliveryId:string;signal:AbortSignal}){
    if(!this.#mailer.sendServiceAlert)throw new EmailDeliveryError('delivery_configuration');
    return this.#mailer.sendServiceAlert(message,context);
  }

  async #live(row: MessageRow, message: AccountEmail | AccountNotification | ServiceAlert): Promise<boolean> {
    if(row.kind==='service_alert'){
      if(!validServiceAlert(message))return false;
      const live=(await this.#pool.query(`SELECT p.locale FROM service_alert_deliveries d JOIN email_outbox e ON e.id=d.outbox_id JOIN venue_incidents i ON i.id=d.incident_id
        LEFT JOIN venue_alert_episodes episode ON episode.id=d.episode_id
        JOIN venues v ON v.id=i.venue_id JOIN installations n ON n.venue_id=v.id
        JOIN organisation_memberships m ON m.organisation_id=v.organisation_id AND m.account_id=d.account_id
        JOIN cloud_accounts a ON a.id=d.account_id JOIN cloud_credentials c ON c.account_id=a.id
        JOIN account_alert_preferences p ON p.account_id=a.id
        WHERE d.outbox_id=$1 AND e.claim_id=$8 AND e.status='processing' AND e.lease_until>clock_timestamp() AND e.expires_at>clock_timestamp() AND i.id=$2 AND i.revision=$3 AND d.revision=i.revision AND i.venue_id=$4 AND i.kind=$5 AND i.status=$6 AND d.state=i.status
          AND d.notification=$9
          AND (d.episode_id IS NULL OR (episode.incident_id=i.id AND episode.installation_id=n.id AND episode.status=i.status
           AND CASE WHEN i.status='open' THEN episode.opening_revision=i.revision ELSE episode.recovery_revision=i.revision END
           AND EXISTS(SELECT 1 FROM venue_alert_recipients r WHERE r.episode_id=episode.id AND r.account_id=d.account_id)))
          AND (($9<>'reminder' AND i.status<>'recovered') OR EXISTS(SELECT 1 FROM service_alert_deliveries opening JOIN email_outbox sent ON sent.id=opening.outbox_id
           WHERE ((d.episode_id IS NOT NULL AND opening.episode_id=d.episode_id) OR (d.episode_id IS NULL AND opening.incident_id=d.incident_id AND opening.revision=d.revision-1)) AND opening.account_id=d.account_id AND opening.state='open' AND opening.notification='transition' AND sent.status='sent'))
          AND m.is_owner AND a.disabled_at IS NULL AND c.email_verified_at IS NOT NULL AND c.email=$7 AND p.enabled
          AND v.environment='test' AND n.revoked_at IS NULL AND n.superseded_by IS NULL
          AND EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=n.id AND s.state<>'unconfigured'
            AND (i.kind='disconnected' OR (i.kind IN ('snapshot_stale','verification_failed') AND s.service='retained_snapshots')
             OR (i.kind IN ('public_route_failed','staff_route_failed','public_probe_stale','staff_probe_stale','public_certificate_expiring','staff_certificate_expiring') AND s.service='remote_access'
              AND EXISTS(SELECT 1 FROM remote_placements rp JOIN remote_hostnames h ON h.venue_id=rp.venue_id WHERE rp.installation_id=n.id AND rp.venue_id=v.id
               AND h.kind=CASE WHEN i.kind LIKE 'public_%' THEN 'public' ELSE 'staff' END))))`,
        [row.id,message.incidentId,message.revision,message.venueId,message.issue,message.state,message.email,row.claim_id,message.notification??'transition'])).rows[0];
      if(!live)return false;
      message.locale=live.locale;return true;
    }
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

  async #finish(row: MessageRow, status: 'sent' | 'expired' | 'cancelled', receipt?: void | EmailDeliveryReceipt) {
    await this.#pool.query(`UPDATE email_outbox SET status = $3, payload = NULL, key_id = NULL,
      claim_id = NULL, lease_until = NULL, finished_at = clock_timestamp(), transport = $4, message_id = $5
      WHERE id = $1 AND claim_id = $2 AND status = 'processing'`, [row.id, row.claim_id, status, receipt?.transport ?? null, receipt?.messageId ?? null]);
  }

  async #fail(row: MessageRow, failure: Failure, retryable = true) {
    await transaction(this.#pool, async client => {
      const current = (await client.query(`SELECT attempts, expires_at FROM email_outbox
        WHERE id = $1 AND claim_id = $2 AND status = 'processing' FOR UPDATE`, [row.id, row.claim_id])).rows[0];
      if (!current) return;
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      // Choose one outcome under the claim lock so state and payload removal agree at expiry.
      const status = current.expires_at <= now ? 'expired' : !retryable || current.attempts >= 8 ? 'failed' : 'pending';
      const seconds = Math.min(900, 30 * 2 ** (current.attempts - 1));
      await client.query(`UPDATE email_outbox SET failures = failures + 1, last_error = $4, status = $3,
        payload = CASE WHEN $3 = 'pending' THEN payload ELSE NULL END,
        key_id = CASE WHEN $3 = 'pending' THEN key_id ELSE NULL END,
        finished_at = CASE WHEN $3 = 'pending' THEN NULL ELSE $6::timestamptz END,
        claim_id = NULL, lease_until = NULL, available_at = $6::timestamptz + $5 * interval '1 second'
        WHERE id = $1 AND claim_id = $2 AND status = 'processing'`, [row.id, row.claim_id, status, failure, seconds, now]);
    });
  }

  async status(): Promise<EmailDeliveryStatus> { return emailDeliveryStatus(this.#pool); }
}

export async function emailDeliveryStatus(pool: Pool): Promise<EmailDeliveryStatus> {
  const rows = (await pool.query(`SELECT status, count(*)::integer AS count, sum(attempts)::integer AS attempts,
    sum(failures)::integer AS failures, min(created_at) AS oldest FROM email_outbox GROUP BY status`)).rows;
  const result: EmailDeliveryStatus = { counts: {pending: 0, processing: 0, sent: 0, expired: 0, cancelled: 0, failed: 0}, attempts: 0, failures: 0, oldestPendingAt: null };
  for (const row of rows) {
    result.counts[row.status as Status] = row.count;
    result.attempts += row.attempts; result.failures += row.failures;
    if (['pending', 'processing'].includes(row.status) && (!result.oldestPendingAt || row.oldest.toISOString() < result.oldestPendingAt)) result.oldestPendingAt = row.oldest.toISOString();
  }
  return result;
}
