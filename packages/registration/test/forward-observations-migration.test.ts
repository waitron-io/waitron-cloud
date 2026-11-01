import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';

test('044 upgrades the historical 043 prefix concurrently and preserves all earlier migration receipts',async()=>{
 const schema='forward_migration_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL}),pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  for(const name of migrationNames.slice(0,43)){const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');await pool.query(sql);await pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);}
  const before=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  await Promise.all([migrate(pool),migrate(pool)]);await migrate(pool);
  const rows=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;assert.equal(rows.length,migrationNames.length);assert.equal(rows.at(44).name,'045_billing_store.sql');assert.equal(rows.at(-1).name,'046_data_lifecycle.sql');assert.deepEqual(rows.slice(0,43),before);assert.equal(rows[43].name,'044_remote_forward_observations.sql');
  const tables=(await pool.query("SELECT relname,relpersistence FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relname IN ('remote_forward_reporters','remote_forward_observations') ORDER BY relname")).rows;
  assert.deepEqual(tables,[{relname:'remote_forward_observations',relpersistence:'u'},{relname:'remote_forward_reporters',relpersistence:'p'}]);
  await pool.query("UPDATE schema_migrations SET digest='tampered' WHERE name='044_remote_forward_observations.sql'");await assert.rejects(migrate(pool),/Applied migration has changed: 044_remote_forward_observations.sql/);
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
