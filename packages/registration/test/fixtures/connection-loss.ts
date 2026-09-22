import { Pool } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { transaction } from '../../src/transaction.ts';
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
try {
  let rejected = false;
  try {
    await transaction(pool, async (client) => {
      if (process.argv[2] === 'query') {
        await client.query('SELECT pg_terminate_backend(pg_backend_pid())');
      } else {
        const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
        await pool.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);
        await delay(50);
      }
    });
  } catch {
    rejected = true;
  }
  const { rows } = await pool.query('SELECT 1 AS alive');
  process.stdout.write(JSON.stringify({ rejected, poolUsable: rows[0].alive === 1 }));
} finally {
  await pool.end();
}
