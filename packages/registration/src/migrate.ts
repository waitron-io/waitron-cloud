import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { transaction } from './transaction.ts';

export const migrationNames = ['001_registration.sql', '002_identity.sql', '003_signup.sql', '004_password_recovery.sql', '005_email_outbox.sql', '006_email_transport.sql', '007_account_http.sql', '008_pairing.sql', '009_installation_lifecycle.sql', '010_remote_access.sql', '011_managed_backups.sql', '012_backup_jobs.sql', '013_service_monitoring.sql', '014_remote_hostname_changes.sql','015_backup_recovery_requests.sql','016_server_replacement.sql','017_remote_probe_observations.sql','018_managed_continuous_recovery.sql','019_passkeys.sql','020_account_security_controls.sql','021_history_cleanup.sql','022_security_audit.sql','023_remote_cell_moves.sql','024_remote_configuration_jobs.sql','025_usage_metering.sql','026_support_grants.sql','027_pairing_code_protection.sql'] as const;
export async function migrate(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    // Serialise migration runners before creating the ledger, including its first creation.
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('cloud_migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    const unknown = await client.query('SELECT name FROM schema_migrations WHERE NOT (name = ANY($1::text[]))', [migrationNames]);
    if (unknown.rowCount) throw new Error('schema_incompatible');
    for (const name of migrationNames) {
      const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
      const digest = createHash('sha256').update(sql).digest('hex');
      const prior = await client.query('SELECT digest FROM schema_migrations WHERE name = $1', [name]);
      if (prior.rows.length) {
        if (prior.rows[0].digest !== digest) throw new Error(`Applied migration has changed: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, digest) VALUES ($1, $2)', [name, digest]);
    }
  });
}
