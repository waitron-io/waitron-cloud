import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';
import {migrationRelease} from './fixtures/migration-release.ts';

// These cases catch rewritten history, partially committed DDL and permissive startup gates.
async function fixture(){
 const schema='billing_upgrade_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`,application_name:schema});
 const old=await migrationRelease(44);
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await old.migrate(pool);
  const {seed}=await import(new URL('../../../scripts/schema-upgrade-fixture.mjs',import.meta.url).href);
  const keys=(id:string)=>({activeKeyId:id,keys:{[id]:randomBytes(32).toString('hex')}});
  await seed(old.root,pool,keys('mail'),keys('pairing'));
  return {schema,admin,pool,old,async close(){await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await old.close();}};
 }catch(error){await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await old.close();throw error;}
}
async function rows(pool:Pool,names?:string[]){
 const tables=names??(await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename')).rows.map(r=>r.tablename as string);
 const result:Record<string,unknown>={};
 for(const table of tables)result[table]=(await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows;
 return result;
}
async function emptyBilling(pool:Pool){
 const names=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE 'billing_%' ORDER BY tablename")).rows;
 assert.equal(names.length,15);
 for(const name of ['billing_allowance_versions','billing_allowance_reservations'])assert.ok(names.some(row=>row.tablename===name),name);
 for(const {tablename} of names)assert.equal((await pool.query(`SELECT count(*) FROM ${tablename}`)).rows[0].count,'0',tablename);
}

test('044 upgrades to billing without changing old rows or digests',async()=>{
 const f=await fixture();try{
  const before=await rows(f.pool),ledger=before.schema_migrations;delete before.schema_migrations;
  assert.equal((ledger as unknown[]).length,44);
  const {hasReleaseMigrationCount}=await import(new URL('../../../scripts/database-recovery-migrations.mjs',import.meta.url).href);
  assert.equal(hasReleaseMigrationCount('44',f.old.names),true);assert.equal(hasReleaseMigrationCount(String(migrationNames.length),f.old.names),false);
  assert.equal(hasReleaseMigrationCount(String(migrationNames.length),migrationNames),true);
  assert.equal(hasReleaseMigrationCount(String(migrationNames.length-1),migrationNames),false);
  assert.equal(hasReleaseMigrationCount(String(migrationNames.length+1),migrationNames),false);
  for(const name of f.old.names)assert.deepEqual(await readFile(new URL('../migrations/'+name,import.meta.url)),await readFile(f.old.root+'/packages/registration/migrations/'+name),name);
  await Promise.all([migrate(f.pool),migrate(f.pool)]);await migrate(f.pool);
  assert.deepEqual(await rows(f.pool,Object.keys(before)),before);
  const current=(await rows(f.pool,['schema_migrations'])).schema_migrations as unknown[];
  assert.equal(current.length,migrationNames.length);assert.deepEqual(current.slice(0,44),ledger);
  assert.equal(current.length-(ledger as unknown[]).length,3);assert.equal((current[46] as {row:{name:string}}).row.name,'047_billing_allowances_traffic.sql');assert.equal((current[44] as {row:{name:string}}).row.name,'045_billing_store.sql');assert.equal((current[45] as {row:{name:string}}).row.name,'046_venue_service_authority.sql');await emptyBilling(f.pool);
 }finally{await f.close();}
});

test('interrupted billing migration rolls back DDL and ledger then retries',async()=>{
 const f=await fixture(),lock=await f.pool.connect();
 let pending:Promise<void>|undefined;
 try{
  const before=await rows(f.pool),constraint=(await f.pool.query("SELECT conname FROM pg_constraint WHERE conrelid='venues'::regclass ORDER BY conname")).rows;
  await lock.query('BEGIN');const blocker=(await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await lock.query('LOCK TABLE schema_migrations IN SHARE MODE');
  pending=migrate(f.pool);const settled=pending.then(()=>({ok:true}),error=>({error}));
  let target:number|undefined;const end=Date.now()+5000;
  while(Date.now()<end){
   const r=(await f.admin.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query LIKE 'INSERT INTO schema_migrations%' AND $2=ANY(pg_blocking_pids(pid))",[f.schema,blocker])).rows[0];
   if(r){target=r.pid;break;}await delay(20);
  }
  assert.ok(target,'the owned migration must reach the blocked ledger insert');
  assert.equal((await f.admin.query('SELECT pg_terminate_backend($1) AS stopped',[target])).rows[0].stopped,true);
  const result=await settled;assert.ok('error' in result);
  await lock.query('ROLLBACK');
  assert.deepEqual(await rows(f.pool),before);
  assert.deepEqual((await f.pool.query("SELECT conname FROM pg_constraint WHERE conrelid='venues'::regclass ORDER BY conname")).rows,constraint);
  assert.equal((await f.pool.query("SELECT to_regclass('billing_businesses') AS relation")).rows[0].relation,null);
  await migrate(f.pool);await emptyBilling(f.pool);
 }finally{await lock.query('ROLLBACK');lock.release();await pending?.catch(()=>{});await f.close();}
});

test('billing consumers refuse missing changed and future ledgers',async()=>{
 const f=await fixture();try{
  const {checkConsumerSchema}=await import(new URL('../../../deploy/local-stack/runtime.mjs',import.meta.url).href);
  const root=new URL('../../../',import.meta.url).pathname;
  const before=await rows(f.pool);await assert.rejects(checkConsumerSchema(f.pool,root),/schema_incompatible/);assert.deepEqual(await rows(f.pool),before);
  await migrate(f.pool);await checkConsumerSchema(f.pool,root);
  const ledger=(await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  await f.pool.query("UPDATE schema_migrations SET digest=$1 WHERE name=$2",['0'.repeat(64),migrationNames[44]]);
  const changed=await rows(f.pool);await assert.rejects(checkConsumerSchema(f.pool,root),/schema_incompatible/);
  await assert.rejects(migrate(f.pool),/Applied migration has changed: 045_billing_store.sql/);assert.deepEqual(await rows(f.pool),changed);
  await f.pool.query('UPDATE schema_migrations SET digest=$1 WHERE name=$2',[ledger[44].digest,migrationNames[44]]);
  await f.pool.query("INSERT INTO schema_migrations(name,digest) VALUES('046_future.sql',$1)",['1'.repeat(64)]);
  const future=await rows(f.pool);await assert.rejects(checkConsumerSchema(f.pool,root),/schema_incompatible/);assert.deepEqual(await rows(f.pool),future);
 }finally{await f.close();}
});
