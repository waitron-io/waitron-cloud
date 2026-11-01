import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import * as migrations from '../src/migrate.ts';
const schema=`schema_gate_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrations.migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
test('migration refuses a newer release ledger without writing',async()=>{
 await pool.query("INSERT INTO schema_migrations(name,digest) VALUES('999_future.sql','future')");
 const before=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
 try{await assert.rejects(migrations.migrate(pool),/schema_incompatible/);assert.deepEqual((await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,before);}
 finally{await pool.query("DELETE FROM schema_migrations WHERE name='999_future.sql'");}
});
test('target verification release checks every applied SQL digest',async()=>{
 const {checkConsumerSchema}=await import(new URL('../../../deploy/local-stack/runtime.mjs',import.meta.url).href);
 const root=new URL('../../../',import.meta.url).pathname;
 assert.equal(migrations.migrationNames.at(44),'045_billing_store.sql');
 assert.equal(migrations.migrationNames.at(-1),'046_data_lifecycle.sql');
 assert.equal(migrations.migrationNames[43],'044_remote_forward_observations.sql');
 assert.equal(migrations.migrationNames[42],'043_backup_target_verification.sql');
 const row=(await pool.query("SELECT * FROM schema_migrations WHERE name='043_backup_target_verification.sql'")).rows[0];
 assert.ok(row);
 await checkConsumerSchema(pool,root);
 try{
  await pool.query("UPDATE schema_migrations SET digest='tampered' WHERE name='043_backup_target_verification.sql'");
  await assert.rejects(migrations.migrate(pool),/Applied migration has changed/);
  await assert.rejects(checkConsumerSchema(pool,root),/schema_incompatible/);
 }finally{await pool.query('UPDATE schema_migrations SET digest=$2 WHERE name=$1',[row.name,row.digest]);}
 await checkConsumerSchema(pool,root);
});

test('lifecycle upgrade preserves the full previous ledger and rejects changed applied SQL',async()=>{
 const name=`lifecycle_upgrade_${randomUUID().replaceAll('-','')}`;
 const p=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${name}`});
 const previous=await mkdtemp(join(tmpdir(),'lifecycle-previous-manifest-'));
 const {checkConsumerSchema}=await import(new URL('../../../deploy/local-stack/runtime.mjs',import.meta.url).href);
 const {hasReleaseMigrationCount}=await import(new URL('../../../scripts/database-recovery-migrations.mjs',import.meta.url).href);
 try{
  await admin.query(`CREATE SCHEMA ${name}`);
  await p.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  const priorNames=migrations.migrationNames.slice(0,45);
  await mkdir(join(previous,'packages/registration/src'),{recursive:true});
  await mkdir(join(previous,'packages/registration/migrations'));
  await writeFile(join(previous,'packages/registration/src/migrate.ts'),'export const migrationNames='+JSON.stringify(priorNames)+';');
  for(const entry of priorNames){
   const sql=await readFile(new URL('../migrations/'+entry,import.meta.url),'utf8');
   await p.query(sql);await p.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[entry,createHash('sha256').update(sql).digest('hex')]);
   await writeFile(join(previous,'packages/registration/migrations',entry),sql);
  }
  const venue=randomUUID(),business=randomUUID(),org=randomUUID();
  await p.query('INSERT INTO organisations(id) VALUES($1)',[org]);
  await p.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,org]);
  await p.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[venue,org,business]);
  const ledger=(await p.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  const venues=(await p.query('SELECT * FROM venues')).rows;
  await checkConsumerSchema(p,previous);
  assert.equal(hasReleaseMigrationCount('45'),false);
  await Promise.all([migrations.migrate(p),migrations.migrate(p)]);await migrations.migrate(p);
  const rows=(await p.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  assert.equal(rows.length,46);assert.deepEqual(rows.slice(0,45),ledger);
  assert.deepEqual((await p.query('SELECT * FROM venues')).rows,venues);
  assert.equal((await p.query('SELECT count(*) FROM data_lifecycles')).rows[0].count,'0');
  assert.equal(hasReleaseMigrationCount('46'),true);
  await assert.rejects(checkConsumerSchema(p,previous),/schema_incompatible/);
  await checkConsumerSchema(p,new URL('../../../',import.meta.url).pathname);
  const applied=rows.at(-1)!;
  await p.query("UPDATE schema_migrations SET digest='tampered' WHERE name='046_data_lifecycle.sql'");
  await assert.rejects(migrations.migrate(p),/Applied migration has changed: 046_data_lifecycle.sql/);
  await assert.rejects(checkConsumerSchema(p,new URL('../../../',import.meta.url).pathname),/schema_incompatible/);
  await p.query('UPDATE schema_migrations SET digest=$2 WHERE name=$1',[applied.name,applied.digest]);
  await migrations.migrate(p);await checkConsumerSchema(p,new URL('../../../',import.meta.url).pathname);
 }finally{await p.end();await admin.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);await rm(previous,{recursive:true,force:true});}
});
