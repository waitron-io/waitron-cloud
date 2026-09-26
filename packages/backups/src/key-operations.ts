import type { Pool, PoolClient } from "pg";
import { EmailOutbox } from "@waitron-cloud/registration";
import type { BackupKeyVault } from "./keys.ts";

type Validation = "verified" | "configured" | "unavailable";
type Retirement = "blocked" | "eligible";

export interface BackupKeyDependency {
  venueId: string;
  version: number;
  active: boolean;
  validation: Validation;
  retirement: Retirement;
  dependencies: {
    captures: number;
    points: number;
    managedStreams: number;
  };
}

export interface EmailKeyDependency {
  keyId: string;
  active: boolean;
  configured: boolean;
  validation: Validation;
  retirement: Retirement;
  dependencies: {
    pending: number;
    processing: number;
  };
}

export interface ManagedKeyDependencyReport {
  schemaVersion: 1;
  ready: boolean;
  backupKeys: BackupKeyDependency[];
  emailKeys: EmailKeyDependency[];
}

export interface InspectManagedKeyOptions {
  backupVault?: BackupKeyVault;
  emailKeys?: {
    activeKeyId: string;
    keys: Record<string, string>;
  };
}

interface BackupRow {
  venue_id: string;
  version: number;
  sealed: string;
  active: boolean;
  captures: string | number;
  points: string | number;
  managed_streams: string | number;
}

interface EmailCountRow {
  key_id: string;
  pending: string | number;
  processing: string | number;
}

const number = (value: string | number) => Number(value);

async function backupDependencies(
  client: PoolClient,
  vault: BackupKeyVault | undefined,
): Promise<BackupKeyDependency[]> {
  const rows = await client.query<BackupRow>(`
    WITH capture_counts AS (
      SELECT venue_id,key_version,count(*) AS count FROM backup_captures GROUP BY venue_id,key_version
    ), point_counts AS (
      SELECT venue_id,key_version,count(*) AS count FROM backup_points GROUP BY venue_id,key_version
    ), stream_counts AS (
      SELECT venue_id,key_version,count(*) AS count FROM backup_managed_streams GROUP BY venue_id,key_version
    )
    SELECT k.venue_id,k.version,k.sealed,l.active_key_version=k.version AS active,
      coalesce(c.count,0) AS captures,coalesce(p.count,0) AS points,
      coalesce(s.count,0) AS managed_streams
    FROM backup_key_versions k
    JOIN backup_locations l ON l.venue_id=k.venue_id
    LEFT JOIN capture_counts c ON c.venue_id=k.venue_id AND c.key_version=k.version
    LEFT JOIN point_counts p ON p.venue_id=k.venue_id AND p.key_version=k.version
    LEFT JOIN stream_counts s ON s.venue_id=k.venue_id AND s.key_version=k.version
    ORDER BY k.venue_id,k.version`);
  return rows.rows.map((row) => {
    let validation: Validation = "unavailable";
    try {
      vault?.open(row.venue_id, row.version, row.sealed);
      if (vault) validation = "verified";
    } catch {}
    const dependencies = {
      captures: number(row.captures),
      points: number(row.points),
      managedStreams: number(row.managed_streams),
    };
    return {
      venueId: row.venue_id,
      version: row.version,
      active: row.active,
      validation,
      retirement:
        validation === "unavailable" ||
        row.active ||
        Object.values(dependencies).some((count) => count > 0)
          ? "blocked"
          : "eligible",
      dependencies,
    };
  });
}

async function emailDependencies(
  client: PoolClient,
  options: InspectManagedKeyOptions,
): Promise<EmailKeyDependency[]> {
  const emailOutbox = options.emailKeys ? new EmailOutbox(options.emailKeys) : undefined;
  const configuredEmailKeyIds = options.emailKeys ? Object.keys(options.emailKeys.keys) : [];
  const activeEmailKeyId = options.emailKeys?.activeKeyId;
  const counts = await client.query<EmailCountRow>(`
    SELECT key_id,
      count(*) FILTER (WHERE status='pending') AS pending,
      count(*) FILTER (WHERE status='processing') AS processing
    FROM email_outbox WHERE payload IS NOT NULL GROUP BY key_id ORDER BY key_id`);
  const countById = new Map(counts.rows.map((row) => [row.key_id, row]));
  const validationById = new Map<string, boolean>();
  let cursorKey = "";
  let cursorId = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const page = await client.query(`
      SELECT * FROM email_outbox WHERE payload IS NOT NULL
        AND (key_id>$1 OR (key_id=$1 AND id>$2::uuid))
      ORDER BY key_id,id LIMIT 100`, [cursorKey, cursorId]);
    for (const row of page.rows) {
      const keyId = row.key_id as string;
      if (!validationById.has(keyId)) validationById.set(keyId, true);
      try {
        emailOutbox?.open(row);
        if (!emailOutbox) validationById.set(keyId, false);
      } catch {
        validationById.set(keyId, false);
      }
    }
    if (page.rows.length < 100) break;
    const last = page.rows.at(-1)!;
    cursorKey = last.key_id as string;
    cursorId = last.id as string;
  }
  const ids = new Set(configuredEmailKeyIds);
  if (activeEmailKeyId) ids.add(activeEmailKeyId);
  for (const row of counts.rows) ids.add(row.key_id);

  return [...ids].sort().map((keyId) => {
    const row = countById.get(keyId);
    const dependencies = {
      pending: number(row?.pending ?? 0),
      processing: number(row?.processing ?? 0),
    };
    const configured = configuredEmailKeyIds.includes(keyId);
    let validation: Validation = configured ? "configured" : "unavailable";
    if (dependencies.pending + dependencies.processing > 0) {
      validation = configured && validationById.get(keyId) ? "verified" : "unavailable";
    }
    const active = keyId === activeEmailKeyId;
    return {
      keyId,
      active,
      configured,
      validation,
      retirement:
        validation === "unavailable" ||
        active ||
        dependencies.pending + dependencies.processing > 0
          ? "blocked"
          : "eligible",
      dependencies,
    };
  });
}

/** Read-only preflight; the report contains identifiers and counts, never key or payload bytes. */
export async function inspectManagedKeyDependencies(
  pool: Pool,
  options: InspectManagedKeyOptions,
): Promise<ManagedKeyDependencyReport> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const backupKeys = await backupDependencies(client, options.backupVault);
    const emailKeys = await emailDependencies(client, options);
    await client.query("COMMIT");
    return {
      schemaVersion: 1,
      ready:
        !!options.backupVault &&
        !!options.emailKeys &&
        emailKeys.some((item) => item.active && item.configured) &&
        backupKeys.every((item) => item.validation === "verified") &&
        emailKeys.every(
          (item) =>
            item.validation !== "unavailable" &&
            (item.dependencies.pending + item.dependencies.processing === 0 ||
              item.validation === "verified"),
        ),
      backupKeys,
      emailKeys,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
