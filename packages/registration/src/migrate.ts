import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { transaction } from './transaction.ts';

const migrations = ['001_registration.sql'];
export async function migrate(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    // Serialise migration runners before creating the ledger, including its first creation.
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('cloud_migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    for (const name of migrations) {
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
