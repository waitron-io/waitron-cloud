import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {randomUUID} from 'node:crypto';
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
 assert.equal(migrations.migrationNames.at(-1),'045_billing_store.sql');
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
