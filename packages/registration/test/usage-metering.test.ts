import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {Pool} from 'pg';
import {createSession} from '@waitron-cloud/identity';
import {
  recordUsageEvent,
  transaction,
  UsageReconciler,
  UsageStore,
  type UsageEventInput,
} from '../src/index.ts';
import {migrate} from '../src/migrate.ts';

const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Run through scripts/test-postgres.mjs');
const schema=`usage_${randomUUID().replaceAll('-','')}`;
const options=`-c search_path=${schema} -c statement_timeout=10000`;
const admin=new Pool({connectionString:url});
const pool=new Pool({connectionString:url,options,application_name:`${schema}_usage`});
const reconciler=new UsageReconciler(pool);
const accountId=randomUUID(),secondAccountId=randomUUID();
const organisationId=randomUUID(),secondOrganisationId=randomUUID();
const businessId=randomUUID(),secondBusinessId=randomUUID();
const venueId=randomUUID(),secondVenueId=randomUUID();
const installationId=randomUUID(),secondInstallationId=randomUUID();
const occurredAt='2026-09-26T10:00:00.000Z';

before(async()=>{
 await admin.query(`CREATE SCHEMA ${schema}`);
 await migrate(pool);
});
after(async()=>{
 await pool.end();
 await admin.query(`DROP SCHEMA ${schema} CASCADE`);
 await admin.end();
});
beforeEach(async()=>{
 await pool.query('TRUNCATE organisations,cloud_accounts CASCADE');
 await pool.query('UPDATE usage_reconciliation_sources SET last_attempted_at=NULL,caught_up_at=NULL');
 await pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)',[accountId,secondAccountId]);
 await pool.query('INSERT INTO organisations(id) VALUES($1),($2)',[organisationId,secondOrganisationId]);
 await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2),($3,$4)',[businessId,organisationId,secondBusinessId,secondOrganisationId]);
 await pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true),($3,$4,true,true)',[accountId,organisationId,secondAccountId,secondOrganisationId]);
 await pool.query(`INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment)
  VALUES($1,$2,$3,$4,'test'),($5,$6,$7,$8,'test')`,[venueId,organisationId,businessId,randomUUID(),secondVenueId,secondOrganisationId,secondBusinessId,randomUUID()]);
 await pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3),($4,$5,$6)',[installationId,venueId,`key:${installationId}`,secondInstallationId,secondVenueId,`key:${secondInstallationId}`]);
 await pool.query("INSERT INTO installation_services(installation_id,service) VALUES($1,'remote_access'),($1,'continuous_backup'),($1,'retained_snapshots'),($2,'remote_access'),($2,'continuous_backup'),($2,'retained_snapshots')",[installationId,secondInstallationId]);
});

function input(overrides:Partial<UsageEventInput>={}):UsageEventInput{
 return {organisationId,venueId,type:'backup.storage_added_bytes',quantity:9007199254740993n,
  sourceKind:'backup_point',sourceReference:randomUUID(),occurredAt,...overrides};
}
async function count(table:string){return Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);}
async function expectCode(action:Promise<unknown>,code:string){
 await assert.rejects(action,(error:unknown)=>typeof error==='object'&&error!==null&&'code' in error&&error.code===code);
}

test('identical reports keep one stable immutable event and conflicting source reuse fails closed',async()=>{
 const same=input();
 const first=await transaction(pool,client=>recordUsageEvent(client,same));
 const replay=await transaction(pool,client=>recordUsageEvent(client,same));
 assert.equal(replay.id,first.id);
 assert.equal(await count('usage_events'),1);
 for(const changed of [
  {organisationId:secondOrganisationId,venueId:secondVenueId},
  {venueId:secondVenueId},
  {quantity:same.quantity+1n},
  {occurredAt:'2026-09-26T10:00:01.000Z'},
 ])await expectCode(transaction(pool,client=>recordUsageEvent(client,{...same,...changed})),'usage_conflict');
 await assert.rejects(pool.query('UPDATE usage_events SET quantity=1'),/usage_event_immutable/);
 await assert.rejects(pool.query('DELETE FROM usage_events'),/usage_event_immutable/);
 assert.equal(await count('usage_events'),1);
});

