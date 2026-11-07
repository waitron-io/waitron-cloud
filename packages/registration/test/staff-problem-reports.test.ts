import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';

test('staff migration preserves populated automatic reports and applied digests across concurrent retries',async()=>{
 assert.equal(migrationNames[52],'053_staff_problem_reports.sql');
 const schema='staff_upgrade_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  for(const name of migrationNames.slice(0,52)){
   const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');await pool.query(sql);
   await pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
  }
  const org=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID(),operation=randomUUID();
  await pool.query("INSERT INTO organisations(id,name) VALUES($1,'Synthetic preserved organisation')",[org]);
  await pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Synthetic business','ES')",[business,org]);
  await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,org,business,randomUUID()]);
  await pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'synthetic-key')",[installation,venue]);
  await pool.query(`INSERT INTO installation_error_reports(installation_id,operation_id,environment,digest,code,source,version_major,version_minor,version_patch,reported_at,occurrences,logs)
   VALUES($1,$2,'test',$3,'storage.disk_full','packages/storage/src/archive.ts#write',1,2,3,'2026-11-01T12:00:00Z',5,'[]')`,[installation,operation,'a'.repeat(64)]);
  const before=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,prior=(await pool.query('SELECT * FROM installation_error_reports')).rows[0];
  await Promise.all([migrate(pool),migrate(pool)]);await migrate(pool);
  const after=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  assert.deepEqual(after.slice(0,52),before);assert.equal(after[52].name,'053_staff_problem_reports.sql');assert.equal(after.length,53);
  assert.deepEqual((await pool.query('SELECT * FROM installation_error_reports')).rows,[{...prior,kind:'automatic',details:null,description:null,description_operation_id:null,description_digest:null}]);
  for(const change of ["code=NULL","occurrences=NULL","details='{}'::jsonb","description='Private text'","kind='staff'","kind='other'"]){
   await assert.rejects(pool.query('UPDATE installation_error_reports SET '+change),(error:unknown)=>(error as {code?:string}).code==='23514');
  }
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
