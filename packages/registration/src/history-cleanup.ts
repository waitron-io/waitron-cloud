import type {Pool, PoolClient, QueryResult} from 'pg';
import {transaction} from './transaction.ts';

export const historyCleanupCategories = [
  'sessions',
  'signupRequests',
  'passwordResetRequests',
  'webauthnCeremonies',
  'pairingRequests',
  'registrationOperations',
  'emailDeliveries',
  'backupJobs',
  'recoveryHistory',
  'backupTombstones',
] as const;

export type HistoryCleanupCategory = typeof historyCleanupCategories[number];
export type HistoryCleanupPolicy = Readonly<{
  cutoffs: Readonly<Partial<Record<HistoryCleanupCategory, string>>>;
  chunkSize: number;
}>;
export type HistoryCleanupCategoryReport = Readonly<{
  cutoff: string;
  eligible: number;
  blocked: number;
  deleted: number;
  hasMore: boolean;
}>;
export type HistoryCleanupReport = Readonly<{
  schemaVersion: 1;
  mode: 'dry-run' | 'apply';
  chunkSize: number;
  categories: Readonly<Partial<Record<HistoryCleanupCategory, HistoryCleanupCategoryReport>>>;
}>;

const CATEGORY_SET = new Set<string>(historyCleanupCategories);
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const fail = (): never => { throw new Error('Invalid history cleanup policy'); };
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function cutoff(value: unknown): string {
  if (typeof value !== 'string') return fail();
  const match = RFC3339.exec(value);
  if (!match) return fail();
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  const fraction = (match[7] ?? '').padEnd(3, '0');
  const zone = match[8]!;
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59
    || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) return fail();
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second, Number(fraction)));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return fail();
  return parsed.toISOString();
}

export function parseHistoryCleanupPolicy(value: unknown): HistoryCleanupPolicy {
  if (!object(value) || !Object.keys(value).every(key => key === 'cutoffs' || key === 'chunkSize') || !object(value.cutoffs)) return fail();
  const entries = Object.entries(value.cutoffs);
  if (entries.some(([key]) => !CATEGORY_SET.has(key))) return fail();
  const cutoffs: Partial<Record<HistoryCleanupCategory, string>> = {};
  for (const [key, raw] of entries) cutoffs[key as HistoryCleanupCategory] = cutoff(raw);
  const chunkSize = value.chunkSize ?? 100;
  if (!Number.isInteger(chunkSize) || Number(chunkSize) < 1 || Number(chunkSize) > 1000) return fail();
  return Object.freeze({cutoffs: Object.freeze(cutoffs), chunkSize: Number(chunkSize)});
}

export class HistoryCleanup {
  readonly #pool: Pool;
  constructor(pool: Pool) { this.#pool = pool; }
  async run(policy: HistoryCleanupPolicy, options: {apply: boolean}): Promise<HistoryCleanupReport> {
    const categories: Partial<Record<HistoryCleanupCategory, HistoryCleanupCategoryReport>> = {};
    for (const category of historyCleanupCategories) {
      const value = policy.cutoffs[category];
      if (value) categories[category] = await transaction(this.#pool, async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('history-cleanup:' || $1))", [category]);
        return this.#category(client, category, value, policy.chunkSize, options.apply);
      });
    }
    return {schemaVersion: 1, mode: options.apply ? 'apply' : 'dry-run', chunkSize: policy.chunkSize, categories};
  }

