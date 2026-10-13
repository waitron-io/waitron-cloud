import type { Pool } from 'pg';
import { migrate } from '../../src/migrate.ts';

// Test isolation replaces an owned disposable schema rather than erasing immutable history.
export async function resetSchema(pool: Pool): Promise<void> {
  const schema = (await pool.query('SELECT current_schema() AS name')).rows[0].name as
    string | null;
  if (
    !process.env.TEST_DATABASE_URL ||
    !schema ||
    schema === 'public' ||
    !/^\w+_[a-f0-9]{32}$/.test(schema)
  )
    throw new Error('test_schema_not_disposable');
  const name = '"' + schema + '"';
  await pool.query(`DROP SCHEMA ${name} CASCADE; CREATE SCHEMA ${name}`);
  await migrate(pool);
}