test('reports reject foreign venues and invalid fixed fields before writing',async()=>{
 await expectCode(transaction(pool,client=>recordUsageEvent(client,input({venueId:secondVenueId}))),'usage_conflict');
 for(const invalid of [
  input({type:'unknown' as UsageEventInput['type']}),
  input({sourceKind:'unknown' as UsageEventInput['sourceKind']}),
  input({type:'operation.monitoring_probe',sourceKind:'backup_point'}),
  input({type:'operation.monitoring_probe',sourceKind:'monitoring_probe',quantity:2n}),
  input({quantity:0n}),input({quantity:-1n}),
  input({sourceReference:'contains a space'}),
  input({sourceReference:'x'.repeat(257)}),
  input({occurredAt:'2026-09-26'}),
  input({occurredAt:'not-a-date'}),
 ])await expectCode(transaction(pool,client=>recordUsageEvent(client,invalid)),'invalid_input');
 assert.equal(await count('usage_events'),0);
});

test('owner summary is passive, tenant-scoped, precision-safe and honest about freshness',async()=>{
 const session=await transaction(pool,client=>createSession(client,accountId));
 const eventInputs:UsageEventInput[]=[
  input({type:'backup.storage_added_bytes',quantity:9007199254740993n,sourceKind:'backup_point',sourceReference:randomUUID(),occurredAt:'2026-09-26T10:00:00.000Z'}),
  input({type:'backup.storage_removed_bytes',quantity:3n,sourceKind:'backup_point',sourceReference:randomUUID(),occurredAt:'2026-09-26T10:00:01.000Z'}),
  input({type:'backup.upload_bytes',quantity:23n,sourceKind:'backup_point',sourceReference:randomUUID(),occurredAt:'2026-09-26T10:00:02.000Z'}),
  input({type:'backup.restore_bytes',quantity:17n,sourceKind:'backup_recovery',sourceReference:randomUUID(),occurredAt:'2026-09-26T10:00:03.000Z'}),
  input({type:'operation.installation_completed',quantity:1n,sourceKind:'installation_operation',sourceReference:`${installationId}:${randomUUID()}`,occurredAt:'2026-09-26T10:00:04.000Z'}),
  input({type:'operation.monitoring_probe',quantity:1n,sourceKind:'monitoring_probe',sourceReference:`${installationId}:public:2026-09-26T10:00:05.000Z`,occurredAt:'2026-09-26T10:00:05.000Z'}),
  input({type:'message.service_alert_sent',quantity:1n,sourceKind:'service_alert',sourceReference:randomUUID(),occurredAt:'2026-09-26T10:00:06.000Z'}),
  input({type:'message.service_alert_failed',quantity:1n,sourceKind:'service_alert',sourceReference:randomUUID(),occurredAt:'2026-09-26T10:00:07.000Z'}),
  input({type:'message.service_alert_expired',quantity:1n,sourceKind:'service_alert',sourceReference:randomUUID(),occurredAt:'2026-09-26T10:00:08.000Z'}),
  input({type:'message.service_alert_cancelled',quantity:1n,sourceKind:'service_alert',sourceReference:randomUUID(),occurredAt:'2026-09-26T10:00:09.000Z'}),
 ];
 for(const event of eventInputs)await transaction(pool,client=>recordUsageEvent(client,event));
 await transaction(pool,client=>recordUsageEvent(client,input({organisationId:secondOrganisationId,venueId:secondVenueId,quantity:999n,sourceReference:randomUUID(),occurredAt:'2026-09-26T10:00:10.000Z'})));
 const store=new UsageStore(pool),summary=await store.summary(session.token,{organisationId});
 assert.deepEqual(summary,{
  version:1,organisationId,
  storage:{currentBytes:'9007199254740990',addedBytes:'9007199254740993',removedBytes:'3'},
  transfer:{uploadedBytes:'23',restoredBytes:'17'},
  operations:{installationCompleted:'1',monitoringProbes:'1'},
  messages:{sent:'1',failed:'1',expired:'1',cancelled:'1'},
  latestEventAt:'2026-09-26T10:00:09.000Z',measuredThrough:null,
 });
 const sessionRow=(await pool.query('SELECT created_at,last_seen_at FROM cloud_sessions WHERE account_id=$1',[accountId])).rows[0];
 assert.equal(sessionRow.last_seen_at.getTime(),sessionRow.created_at.getTime());
 await pool.query("UPDATE usage_reconciliation_sources SET caught_up_at='2026-09-26T11:00:00.000Z'");
 assert.equal((await store.summary(session.token,{organisationId})).measuredThrough,'2026-09-26T11:00:00.000Z');
 await pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1 AND organisation_id=$2',[accountId,organisationId]);
 await expectCode(store.summary(session.token,{organisationId}),'permission_denied');
});

