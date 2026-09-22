import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { resolveSession } from '@waitron-cloud/identity';
import { transaction } from './transaction.ts';
export { SignupStore, SignupError, type SignupEmail, type SignupMailer, type SignupDetails, type SignupResult } from './signup.ts';
export { PasswordRecoveryStore, PasswordRecoveryError, type PasswordRecoveryMailer } from './password-recovery.ts';
export { EmailOutbox, EmailWorker, emailDeliveryStatus, type EmailKind, type EmailDeliveryStatus } from './email-outbox.ts';
export type { AccountEmail } from './account-input.ts';
export { createSmtpAccountMailer, type SmtpAccountMailConfig } from './smtp-mailer.ts';
export { EmailDeliveryError, type EmailDeliveryContext, type EmailDeliveryReceipt } from './email-delivery.ts';
export { createLocalAccountMailer } from './local-mailer.ts';

export interface ConnectionBinding {
  operationId: string;
  /** Canonical public-key identifier supplied by the trusted identity adapter. */
  installationKey: string;
  localVenueId: string;
  environment: string;
  organisationId: string;
  legalBusinessId: string;
}
export interface Registration {
  venueId: string;
  installationId: string;
  organisationId: string;
  legalBusinessId: string;
}
export interface ServiceState {
  service: 'continuous_backup' | 'remote_access' | 'retained_snapshots';
  state: 'unconfigured' | 'provisioning' | 'ready' | 'failed';
}
export type RegistrationErrorCode = 'invalid_input' | 'binding_conflict' | 'request_not_found'
  | 'request_expired' | 'approval_required' | 'approval_conflict' | 'permission_denied'
  | 'business_not_found' | 'registration_conflict' | 'installation_unavailable';
export class RegistrationError extends Error {
  readonly code: RegistrationErrorCode;
  constructor(code: RegistrationErrorCode) {
    super(code);
    this.name = 'RegistrationError';
    this.code = code;
  }
}
interface RequestRow {
  local_venue_id: string;
  environment: string;
  organisation_id: string;
  legal_business_id: string;
  local_receipt_id: string | null;
  cloud_account_id: string | null;
  result: Registration | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function requireUuid(value: string) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new RegistrationError('invalid_input');
}
function requireText(value: string, max: number) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.trim() !== value || value.includes('\0')) {
    throw new RegistrationError('invalid_input');
  }
}
function validate(binding: ConnectionBinding) {
  for (const id of [binding.operationId, binding.localVenueId, binding.organisationId, binding.legalBusinessId]) requireUuid(id);
  requireText(binding.installationKey, 256);
  requireText(binding.environment, 64);
}
function key(binding: ConnectionBinding) { return [binding.installationKey, binding.operationId]; }
function checkBinding(row: RequestRow, binding: ConnectionBinding) {
  if (row.local_venue_id !== binding.localVenueId || row.environment !== binding.environment
    || row.organisation_id !== binding.organisationId || row.legal_business_id !== binding.legalBusinessId) {
    throw new RegistrationError('binding_conflict');
  }
}
async function lockRequest(client: PoolClient, binding: ConnectionBinding): Promise<RequestRow | undefined> {
  const { rows } = await client.query<RequestRow>(
    'SELECT * FROM connection_requests WHERE installation_key = $1 AND operation_id = $2 FOR UPDATE', key(binding));
  const row = rows[0];
  if (row) checkBinding(row, binding);
  return row;
}
async function requireUnexpired(client: PoolClient, binding: ConnectionBinding) {
  // Use wall time after lock waits: transaction-start time could accept an expired approval.
  const { rows } = await client.query(
    'SELECT expires_at > clock_timestamp() AS valid FROM connection_requests WHERE installation_key = $1 AND operation_id = $2', key(binding));
  if (!rows[0]?.valid) throw new RegistrationError('request_expired');
}
async function requirePermission(client: PoolClient, accountId: string, organisationId: string) {
  const { rowCount } = await client.query(`SELECT a.id FROM cloud_accounts a
    JOIN organisation_memberships m ON m.account_id = a.id
    WHERE a.id = $1 AND m.organisation_id = $2 AND a.disabled_at IS NULL AND m.can_register_venues
    FOR SHARE OF a, m`, [accountId, organisationId]);
  if (!rowCount) throw new RegistrationError('permission_denied');
}
function isUniqueViolation(error: unknown, constraints: readonly string[]): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
    && 'constraint' in error && typeof error.constraint === 'string' && constraints.includes(error.constraint);
}

