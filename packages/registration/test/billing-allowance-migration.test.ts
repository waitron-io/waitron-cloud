import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';
import {migrationRelease} from './fixtures/migration-release.ts';

const added=['billing_allowance_versions','billing_allowance_reservations','remote_traffic_processes','remote_traffic_samples','remote_traffic_coverage'];
async function fixture(){
 const schema='allowance_upgrade_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`,application_name:schema}),old=await migrationRelease(46);
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await old.migrate(pool);
  await pool.query('INSERT INTO organisations(id,name) VALUES($1,$2)',[randomUUID(),'retained allowance predecessor']);
  const names=(await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename')).rows.map(r=>r.tablename as string);
  const prior:Record<string,unknown>={};for(const name of names)prior[name]=(await pool.query(`SELECT to_jsonb(t) AS row FROM "${name}" t ORDER BY ${name==='schema_migrations'?'name':'to_jsonb(t)::text'}`)).rows;
  return {schema,admin,pool,old,prior,async close(){await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await old.close();}};
 }catch(error){await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await old.close();throw error;}
}

test('allowance upgrade preserves every prior ledger row',async()=>{
 const f=await fixture();try{
  assert.equal((f.prior.schema_migrations as unknown[]).length,46);
  for(const name of f.old.names)assert.deepEqual(await readFile(new URL('../migrations/'+name,import.meta.url)),await readFile(f.old.root+'/packages/registration/migrations/'+name),name);
  await Promise.all([migrate(f.pool),migrate(f.pool)]);
  const ledger=(await f.pool.query('SELECT to_jsonb(t) AS row FROM schema_migrations t ORDER BY name')).rows;
  assert.equal(ledger.length,47,'the current migration must append exactly the allowance schema');
  assert.deepEqual(ledger.slice(0,46),f.prior.schema_migrations);
  assert.equal(ledger[46].row.name,'047_billing_allowances_traffic.sql');assert.equal(migrationNames.at(-1),'047_billing_allowances_traffic.sql');
  for(const [name,before] of Object.entries(f.prior))if(name!=='schema_migrations')assert.deepEqual((await f.pool.query(`SELECT to_jsonb(t) AS row FROM "${name}" t ORDER BY to_jsonb(t)::text`)).rows,before,name);
  for(const name of added)assert.equal((await f.pool.query(`SELECT count(*) FROM ${name}`)).rows[0].count,'0',name);
  await migrate(f.pool);assert.deepEqual((await f.pool.query('SELECT to_jsonb(t) AS row FROM schema_migrations t ORDER BY name')).rows,ledger);
  await assert.rejects(f.old.migrate(f.pool),/schema_incompatible/);
 }finally{await f.close();}
});

test('interrupted allowance migration rolls back and retries once',async()=>{
 const f=await fixture(),blocker=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  assert.equal(migrationNames.at(-1),'047_billing_allowances_traffic.sql','the interrupted candidate must contain the actual allowance migration');
  await blocker.query('BEGIN');await blocker.query('LOCK TABLE schema_migrations IN SHARE MODE');
  const blockerPid=Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  pending=migrate(f.pool).then(()=>({ok:true}),error=>({error}));let target:number|undefined;const until=performance.now()+5000;
  do{
   const row=(await f.admin.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query LIKE 'INSERT INTO schema_migrations%' AND $2=ANY(pg_blocking_pids(pid))",[f.schema,blockerPid])).rows[0];
   if(row){target=Number(row.pid);break;}await setImmediate();
  }while(performance.now()<until);
  assert.ok(target,'the owned migration backend must reach its blocked ledger insert');
  assert.equal((await f.admin.query('SELECT pg_terminate_backend($1) AS stopped',[target])).rows[0].stopped,true);
  const stopped=await pending;assert.ok(stopped&&typeof stopped==='object'&&'error' in stopped);
  await blocker.query('ROLLBACK');
  for(const name of added)assert.equal((await f.pool.query('SELECT to_regclass($1) AS relation',[name])).rows[0].relation,null,name);
  assert.deepEqual((await f.pool.query('SELECT to_jsonb(t) AS row FROM schema_migrations t ORDER BY name')).rows,f.prior.schema_migrations);
  await Promise.all([migrate(f.pool),migrate(f.pool)]);const ledger=(await f.pool.query('SELECT to_jsonb(t) AS row FROM schema_migrations t ORDER BY name')).rows;
  assert.equal(ledger.length,47);assert.deepEqual(ledger.slice(0,46),f.prior.schema_migrations);
  await migrate(f.pool);assert.deepEqual((await f.pool.query('SELECT to_jsonb(t) AS row FROM schema_migrations t ORDER BY name')).rows,ledger);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending;await f.close();}
});
