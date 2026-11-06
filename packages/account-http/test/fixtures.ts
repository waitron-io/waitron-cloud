import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { EmailOutbox } from '@waitron-cloud/registration';
import { migrate } from '../../registration/src/migrate.ts';
import {cloneVenueServiceTemplate} from '../../registration/test/fixtures/venue-service-template.ts';
export async function database(template?: string) {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Run through scripts/test-postgres.mjs');
  const schema = `http_${randomUUID().replaceAll('-', '')}`;
  const cloned = template === undefined ? undefined : await cloneVenueServiceTemplate(template, schema);
  const connectionString = cloned?.connectionString ?? process.env.TEST_DATABASE_URL;
  const admin = new Pool({connectionString});
  const connection = {connectionString, options: `-c search_path=${schema}`, application_name: schema};
  const pool = new Pool(connection); const secondPool = new Pool(connection);
  const keys = {test: randomBytes(32).toString('hex')};
  const rateKey = randomBytes(32).toString('hex');
  try {
    if (!cloned) await admin.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);
  } catch (error) {
    await pool.end(); await secondPool.end();
    if (!cloned) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end(); await cloned?.close(); throw error;
  }
  return {pool, secondPool, schema, keys, rateKey, outbox: new EmailOutbox({activeKeyId: 'test', keys}),
    async close() {await pool.end(); await secondPool.end(); if (!cloned) await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); await cloned?.close();}};
}