/**
 * Internal persistence only. Callers must authenticate the installation/account and verify local
 * approval before calling these methods. Keys, account IDs and receipt IDs are not bearer credentials.
 */
export class RegistrationStore {
  readonly #pool: Pool;
  constructor(pool: Pool) { this.#pool = pool; }

  async start(input: ConnectionBinding): Promise<void> {
    const binding = { ...input };
    validate(binding);
    await transaction(this.#pool, async (client) => {
      const prior = await lockRequest(client, binding);
      if (prior) {
        if (!prior.result) await requireUnexpired(client, binding);
        return;
      }
      const business = await client.query('SELECT id FROM legal_businesses WHERE id = $1 AND organisation_id = $2',
        [binding.legalBusinessId, binding.organisationId]);
      if (!business.rowCount) throw new RegistrationError('business_not_found');
      await client.query(`INSERT INTO connection_requests
        (installation_key, operation_id, local_venue_id, environment, organisation_id, legal_business_id)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (installation_key, operation_id) DO NOTHING`,
      [...key(binding), binding.localVenueId, binding.environment, binding.organisationId, binding.legalBusinessId]);
      await lockRequest(client, binding);
      await requireUnexpired(client, binding);
    });
  }

  async #request<T>(input: ConnectionBinding, action: (client: PoolClient, row: RequestRow, binding: ConnectionBinding) => Promise<T>): Promise<T> {
    const binding = { ...input };
    validate(binding);
    return transaction(this.#pool, async (client) => {
      const row = await lockRequest(client, binding);
      if (!row) throw new RegistrationError('request_not_found');
      return action(client, row, binding);
    });
  }

  async approveLocal(input: ConnectionBinding, receiptId: string): Promise<void> {
    requireUuid(receiptId);
    try {
      await this.#request(input, async (client, row, binding) => {
        await requireUnexpired(client, binding);
        if (row.local_receipt_id && row.local_receipt_id !== receiptId) throw new RegistrationError('approval_conflict');
        await client.query('UPDATE connection_requests SET local_receipt_id = $3 WHERE installation_key = $1 AND operation_id = $2',
          [...key(binding), receiptId]);
      });
    } catch (error) {
      if (isUniqueViolation(error, ['connection_requests_local_receipt_id_key'])) throw new RegistrationError('approval_conflict');
      throw error;
    }
  }

  async approveCloudWithSession(input: ConnectionBinding, sessionToken: string, csrfToken: string): Promise<void> {
    await this.#request(input, async (client, row, binding) => {
      const session = await resolveSession(client, sessionToken, { csrfToken, touch: false });
      await this.#approveCloud(client, row, binding, session.accountId);
      // Permission contention can outlast the session; an expired session rolls back the approval.
      await resolveSession(client, sessionToken, { csrfToken });
    });
  }

  /** Trusted adapter entry point. Browser callers must use approveCloudWithSession. */
  async approveCloud(input: ConnectionBinding, accountId: string): Promise<void> {
    requireUuid(accountId);
    await this.#request(input, (client, row, binding) => this.#approveCloud(client, row, binding, accountId));
  }

  async #approveCloud(client: PoolClient, row: RequestRow, binding: ConnectionBinding, accountId: string): Promise<void> {
    await requirePermission(client, accountId, binding.organisationId);
    await requireUnexpired(client, binding);
    if (row.cloud_account_id && row.cloud_account_id !== accountId) throw new RegistrationError('approval_conflict');
    await client.query('UPDATE connection_requests SET cloud_account_id = $3 WHERE installation_key = $1 AND operation_id = $2',
      [...key(binding), accountId]);
  }

  async complete(input: ConnectionBinding): Promise<Registration> {
    try {
      return await this.#request(input, async (client, row, binding) => {
        if (!row.local_receipt_id || !row.cloud_account_id) throw new RegistrationError('approval_required');
        if (row.result) {
          const active = await client.query('SELECT id FROM installations WHERE id = $1 AND revoked_at IS NULL FOR SHARE',
            [row.result.installationId]);
          if (!active.rowCount) throw new RegistrationError('installation_unavailable');
          return row.result;
        }
        // Hold permission rows until commit so revocation cannot commit between checking and linking.
        await requirePermission(client, row.cloud_account_id, binding.organisationId);
        await requireUnexpired(client, binding);
        await client.query(`INSERT INTO venues (id, organisation_id, legal_business_id, local_venue_id, environment)
          VALUES ($1, $2, $3, $4, $5) ON CONFLICT (environment, local_venue_id) DO NOTHING`,
        [randomUUID(), binding.organisationId, binding.legalBusinessId, binding.localVenueId, binding.environment]);
        const { rows: venues } = await client.query(`SELECT * FROM venues
          WHERE environment = $1 AND local_venue_id = $2 FOR UPDATE`, [binding.environment, binding.localVenueId]);
        const venue = venues[0];
        if (!venue || venue.organisation_id !== binding.organisationId || venue.legal_business_id !== binding.legalBusinessId) {
          throw new RegistrationError('registration_conflict');
        }
        const { rows: installations } = await client.query('SELECT * FROM installations WHERE venue_id = $1 FOR UPDATE', [venue.id]);
        let installation = installations[0];
        if (installation) {
          if (installation.public_key !== binding.installationKey) throw new RegistrationError('registration_conflict');
          if (installation.revoked_at) throw new RegistrationError('installation_unavailable');
        } else {
          const inserted = await client.query('INSERT INTO installations (id, venue_id, public_key) VALUES ($1, $2, $3) RETURNING *',
            [randomUUID(), venue.id, binding.installationKey]);
          installation = inserted.rows[0];
          await client.query(`INSERT INTO installation_services (installation_id, service)
            VALUES ($1, 'remote_access'), ($1, 'continuous_backup'), ($1, 'retained_snapshots')`, [installation.id]);
        }
        // A competing venue/installation insert may wait past expiry; roll back all writes then.
        await requireUnexpired(client, binding);
        const result: Registration = {
          venueId: venue.id, installationId: installation.id,
          organisationId: binding.organisationId, legalBusinessId: binding.legalBusinessId,
        };
        await client.query(`UPDATE connection_requests SET result = $3, completed_at = clock_timestamp(), completed_installation_id = $4
          WHERE installation_key = $1 AND operation_id = $2`, [...key(binding), result, result.installationId]);
        return result;
      });
    } catch (error) {
      if (isUniqueViolation(error, ['installations_public_key_key', 'installations_venue_id_key'])) {
        throw new RegistrationError('registration_conflict');
      }
      throw error;
    }
  }

  async configuration(installationKey: string): Promise<Registration & { services: ServiceState[] }> {
    requireText(installationKey, 256);
    const { rows } = await this.#pool.query(`SELECT i.id AS "installationId", v.id AS "venueId",
      v.organisation_id AS "organisationId", v.legal_business_id AS "legalBusinessId",
      jsonb_agg(jsonb_build_object('service', s.service, 'state', s.state) ORDER BY s.service) AS services
      FROM installations i JOIN venues v ON v.id = i.venue_id
      JOIN installation_services s ON s.installation_id = i.id
      WHERE i.public_key = $1 AND i.revoked_at IS NULL
      GROUP BY i.id, v.id`, [installationKey]);
    if (!rows[0]) throw new RegistrationError('installation_unavailable');
    return rows[0];
  }
}
