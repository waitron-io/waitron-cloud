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
