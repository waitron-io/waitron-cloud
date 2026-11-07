import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';
import {fixture as relayFixture} from './fixtures/relay-worker.ts';
import {RelayWorker} from '../src/relay-worker.ts';
import {config,keys} from './fixtures/mail-attempt.ts';

async function previous(){
 const schema='handoff_upgrade_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,application_name:schema,options:`-c search_path=${schema} -c statement_timeout=10000`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  for(const name of migrationNames.slice(0,49)){
   const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');await pool.query(sql);
   await pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
  }
  await pool.query("INSERT INTO relay_suppressions(key_id,digest) VALUES('old-local-key',repeat('a',64))");
  const before=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,legacy=(await pool.query('SELECT * FROM relay_suppressions')).rows;
  return {pool,admin,schema,before,legacy,async close(){await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
 }catch(error){await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();throw error;}
}

test('the handoff upgrade preserves the exact 49-entry ledger and never attributes existing local blocks to a country',async()=>{
 const f=await previous();try{
  const {checkConsumerSchema}=await import(new URL('../../../deploy/local-stack/runtime.mjs',import.meta.url).href);
  const root=new URL('../../../',import.meta.url).pathname;
  await assert.rejects(checkConsumerSchema(f.pool,root),/schema_incompatible/);
  await Promise.all([migrate(f.pool),migrate(f.pool)]);await migrate(f.pool);
  const after=(await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  assert.equal(after.length,54);assert.deepEqual(after.slice(0,49),f.before);assert.equal(after[49].name,'050_mail_legacy_suppression_scopes.sql');
  assert.deepEqual((await f.pool.query('SELECT key_id,digest FROM relay_suppressions')).rows,f.legacy);
  assert.deepEqual((await f.pool.query('SELECT * FROM mail_legacy_suppression_scopes')).rows,[]);
  await checkConsumerSchema(f.pool,root);
 }finally{await f.close();}
});

test('interrupted handoff mapping creation rolls back its table and ledger without changing old blocks',async()=>{
 const f=await previous(),held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await held.query('LOCK TABLE schema_migrations IN SHARE MODE');const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=migrate(f.pool).then(()=>null,e=>e);let target:number|undefined;const until=performance.now()+5000;
  do{target=(await f.admin.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query LIKE 'INSERT INTO schema_migrations%' AND $2=ANY(pg_blocking_pids(pid))",[f.schema,blocker])).rows[0]?.pid;if(!target)await setImmediate();}while(!target&&performance.now()<until);
  assert.ok(target);await f.admin.query('SELECT pg_cancel_backend($1)',[target]);assert.equal((await pending as {code:string}).code,'57014');await held.query('ROLLBACK');
  assert.equal((await f.pool.query("SELECT to_regclass('mail_legacy_suppression_scopes') AS relation")).rows[0].relation,null);
  assert.deepEqual((await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,f.before);
  assert.deepEqual((await f.pool.query('SELECT * FROM relay_suppressions')).rows,f.legacy);
  await migrate(f.pool);assert.equal((await f.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'54');
 }finally{await held.query('ROLLBACK');held.release();await pending;await f.close();}
});

test('a mapped manual block retains private immutable attribution without a fabricated provider event',async()=>{
 const f=await relayFixture();try{
  await new RelayWorker(f.pool,{...f.config,ses:{config:config(),recipientKeys:keys}}).suppress('owner@example.test');
  const rows=(await f.pool.query('SELECT * FROM mail_legacy_suppression_scopes')).rows;assert.equal(rows.length,1);
  assert.equal(rows[0].country,'ES');assert.equal(rows[0].provider_account_id,'123456789012');assert.equal(rows[0].region,'eu-north-1');
  assert.equal(rows[0].legacy_key_id,'s1');assert.equal(rows[0].key_id,'v1');assert.match(rows[0].digest,/^[a-f0-9]{64}$/);assert.match(rows[0].legacy_digest,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(rows).includes('owner@example.test'),false);assert.equal((await f.pool.query('SELECT count(*) FROM mail_feedback_events')).rows[0].count,'0');
  for(const sql of ["UPDATE mail_legacy_suppression_scopes SET country='FR'",'DELETE FROM mail_legacy_suppression_scopes','TRUNCATE mail_legacy_suppression_scopes CASCADE'])await assert.rejects(f.pool.query(sql),/mail_binding_immutable/);
 }finally{await f.close();}
});
