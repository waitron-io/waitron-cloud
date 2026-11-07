import assert from 'node:assert/strict';
import {test} from 'node:test';
import {lifecycleFixture} from './fixtures/data-lifecycle.ts';
import {Pool} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {migrate,migrationNames} from '../src/migrate.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const previousRelease='4d0eb9a5ed6264bb9469397d20ec71141c3f68f3';

const f=lifecycleFixture('country_migration');
const tables=['country_policy_versions','country_policy_heads','venue_country_bindings','venue_country_binding_heads'];
async function installed(){
 assert.equal((await f.pool.query("SELECT to_regclass('country_policy_versions') IS NOT NULL AS present")).rows[0].present,true,'country policy schema must be installed');
}
const policy={country:'ES',revision:1,homeRegion:'eu-south-2',backupRegions:[],flows:[]};
async function seed(){
 await installed();
 await f.pool.query('INSERT INTO country_policy_versions(country,revision,definition) VALUES($1,1,$2)',['ES',policy]);
 await f.pool.query("INSERT INTO country_policy_heads VALUES('ES',1)");
 await f.pool.query(`INSERT INTO venue_country_bindings VALUES($1,'venue-backup-home',1,'ES',1,'test-supplier','test-account','https://backup.example.test/','backup','eu-south-2')`,[f.venueId]);
 await f.pool.query("INSERT INTO venue_country_binding_heads VALUES($1,'venue-backup-home',1)",[f.venueId]);
}

test('country admission tables start empty without qualifying a policy or a venue',async()=>{
 for(const name of tables){
  assert.equal((await f.pool.query('SELECT to_regclass($1) IS NOT NULL AS present',[name])).rows[0].present,true,name+' must be installed');
  assert.equal((await f.pool.query(`SELECT count(*) FROM ${name}`)).rows[0].count,'0',name+' must start empty');
 }
});

test('policy and binding versions cannot be changed, deleted or truncated',async()=>{
 await seed();
 for(const sql of ["UPDATE country_policy_versions SET definition='{}'",'DELETE FROM country_policy_versions',
  "UPDATE venue_country_bindings SET account_id='other-account'",'DELETE FROM venue_country_bindings',
  'TRUNCATE country_policy_versions CASCADE','TRUNCATE venue_country_bindings CASCADE']){
  await assert.rejects(f.pool.query(sql),{code:'55000'});
 }
});

test('heads advance monotonically and cannot be deleted or retargeted',async()=>{
 await seed();
 await f.pool.query('INSERT INTO country_policy_versions VALUES($1,2,$2)',['ES',{...policy,revision:2}]);
 await f.pool.query("UPDATE country_policy_heads SET revision=2 WHERE country='ES'");
 await f.pool.query(`INSERT INTO venue_country_bindings SELECT venue_id,service_id,2,country,2,supplier_id,account_id,endpoint,data_class,region FROM venue_country_bindings WHERE placement_revision=1`);
 await f.pool.query('UPDATE venue_country_binding_heads SET placement_revision=2');
 for(const sql of ["UPDATE country_policy_heads SET revision=1","UPDATE country_policy_heads SET revision=2",
  'UPDATE venue_country_binding_heads SET placement_revision=1','UPDATE venue_country_binding_heads SET placement_revision=2',
  'DELETE FROM country_policy_heads','DELETE FROM venue_country_binding_heads','TRUNCATE country_policy_heads CASCADE',
  'TRUNCATE venue_country_binding_heads CASCADE'])await assert.rejects(f.pool.query(sql),{code:'55000'});
 assert.equal((await f.pool.query('SELECT revision FROM country_policy_heads')).rows[0].revision,2);
 assert.equal((await f.pool.query('SELECT placement_revision FROM venue_country_binding_heads')).rows[0].placement_revision,2);
});