async function seedSources(){
 await pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://storage.example.test','usage-bucket','test')",[venueId,installationId]);
 await pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'sealed')",[venueId]);
 const activePoint=randomUUID(),deletedPoint=randomUUID(),node=randomUUID();
 for(const [id,size,captured,deleted] of [[activePoint,7,'2026-09-26T10:01:00.000Z',null],[deletedPoint,11,'2026-09-26T10:02:00.000Z','2026-09-26T10:03:00.000Z']] as const){
  await pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version,created_at) VALUES($1,$2,$3,1,$4)',[id,venueId,installationId,captured]);
  await pool.query(`INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification,deleting,deleted_at)
   VALUES($1,$2,$3,1,'snapshot',$4,$5,$6,$7,'daily',$8,'{}','verified',$9,$10)`,
  [id,venueId,installationId,`snapshots/${id}`,id.replaceAll('-','').slice(0,1).repeat(64),size,captured,node,deleted!==null,deleted]);
 }
 const recoveryId=randomUUID();
 await pool.query(`INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode,status,created_at,expires_at,restored_at)
  VALUES($1,$2,$3,$4,$5,'failure','restored',$6,$7,$8)`,[recoveryId,venueId,activePoint,accountId,`restore:${recoveryId}`,'2026-09-26T10:04:00.000Z','2026-09-26T11:04:00.000Z','2026-09-26T10:05:00.000Z']);
 for(const created of ['2026-09-26T10:06:00.000Z','2026-09-26T10:07:00.000Z'])await pool.query(
  "INSERT INTO installation_operations(installation_id,operation_id,digest,result,created_at) VALUES($1,$2,'digest','{}',$3)",[installationId,randomUUID(),created]);
 for(const [status,finished,kind] of [['sent','2026-09-26T10:08:00.000Z','disconnected'],['failed','2026-09-26T10:09:00.000Z','snapshot_stale']] as const){
  const incident=randomUUID(),outbox=randomUUID();
  await pool.query(`INSERT INTO venue_incidents(id,venue_id,kind,status,revision,opened_at,changed_at)
   VALUES($1,$2,$3,'recovered',2,$4,$4)`,[incident,venueId,kind,finished]);
  await pool.query(`INSERT INTO email_outbox(id,kind,status,created_at,expires_at,available_at,attempts,failures,last_error,finished_at)
   VALUES($1,'service_alert',$2,$3,$3,$3,1,$4,$5,$3)`,[outbox,status,finished,status==='failed'?1:0,status==='failed'?'delivery_rejected':null]);
  await pool.query("INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id) VALUES($1,$2,2,'recovered',$3)",[outbox,incident,accountId]);
 }
 return {activePoint,deletedPoint,recoveryId};
}

test('bounded reconciliation resumes to exact totals and a lost reply is idempotent',async()=>{
 await seedSources();
 let passes=0;
 for(;passes<20;passes++){
  const result=await reconciler.runOnce(1);
  assert.equal(result.acquired,true);
  assert.ok(Object.values(result.sources).every(source=>source.recorded<=1));
  if(Object.values(result.sources).every(source=>source.caughtUp))break;
 }
 assert.ok(passes<20,'bounded reconciliation must eventually catch up');
 assert.equal(await count('usage_events'),10);
 const before=(await pool.query('SELECT id,event_type,source_kind,source_reference,quantity::text FROM usage_events ORDER BY id')).rows;
 const replay=await reconciler.runOnce(1);
 assert.ok(Object.values(replay.sources).every(source=>source.recorded===0&&source.caughtUp));
 assert.deepEqual((await pool.query('SELECT id,event_type,source_kind,source_reference,quantity::text FROM usage_events ORDER BY id')).rows,before);
 const status=await reconciler.status();
 assert.deepEqual(status.sources.map(source=>source.source),['backup_points','backup_recoveries','installation_operations','service_alerts']);
 assert.ok(status.sources.every(source=>source.lastAttemptedAt&&source.caughtUpAt));
});

test('a failed reconciliation batch leaves no partial events or false freshness and can retry',async()=>{
 await seedSources();
 await pool.query("ALTER TABLE usage_events ADD CONSTRAINT fixture_reject_storage CHECK(event_type<>'backup.storage_added_bytes')");
 try{
  await assert.rejects(reconciler.runOnce(100),/fixture_reject_storage/);
  assert.equal(await count('usage_events'),0);
  assert.ok((await reconciler.status()).sources.every(source=>source.lastAttemptedAt===null&&source.caughtUpAt===null));
 }finally{await pool.query('ALTER TABLE usage_events DROP CONSTRAINT fixture_reject_storage');}
 const recovered=await reconciler.runOnce(100);
 assert.ok(Object.values(recovered.sources).every(source=>source.caughtUp));
 assert.equal(await count('usage_events'),10);
});
