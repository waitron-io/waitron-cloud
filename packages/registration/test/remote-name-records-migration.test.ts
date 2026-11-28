import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';
import {migrationRelease} from './fixtures/migration-release.ts';

test('the name-job upgrade preserves earlier jobs and migration receipts across repeated runners',async()=>{
 const old=await migrationRelease(71),schema='name_records_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL}),pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await old.migrate(pool);
  for(const kind of ['route','certificate_staff','certificate_public'])await pool.query("INSERT INTO remote_configuration_jobs(kind,target_id,desired_digest,status,attempts,last_error) VALUES($1,$2,$3,'failed',8,'reconcile_failed')",[kind,randomUUID(),'a'.repeat(64)]);
  const rows=(await pool.query('SELECT * FROM remote_configuration_jobs ORDER BY kind')).rows,ledger=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  await assert.rejects(pool.query("INSERT INTO remote_configuration_jobs(kind,target_id,desired_digest) VALUES('name',$1,$2)",[randomUUID(),'b'.repeat(64)]),{code:'23514'});
  await Promise.all([migrate(pool),migrate(pool)]);await migrate(pool);
  await pool.query("INSERT INTO remote_configuration_jobs(kind,target_id,desired_digest) VALUES('name',$1,$2)",[randomUUID(),'b'.repeat(64)]);
  assert.deepEqual((await pool.query("SELECT * FROM remote_configuration_jobs WHERE kind<>'name' ORDER BY kind")).rows,rows);
  const current=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  assert.deepEqual(current.slice(0,71),ledger);assert.equal(current.length,93);assert.equal(current[71].name,'072_remote_name_records.sql');
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await old.close();}
});