test('incomplete JSON, missing referenced versions and nonpositive revisions cannot create bindings',async()=>{
 await installed();
 await assert.rejects(f.pool.query("INSERT INTO country_policy_versions VALUES('ES',1,'[]')"),{code:'23514'});
 await assert.rejects(f.pool.query('INSERT INTO country_policy_versions VALUES($1,0,$2)',['ES',policy]),{code:'23514'});
 await assert.rejects(f.pool.query("INSERT INTO country_policy_heads VALUES('ES',1)"),{code:'23503'});
 await seed();
 for(const change of ["supplier_id=''","account_id=''","endpoint=''","data_class=''","region=''","placement_revision=0"]){
  await assert.rejects(f.pool.query(`INSERT INTO venue_country_bindings SELECT venue_id,'other-service',${change==='placement_revision=0'?'0':'1'},country,policy_revision,${change.startsWith('supplier_id=')?"''":'supplier_id'},${change.startsWith('account_id=')?"''":'account_id'},${change.startsWith('endpoint=')?"''":'endpoint'},${change.startsWith('data_class=')?"''":'data_class'},${change.startsWith('region=')?"''":'region'} FROM venue_country_bindings`),{code:'23514'});
 }
});

test('historical SQL bytes and the populated organisation survive interrupted upgrade and retry',async()=>{
 const schema='country_upgrade_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema},pg_catalog -c application_name=${schema}`});
 let held:import('pg').PoolClient|undefined,pending:Promise<unknown>|undefined;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  const root=new URL('../../../',import.meta.url).pathname;
  const names=(await exec('git',['ls-tree','-r','--name-only',previousRelease,'packages/registration/migrations/'],{cwd:root})).stdout.trim().split('\n').map(name=>name.slice('packages/registration/migrations/'.length));
  assert.deepEqual(migrationNames.slice(0,-1),names,'the previous release must be the exact migration prefix');
  for(const name of migrationNames.slice(0,-1)){
   const sql=(await exec('git',['show',previousRelease+':packages/registration/migrations/'+name],{cwd:root,encoding:'buffer'})).stdout;
   assert.deepEqual(await readFile(new URL('../migrations/'+name,import.meta.url)),sql,name+' must match the delivered predecessor');
   await pool.query(sql.toString());
   await pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
  }
  const org=randomUUID();await pool.query('INSERT INTO organisations(id) VALUES($1)',[org]);
  const oldRows=(await pool.query('SELECT * FROM organisations')).rows;
  const ledger=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  assert.equal(ledger.length,migrationNames.length-1);
  held=await pool.connect();await held.query('BEGIN');await held.query('LOCK TABLE schema_migrations IN SHARE MODE');
  const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=migrate(pool).then(()=>null,error=>error);
  let target:number|undefined;
  for(let n=0;n<500&&!target;n++){
   target=(await pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query LIKE 'INSERT INTO schema_migrations%' AND $2=ANY(pg_blocking_pids(pid))",[schema,blocker])).rows[0]?.pid;
   if(!target)await delay(10);
  }
  assert.ok(target,'the new migration must reach its uncommitted ledger write');
  assert.equal((await pool.query('SELECT pg_cancel_backend($1) AS cancelled',[target])).rows[0].cancelled,true);
  assert.equal((await pending as {code:string}).code,'57014');await held.query('ROLLBACK');
  assert.equal((await pool.query("SELECT to_regclass('country_policy_versions') AS relation")).rows[0].relation,null);
  assert.deepEqual((await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,ledger);
  assert.deepEqual((await pool.query('SELECT * FROM organisations')).rows,oldRows);
  await migrate(pool);await migrate(pool);
  const upgraded=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  assert.equal(upgraded.length,migrationNames.length);assert.deepEqual(upgraded.slice(0,-1),ledger);
  assert.equal(upgraded.at(-1).name,migrationNames.at(-1));
  assert.equal(upgraded.at(-1).digest,createHash('sha256').update(await readFile(new URL('../migrations/'+migrationNames.at(-1),import.meta.url))).digest('hex'));
  for(const row of ledger)assert.equal(createHash('sha256').update(await readFile(new URL('../migrations/'+row.name,import.meta.url))).digest('hex'),row.digest);
  assert.deepEqual((await pool.query('SELECT * FROM organisations')).rows,oldRows);
  for(const name of tables)assert.equal((await pool.query(`SELECT count(*) FROM ${name}`)).rows[0].count,'0');
 }finally{
  await held?.query('ROLLBACK');await pending;held?.release();await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
 }
});
