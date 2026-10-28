import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { transaction } from './transaction.ts';

export const migrationNames = ['001_registration.sql', '002_identity.sql', '003_signup.sql', '004_password_recovery.sql', '005_email_outbox.sql', '006_email_transport.sql', '007_account_http.sql', '008_pairing.sql', '009_installation_lifecycle.sql', '010_remote_access.sql', '011_managed_backups.sql', '012_backup_jobs.sql', '013_service_monitoring.sql', '014_remote_hostname_changes.sql','015_backup_recovery_requests.sql','016_server_replacement.sql','017_remote_probe_observations.sql','018_managed_continuous_recovery.sql','019_passkeys.sql','020_account_security_controls.sql','021_history_cleanup.sql','022_security_audit.sql','023_remote_cell_moves.sql','024_remote_configuration_jobs.sql','025_usage_metering.sql','026_support_grants.sql','027_pairing_code_protection.sql','028_recovery_code_protection.sql','029_backup_verification_unavailable.sql','030_staff_certificate_exchange.sql','031_relay_grants.sql','032_relay_messages.sql','033_relay_worker.sql','034_relay_admission_bounds.sql','035_authenticator_factor.sql','036_relay_operator_stop.sql','037_monitoring_quiet_escalation.sql','038_fiscal_allocation_registry.sql','039_translation_jobs.sql','040_translation_result_json.sql','041_content_translation_service.sql','042_organisation_service_plans.sql','043_backup_target_verification.sql','044_remote_forward_observations.sql'] as const;
export async function migrate(pool: Pool): Promise<void> {
  let stage = 'transaction-start';
  let migrationOrdinal: number | undefined;
  try {
    await transaction(pool, async (client) => {
      // Serialise migration runners before creating the ledger, including its first creation.
      stage = 'advisory-lock';
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('cloud_migrations'))");
      stage = 'ledger-create';
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
      stage = 'ledger-compatibility';
      const unknown = await client.query('SELECT name FROM schema_migrations WHERE NOT (name = ANY($1::text[]))', [migrationNames]);
      if (unknown.rowCount) throw new Error('schema_incompatible');
      for (const name of migrationNames) {
        migrationOrdinal = migrationNames.indexOf(name) + 1;
        stage = 'migration-load';
        const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
        const digest = createHash('sha256').update(sql).digest('hex');
        stage = 'migration-lookup';
        const prior = await client.query('SELECT digest FROM schema_migrations WHERE name = $1', [name]);
        if (prior.rows.length) {
          if (prior.rows[0].digest !== digest) throw new Error(`Applied migration has changed: ${name}`);
          continue;
        }
        stage = 'migration-apply';
        await client.query(sql);
        stage = 'migration-record';
        await client.query('INSERT INTO schema_migrations (name, digest) VALUES ($1, $2)', [name, digest]);
      }
      stage = 'transaction-finish';
      migrationOrdinal = undefined;
    });
  } catch (error) {
    // Diagnostic fields come only from this runner, never from SQL or the caught value.
    try { console.error(JSON.stringify({event:'cloud-migration-setup-failed',stage,...(migrationOrdinal === undefined ? {} : {migrationOrdinal})})); } catch {}
    throw error;
  }
}
