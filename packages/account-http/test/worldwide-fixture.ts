import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
export async function worldwideDatabase() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Run through scripts/test-postgres.mjs');
  const schema = `console_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
  await admin.query(`CREATE DATABASE ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = '/'+schema;
  const connection = {connectionString: url.href, options: '-c search_path=public'};
  const pool = new Pool(connection);
  return {pool, connection, async close() {await pool.end(); await admin.query(`DROP DATABASE ${schema}`); await admin.end();}};
}
export async function consolePort() {
  const server = (await import('node:net')).createServer();
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
  await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
