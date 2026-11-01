import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {migrate,migrationNames} from '../../registration/src/migrate.ts';
import {migrationRelease} from '../../registration/test/fixtures/migration-release.ts';
const {checkConsumerSchema}=await import(new URL('../../../deploy/local-stack/runtime.mjs',import.meta.url).href);
const {hasReleaseMigrationCount}=await import(new URL('../../../scripts/database-recovery-migrations.mjs',import.meta.url).href);
import {collectJob,createJob,jobFingerprint,lockVenue,readJob} from '../src/index.ts';
import {database,connectedVenue} from './fixtures.ts';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
test('release 39 upgrades retained batches without changing outcomes, jobs or existing ledger digests',async()=>{
 const db=await database(),legacy=await migrationRelease(39);
 try{
  await db.pool.query(`DROP SCHEMA ${db.schema} CASCADE; CREATE SCHEMA ${db.schema}`);await legacy.migrate(db.pool);
  const v=await connectedVenue(db,issuer,'https://cloud.example.test'),body=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca']},items:[{ref:'p1',kind:'product',family:'p1',category:null,staffName:'Cafe',existing:{},missing:['ca']}],houseStyle:[]});
  const job=await transaction(db.pool,async c=>{await lockVenue(c,v.venueId);return createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(body),body,total:1});});
  const batch={0:{results:[{ref:'p1',names:{ca:'Cafè 😀'},placeholder:false,corrections:[]}],failed:[]}};
  await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[job.id,batch]);
  await db.pool.query("UPDATE translation_jobs SET state='done',done=1,finished_at=clock_timestamp() WHERE id=$1",[job.id]);
  const rows=(await db.pool.query('SELECT * FROM translation_jobs')).rows,ledger=(await db.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  assert.equal(hasReleaseMigrationCount('39'),false);await assert.rejects(checkConsumerSchema(db.pool,new URL('../../../',import.meta.url).pathname));
  const held=await db.secondPool.connect();
  try{
   await held.query('BEGIN');await held.query('LOCK schema_migrations IN SHARE MODE');
   const interrupted=migrate(db.pool).then(()=>undefined,error=>error);let pid:number|undefined;
   for(let attempt=0;attempt<200&&!pid;attempt++){
    pid=(await db.secondPool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'INSERT INTO schema_migrations%'",[db.schema])).rows[0]?.pid;
    if(!pid)await delay(10);
   }
   assert.ok(pid,'migration must reach its ledger insertion');await db.secondPool.query('SELECT pg_cancel_backend($1)',[pid]);
   assert.equal((await interrupted).code,'57014');await held.query('ROLLBACK');
   assert.deepEqual((await db.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,ledger);
   assert.deepEqual((await db.pool.query('SELECT * FROM translation_jobs')).rows,rows);
   assert.deepEqual((await db.pool.query('SELECT batch_results FROM translation_job_bodies WHERE job_id=$1',[job.id])).rows,[{batch_results:batch}]);
   assert.equal((await db.pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='translation_job_bodies' AND column_name='batch_results'",[db.schema])).rows[0].data_type,'jsonb');
  }finally{await held.query('ROLLBACK');held.release();}
  await Promise.all([migrate(db.pool),migrate(db.secondPool)]);await migrate(db.pool);
  assert.deepEqual((await db.pool.query('SELECT * FROM translation_jobs')).rows,rows);
  assert.deepEqual((await db.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0,39),ledger);
  assert.deepEqual((await db.pool.query('SELECT body,batch_results FROM translation_job_bodies WHERE job_id=$1',[job.id])).rows,[{body,batch_results:batch}]);
  assert.equal(migrationNames.length,46);assert.equal(migrationNames.at(-1),'046_data_lifecycle.sql');assert.equal(migrationNames.at(44),'045_billing_store.sql');assert.equal(migrationNames[43],'044_remote_forward_observations.sql');assert.equal(migrationNames[42],'043_backup_target_verification.sql');assert.equal(migrationNames[39],'040_translation_result_json.sql');assert.equal(migrationNames[40],'041_content_translation_service.sql');assert.equal(migrationNames[41],'042_organisation_service_plans.sql');
  assert.equal(hasReleaseMigrationCount('43'),false);assert.equal(hasReleaseMigrationCount('40'),false);assert.equal(hasReleaseMigrationCount('41'),false);assert.equal(hasReleaseMigrationCount('42'),false);assert.equal(hasReleaseMigrationCount('44'),false);assert.equal(hasReleaseMigrationCount(String(migrationNames.length)),true);
  await checkConsumerSchema(db.pool,new URL('../../../',import.meta.url).pathname);
  const sql=await readFile(new URL('../../registration/migrations/040_translation_result_json.sql',import.meta.url));
  assert.equal((await db.pool.query('SELECT digest FROM schema_migrations WHERE name=$1',[migrationNames[39]])).rows[0].digest,createHash('sha256').update(sql).digest('hex'));
  const result={ref:'p1',names:{ca:'\u0000\ud800\udfff'},placeholder:false,corrections:[]};
  await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[job.id,{0:{results:[result],failed:[]}}]);
  assert.deepEqual((await transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,job.id)))).results,[result]);
 }finally{await db.close();await legacy.close();}
});
