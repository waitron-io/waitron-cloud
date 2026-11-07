import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';

test('migration 052 preserves populated release51 and every applied SQL digest across retries',async()=>{
 assert.equal(migrationNames[51],'052_box_error_reports.sql');
 const schema='error_upgrade_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  for(const name of migrationNames.slice(0,51)){
   const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');await pool.query(sql);
   await pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
  }
  const id=randomUUID();await pool.query('INSERT INTO organisations(id,name) VALUES($1,$2)',[id,'Synthetic preserved organisation']);
  const before=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  await Promise.all([migrate(pool),migrate(pool)]);await migrate(pool);
  const after=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  assert.deepEqual(after.slice(0,51),before);assert.equal(after[51].name,'052_box_error_reports.sql');
  assert.equal((await pool.query('SELECT name FROM organisations WHERE id=$1',[id])).rows[0].name,'Synthetic preserved organisation');
  assert.equal((await pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count,'0');
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
