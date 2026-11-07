import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import type {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';
import {lockMailScope,recipientIsSuppressed} from '../src/recipient-suppression.ts';
import {transaction} from '../src/transaction.ts';
import {fixture as relayFixture} from './fixtures/relay-worker.ts';
import {config,keys} from './fixtures/mail-attempt.ts';

async function previous(pool:Pool){
 await transaction(pool,async c=>{
  await c.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  for(const name of migrationNames.slice(0,50)){
   const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');await c.query(sql);
   await c.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
  }
 });
}
async function populated(){
 const f=await relayFixture(previous);
 try{
  const shared=createHmac('sha256',Buffer.from(keys.keys.v1,'hex')).update(JSON.stringify(['waitron-mail-recipient-v1','owner@example.test'])).digest('hex');
  const local=createHmac('sha256',Buffer.from(f.config.suppressionKeys.keys.s1,'hex')).update(JSON.stringify(['relay-suppression-v1','owner@example.test'])).digest('hex');
  await f.pool.query("INSERT INTO relay_suppressions(key_id,digest) VALUES('s1',$1),('s1',repeat('b',64))",[local]);
  for(const country of ['ES','FR']){
   await f.pool.query("INSERT INTO mail_recipient_key_versions(country,provider_account_id,region,key_id,commitment) VALUES($1,'123456789012','eu-north-1','v1',repeat('c',64))",[country]);
   await f.pool.query("INSERT INTO mail_legacy_suppression_scopes(country,provider_account_id,region,key_id,digest,legacy_key_id,legacy_digest) VALUES($1,'123456789012','eu-north-1','v1',$2,'s1',$3)",[country,shared,local]);
  }
  return {...f,shared,local,ledger:(await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,legacy:(await f.pool.query('SELECT * FROM relay_suppressions ORDER BY key_id,digest')).rows,mappings:(await f.pool.query('SELECT * FROM mail_legacy_suppression_scopes ORDER BY country')).rows};
 }catch(error){await f.close();throw error;}
}

test('release 51 preserves all 50 SQL digests and populated mappings while assigning exact current block lifetimes',async()=>{
 const f=await populated();try{
  await Promise.all([migrate(f.pool),migrate(f.pool)]);await migrate(f.pool);
  const ledger=(await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  assert.equal(ledger.length,54);assert.equal(ledger[50].name,'051_mail_suppression_reconciliation.sql');assert.equal(ledger[51].name,'052_box_error_reports.sql');assert.deepEqual(ledger.slice(0,50),f.ledger);
  for(const row of f.ledger)assert.equal(createHash('sha256').update(await readFile(new URL('../migrations/'+row.name,import.meta.url))).digest('hex'),row.digest);
  assert.deepEqual((await f.pool.query('SELECT key_id,digest FROM relay_suppressions ORDER BY key_id,digest')).rows,f.legacy);
  assert.deepEqual((await f.pool.query('SELECT * FROM mail_legacy_suppression_scopes ORDER BY country')).rows,f.mappings);
  const blocks=(await f.pool.query('SELECT * FROM relay_suppressions ORDER BY key_id,digest')).rows;
  assert.equal(new Set(blocks.map(b=>b.block_id)).size,2);
  const lifetimes=(await f.pool.query('SELECT * FROM mail_legacy_suppression_lifetimes ORDER BY country')).rows;
  assert.equal(lifetimes.length,2);for(const row of lifetimes)assert.equal(row.block_id,blocks.find(b=>b.digest===f.local).block_id);
  const blocked=(country:string)=>transaction(f.pool,async c=>{await lockMailScope(c,config('eu-north-1',country).scope);return recipientIsSuppressed(c,config('eu-north-1',country).scope,[{keyId:'v1',digest:f.shared}]);});
  assert.equal(await blocked('ES'),true);assert.equal(await blocked('FR'),true);
  await f.pool.query("DELETE FROM relay_suppressions WHERE digest=$1",[f.local]);await f.pool.query("INSERT INTO relay_suppressions(key_id,digest) VALUES('s1',$1)",[f.local]);
  assert.equal(await blocked('ES'),false);assert.equal(await blocked('FR'),false);
  for(const sql of ["UPDATE relay_suppressions SET block_id=gen_random_uuid()",'DELETE FROM mail_legacy_suppression_lifetimes','TRUNCATE mail_legacy_suppression_lifetimes CASCADE'])await assert.rejects(f.pool.query(sql),/mail_binding_immutable/);
 }finally{await f.close();}
});

test('interrupting release 51 rolls back lifetime assignment and its ledger before a repeatable retry',async()=>{
 const f=await populated(),held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await held.query('LOCK TABLE schema_migrations IN SHARE MODE');const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=migrate(f.pool).then(()=>null,e=>e);let target:number|undefined;const until=performance.now()+5000;
  do{target=(await f.pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query LIKE 'INSERT INTO schema_migrations%' AND $2=ANY(pg_blocking_pids(pid))",[f.schema,blocker])).rows[0]?.pid;if(!target)await setImmediate();}while(!target&&performance.now()<until);
  assert.ok(target);await f.pool.query('SELECT pg_cancel_backend($1)',[target]);assert.equal((await pending as {code:string}).code,'57014');await held.query('ROLLBACK');
  assert.equal((await f.pool.query("SELECT to_regclass('mail_legacy_suppression_lifetimes') AS relation")).rows[0].relation,null);
  assert.deepEqual((await f.pool.query('SELECT * FROM relay_suppressions ORDER BY key_id,digest')).rows,f.legacy);
  assert.deepEqual((await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,f.ledger);
  await migrate(f.pool);assert.equal((await f.pool.query('SELECT count(*) FROM mail_legacy_suppression_lifetimes')).rows[0].count,'2');
 }finally{await held.query('ROLLBACK');await pending;held.release();await f.close();}
});

test('unscoped provenance survives upgrade and cannot be changed into scoped authority',async()=>{
 const f=await populated();try{
  await migrate(f.pool);
  const rows=(await f.pool.query("SELECT digest,to_jsonb(relay_suppressions)->'unscoped' AS unscoped FROM relay_suppressions ORDER BY digest")).rows;
  assert.equal(rows.find(r=>r.digest!==f.local).unscoped,true,'old unmapped origin remains unknown');
  assert.equal(rows.find(r=>r.digest===f.local).unscoped,true,'an old mapping cannot prove that the block began scoped');
  await f.pool.query("INSERT INTO relay_suppressions(key_id,digest,unscoped) VALUES('s1',repeat('c',64),false)");
  await f.pool.query("UPDATE relay_suppressions SET unscoped=true WHERE digest=repeat('c',64)");
  assert.equal((await f.pool.query("SELECT unscoped FROM relay_suppressions WHERE digest=repeat('c',64)")).rows[0].unscoped,true);
  await assert.rejects(f.pool.query('UPDATE relay_suppressions SET unscoped=false WHERE digest=$1',[f.local]),/mail_binding_immutable/);
  for(const column of ['key_id','digest','block_id'])await assert.rejects(f.pool.query(`UPDATE relay_suppressions SET ${column}=${column==='block_id'?'gen_random_uuid()':"repeat('f',64)"}`),/mail_binding_immutable/);
  for(const table of ['mail_unblock_provider_attempts','mail_unblock_provider_results'])assert.equal((await f.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0');
 }finally{await f.close();}
});
