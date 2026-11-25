import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';

test('staff migration preserves populated automatic reports and applied digests across concurrent retries',async()=>{
 assert.equal(migrationNames[52],'053_country_flow_authority.sql');assert.equal(migrationNames[53],'054_staff_problem_reports.sql');
 const schema='staff_upgrade_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  for(const name of migrationNames.slice(0,53)){
   const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');await pool.query(sql);
   await pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
  }
  const org=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID(),operation=randomUUID();
  await pool.query("INSERT INTO organisations(id,name) VALUES($1,'Synthetic preserved organisation')",[org]);
  await pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Synthetic business','ES')",[business,org]);
  await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[venue,org,business]);
  await pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'synthetic-key')",[installation,venue]);
  await pool.query(`INSERT INTO installation_error_reports(installation_id,operation_id,environment,digest,code,source,version_major,version_minor,version_patch,reported_at,occurrences,logs)
   VALUES($1,$2,'test',$3,'storage.disk_full','packages/storage/src/archive.ts#write',1,2,3,'2026-11-01T12:00:00Z',5,'[]')`,[installation,operation,'a'.repeat(64)]);
  const before=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,prior=(await pool.query('SELECT * FROM installation_error_reports')).rows[0];
  await Promise.all([migrate(pool),migrate(pool)]);await migrate(pool);
  const after=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  assert.deepEqual(after.slice(0,53),before);assert.equal(after[52].name,'053_country_flow_authority.sql');assert.equal(after[53].name,'054_staff_problem_reports.sql');assert.equal(after.length,85);assert.equal(after[58].name,'059_account_action_proof.sql');assert.equal(after[59].name,'060_account_email_changes.sql');assert.equal(after[60].name,'061_connection_action_proof.sql');
  assert.deepEqual((await pool.query('SELECT * FROM installation_error_reports')).rows,[{...prior,kind:'automatic',details:null,description:null,description_operation_id:null,description_digest:null,staff_receipt_owner_id:null,staff_report_body:null,staff_description_body:null,staff_description_at:null}]);
  for(const change of ["code=NULL","occurrences=NULL","details='{}'::jsonb","description='Private text'","kind='staff'","kind='other'"]){
   await assert.rejects(pool.query('UPDATE installation_error_reports SET '+change),(error:unknown)=>(error as {code?:string}).code==='23514');
  }
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});

test('Sent reports upgrade dates existing owners without exposing legacy staff reports',async()=>{
 const schema='sent_reports_upgrade_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  for(const name of migrationNames.slice(0,82)){
   const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');
   await pool.query(sql);
   await pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
  }
  const owner=randomUUID(),member=randomUUID(),org=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID();
  await pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)',[owner,member]);
  await pool.query("INSERT INTO organisations(id,name) VALUES($1,'Synthetic group')",[org]);
  await pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$3,true),($2,$3,false)',[owner,member,org]);
  await pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Synthetic business','ES')",[business,org]);
  await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",[venue,org,business]);
  await pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'synthetic-key')",[installation,venue]);
  await pool.query(`INSERT INTO installation_error_reports(installation_id,operation_id,environment,digest,kind,version_major,version_minor,version_patch,reported_at,logs,details,description)
   VALUES($1,$2,'test',repeat('a',64),'staff',1,2,3,'2026-11-01T12:00:00Z','[]','{}','Legacy text')`,[installation,randomUUID()]);
  const before=(await pool.query('SELECT name,digest FROM schema_migrations ORDER BY name')).rows;
  const start=(await pool.query('SELECT clock_timestamp()::text AS at')).rows[0].at;
  await migrate(pool);
  const end=(await pool.query('SELECT clock_timestamp()::text AS at')).rows[0].at;
  const membership=await pool.query(`SELECT (to_jsonb(m)->>'owner_since')::timestamptz BETWEEN $1::timestamptz AND $2::timestamptz AS dated, is_owner
   FROM organisation_memberships m ORDER BY is_owner DESC`,[start,end]);
  assert.deepEqual(membership.rows,[{dated:true,is_owner:true},{dated:null,is_owner:false}]);
  const result=(await pool.query('SELECT * FROM installation_error_reports')).rows[0];
  assert.equal(result.description,'Legacy text');
  assert.equal(result.staff_report_body,null);
  assert.equal(result.staff_receipt_owner_id,null);
  assert.equal(result.staff_description_body,null);
  assert.equal(result.staff_description_at,null);
  const after=(await pool.query('SELECT name,digest FROM schema_migrations ORDER BY name')).rows;
  assert.deepEqual(after.slice(0,82),before);
  assert.equal(after.length,85);
  assert.equal(after.at(82)?.name,'083_sent_report_bodies.sql');assert.equal(after.at(83)?.name,'084_venue_snapshot_recovery.sql');assert.equal(after.at(-1)?.name,'085_address_lookup.sql');
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