  async #category(client: PoolClient, category: HistoryCleanupCategory, cutoff: string,
    limit: number, apply: boolean): Promise<HistoryCleanupCategoryReport> {
    switch (category) {
      case 'sessions': return this.#simple(client, cutoff, limit, apply, {
        eligible: `SELECT count(*)::integer AS count FROM cloud_sessions s
          WHERE (s.ended_at<$1 OR (s.ended_at IS NULL AND LEAST(s.last_seen_at+interval '30 minutes',s.absolute_expires_at)<$1))
          AND NOT EXISTS(SELECT 1 FROM cloud_webauthn_ceremonies c WHERE c.session_token_hash=s.token_hash)`,
        blocked: `SELECT count(*)::integer AS count FROM cloud_sessions s
          WHERE (s.ended_at<$1 OR (s.ended_at IS NULL AND LEAST(s.last_seen_at+interval '30 minutes',s.absolute_expires_at)<$1))
          AND EXISTS(SELECT 1 FROM cloud_webauthn_ceremonies c WHERE c.session_token_hash=s.token_hash)`,
        apply: `WITH selected AS(SELECT s.token_hash FROM cloud_sessions s
          WHERE (s.ended_at<$1 OR (s.ended_at IS NULL AND LEAST(s.last_seen_at+interval '30 minutes',s.absolute_expires_at)<$1))
          AND NOT EXISTS(SELECT 1 FROM cloud_webauthn_ceremonies c WHERE c.session_token_hash=s.token_hash)
          ORDER BY COALESCE(s.ended_at,LEAST(s.last_seen_at+interval '30 minutes',s.absolute_expires_at)),s.token_hash
          LIMIT $2 FOR UPDATE OF s SKIP LOCKED)
          DELETE FROM cloud_sessions s USING selected x WHERE s.token_hash=x.token_hash
          AND (s.ended_at<$1 OR (s.ended_at IS NULL AND LEAST(s.last_seen_at+interval '30 minutes',s.absolute_expires_at)<$1))
          AND NOT EXISTS(SELECT 1 FROM cloud_webauthn_ceremonies c WHERE c.session_token_hash=s.token_hash) RETURNING s.token_hash`,
      });
      case 'signupRequests': return this.#requestCategory(client, 'signup_requests', cutoff, limit, apply);
      case 'passwordResetRequests': return this.#requestCategory(client, 'password_reset_requests', cutoff, limit, apply);
      case 'webauthnCeremonies': return this.#simple(client, cutoff, limit, apply, {
        eligible: `SELECT count(*)::integer AS count FROM cloud_webauthn_ceremonies
          WHERE COALESCE(consumed_at,expires_at)<$1 AND (consumed_at IS NOT NULL OR expires_at<=clock_timestamp())`,
        apply: `WITH selected AS(SELECT id FROM cloud_webauthn_ceremonies
          WHERE COALESCE(consumed_at,expires_at)<$1 AND (consumed_at IS NOT NULL OR expires_at<=clock_timestamp())
          ORDER BY COALESCE(consumed_at,expires_at),id LIMIT $2 FOR UPDATE SKIP LOCKED)
          DELETE FROM cloud_webauthn_ceremonies c USING selected s WHERE c.id=s.id
          AND COALESCE(c.consumed_at,c.expires_at)<$1 AND (c.consumed_at IS NOT NULL OR c.expires_at<=clock_timestamp()) RETURNING c.id`,
      });
      case 'pairingRequests': return this.#simple(client, cutoff, limit, apply, {
        eligible: `SELECT count(*)::integer AS count FROM pairing_requests
          WHERE expires_at<$1 AND (result IS NOT NULL OR expires_at<=clock_timestamp())`,
        apply: `WITH selected AS(SELECT id FROM pairing_requests
          WHERE expires_at<$1 AND (result IS NOT NULL OR expires_at<=clock_timestamp())
          ORDER BY expires_at,id LIMIT $2 FOR UPDATE SKIP LOCKED)
          DELETE FROM pairing_requests p USING selected s WHERE p.id=s.id
          AND p.expires_at<$1 AND (p.result IS NOT NULL OR p.expires_at<=clock_timestamp()) RETURNING p.id`,
      });
      case 'registrationOperations': return this.#registrationOperations(client, cutoff, limit, apply);
      case 'emailDeliveries': return this.#emailDeliveries(client, cutoff, limit, apply);
      case 'backupJobs': return this.#simple(client, cutoff, limit, apply, {
        eligible: `SELECT count(*)::integer AS count FROM backup_jobs
          WHERE status='completed' AND COALESCE(last_success_at,available_at)<$1`,
        apply: `WITH selected AS(SELECT id FROM backup_jobs
          WHERE status='completed' AND COALESCE(last_success_at,available_at)<$1
          ORDER BY COALESCE(last_success_at,available_at),id LIMIT $2 FOR UPDATE SKIP LOCKED)
          DELETE FROM backup_jobs j USING selected s WHERE j.id=s.id
          AND j.status='completed' AND COALESCE(j.last_success_at,j.available_at)<$1 RETURNING j.id`,
      });
      case 'recoveryHistory': return this.#recoveryHistory(client, cutoff, limit, apply);
      case 'backupTombstones': return this.#backupTombstones(client, cutoff, limit, apply);
    }
  }

  async #simple(client: PoolClient, cutoff: string, limit: number, apply: boolean,
    queries: {eligible: string; blocked?: string; apply: string}): Promise<HistoryCleanupCategoryReport> {
    const eligible = await count(client, queries.eligible, [cutoff]);
    const blocked = queries.blocked ? await count(client, queries.blocked, [cutoff]) : 0;
    const deleted = apply ? (await client.query(queries.apply, [cutoff, limit])).rowCount ?? 0 : 0;
    return {cutoff, eligible, blocked, deleted, hasMore: apply ? eligible > deleted : eligible > 0};
  }

  #requestCategory(client: PoolClient, table: 'signup_requests' | 'password_reset_requests',
    cutoff: string, limit: number, apply: boolean) {
    const base = `COALESCE(r.consumed_at,r.expires_at)<$1 AND (r.consumed_at IS NOT NULL OR r.expires_at<=clock_timestamp())`;
    const work = `EXISTS(SELECT 1 FROM email_outbox e WHERE e.token_hash=r.token_hash AND e.status IN ('pending','processing'))`;
    return this.#simple(client, cutoff, limit, apply, {
      eligible: `SELECT count(*)::integer AS count FROM ${table} r WHERE ${base} AND NOT ${work}`,
      blocked: `SELECT count(*)::integer AS count FROM ${table} r WHERE ${base} AND ${work}`,
      apply: `WITH selected AS(SELECT r.token_hash FROM ${table} r WHERE ${base} AND NOT ${work}
        ORDER BY COALESCE(r.consumed_at,r.expires_at),r.token_hash LIMIT $2 FOR UPDATE OF r SKIP LOCKED)
        DELETE FROM ${table} r USING selected s WHERE r.token_hash=s.token_hash AND ${base} AND NOT ${work} RETURNING r.token_hash`,
    });
  }

  async #registrationOperations(client: PoolClient, cutoff: string, limit: number, apply: boolean) {
    const requestBase = `COALESCE(r.completed_at,r.expires_at)<$1 AND (r.completed_at IS NOT NULL OR r.expires_at<=clock_timestamp())`;
    const eligibleRequests = await count(client, `SELECT count(*)::integer AS count FROM connection_requests r WHERE ${requestBase}`, [cutoff]);
    const eligibleOperations = await count(client, 'SELECT count(*)::integer AS count FROM installation_operations WHERE created_at<$1', [cutoff]);
    let deleted = 0;
    if (apply) {
      const requests = await client.query(`WITH selected AS(SELECT r.installation_key,r.operation_id FROM connection_requests r
        WHERE ${requestBase} ORDER BY COALESCE(r.completed_at,r.expires_at),r.installation_key,r.operation_id
        LIMIT $2 FOR UPDATE OF r SKIP LOCKED)
        DELETE FROM connection_requests r USING selected s
        WHERE r.installation_key=s.installation_key AND r.operation_id=s.operation_id AND ${requestBase}
        RETURNING r.operation_id`, [cutoff, limit]);
      deleted += requests.rowCount ?? 0;
      const remaining = limit - deleted;
      if (remaining > 0) {
        const operations = await client.query(`WITH selected AS(SELECT installation_id,operation_id FROM installation_operations
          WHERE created_at<$1 ORDER BY created_at,installation_id,operation_id LIMIT $2 FOR UPDATE SKIP LOCKED)
          DELETE FROM installation_operations o USING selected s
          WHERE o.installation_id=s.installation_id AND o.operation_id=s.operation_id AND o.created_at<$1 RETURNING o.operation_id`, [cutoff, remaining]);
        deleted += operations.rowCount ?? 0;
      }
    }
    const eligible = eligibleRequests + eligibleOperations;
    return {cutoff, eligible, blocked: 0, deleted, hasMore: apply ? eligible > deleted : eligible > 0};
  }

  async #emailDeliveries(client: PoolClient, cutoff: string, limit: number, apply: boolean) {
    const terminal = `e.status IN ('sent','expired','cancelled','failed') AND e.finished_at<$1`;
    const eligible = await count(client, `SELECT count(*)::integer AS count FROM email_outbox e WHERE ${terminal}`, [cutoff]);
    let deleted = 0;
    if (apply) {
      const selected = await client.query<{id: string}>(`SELECT e.id FROM email_outbox e WHERE ${terminal}
        ORDER BY e.finished_at,e.id LIMIT $2 FOR UPDATE OF e SKIP LOCKED`, [cutoff, limit]);
      const ids = selected.rows.map(row => row.id);
      if (ids.length) {
        await client.query('DELETE FROM service_alert_deliveries WHERE outbox_id=ANY($1::uuid[])', [ids]);
        const result = await client.query(`DELETE FROM email_outbox e WHERE e.id=ANY($2::uuid[]) AND ${terminal} RETURNING e.id`, [cutoff, ids]);
        deleted = result.rowCount ?? 0;
      }
    }
    return {cutoff, eligible, blocked: 0, deleted, hasMore: apply ? eligible > deleted : eligible > 0};
  }

  async #recoveryHistory(client: PoolClient, cutoff: string, limit: number, apply: boolean) {
    const aged = `r.status='closed' AND r.expires_at<$1`;
    const incomplete = `EXISTS(SELECT 1 FROM installation_replacements x WHERE x.id=r.id AND x.completed_at IS NULL)`;
    const eligible = await count(client, `SELECT count(*)::integer AS count FROM backup_recoveries r WHERE ${aged} AND NOT ${incomplete}`, [cutoff]);
    const blocked = await count(client, `SELECT count(*)::integer AS count FROM backup_recoveries r WHERE ${aged} AND ${incomplete}`, [cutoff]);
    let deleted = 0;
    if (apply) {
      const selected = await client.query<{id: string}>(`SELECT r.id FROM backup_recoveries r WHERE ${aged} AND NOT ${incomplete}
        ORDER BY r.expires_at,r.id LIMIT $2 FOR UPDATE OF r SKIP LOCKED`, [cutoff, limit]);
      const ids = selected.rows.map(row => row.id);
      if (ids.length) {
        await client.query('DELETE FROM backup_recovery_requests WHERE id=ANY($1::uuid[])', [ids]);
        await client.query('DELETE FROM installation_replacements WHERE id=ANY($1::uuid[]) AND completed_at IS NOT NULL', [ids]);
        const result = await client.query(`DELETE FROM backup_recoveries r WHERE r.id=ANY($2::uuid[]) AND ${aged}
          AND NOT ${incomplete} RETURNING r.id`, [cutoff, ids]);
        deleted = result.rowCount ?? 0;
      }
    }
    return {cutoff, eligible, blocked, deleted, hasMore: apply ? eligible > deleted : eligible > 0};
  }

  async #backupTombstones(client: PoolClient, cutoff: string, limit: number, apply: boolean) {
    const protectedPoint = `p.id=(SELECT q.id FROM backup_points q WHERE q.venue_id=p.venue_id AND q.kind='snapshot'
      AND NOT q.deleting AND q.deleted_at IS NULL AND q.verification='verified' ORDER BY q.captured_at DESC,q.id DESC LIMIT 1)`;
    const referenced = `EXISTS(SELECT 1 FROM backup_recoveries r WHERE r.point_id=p.id)`;
    const aged = `p.deleted_at<$1`;
    const eligible = await count(client, `SELECT count(*)::integer AS count FROM backup_points p
      WHERE ${aged} AND NOT ${referenced} AND NOT ${protectedPoint}`, [cutoff]);
    const blocked = await count(client, `SELECT count(*)::integer AS count FROM backup_points p
      WHERE ${aged} AND (${referenced} OR ${protectedPoint})`, [cutoff]);
    let deleted = 0;
    if (apply) {
      const selected = await client.query<{id: string}>(`SELECT p.id FROM backup_points p
        WHERE ${aged} AND NOT ${referenced} AND NOT ${protectedPoint}
        ORDER BY p.deleted_at,p.id LIMIT $2 FOR UPDATE OF p SKIP LOCKED`, [cutoff, limit]);
      const ids = selected.rows.map(row => row.id);
      if (ids.length) {
        await client.query('DELETE FROM backup_verifications WHERE point_id=ANY($1::uuid[])', [ids]);
        await client.query("DELETE FROM backup_jobs WHERE kind='verify' AND status='completed' AND target_id=ANY($1::uuid[])", [ids]);
        const result = await client.query(`DELETE FROM backup_points p WHERE p.id=ANY($2::uuid[]) AND ${aged}
          AND NOT ${referenced} AND NOT ${protectedPoint} RETURNING p.id`, [cutoff, ids]);
        const removed = result.rows.map(row => row.id as string);
        deleted = removed.length;
        if (removed.length) await client.query(`DELETE FROM backup_captures c WHERE c.id=ANY($2::uuid[])
          AND c.cleaned_at<$1 AND NOT EXISTS(SELECT 1 FROM backup_points p WHERE p.id=c.id)`, [cutoff, removed]);
      }
    }
    return {cutoff, eligible, blocked, deleted, hasMore: apply ? eligible > deleted : eligible > 0};
  }
}

async function count(client: PoolClient, sql: string, values: unknown[]): Promise<number> {
  const result: QueryResult<{count: number}> = await client.query(sql, values);
  return result.rows[0]?.count ?? 0;
}
