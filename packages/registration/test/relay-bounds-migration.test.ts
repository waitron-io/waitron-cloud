import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test, {after} from 'node:test';
import {migrationRelease} from './fixtures/migration-release.ts';
const release = await migrationRelease(36);
const target = await migrationRelease(37);
const {migrate,names:migrationNames}=target;
const fixture=(initialise=migrate)=>currentFixture(initialise);
after(()=>target.close());
after(() => release.close());
import {fixture as currentFixture} from './fixtures/relay-worker.ts';
import {RelayBounds} from '../src/relay-bounds.ts';
import {transaction} from '../src/transaction.ts';
const {checkConsumerSchema}=await import(new URL('../../../deploy/local-stack/runtime.mjs',import.meta.url).href);
const {hasReleaseMigrationCount}=await import(new URL('scripts/database-recovery-migrations.mjs','file://'+target.root+'/').href);

async function removeBounds(f:Awaited<ReturnType<typeof fixture>>){
 await f.pool.query('DROP TABLE relay_control');
 await f.pool.query("DELETE FROM schema_migrations WHERE name='036_relay_operator_stop.sql'");
 await f.pool.query('DROP TABLE IF EXISTS cloud_factor_replays,cloud_factor_recovery_codes,cloud_factor_enrolments,cloud_factor_login_challenges,cloud_authenticator_factors; ALTER TABLE cloud_sessions DROP CONSTRAINT IF EXISTS cloud_sessions_factor_account_unique');
 await f.pool.query("DELETE FROM schema_migrations WHERE name='035_authenticator_factor.sql'");
 await f.pool.query('DROP TRIGGER relay_payload_bytes ON relay_messages; DROP TRIGGER relay_payload_bytes_truncate ON relay_messages; DROP FUNCTION relay_account_payload_bytes(); DROP TABLE relay_bounds_counters,relay_bounds_windows,relay_bounds_policy,relay_queue_bytes');
 await f.pool.query("DELETE FROM schema_migrations WHERE name='034_relay_admission_bounds.sql'");
}
test('existing 33-migration ciphertext upgrade is repeatable and concurrent; over-cap draining works',async()=>{
 const f=await fixture(release.migrate);try{
  const v=await f.venue(),a=await v.submit(),b=await v.submit();
  await f.pool.query("UPDATE relay_messages SET state='sending',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute' WHERE message_id=$1",[b.messageId]);
  const before=(await f.pool.query('SELECT * FROM relay_messages ORDER BY message_id')).rows;
  const sum=(await f.pool.query('SELECT sum(octet_length(payload))::text AS bytes FROM relay_messages')).rows[0].bytes;
  await removeBounds(f);
  const legacy=(await f.pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r=>r.name);
  assert.equal(legacy.length,33);assert.equal(legacy.at(-1),'033_relay_worker.sql');assert.deepEqual(legacy,migrationNames.slice(0,33));
  await Promise.all([migrate(f.pool),migrate(f.pool)]);await migrate(f.pool);
  assert.deepEqual((await f.pool.query('SELECT * FROM relay_messages ORDER BY message_id')).rows,before);
  assert.equal((await f.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes,sum);
  const bounds=new RelayBounds(f.pool,{...f.relay.bounds,queuedPayloadBytes:1});await transaction(f.pool,c=>bounds.check(c));
  await assert.rejects(f.pool.query('UPDATE relay_messages SET payload=payload||$1 WHERE message_id=$2',[Buffer.alloc(1),a.messageId]),/relay_bytes_exhausted/);
  await f.pool.query("UPDATE relay_messages SET state='cancelled',reason='cancelled',payload=NULL WHERE message_id=$1",[a.messageId]);
  assert.equal((await f.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes,String(before.find(r=>r.message_id===b.messageId)!.payload.length));
  await f.pool.query("UPDATE relay_messages SET state='uncertain',reason='uncertain',payload=NULL,claim_id=NULL,lease_until=NULL WHERE message_id=$1",[b.messageId]);
  assert.equal((await bounds.status()).retainedPayloadBytes,'0');
  for(const name of migrationNames){const expected=createHash('sha256').update(await readFile(new URL('../migrations/'+name,import.meta.url))).digest('hex');assert.equal((await f.pool.query('SELECT digest FROM schema_migrations WHERE name=$1',[name])).rows[0].digest,expected);}
 }finally{await f.close();}
});
test('interrupted bounds DDL rolls back ledger and tables, then retry succeeds',async()=>{
 const f=await fixture(release.migrate),block=await f.pool.connect();let run:Promise<void>|undefined;
 try{
  await removeBounds(f);await block.query('BEGIN');await block.query('LOCK TABLE relay_messages IN ACCESS EXCLUSIVE MODE');
  run=migrate(f.pool);void run.catch(()=>{});
  let pid:number|undefined;
  for(let i=0;i<200;i++){
   await block.query('SELECT pg_stat_clear_snapshot()');
   const row=(await block.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%relay_bounds_policy%'",[f.schema])).rows[0];if(row){pid=row.pid;break;}await new Promise(r=>setTimeout(r,10));
  }
  assert.ok(pid,'migration reached table lock');await block.query('SELECT pg_cancel_backend($1)',[pid]);await assert.rejects(run,{code:'57014'});
  assert.equal((await block.query("SELECT to_regclass('relay_bounds_policy') AS table")).rows[0].table,null);
  assert.equal((await block.query("SELECT count(*) FROM schema_migrations WHERE name='034_relay_admission_bounds.sql'")).rows[0].count,'0');
  await block.query('COMMIT');await migrate(f.pool);assert.equal((await f.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'37');
 }finally{await block.query('ROLLBACK');block.release();await run?.catch(()=>{});await f.close();}
});
test('current release consumer and recovery gates reject missing, future or changed manifests',async()=>{
 const f=await fixture();try{
  const root=target.root;
  await checkConsumerSchema(f.pool,root);assert.equal(hasReleaseMigrationCount('37'),true);assert.equal(hasReleaseMigrationCount('33'),false);assert.equal(hasReleaseMigrationCount('34'),false);assert.equal(hasReleaseMigrationCount('35'),false);assert.equal(hasReleaseMigrationCount('36'),false);
  const prior=(await f.pool.query("SELECT * FROM schema_migrations WHERE name='034_relay_admission_bounds.sql'")).rows[0];
  await f.pool.query("DELETE FROM schema_migrations WHERE name='034_relay_admission_bounds.sql'");await assert.rejects(checkConsumerSchema(f.pool,root),/schema_incompatible/);
  await f.pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[prior.name,'changed']);await assert.rejects(checkConsumerSchema(f.pool,root),/schema_incompatible/);
  await f.pool.query('UPDATE schema_migrations SET digest=$2 WHERE name=$1',[prior.name,prior.digest]);await f.pool.query("INSERT INTO schema_migrations(name,digest) VALUES('999_future.sql','future')");await assert.rejects(checkConsumerSchema(f.pool,root),/schema_incompatible/);
 }finally{await f.close();}
});
test('pre-upgrade backup restores separately with external keys while upgraded source stays intact',async()=>{
 const {execFile,spawn}=await import('node:child_process');const {promisify}=await import('node:util');const {Pool}=await import('pg');
 const exec=promisify(execFile),f=await fixture(release.migrate);let restored:InstanceType<typeof Pool>|undefined;
 const restoredSchema=f.schema+'_restore';
 try{
  const v=await f.venue(),body=await v.submit();const original=await f.row(body.messageId);await removeBounds(f);
  const port=new URL(process.env.TEST_DATABASE_URL!).port;
  const running=(await exec('docker',['ps','--format','{{.Names}} {{.Ports}}'])).stdout.split('\n');
  const container=running.find(row=>row.startsWith('waitron-cloud-test-')&&!row.includes('-mail ')&&row.includes(':'+port+'->'))?.split(' ')[0];assert.ok(container,'the wrapper owns the backup fixture container');
  const dump=(await exec('docker',['exec',container,'pg_dump','-U','postgres','-d','cloud_test','--schema='+f.schema,'--no-owner','--no-privileges'])).stdout;
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','cloud_test','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let errors='';child.stdout.resume();child.stderr.on('data',b=>errors+=b);
  const exit=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});child.stdin.end(dump.replaceAll(f.schema,restoredSchema));assert.equal(await exit,0,errors);
  restored=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${restoredSchema}`});
  assert.equal((await restored.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'33');
  const copy=(await restored.query('SELECT * FROM relay_messages WHERE message_id=$1',[body.messageId])).rows[0];assert.deepEqual(copy.payload,original.payload);
  const {RelayKeys}=await import('../src/relay-payload.ts');assert.equal(new RelayKeys(f.relay.payloadKeys).open(copy).recipient,body.recipient);
  await migrate(f.pool);assert.equal((await f.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'37');
  assert.equal((await restored.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'33');assert.deepEqual((await f.row(body.messageId)).payload,original.payload);
 }finally{await restored?.end();await f.pool.query(`DROP SCHEMA IF EXISTS ${restoredSchema} CASCADE`);await f.close();}
});
