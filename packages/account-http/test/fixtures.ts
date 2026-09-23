import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { EmailOutbox } from '@waitron-cloud/registration';
import { migrate } from '../../registration/src/migrate.ts';
export async function database() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Run through scripts/test-postgres.mjs');
  const schema = `http_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
  const connection = {connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, application_name: schema};
  const pool = new Pool(connection); const secondPool = new Pool(connection);
  const keys = {test: randomBytes(32).toString('hex')};
  const rateKey = randomBytes(32).toString('hex');
  await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
  return {pool, secondPool, schema, keys, rateKey, outbox: new EmailOutbox({activeKeyId: 'test', keys}),
    async close() {await pool.end(); await secondPool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();}};
}
